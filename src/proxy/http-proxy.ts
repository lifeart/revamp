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
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib';
import { getConfig } from '../config/index.js';
import { getCached, setCache } from '../cache/index.js';
import { generateDomainCert } from '../certs/index.js';
import { transformJs, transformCss, transformHtml, isHtmlDocument } from '../transformers/index.js';

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

async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  isHttps: boolean
): Promise<void> {
  const parsedUrl = new URL(targetUrl);
  
  // Block ad/tracking domains
  if (shouldBlockDomain(parsedUrl.hostname)) {
    console.log(`🚫 Blocked: ${parsedUrl.hostname}`);
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
          
          // Determine content type and transform
          const contentType = getContentType(
            proxyRes.headers as Record<string, string | string[] | undefined>,
            targetUrl
          );
          
          if (contentType !== 'other') {
            body = Buffer.from(await transformContent(body, contentType, targetUrl));
          }
          
          // Copy response headers
          const headers = { ...proxyRes.headers };
          
          // Remove encoding header since we decompressed
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          
          // Update content length
          headers['content-length'] = String(body.length);
          
          // Remove hop-by-hop headers from response
          delete headers['connection'];
          delete headers['keep-alive'];
          
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(body);
          resolve();
        });
        
        proxyRes.on('error', (err) => {
          console.error(`❌ Proxy response error: ${err.message}`);
          res.writeHead(502);
          res.end('Bad Gateway');
          reject(err);
        });
      } catch (err) {
        console.error(`❌ Proxy error: ${err}`);
        res.writeHead(500);
        res.end('Internal Server Error');
        reject(err);
      }
    });
    
    proxyReq.on('error', (err) => {
      console.error(`❌ Proxy request error: ${err.message}`);
      res.writeHead(502);
      res.end('Bad Gateway');
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
export function createHttpProxy(port: number): Server {
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
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
  
  // Handle CONNECT method for HTTPS
  server.on('connect', handleConnect);
  
  server.listen(port, () => {
    console.log(`🌐 HTTP Proxy listening on port ${port}`);
  });
  
  return server;
}

export { proxyRequest };
