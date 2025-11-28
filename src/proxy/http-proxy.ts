/**
 * HTTP/HTTPS Proxy Interceptor
 *
 * Intercepts HTTP/HTTPS traffic, transforms content for legacy browsers,
 * and returns modified responses to the client.
 *
 * @module proxy/http-proxy
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import { URL } from 'node:url';
import { getEffectiveConfig, getConfig } from '../config/index.js';
import { markAsRedirect, isRedirectStatus } from '../cache/index.js';
import {
  recordRequest,
  recordBlocked,
  recordCacheHit,
  recordTransform,
  recordBandwidth,
  recordError,
  updateConnections,
} from '../metrics/index.js';
import { generateDomainCert } from '../certs/index.js';
import { needsImageTransform, transformImage } from '../transformers/image.js';
import {
  shouldCompress,
  acceptsGzip,
  getCharset,
  getContentType,
  decompressBody,
  compressGzip,
  transformContent,
  shouldBlockDomain,
  shouldBlockUrl,
  removeCorsHeaders,
  buildCorsHeaders,
} from './shared.js';
import {
  isConfigEndpoint,
  handleConfigRequest,
} from './config-endpoint.js';
import {
  isRevampEndpoint,
  handleRevampRequest,
} from './revamp-api.js';
import {
  shouldLogJsonRequest,
  logJsonRequest,
  isJsonContentType,
} from '../logger/json-request-logger.js';

// =============================================================================
// Revamp API Endpoint Handler
// =============================================================================

/**
 * Handle Revamp API requests for HTTP proxy
 * Uses the shared Revamp API handler for all /__revamp__/* endpoints
 *
 * @param req - Incoming HTTP request
 * @param res - Server response object
 * @param clientIp - Client IP for per-client config
 * @returns true if request was handled, false otherwise
 */
async function handleRevampApiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  clientIp: string
): Promise<boolean> {
  const url = req.url || '';

  if (!isRevampEndpoint(url)) {
    return false;
  }

  console.log(`🔧 Revamp API: ${req.method} ${url} (client: ${clientIp})`);

  // Read body for POST requests
  const body = req.method === 'POST' ? await readRequestBody(req) : '';

  // Use shared handler with client IP
  const result = handleRevampRequest(url, req.method || 'GET', body, clientIp);

  // Apply headers
  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value);
  }

  // Send response
  res.writeHead(result.statusCode);
  res.end(result.body);
  return true;
}

/**
 * Read request body as string
 */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Extract client IP from request, handling X-Forwarded-For headers
 * and falling back to socket address
 */
function getClientIp(req: IncomingMessage): string {
  // Check X-Forwarded-For header (set by reverse proxies)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated list, take the first (original client)
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const clientIp = ips.split(',')[0].trim();
    if (clientIp) return clientIp;
  }

  // Fall back to direct socket address
  const socketAddress = req.socket?.remoteAddress || '';
  // Normalize IPv6 localhost to IPv4 for consistency
  if (socketAddress === '::1' || socketAddress === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  // Remove IPv6 prefix if present (::ffff:192.168.1.1 -> 192.168.1.1)
  return socketAddress.replace(/^::ffff:/, '');
}

// =============================================================================
// Proxy Request Handler
// =============================================================================

async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  isHttps: boolean,
  clientIp?: string
): Promise<void> {
  // Extract client IP for per-client cache separation
  const effectiveClientIp = clientIp || getClientIp(req);

  // Check if this is a Revamp API endpoint request first
  const parsedUrl = new URL(targetUrl);
  const isRevampPath = isRevampEndpoint(parsedUrl.pathname);

  if (isRevampPath) {
    // Rewrite req.url for the handler
    req.url = parsedUrl.pathname + parsedUrl.search;
    const handled = await handleRevampApiHttp(req, res, effectiveClientIp);
    if (handled) return;
  }

  // Get effective config (merges server defaults with client overrides)
  const config = getEffectiveConfig(effectiveClientIp);

  // Record request for metrics
  recordRequest();

  // Block ad/tracking domains
  if (shouldBlockDomain(parsedUrl.hostname, config)) {
    console.log(`🚫 Blocked domain: ${parsedUrl.hostname}`);
    recordBlocked();
    res.writeHead(204); // No Content
    res.end();
    return;
  }

  // Block tracking URLs by pattern
  if (shouldBlockUrl(targetUrl, config)) {
    console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
    recordBlocked();
    res.writeHead(204); // No Content
    res.end();
    return;
  }

  // Check if we need to log JSON requests (affects how we handle request body)
  const globalConfig = getConfig();
  const jsonLoggingEnabled = globalConfig.logJsonRequests;

  // Only buffer request body if JSON logging is enabled
  // Otherwise we'll pipe the request directly for better performance
  let requestBody: Buffer | null = null;
  if (jsonLoggingEnabled) {
    const requestBodyChunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      req.on('data', (chunk: Buffer) => requestBodyChunks.push(chunk));
      req.on('end', () => resolve());
    });
    requestBody = Buffer.concat(requestBodyChunks);
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
          body = Buffer.from(await decompressBody(body, encoding as string));

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
                recordTransform('images');
              }
            } else {
              // Only transform text content (not images)
              const charset = getCharset(contentTypeValue);
              const contentType = getContentType(
                proxyRes.headers as Record<string, string | string[] | undefined>,
                targetUrl
              );

              if (contentType !== 'other') {
                const originalSize = body.length;
                body = Buffer.from(await transformContent(body, contentType, targetUrl, charset, config, effectiveClientIp));
                recordTransform(contentType);
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

          // Check if JSON logging is needed BEFORE compression (to avoid unnecessary work)
          // Use jsonLoggingEnabled from outer scope (already checked at request start)
          const shouldLog = jsonLoggingEnabled && isJsonContentType(headers['content-type']);
          // Only save reference if we need to log (no memory overhead when disabled)
          const decompressedBody = shouldLog ? body : null;

          // Apply gzip compression for text-based content if client supports it
          const currentContentType = headers['content-type'];
          const contentTypeStr = Array.isArray(currentContentType) ? currentContentType[0] : (currentContentType || '');
          const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
          if (acceptsGzip(acceptEncoding) && shouldCompress(contentTypeStr) && body.length > 1024) {
            body = await compressGzip(body);
            headers['content-encoding'] = 'gzip';
            headers['vary'] = 'Accept-Encoding';
          }

          // Update content length
          headers['content-length'] = String(body.length);

          // Remove hop-by-hop headers from response
          delete headers['connection'];
          delete headers['keep-alive'];

          // Remove original CORS headers so we can replace with permissive ones
          removeCorsHeaders(headers);

          // Add CORS headers (use Origin for credentials support)
          const requestOrigin = req.headers['origin'] as string || '*';
          const corsHeaders = buildCorsHeaders(requestOrigin);
          Object.assign(headers, corsHeaders);

          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(body);

          // Log JSON requests if enabled (use decompressed body, not re-compressed)
          if (shouldLog && decompressedBody) {
            // Create headers copy without content-encoding for logging since we log decompressed data
            const headersForLogging = { ...headers };
            delete headersForLogging['content-encoding'];
            logJsonRequest(
              effectiveClientIp,
              targetUrl,
              req.headers,
              headersForLogging,
              decompressedBody,
              requestBody ?? undefined
            );
          }

          // Record bandwidth metrics
          const bytesIn = Buffer.concat(chunks).length;
          recordBandwidth(bytesIn, body.length);

          resolve();
        });

        proxyRes.on('error', (err) => {
          console.error(`❌ Proxy response error: ${err.message}`);
          recordError();
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
          reject(err);
        });
      } catch (err) {
        console.error(`❌ Proxy error: ${err}`);
        recordError();
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
        reject(err);
      }
    });

    proxyReq.on('error', (err) => {
      console.error(`❌ Proxy request error: ${err.message}`);
      recordError();
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
      reject(err);
    });

    // Send request body to upstream
    if (requestBody) {
      // Buffered mode (JSON logging enabled) - write buffered body
      if (requestBody.length > 0) {
        proxyReq.write(requestBody);
      }
      proxyReq.end();
    } else {
      // Streaming mode (JSON logging disabled) - pipe directly for better performance
      req.pipe(proxyReq);
    }
  });
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
    recordBlocked();
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  // Record connection for metrics
  updateConnections(1);

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
      updateConnections(-1);
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
