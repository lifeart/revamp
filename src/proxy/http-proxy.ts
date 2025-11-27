/**
 * HTTP/HTTPS Proxy Interceptor
 * Intercepts HTTP traffic, transforms content, and returns to client
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import { URL } from 'node:url';
import { gunzipSync, brotliDecompressSync, inflateSync, gzipSync } from 'node:zlib';
import { getConfig } from '../config/index.js';
import { getCached, setCache, markAsRedirect, isRedirectStatus } from '../cache/index.js';
import { generateDomainCert } from '../certs/index.js';
import { transformJs, transformCss, transformHtml, isHtmlDocument } from '../transformers/index.js';
import { needsImageTransform, transformImage } from '../transformers/image.js';

type ContentType = 'js' | 'css' | 'html' | 'other';

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
function acceptsGzip(req: IncomingMessage): boolean {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  return acceptEncoding.includes('gzip');
}

// Extract charset from Content-Type header
function getCharset(contentType: string): string {
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  if (charsetMatch) {
    return charsetMatch[1].toLowerCase().replace(/["']/g, '');
  }
  return 'utf-8';
}

// Windows-1251 (Cyrillic) decoder
function decodeWindows1251(buffer: Buffer): string {
  // Windows-1251 to Unicode mapping for bytes 0x80-0xFF
  const WIN1251_MAP: Record<number, number> = {
    0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201A, 0x83: 0x0453, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
    0x88: 0x20AC, 0x89: 0x2030, 0x8A: 0x0409, 0x8B: 0x2039, 0x8C: 0x040A, 0x8D: 0x040C, 0x8E: 0x040B, 0x8F: 0x040F,
    0x90: 0x0452, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x0098, 0x99: 0x2122, 0x9A: 0x0459, 0x9B: 0x203A, 0x9C: 0x045A, 0x9D: 0x045C, 0x9E: 0x045B, 0x9F: 0x045F,
    0xA0: 0x00A0, 0xA1: 0x040E, 0xA2: 0x045E, 0xA3: 0x0408, 0xA4: 0x00A4, 0xA5: 0x0490, 0xA6: 0x00A6, 0xA7: 0x00A7,
    0xA8: 0x0401, 0xA9: 0x00A9, 0xAA: 0x0404, 0xAB: 0x00AB, 0xAC: 0x00AC, 0xAD: 0x00AD, 0xAE: 0x00AE, 0xAF: 0x0407,
    0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x0406, 0xB3: 0x0456, 0xB4: 0x0491, 0xB5: 0x00B5, 0xB6: 0x00B6, 0xB7: 0x00B7,
    0xB8: 0x0451, 0xB9: 0x2116, 0xBA: 0x0454, 0xBB: 0x00BB, 0xBC: 0x0458, 0xBD: 0x0405, 0xBE: 0x0455, 0xBF: 0x0457,
    0xC0: 0x0410, 0xC1: 0x0411, 0xC2: 0x0412, 0xC3: 0x0413, 0xC4: 0x0414, 0xC5: 0x0415, 0xC6: 0x0416, 0xC7: 0x0417,
    0xC8: 0x0418, 0xC9: 0x0419, 0xCA: 0x041A, 0xCB: 0x041B, 0xCC: 0x041C, 0xCD: 0x041D, 0xCE: 0x041E, 0xCF: 0x041F,
    0xD0: 0x0420, 0xD1: 0x0421, 0xD2: 0x0422, 0xD3: 0x0423, 0xD4: 0x0424, 0xD5: 0x0425, 0xD6: 0x0426, 0xD7: 0x0427,
    0xD8: 0x0428, 0xD9: 0x0429, 0xDA: 0x042A, 0xDB: 0x042B, 0xDC: 0x042C, 0xDD: 0x042D, 0xDE: 0x042E, 0xDF: 0x042F,
    0xE0: 0x0430, 0xE1: 0x0431, 0xE2: 0x0432, 0xE3: 0x0433, 0xE4: 0x0434, 0xE5: 0x0435, 0xE6: 0x0436, 0xE7: 0x0437,
    0xE8: 0x0438, 0xE9: 0x0439, 0xEA: 0x043A, 0xEB: 0x043B, 0xEC: 0x043C, 0xED: 0x043D, 0xEE: 0x043E, 0xEF: 0x043F,
    0xF0: 0x0440, 0xF1: 0x0441, 0xF2: 0x0442, 0xF3: 0x0443, 0xF4: 0x0444, 0xF5: 0x0445, 0xF6: 0x0446, 0xF7: 0x0447,
    0xF8: 0x0448, 0xF9: 0x0449, 0xFA: 0x044A, 0xFB: 0x044B, 0xFC: 0x044C, 0xFD: 0x044D, 0xFE: 0x044E, 0xFF: 0x044F,
  };
  
  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else {
      result += String.fromCharCode(WIN1251_MAP[byte] || byte);
    }
  }
  return result;
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
  // Decode using proper charset
  let text: string;
  if (charset === 'windows-1251' || charset === 'cp1251') {
    text = decodeWindows1251(body);
  } else {
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

async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  isHttps: boolean
): Promise<void> {
  const config = getConfig();
  const parsedUrl = new URL(targetUrl);
  
  // Block ad/tracking domains
  if (shouldBlockDomain(parsedUrl.hostname)) {
    console.log(`🚫 Blocked domain: ${parsedUrl.hostname}`);
    res.writeHead(204); // No Content
    res.end();
    return;
  }
  
  // Block tracking URLs by pattern
  if (shouldBlockUrl(targetUrl)) {
    console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
    res.writeHead(204); // No Content
    res.end();
    return;
  }
  
  const requestFn = isHttps ? httpsRequest : httpRequest;
  
  // Copy and clean headers
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: parsedUrl.host,
    // Tell servers we accept uncompressed content (easier to transform)
    'accept-encoding': 'identity',
  };
  
  // Spoof User-Agent to simulate a modern browser
  if (config.spoofUserAgent && headers['user-agent']) {
    headers['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  
  // Remove hop-by-hop headers
  delete headers['connection'];
  delete headers['keep-alive'];
  delete headers['proxy-connection'];
  delete headers['proxy-authenticate'];
  delete headers['proxy-authorization'];
  delete headers['transfer-encoding'];
  delete headers['upgrade'];
  
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers,
    // For HTTPS, we need to handle self-signed certs
    rejectUnauthorized: false,
  };
  
  return new Promise((resolve, reject) => {
    const proxyReq = requestFn(options, async (proxyRes) => {
      try {
        const chunks: Buffer[] = [];
        
        proxyRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        proxyRes.on('end', async () => {
          let body: Buffer = Buffer.concat(chunks);
          
          // Decompress if needed
          const encoding = proxyRes.headers['content-encoding'];
          body = Buffer.from(decompressBody(body, encoding as string));
          
          // Check if this is a redirect response
          const statusCode = proxyRes.statusCode || 200;
          const isRedirect = isRedirectStatus(statusCode);
          
          // Mark redirecting URLs so we don't cache them in the future
          if (isRedirect) {
            markAsRedirect(targetUrl);
          }
          
          // Determine content type and transform
          const rawContentType = proxyRes.headers['content-type'] || '';
          const contentTypeValue = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
          
          // Skip transformation for redirect responses
          if (!isRedirect && body.length > 0) {
            // Transform WebP/AVIF images to JPEG for legacy browser compatibility
            // Do this BEFORE text transformation, since images shouldn't be transformed as text
            if (needsImageTransform(contentTypeValue, targetUrl)) {
              const imageResult = await transformImage(body, contentTypeValue, targetUrl);
              if (imageResult.transformed) {
                body = Buffer.from(imageResult.data);
                proxyRes.headers['content-type'] = imageResult.contentType;
              }
            } else {
              // Only transform text content (not images)
              const charset = getCharset(contentTypeValue);
              const contentType = getContentType(
                proxyRes.headers as Record<string, string | string[] | undefined>,
                targetUrl
              );
              
              if (contentType !== 'other') {
                body = Buffer.from(await transformContent(body, contentType, targetUrl, charset));
              }
            }
          }
          
          // Copy response headers (sanitize header names to remove trailing spaces)
          const headers: Record<string, string | string[] | undefined> = {};
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            headers[key.trim().toLowerCase()] = value;
          }
          
          // Get the final content type for charset update check
          const finalContentType = getContentType(
            proxyRes.headers as Record<string, string | string[] | undefined>,
            targetUrl
          );
          
          // Update Content-Type header to UTF-8 if we transformed the content (not images)
          if (!isRedirect && finalContentType !== 'other' && !needsImageTransform(contentTypeValue, targetUrl) && headers['content-type']) {
            const ct = Array.isArray(headers['content-type']) 
              ? headers['content-type'][0] 
              : headers['content-type'];
            // Replace charset with UTF-8 since we converted the content
            headers['content-type'] = ct.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
          }
          
          // Remove encoding header since we decompressed
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          
          // Remove trailer-related headers (invalid without chunked encoding)
          delete headers['trailer'];
          delete headers['te'];
          
          // Apply gzip compression for text-based content if client supports it
          const currentContentType = headers['content-type'];
          const contentTypeStr = Array.isArray(currentContentType) ? currentContentType[0] : (currentContentType || '');
          if (acceptsGzip(req) && shouldCompress(contentTypeStr) && body.length > 1024) {
            body = Buffer.from(gzipSync(body));
            headers['content-encoding'] = 'gzip';
            headers['vary'] = 'Accept-Encoding';
          }
          
          // Update content length
          headers['content-length'] = String(body.length);
          
          // Remove hop-by-hop headers from response
          delete headers['connection'];
          delete headers['keep-alive'];
          
          // Remove original CORS headers so we can replace with permissive ones
          delete headers['access-control-allow-origin'];
          delete headers['access-control-allow-methods'];
          delete headers['access-control-allow-headers'];
          delete headers['access-control-expose-headers'];
          delete headers['access-control-allow-credentials'];
          delete headers['access-control-max-age'];
          
          // Add CORS headers (use Origin for credentials support)
          const requestOrigin = req.headers['origin'] || '*';
          headers['access-control-allow-origin'] = requestOrigin;
          headers['access-control-allow-credentials'] = 'true';
          headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD';
          headers['access-control-allow-headers'] = '*';
          headers['access-control-expose-headers'] = '*';
          
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(body);
          resolve();
        });
        
        proxyRes.on('error', (err) => {
          console.error(`❌ Proxy response error: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
          reject(err);
        });
      } catch (err) {
        console.error(`❌ Proxy error: ${err}`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
        reject(err);
      }
    });
    
    proxyReq.on('error', (err) => {
      console.error(`❌ Proxy request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
      reject(err);
    });
    
    // Pipe request body to proxy request
    req.pipe(proxyReq);
  });
}

// Map to store HTTPS servers for each domain
const httpsServers = new Map<string, HttpsServer>();

function getOrCreateHttpsServer(hostname: string): HttpsServer {
  const existing = httpsServers.get(hostname);
  if (existing) {
    return existing;
  }
  
  const certPair = generateDomainCert(hostname);
  
  const server = createHttpsServer({
    key: certPair.key,
    cert: certPair.cert,
  });
  
  httpsServers.set(hostname, server);
  return server;
}

/**
 * Handle CONNECT requests for HTTPS proxying
 */
function handleConnect(
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer
): void {
  const [hostname, portStr] = (req.url || '').split(':');
  const port = parseInt(portStr, 10) || 443;
  
  if (shouldBlockDomain(hostname)) {
    console.log(`🚫 Blocked HTTPS: ${hostname}`);
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  
  console.log(`🔒 HTTPS CONNECT: ${hostname}:${port}`);
  
  // For HTTPS interception, we create a local server with our certificate
  const certPair = generateDomainCert(hostname);
  
  // Create a temporary HTTPS server for this connection
  const fakeServer = createHttpsServer({
    key: certPair.key,
    cert: certPair.cert,
  }, async (httpsReq, httpsRes) => {
    const targetUrl = `https://${hostname}${httpsReq.url}`;
    console.log(`🔐 HTTPS: ${httpsReq.method} ${targetUrl}`);
    
    try {
      await proxyRequest(httpsReq, httpsRes, targetUrl, true);
    } catch (err) {
      console.error(`❌ HTTPS proxy error: ${err}`);
    }
  });
  
  // Listen on a random port
  fakeServer.listen(0, '127.0.0.1', () => {
    const addr = fakeServer.address();
    if (!addr || typeof addr === 'string') {
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      return;
    }
    
    // Connect client to our fake server
    const serverSocket = connect(addr.port, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      
      // Pipe traffic between client and fake server
      serverSocket.write(head);
      clientSocket.pipe(serverSocket);
      serverSocket.pipe(clientSocket);
    });
    
    serverSocket.on('error', (err) => {
      console.error(`❌ Server socket error: ${err.message}`);
      clientSocket.end();
    });
    
    clientSocket.on('error', (err) => {
      console.error(`❌ Client socket error: ${err.message}`);
      serverSocket.end();
    });
    
    clientSocket.on('close', () => {
      serverSocket.end();
      // Close the fake server after some delay
      setTimeout(() => {
        fakeServer.close();
      }, 1000);
    });
  });
}

/**
 * Create and start the HTTP proxy server
 */
export function createHttpProxy(port: number, bindAddress: string = '0.0.0.0'): Server {
  const server = createServer(async (req, res) => {
    const targetUrl = req.url || '/';
    console.log(`📡 HTTP: ${req.method} ${targetUrl}`);
    
    try {
      // Determine if this is a proxy request or a direct request
      let fullUrl: string;
      if (targetUrl.startsWith('http://')) {
        fullUrl = targetUrl;
      } else {
        // Direct request to proxy server
        const host = req.headers.host || 'localhost';
        fullUrl = `http://${host}${targetUrl}`;
      }
      
      await proxyRequest(req, res, fullUrl, false);
    } catch (err) {
      console.error(`❌ HTTP proxy error: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    }
  });
  
  // Handle CONNECT method for HTTPS
  server.on('connect', handleConnect);
  
  server.listen(port, bindAddress, () => {
    console.log(`🌐 HTTP Proxy listening on ${bindAddress}:${port}`);
  });
  
  return server;
}

export { proxyRequest };
