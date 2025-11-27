/**
 * SOCKS5 Proxy Server
 * Implements SOCKS5 protocol for legacy device connections
 */

import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import { TLSSocket, type TLSSocket as TLSSocketType, connect as tlsConnect } from 'node:tls';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gunzipSync, brotliDecompressSync, inflateSync, gzipSync } from 'node:zlib';
import { getConfig } from '../config/index.js';
import { generateDomainCert } from '../certs/index.js';
import { getCached, setCache } from '../cache/index.js';
import { transformJs, transformCss, transformHtml, isHtmlDocument } from '../transformers/index.js';
import { transformImage, needsImageTransform } from '../transformers/image.js';

// SOCKS5 constants
const SOCKS_VERSION = 0x05;

// Authentication methods
const AUTH_NO_AUTH = 0x00;
const AUTH_NO_ACCEPTABLE = 0xff;

// Address types
const ADDR_IPV4 = 0x01;
const ADDR_DOMAIN = 0x03;
const ADDR_IPV6 = 0x04;

// Commands
const CMD_CONNECT = 0x01;
// const CMD_BIND = 0x02;     // Not implemented
// const CMD_UDP = 0x03;      // Not implemented

// Reply codes
const REPLY_SUCCESS = 0x00;
const REPLY_GENERAL_FAILURE = 0x01;
// const REPLY_CONNECTION_NOT_ALLOWED = 0x02;
const REPLY_NETWORK_UNREACHABLE = 0x03;
// const REPLY_HOST_UNREACHABLE = 0x04;
// const REPLY_CONNECTION_REFUSED = 0x05;
// const REPLY_TTL_EXPIRED = 0x06;
const REPLY_COMMAND_NOT_SUPPORTED = 0x07;
const REPLY_ADDRESS_TYPE_NOT_SUPPORTED = 0x08;

interface ParsedAddress {
  host: string;
  port: number;
  addressType: number;
}

// Check if content type should be gzip compressed
function shouldCompress(contentType: string): boolean {
  const compressibleTypes = [
    'text/',
    'application/json',
    'application/javascript',
    'application/xml',
    'application/xhtml+xml',
    'application/rss+xml',
    'application/atom+xml',
    'image/svg+xml',
  ];
  const ct = contentType.toLowerCase();
  return compressibleTypes.some(type => ct.includes(type));
}

// Check if client accepts gzip encoding
function acceptsGzipEncoding(acceptEncoding: string | undefined): boolean {
  return (acceptEncoding || '').includes('gzip');
}

enum ConnectionState {
  AWAITING_GREETING,
  AWAITING_REQUEST,
  CONNECTED,
}

function parseAddress(buffer: Buffer, offset: number): ParsedAddress | null {
  const addressType = buffer[offset];
  let host: string;
  let port: number;
  let endOffset: number;
  
  switch (addressType) {
    case ADDR_IPV4:
      if (buffer.length < offset + 7) return null;
      host = `${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}.${buffer[offset + 4]}`;
      port = buffer.readUInt16BE(offset + 5);
      endOffset = offset + 7;
      break;
      
    case ADDR_DOMAIN:
      const domainLength = buffer[offset + 1];
      if (buffer.length < offset + 2 + domainLength + 2) return null;
      host = buffer.subarray(offset + 2, offset + 2 + domainLength).toString('ascii');
      port = buffer.readUInt16BE(offset + 2 + domainLength);
      endOffset = offset + 4 + domainLength;
      break;
      
    case ADDR_IPV6:
      if (buffer.length < offset + 19) return null;
      const ipv6Parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        ipv6Parts.push(buffer.readUInt16BE(offset + 1 + i * 2).toString(16));
      }
      host = ipv6Parts.join(':');
      port = buffer.readUInt16BE(offset + 17);
      endOffset = offset + 19;
      break;
      
    default:
      return null;
  }
  
  return { host, port, addressType };
}

function createReply(
  replyCode: number,
  addressType: number = ADDR_IPV4,
  bindAddress: string = '0.0.0.0',
  bindPort: number = 0
): Buffer {
  let addressBuffer: Buffer;
  
  if (addressType === ADDR_IPV4) {
    const parts = bindAddress.split('.').map(Number);
    addressBuffer = Buffer.from([ADDR_IPV4, ...parts]);
  } else if (addressType === ADDR_IPV6) {
    // Simplified: just use zeros
    addressBuffer = Buffer.alloc(17);
    addressBuffer[0] = ADDR_IPV6;
  } else {
    // Domain - shouldn't happen in replies usually
    addressBuffer = Buffer.from([ADDR_IPV4, 0, 0, 0, 0]);
  }
  
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(bindPort, 0);
  
  return Buffer.concat([
    Buffer.from([SOCKS_VERSION, replyCode, 0x00]),
    addressBuffer,
    portBuffer,
  ]);
}

// Content type detection
type ContentType = 'js' | 'css' | 'html' | 'other';

function getCharset(contentType: string): string {
  // Extract charset from Content-Type header: text/html; charset=utf-8
  const charsetMatch = contentType.match(/charset=([\w-]+)/i);
  if (charsetMatch) {
    return charsetMatch[1].toLowerCase();
  }
  return 'utf-8'; // Default to UTF-8
}

function getContentType(headers: Record<string, string | string[] | undefined>, url: string): ContentType {
  const contentType = (headers['content-type'] as string || '').toLowerCase();
  
  // Check for binary/non-text content types first - these should never be transformed
  if (contentType.includes('image/') || 
      contentType.includes('video/') || 
      contentType.includes('audio/') ||
      contentType.includes('font/') ||
      contentType.includes('application/octet-stream') ||
      contentType.includes('application/pdf') ||
      contentType.includes('application/zip') ||
      contentType.includes('application/gzip')) {
    return 'other';
  }
  
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    return 'js';
  }
  if (contentType.includes('text/css')) {
    return 'css';
  }
  if (contentType.includes('text/html')) {
    return 'html';
  }
  
  // If we have a content-type but it's not something we transform, skip it
  if (contentType && !contentType.includes('text/')) {
    return 'other';
  }
  
  // Fallback to URL-based detection only if no content-type was provided
  if (!contentType) {
    const pathname = new URL(url, 'http://localhost').pathname.toLowerCase();
    if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
      return 'js';
    }
    if (pathname.endsWith('.css')) {
      return 'css';
    }
    if (pathname.endsWith('.html') || pathname.endsWith('.htm') || pathname === '/') {
      return 'html';
    }
  }
  
  return 'other';
}

function decompressBody(body: Buffer, encoding: string | undefined): Buffer {
  if (!encoding) return body;
  
  try {
    switch (encoding.toLowerCase()) {
      case 'gzip':
        return gunzipSync(body);
      case 'br':
        return brotliDecompressSync(body);
      case 'deflate':
        return inflateSync(body);
      default:
        return body;
    }
  } catch {
    return body;
  }
}

// Windows-1251 (Cyrillic) character map for bytes 128-255
const WINDOWS_1251_MAP: string[] = [
  '\u0402', '\u0403', '\u201A', '\u0453', '\u201E', '\u2026', '\u2020', '\u2021', // 128-135
  '\u20AC', '\u2030', '\u0409', '\u2039', '\u040A', '\u040C', '\u040B', '\u040F', // 136-143
  '\u0452', '\u2018', '\u2019', '\u201C', '\u201D', '\u2022', '\u2013', '\u2014', // 144-151
  '\uFFFD', '\u2122', '\u0459', '\u203A', '\u045A', '\u045C', '\u045B', '\u045F', // 152-159
  '\u00A0', '\u040E', '\u045E', '\u0408', '\u00A4', '\u0490', '\u00A6', '\u00A7', // 160-167
  '\u0401', '\u00A9', '\u0404', '\u00AB', '\u00AC', '\u00AD', '\u00AE', '\u0407', // 168-175
  '\u00B0', '\u00B1', '\u0406', '\u0456', '\u0491', '\u00B5', '\u00B6', '\u00B7', // 176-183
  '\u0451', '\u2116', '\u0454', '\u00BB', '\u0458', '\u0405', '\u0455', '\u0457', // 184-191
  '\u0410', '\u0411', '\u0412', '\u0413', '\u0414', '\u0415', '\u0416', '\u0417', // 192-199
  '\u0418', '\u0419', '\u041A', '\u041B', '\u041C', '\u041D', '\u041E', '\u041F', // 200-207
  '\u0420', '\u0421', '\u0422', '\u0423', '\u0424', '\u0425', '\u0426', '\u0427', // 208-215
  '\u0428', '\u0429', '\u042A', '\u042B', '\u042C', '\u042D', '\u042E', '\u042F', // 216-223
  '\u0430', '\u0431', '\u0432', '\u0433', '\u0434', '\u0435', '\u0436', '\u0437', // 224-231
  '\u0438', '\u0439', '\u043A', '\u043B', '\u043C', '\u043D', '\u043E', '\u043F', // 232-239
  '\u0440', '\u0441', '\u0442', '\u0443', '\u0444', '\u0445', '\u0446', '\u0447', // 240-247
  '\u0448', '\u0449', '\u044A', '\u044B', '\u044C', '\u044D', '\u044E', '\u044F', // 248-255
];

function decodeWindows1251(buffer: Buffer): string {
  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte < 128) {
      result += String.fromCharCode(byte);
    } else {
      result += WINDOWS_1251_MAP[byte - 128];
    }
  }
  return result;
}

// Check if buffer contains binary content by looking for common binary file signatures
function isBinaryContent(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  
  // Check for common binary file signatures (magic bytes)
  const signatures = [
    [0x47, 0x49, 0x46, 0x38],       // GIF (GIF87a, GIF89a)
    [0x89, 0x50, 0x4E, 0x47],       // PNG
    [0xFF, 0xD8, 0xFF],              // JPEG
    [0x52, 0x49, 0x46, 0x46],       // WEBP (RIFF)
    [0x00, 0x00, 0x00],              // Various (MP4, etc.)
    [0x50, 0x4B, 0x03, 0x04],       // ZIP/XLSX/DOCX
    [0x25, 0x50, 0x44, 0x46],       // PDF
    [0x1F, 0x8B],                    // GZIP
  ];
  
  for (const sig of signatures) {
    let match = true;
    for (let i = 0; i < sig.length && i < buffer.length; i++) {
      if (buffer[i] !== sig[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  
  return false;
}

async function transformContent(body: Buffer, contentType: ContentType, url: string, charset: string = 'utf-8'): Promise<Buffer> {
  const config = getConfig();
  
  // Safety check: don't transform binary content even if content-type was wrong
  if (isBinaryContent(body)) {
    console.log(`⏭️ Skipping binary content: ${url}`);
    return body;
  }
  
  // Check cache first
  const cached = await getCached(url, contentType);
  if (cached) {
    console.log(`📦 Cache hit: ${url}`);
    return cached;
  }
  
  let transformed: string;
  
  // Convert buffer to string using the correct charset
  let text: string;
  const normalizedCharset = charset.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Handle common Russian/Cyrillic encodings
  if (normalizedCharset === 'windows1251' || normalizedCharset === 'cp1251' || normalizedCharset === 'win1251') {
    // Windows-1251 (Cyrillic) - manually decode
    text = decodeWindows1251(body);
  } else if (normalizedCharset === 'koi8r' || normalizedCharset === 'koi8u') {
    // KOI8-R/KOI8-U - try as UTF-8 first, fallback to latin1
    text = body.toString('utf-8');
  } else if (normalizedCharset === 'iso88591' || normalizedCharset === 'latin1') {
    text = body.toString('latin1');
  } else {
    // Default to UTF-8
    text = body.toString('utf-8');
  }
  
  switch (contentType) {
    case 'js':
      if (config.transformJs) {
        console.log(`🔧 Transforming JS: ${url}`);
        transformed = await transformJs(text, url);
      } else {
        transformed = text;
      }
      break;
    case 'css':
      if (config.transformCss) {
        console.log(`🎨 Transforming CSS: ${url}`);
        transformed = await transformCss(text, url);
      } else {
        transformed = text;
      }
      break;
    case 'html':
      if (config.transformHtml && isHtmlDocument(text)) {
        console.log(`📄 Transforming HTML: ${url}`);
        transformed = await transformHtml(text, url);
      } else {
        transformed = text;
      }
      break;
    default:
      return body;
  }
  
  const result = Buffer.from(transformed, 'utf-8');
  
  // Cache the result
  await setCache(url, contentType, result);
  
  return result;
}

function shouldBlockDomain(hostname: string): boolean {
  const config = getConfig();
  
  // Check ad domains
  if (config.removeAds) {
    for (const domain of config.adDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }
  
  // Check tracking domains
  if (config.removeTracking) {
    for (const domain of config.trackingDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }
  
  return false;
}

function shouldBlockUrl(url: string): boolean {
  const config = getConfig();
  
  // Check tracking URL patterns
  if (config.removeTracking) {
    const urlLower = url.toLowerCase();
    for (const pattern of config.trackingUrls) {
      if (urlLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }
  
  return false;
}

function handleConnection(clientSocket: Socket, httpProxyPort: number): void {
  let state = ConnectionState.AWAITING_GREETING;
  let targetSocket: Socket | TLSSocket | null = null;
  
  // Data buffer for partial reads
  let buffer = Buffer.alloc(0);
  
  clientSocket.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    
    switch (state) {
      case ConnectionState.AWAITING_GREETING:
        handleGreeting();
        break;
      case ConnectionState.AWAITING_REQUEST:
        handleRequest();
        break;
      case ConnectionState.CONNECTED:
        // Should not happen - data should go directly to target
        if (targetSocket && !targetSocket.destroyed) {
          targetSocket.write(data);
        }
        break;
    }
  });
  
  function handleGreeting() {
    // Minimum greeting: version(1) + nmethods(1) + methods(1+)
    if (buffer.length < 3) return;
    
    const version = buffer[0];
    const nmethods = buffer[1];
    
    // Detect HTTP requests sent to SOCKS port by mistake
    // HTTP methods start with: GET (71), POST (80), PUT (80), HEAD (72), 
    // DELETE (68), CONNECT (67), OPTIONS (79), PATCH (80)
    // ASCII: C=67, G=71, P=80, H=72, D=68, O=79
    const httpMethodChars = [67, 68, 71, 72, 79, 80]; // C, D, G, H, O, P
    if (httpMethodChars.includes(version)) {
      // This is likely an HTTP request, not SOCKS5
      // Silently close - don't spam logs
      clientSocket.end();
      return;
    }
    
    if (version !== SOCKS_VERSION) {
      console.error(`❌ Invalid SOCKS version: ${version}`);
      clientSocket.end();
      return;
    }
    
    if (buffer.length < 2 + nmethods) return;
    
    const methods = buffer.subarray(2, 2 + nmethods);
    
    // Check if NO_AUTH is supported
    if (methods.includes(AUTH_NO_AUTH)) {
      // Accept no authentication
      clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_AUTH]));
      state = ConnectionState.AWAITING_REQUEST;
    } else {
      // No acceptable methods
      clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_ACCEPTABLE]));
      clientSocket.end();
      return;
    }
    
    // Clear buffer
    buffer = buffer.subarray(2 + nmethods);
  }
  
  function handleRequest() {
    // Minimum request: version(1) + cmd(1) + rsv(1) + atyp(1) + addr(min 1) + port(2)
    if (buffer.length < 7) return;
    
    const version = buffer[0];
    const command = buffer[1];
    // const reserved = buffer[2];
    
    if (version !== SOCKS_VERSION) {
      clientSocket.write(createReply(REPLY_GENERAL_FAILURE));
      clientSocket.end();
      return;
    }
    
    // Only support CONNECT command
    if (command !== CMD_CONNECT) {
      clientSocket.write(createReply(REPLY_COMMAND_NOT_SUPPORTED));
      clientSocket.end();
      return;
    }
    
    const address = parseAddress(buffer, 3);
    if (!address) {
      // Need more data or invalid address
      if (buffer.length > 300) {
        // Too much data, probably garbage
        clientSocket.write(createReply(REPLY_ADDRESS_TYPE_NOT_SUPPORTED));
        clientSocket.end();
      }
      return;
    }
    
    console.log(`🔌 SOCKS5 CONNECT: ${address.host}:${address.port}`);
    
    // Check if domain should be blocked
    if (shouldBlockDomain(address.host)) {
      console.log(`🚫 Blocked: ${address.host}`);
      clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
      clientSocket.end();
      return;
    }
    
    const isHttp = address.port === 80;
    const isHttps = address.port === 443;
    
    if (isHttps) {
      // For HTTPS: We need to do TLS interception
      // 1. Tell client connection is established
      // 2. Perform TLS handshake with client using our cert
      // 3. Connect to real server with TLS
      // 4. Intercept and transform data
      handleHttpsConnection(clientSocket, address.host, address.addressType);
    } else if (isHttp) {
      // For HTTP: Connect to target and intercept
      handleHttpConnection(clientSocket, address.host, address.port, address.addressType);
    } else {
      // For non-HTTP traffic, connect directly (no interception)
      targetSocket = connect(address.port, address.host, () => {
        console.log(`✅ Direct connection to ${address.host}:${address.port}`);
        
        // Send success reply
        clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
        state = ConnectionState.CONNECTED;
        
        // Clear buffer
        buffer = Buffer.alloc(0);
        
        // Pipe data between client and target
        clientSocket.pipe(targetSocket!);
        targetSocket!.pipe(clientSocket);
      });
      
      targetSocket.on('error', (err) => {
        console.error(`❌ Target socket error: ${err.message}`);
        if (state === ConnectionState.AWAITING_REQUEST) {
          clientSocket.write(createReply(REPLY_NETWORK_UNREACHABLE));
        }
        clientSocket.end();
      });
      
      targetSocket.on('close', () => {
        clientSocket.end();
      });
    }
  }
  
  // Handle HTTPS with TLS interception
  function handleHttpsConnection(clientSocket: Socket, hostname: string, addressType: number): void {
    console.log(`🔒 Starting TLS interception for ${hostname}`);
    // First, tell the client the connection is established
    clientSocket.write(createReply(REPLY_SUCCESS, addressType));
    
    // Generate certificate for this domain
    const certPair = generateDomainCert(hostname);
    
    // Create a TLS server to handle the client connection
    const tlsOptions = {
      key: certPair.key,
      cert: certPair.cert,
      isServer: true,
    };
    
    // Upgrade client socket to TLS using TLSSocket
    const tlsServer = new TLSSocket(clientSocket, tlsOptions);
    
    tlsServer.on('secure', () => {
      console.log(`🔐 TLS handshake complete with client for ${hostname}`);
    });
    
    // Buffer for incoming HTTP request
    let requestBuffer = Buffer.alloc(0);
    let requestComplete = false;
    
    tlsServer.on('data', async (data: Buffer) => {
      if (requestComplete) return;
      
      requestBuffer = Buffer.concat([requestBuffer, data]);
      
      // Check if we have complete HTTP headers
      const headerEnd = requestBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      
      requestComplete = true;
      
      // Parse the HTTP request
      const headerStr = requestBuffer.subarray(0, headerEnd).toString('utf-8');
      const bodyStart = headerEnd + 4;
      const lines = headerStr.split('\r\n');
      const requestLine = lines[0];
      const [method, path] = requestLine.split(' ');
      
      // Parse headers
      const headers: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
          const key = lines[i].substring(0, colonIdx).toLowerCase();
          const value = lines[i].substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }
      
      // Get content length for body
      const contentLength = parseInt(headers['content-length'] || '0', 10);
      let requestBody = requestBuffer.subarray(bodyStart);
      
      // Wait for full body if needed
      while (requestBody.length < contentLength) {
        const moreData = await new Promise<Buffer>((resolve) => {
          tlsServer.once('data', resolve);
        });
        requestBody = Buffer.concat([requestBody, moreData]);
      }
      
      const targetUrl = `https://${hostname}${path}`;
      console.log(`🔐 HTTPS: ${method} ${targetUrl}`);
      
      // Block tracking URLs by pattern
      if (shouldBlockUrl(targetUrl)) {
        console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
        const blockedResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        tlsServer.write(blockedResponse);
        tlsServer.end();
        return;
      }
      
      // Check for WebSocket upgrade request
      const upgradeHeader = headers['upgrade']?.toLowerCase();
      if (upgradeHeader === 'websocket') {
        console.log(`🔌 WebSocket upgrade request: ${targetUrl}`);
        handleWebSocketUpgrade(tlsServer, hostname, path, headers, requestBuffer);
        return;
      }
      
      // Handle CORS preflight requests
      // Use the Origin header for CORS to support credentials
      const requestOrigin = headers['origin'] || '*';
      
      if (method === 'OPTIONS') {
        const corsResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n' +
          'Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, X-File-Size, X-File-Type, X-Client-Data, X-Goog-Api-Key, X-Goog-AuthUser, X-Goog-Visitor-Id, X-Origin, X-Referer, X-Same-Domain, X-Upload-Content-Type, X-Upload-Content-Length, X-YouTube-Client-Name, X-YouTube-Client-Version\r\n' +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Access-Control-Max-Age: 86400\r\n' +
          'Content-Length: 0\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        tlsServer.write(corsResponse);
        tlsServer.end();
        return;
      }
      
      // Make request to real server
      try {
        console.log(`📤 Fetching: ${method} ${targetUrl}`);
        const response = await makeHttpsRequest(method, hostname, path, headers, requestBody);
        console.log(`📥 Response: ${response.statusCode} for ${targetUrl} (${response.body.length} bytes)`);
        
        // Build response headers, filtering out problematic ones
        const skipHeaders = new Set([
          'transfer-encoding',
          'content-encoding', 
          'content-length',
          'connection',
          'keep-alive',
          'proxy-connection',
          'proxy-authenticate',
          'proxy-authorization',
          'te',
          'trailers',
          'upgrade',
          // Remove original CORS headers so we can replace with permissive ones
          'access-control-allow-origin',
          'access-control-allow-methods',
          'access-control-allow-headers',
          'access-control-expose-headers',
          'access-control-allow-credentials',
          'access-control-max-age',
          // Remove CSP headers to allow our injected inline scripts/polyfills
          'content-security-policy',
          'content-security-policy-report-only',
          'x-content-security-policy',
          'x-webkit-csp',
        ]);
        
        // Send response back to client
        let responseHeaders = `HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'OK'}\r\n`;
        for (const [key, value] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (!skipHeaders.has(lowerKey)) {
            if (Array.isArray(value)) {
              responseHeaders += `${key}: ${value.join(', ')}\r\n`;
            } else if (value !== undefined && value !== null) {
              responseHeaders += `${key}: ${value}\r\n`;
            }
          }
        }
        responseHeaders += `Content-Length: ${response.body.length}\r\n`;
        responseHeaders += `Connection: close\r\n`;
        // Add CORS headers to allow cross-origin requests (use Origin for credentials support)
        responseHeaders += `Access-Control-Allow-Origin: ${requestOrigin}\r\n`;
        responseHeaders += `Access-Control-Allow-Credentials: true\r\n`;
        responseHeaders += `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n`;
        responseHeaders += `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, X-File-Size, X-File-Type, X-Client-Data, X-Goog-Api-Key, X-Goog-AuthUser, X-Goog-Visitor-Id, X-Origin, X-Referer, X-Same-Domain, X-Upload-Content-Type, X-Upload-Content-Length, X-YouTube-Client-Name, X-YouTube-Client-Version\r\n`;
        responseHeaders += `Access-Control-Expose-Headers: Content-Type, Content-Length, Content-Disposition, Cache-Control, ETag, Last-Modified, X-Request-Id\r\n`;
        responseHeaders += '\r\n';
        
        tlsServer.write(responseHeaders);
        tlsServer.write(response.body);
        tlsServer.end();
      } catch (err) {
        const error = err as Error;
        console.error(`❌ HTTPS request error for ${targetUrl}:`, error.message);
        const errorResponse = 
          'HTTP/1.1 502 Bad Gateway\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 11\r\n' +
          'Connection: close\r\n' +
          '\r\n' +
          'Bad Gateway';
        tlsServer.write(errorResponse);
        tlsServer.end();
      }
    });
    
    tlsServer.on('error', (err: Error) => {
      // Suppress common expected errors
      if (err.message.includes('ECONNRESET') || 
          err.message.includes('unknown ca') ||
          err.message.includes('certificate') ||
          err.message.includes('handshake')) {
        // These are expected when client hasn't installed CA cert
        console.log(`⚠️ TLS error for ${hostname}: ${err.message}`);
        return;
      }
      console.error(`❌ TLS server error for ${hostname}: ${err.message}`);
    });
    
    tlsServer.on('close', () => {
      clientSocket.destroy();
    });
  }
  
  // Handle WebSocket upgrade requests - proxy directly without transformation
  function handleWebSocketUpgrade(
    tlsClient: TLSSocket, 
    hostname: string, 
    path: string, 
    headers: Record<string, string>,
    initialRequest: Buffer
  ): void {
    console.log(`🌐 Establishing WebSocket connection to ${hostname}`);
    
    // Connect to the real server via TLS
    const tlsServer = tlsConnect({
      host: hostname,
      port: 443,
      rejectUnauthorized: false,
    });
    
    tlsServer.on('secureConnect', () => {
      console.log(`🔗 WebSocket TLS connection established to ${hostname}`);
      
      // Forward the original upgrade request to the server
      tlsServer.write(initialRequest);
      
      // Set up bidirectional piping
      tlsClient.pipe(tlsServer);
      tlsServer.pipe(tlsClient);
    });
    
    tlsServer.on('error', (err: Error) => {
      console.error(`❌ WebSocket server connection error for ${hostname}: ${err.message}`);
      tlsClient.end();
    });
    
    tlsServer.on('close', () => {
      console.log(`🔌 WebSocket connection closed for ${hostname}`);
      tlsClient.end();
    });
    
    tlsClient.on('error', (err: Error) => {
      if (!err.message.includes('ECONNRESET')) {
        console.error(`❌ WebSocket client error for ${hostname}: ${err.message}`);
      }
      tlsServer.end();
    });
    
    tlsClient.on('close', () => {
      tlsServer.end();
    });
  }
  
  // Handle HTTP connections with interception
  function handleHttpConnection(clientSocket: Socket, hostname: string, port: number, addressType: number): void {
    // Tell client connection is established
    clientSocket.write(createReply(REPLY_SUCCESS, addressType));
    state = ConnectionState.CONNECTED;
    
    let requestBuffer = Buffer.alloc(0);
    
    clientSocket.on('data', async (data: Buffer) => {
      requestBuffer = Buffer.concat([requestBuffer, data]);
      
      // Check for complete headers
      const headerEnd = requestBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      
      // Parse request
      const headerStr = requestBuffer.subarray(0, headerEnd).toString('utf-8');
      const bodyStart = headerEnd + 4;
      const lines = headerStr.split('\r\n');
      const requestLine = lines[0];
      const [method, path] = requestLine.split(' ');
      
      const headers: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
          const key = lines[i].substring(0, colonIdx).toLowerCase();
          const value = lines[i].substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }
      
      const contentLength = parseInt(headers['content-length'] || '0', 10);
      let requestBody = requestBuffer.subarray(bodyStart);
      
      while (requestBody.length < contentLength) {
        const moreData = await new Promise<Buffer>((resolve) => {
          clientSocket.once('data', resolve);
        });
        requestBody = Buffer.concat([requestBody, moreData]);
      }
      
      const targetUrl = `http://${hostname}${path}`;
      console.log(`📡 HTTP: ${method} ${targetUrl}`);
      
      // Block tracking URLs by pattern
      if (shouldBlockUrl(targetUrl)) {
        console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
        const blockedResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        clientSocket.write(blockedResponse);
        requestBuffer = Buffer.alloc(0);
        return;
      }
      
      // Use the Origin header for CORS to support credentials
      const requestOrigin = headers['origin'] || '*';

      // Handle CORS preflight requests
      if (method === 'OPTIONS') {
        const corsResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n' +
          'Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, X-File-Size, X-File-Type, X-Client-Data, X-Goog-Api-Key, X-Goog-AuthUser, X-Goog-Visitor-Id, X-Origin, X-Referer, X-Same-Domain, X-Upload-Content-Type, X-Upload-Content-Length, X-YouTube-Client-Name, X-YouTube-Client-Version\r\n' +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Access-Control-Max-Age: 86400\r\n' +
          'Content-Length: 0\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        clientSocket.write(corsResponse);
        requestBuffer = Buffer.alloc(0);
        return;
      }
      
      try {
        const response = await makeHttpRequest(method, hostname, port, path, headers, requestBody);
        
        // Build response headers, filtering out problematic ones
        const skipHeaders = new Set([
          'transfer-encoding',
          'content-encoding', 
          'content-length',
          'connection',
          'keep-alive',
          'proxy-connection',
          'proxy-authenticate',
          'proxy-authorization',
          'te',
          'trailers',
          'upgrade',
          // Remove original CORS headers so we can replace with permissive ones
          'access-control-allow-origin',
          'access-control-allow-methods',
          'access-control-allow-headers',
          'access-control-expose-headers',
          'access-control-allow-credentials',
          'access-control-max-age',
          // Remove CSP headers to allow our injected inline scripts/polyfills
          'content-security-policy',
          'content-security-policy-report-only',
          'x-content-security-policy',
          'x-webkit-csp',
        ]);
        
        let responseHeaders = `HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'OK'}\r\n`;
        
        // Apply gzip compression for text-based content if client supports it
        let responseBody = response.body;
        const responseContentType = response.headers['content-type'];
        const contentTypeStr = Array.isArray(responseContentType) ? responseContentType[0] : (responseContentType || '');
        const clientAcceptsGzip = acceptsGzipEncoding(headers['accept-encoding']);
        let isGzipped = false;
        
        if (clientAcceptsGzip && shouldCompress(contentTypeStr) && responseBody.length > 1024) {
          responseBody = Buffer.from(gzipSync(responseBody));
          isGzipped = true;
        }
        
        for (const [key, value] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (!skipHeaders.has(lowerKey)) {
            if (Array.isArray(value)) {
              responseHeaders += `${key}: ${value.join(', ')}\r\n`;
            } else if (value !== undefined && value !== null) {
              responseHeaders += `${key}: ${value}\r\n`;
            }
          }
        }
        responseHeaders += `Content-Length: ${responseBody.length}\r\n`;
        if (isGzipped) {
          responseHeaders += `Content-Encoding: gzip\r\n`;
          responseHeaders += `Vary: Accept-Encoding\r\n`;
        }
        responseHeaders += `Connection: close\r\n`;
        // Add CORS headers to allow cross-origin requests (use Origin for credentials support)
        responseHeaders += `Access-Control-Allow-Origin: ${requestOrigin}\r\n`;
        responseHeaders += `Access-Control-Allow-Credentials: true\r\n`;
        responseHeaders += `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n`;
        responseHeaders += `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, X-File-Size, X-File-Type, X-Client-Data, X-Goog-Api-Key, X-Goog-AuthUser, X-Goog-Visitor-Id, X-Origin, X-Referer, X-Same-Domain, X-Upload-Content-Type, X-Upload-Content-Length, X-YouTube-Client-Name, X-YouTube-Client-Version\r\n`;
        responseHeaders += `Access-Control-Expose-Headers: Content-Type, Content-Length, Content-Disposition, Cache-Control, ETag, Last-Modified, X-Request-Id\r\n`;
        responseHeaders += '\r\n';
        
        clientSocket.write(responseHeaders);
        clientSocket.write(responseBody);
        
        // Reset for next request
        requestBuffer = Buffer.alloc(0);
      } catch (err) {
        console.error(`❌ HTTP request error:`, err);
        const errorResponse = 
          'HTTP/1.1 502 Bad Gateway\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Content-Length: 11\r\n' +
          '\r\n' +
          'Bad Gateway';
        clientSocket.write(errorResponse);
      }
    });
  }
  
  clientSocket.on('error', (err) => {
    if (!err.message.includes('ECONNRESET')) {
      console.error(`❌ Client socket error: ${err.message}`);
    }
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });
  
  clientSocket.on('close', () => {
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });
}

interface HttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

async function makeHttpsRequest(
  method: string,
  hostname: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<HttpResponse> {
  const config = getConfig();
  
  // Spoof User-Agent to simulate a modern browser
  const requestHeaders = { ...headers };
  if (config.spoofUserAgent && requestHeaders['user-agent']) {
    // Replace old Safari/iOS user agent with a modern Chrome one
    requestHeaders['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method,
      headers: {
        ...requestHeaders,
        'accept-encoding': 'gzip, deflate', // Don't request brotli for simplicity
      },
      rejectUnauthorized: false,
    };
    
    const req = httpsRequest(options, async (res) => {
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        let responseBody = Buffer.concat(chunks);
        
        // Decompress if needed
        const encoding = res.headers['content-encoding'];
        responseBody = Buffer.from(decompressBody(responseBody, encoding as string));
        
        const updatedHeaders = { ...res.headers };
        
        // Skip transformation for redirect responses (301, 302, 303, 307, 308)
        const statusCode = res.statusCode || 200;
        const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
        
        if (!isRedirect && responseBody.length > 0) {
          // Transform content only for non-redirect responses with content
          const targetUrl = `https://${hostname}${path}`;
          const rawContentType = res.headers['content-type'] || '';
          const contentTypeValue = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
          const charset = getCharset(contentTypeValue);
          const contentType = getContentType(
            res.headers as Record<string, string | string[] | undefined>,
            targetUrl
          );
          
          if (contentType !== 'other') {
            responseBody = Buffer.from(await transformContent(responseBody, contentType, targetUrl, charset));
            
            // Update Content-Type header to UTF-8 if we transformed the content
            if (updatedHeaders['content-type']) {
              const ct = Array.isArray(updatedHeaders['content-type']) 
                ? updatedHeaders['content-type'][0] 
                : updatedHeaders['content-type'];
              // Replace charset with UTF-8 since we converted the content
              updatedHeaders['content-type'] = ct.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
            }
          }
          
          // Transform WebP/AVIF images to JPEG for legacy browser compatibility
          if (needsImageTransform(contentTypeValue, targetUrl)) {
            const imageResult = await transformImage(responseBody, contentTypeValue, targetUrl);
            if (imageResult.transformed) {
              responseBody = Buffer.from(imageResult.data);
              updatedHeaders['content-type'] = imageResult.contentType;
            }
          }
        }
        
        resolve({
          statusCode: res.statusCode || 200,
          statusMessage: res.statusMessage || 'OK',
          headers: updatedHeaders,
          body: responseBody,
        });
      });
      
      res.on('error', reject);
    });
    
    req.on('error', reject);
    
    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

async function makeHttpRequest(
  method: string,
  hostname: string,
  port: number,
  path: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port,
      path,
      method,
      headers: {
        ...headers,
        'accept-encoding': 'gzip, deflate',
      },
    };
    
    const req = httpRequest(options, async (res) => {
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        let responseBody = Buffer.concat(chunks);
        
        const encoding = res.headers['content-encoding'];
        responseBody = Buffer.from(decompressBody(responseBody, encoding as string));
        
        const updatedHeaders = { ...res.headers };
        
        // Skip transformation for redirect responses (301, 302, 303, 307, 308)
        const statusCode = res.statusCode || 200;
        const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
        
        if (!isRedirect && responseBody.length > 0) {
          // Transform content only for non-redirect responses with content
          const targetUrl = `http://${hostname}${path}`;
          const rawContentType = res.headers['content-type'] || '';
          const contentTypeValue = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
          const charset = getCharset(contentTypeValue);
          const contentType = getContentType(
            res.headers as Record<string, string | string[] | undefined>,
            targetUrl
          );
          
          if (contentType !== 'other') {
            responseBody = Buffer.from(await transformContent(responseBody, contentType, targetUrl, charset));
            
            // Update Content-Type header to UTF-8 if we transformed the content
            if (updatedHeaders['content-type']) {
              const ct = Array.isArray(updatedHeaders['content-type']) 
                ? updatedHeaders['content-type'][0] 
                : updatedHeaders['content-type'];
              // Replace charset with UTF-8 since we converted the content
              updatedHeaders['content-type'] = ct.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
            }
          }
          
          // Transform WebP/AVIF images to JPEG for legacy browser compatibility
          if (needsImageTransform(contentTypeValue, targetUrl)) {
            const imageResult = await transformImage(responseBody, contentTypeValue, targetUrl);
            if (imageResult.transformed) {
              responseBody = Buffer.from(imageResult.data);
              updatedHeaders['content-type'] = imageResult.contentType;
            }
          }
        }
        
        resolve({
          statusCode: res.statusCode || 200,
          statusMessage: res.statusMessage || 'OK',
          headers: updatedHeaders,
          body: responseBody,
        });
      });
      
      res.on('error', reject);
    });
    
    req.on('error', reject);
    
    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Create and start the SOCKS5 proxy server
 */
export function createSocks5Proxy(port: number, httpProxyPort: number, bindAddress: string = '0.0.0.0'): Server {
  const server = createServer((socket) => {
    handleConnection(socket, httpProxyPort);
  });
  
  server.on('error', (err) => {
    console.error(`❌ SOCKS5 server error: ${err.message}`);
  });
  
  server.listen(port, bindAddress, () => {
    console.log(`🧦 SOCKS5 Proxy listening on ${bindAddress}:${port}`);
  });
  
  return server;
}
