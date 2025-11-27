/**
 * SOCKS5 Proxy Server
 * Implements SOCKS5 protocol for legacy device connections
 */

import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import { TLSSocket, type TLSSocket as TLSSocketType } from 'node:tls';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib';
import { getConfig } from '../config/index.js';
import { generateDomainCert } from '../certs/index.js';
import { getCached, setCache } from '../cache/index.js';
import { transformJs, transformCss, transformHtml, isHtmlDocument } from '../transformers/index.js';

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

function getContentType(headers: Record<string, string | string[] | undefined>, url: string): ContentType {
  const contentType = (headers['content-type'] as string || '').toLowerCase();
  
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    return 'js';
  }
  if (contentType.includes('text/css')) {
    return 'css';
  }
  if (contentType.includes('text/html')) {
    return 'html';
  }
  
  // Fallback to URL-based detection
  const pathname = new URL(url, 'http://localhost').pathname.toLowerCase();
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
    return 'js';
  }
  if (pathname.endsWith('.css')) {
    return 'css';
  }
  if (pathname.endsWith('.html') || pathname.endsWith('.htm') || pathname === '/' || !pathname.includes('.')) {
    return 'html';
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

async function transformContent(body: Buffer, contentType: ContentType, url: string): Promise<Buffer> {
  const config = getConfig();
  
  // Check cache first
  const cached = await getCached(url, contentType);
  if (cached) {
    console.log(`📦 Cache hit: ${url}`);
    return cached;
  }
  
  let transformed: string;
  const text = body.toString('utf-8');
  
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
      
      // Handle CORS preflight requests
      if (method === 'OPTIONS') {
        const corsResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          'Access-Control-Allow-Origin: *\r\n' +
          'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n' +
          'Access-Control-Allow-Headers: *\r\n' +
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
        const response = await makeHttpsRequest(method, hostname, path, headers, requestBody);
        
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
        // Add CORS headers to allow cross-origin requests
        responseHeaders += `Access-Control-Allow-Origin: *\r\n`;
        responseHeaders += `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD\r\n`;
        responseHeaders += `Access-Control-Allow-Headers: *\r\n`;
        responseHeaders += `Access-Control-Expose-Headers: *\r\n`;
        responseHeaders += '\r\n';
        
        tlsServer.write(responseHeaders);
        tlsServer.write(response.body);
        tlsServer.end();
      } catch (err) {
        console.error(`❌ HTTPS request error:`, err);
        tlsServer.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 11\r\n\r\nBad Gateway');
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
        return;
      }
      console.error(`❌ TLS server error: ${err.message}`);
    });
    
    tlsServer.on('close', () => {
      clientSocket.destroy();
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
      
      // Handle CORS preflight requests
      if (method === 'OPTIONS') {
        const corsResponse = 
          'HTTP/1.1 204 No Content\r\n' +
          'Access-Control-Allow-Origin: *\r\n' +
          'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH\r\n' +
          'Access-Control-Allow-Headers: *\r\n' +
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
        ]);
        
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
        // Add CORS headers to allow cross-origin requests
        responseHeaders += `Access-Control-Allow-Origin: *\r\n`;
        responseHeaders += `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD\r\n`;
        responseHeaders += `Access-Control-Allow-Headers: *\r\n`;
        responseHeaders += `Access-Control-Expose-Headers: *\r\n`;
        responseHeaders += '\r\n';
        
        clientSocket.write(responseHeaders);
        clientSocket.write(response.body);
        
        // Reset for next request
        requestBuffer = Buffer.alloc(0);
      } catch (err) {
        console.error(`❌ HTTP request error:`, err);
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 11\r\n\r\nBad Gateway');
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
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method,
      headers: {
        ...headers,
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
        
        // Transform content
        const targetUrl = `https://${hostname}${path}`;
        const contentType = getContentType(
          res.headers as Record<string, string | string[] | undefined>,
          targetUrl
        );
        
        if (contentType !== 'other') {
          responseBody = Buffer.from(await transformContent(responseBody, contentType, targetUrl));
        }
        
        resolve({
          statusCode: res.statusCode || 200,
          statusMessage: res.statusMessage || 'OK',
          headers: res.headers,
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
        
        const targetUrl = `http://${hostname}${path}`;
        const contentType = getContentType(
          res.headers as Record<string, string | string[] | undefined>,
          targetUrl
        );
        
        if (contentType !== 'other') {
          responseBody = Buffer.from(await transformContent(responseBody, contentType, targetUrl));
        }
        
        resolve({
          statusCode: res.statusCode || 200,
          statusMessage: res.statusMessage || 'OK',
          headers: res.headers,
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
export function createSocks5Proxy(port: number, httpProxyPort: number): Server {
  const server = createServer((socket) => {
    handleConnection(socket, httpProxyPort);
  });
  
  server.on('error', (err) => {
    console.error(`❌ SOCKS5 server error: ${err.message}`);
  });
  
  server.listen(port, () => {
    console.log(`🧦 SOCKS5 Proxy listening on port ${port}`);
  });
  
  return server;
}
