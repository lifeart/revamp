/**
 * HTTP/HTTPS Proxy Interceptor
 *
 * Intercepts HTTP/HTTPS traffic, transforms content for legacy browsers,
 * and returns modified responses to the client.
 *
 * Architecture:
 * - HTTP requests are proxied directly with content transformation
 * - HTTPS requests use CONNECT tunneling with TLS interception
 * - Supports per-client configuration via Revamp API
 * - Integrates with metrics, caching, and JSON logging systems
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
import { isConfigEndpoint, handleConfigRequest } from './config-endpoint.js';
import { isRevampEndpoint, handleRevampRequest } from './revamp-api.js';
import { shouldLogJsonRequest, logJsonRequest, isJsonContentType } from '../logger/json-request-logger.js';
import { remoteSwServer, isRemoteSwEndpoint } from './remote-sw-server.js';

// =============================================================================
// Types
// =============================================================================

/** Options for making a proxy request */
interface ProxyRequestOptions {
  hostname: string;
  port: number | string;
  path: string;
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  rejectUnauthorized: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Spoofed User-Agent string for modern browser simulation */
const SPOOFED_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Minimum body size (bytes) to apply gzip compression */
const COMPRESSION_THRESHOLD = 1024;

/** Hop-by-hop headers that should not be proxied */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'transfer-encoding',
  'upgrade',
  // Remove Origin header to prevent upstream CORS issues (e.g., fonts.gstatic.com)
  // When proxying, the browser's Origin doesn't match what upstream servers expect
  // The proxy adds its own permissive CORS headers to responses
  'origin',
] as const;

// =============================================================================
// Client IP Utilities
// =============================================================================

/**
 * Extract client IP from request, handling X-Forwarded-For headers
 * and normalizing IPv6 addresses.
 *
 * @param req - Incoming HTTP request
 * @returns Normalized client IP address
 */
function getClientIp(req: IncomingMessage): string {
  // Check X-Forwarded-For header (set by reverse proxies)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const clientIp = ips.split(',')[0].trim();
    if (clientIp) return clientIp;
  }

  // Fall back to direct socket address
  return normalizeIpAddress(req.socket?.remoteAddress || '');
}

/**
 * Normalize IP address for consistency.
 * Converts IPv6 localhost to IPv4 and removes IPv6 prefix.
 *
 * @param ip - Raw IP address
 * @returns Normalized IP address
 */
function normalizeIpAddress(ip: string): string {
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  return ip.replace(/^::ffff:/, '');
}

// =============================================================================
// Request Body Utilities
// =============================================================================

/**
 * Read request body as string.
 *
 * @param req - Incoming HTTP request
 * @returns Promise resolving to request body string
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
 * Buffer request body for JSON logging (if enabled).
 *
 * @param req - Incoming HTTP request
 * @returns Promise resolving to buffered body or null if logging disabled
 */
async function bufferRequestBodyIfNeeded(req: IncomingMessage): Promise<Buffer | null> {
  const globalConfig = getConfig();
  if (!globalConfig.logJsonRequests) {
    return null;
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve());
  });
  return Buffer.concat(chunks);
}

// =============================================================================
// Header Utilities
// =============================================================================

/**
 * Prepare headers for proxying to upstream server.
 *
 * @param req - Incoming request
 * @param targetUrl - Parsed target URL
 * @param spoofUserAgent - Whether to spoof User-Agent header
 * @returns Cleaned headers object
 */
function prepareProxyHeaders(
  req: IncomingMessage,
  targetUrl: URL,
  spoofUserAgent: boolean
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: targetUrl.host,
    'accept-encoding': 'identity', // Request uncompressed for easier transformation
  };

  // Spoof User-Agent if enabled
  if (spoofUserAgent && headers['user-agent']) {
    headers['user-agent'] = SPOOFED_USER_AGENT;
  }

  // Remove hop-by-hop headers
  for (const header of HOP_BY_HOP_HEADERS) {
    delete headers[header];
  }

  // Strip cache validation headers for JS/CSS files to ensure we always get
  // the full response body for transformation. Without this, the server may
  // return 304 Not Modified and the browser uses its cached (untransformed) version.
  const pathLower = targetUrl.pathname.toLowerCase();
  if (
    pathLower.includes('/js/') ||
    pathLower.includes('/_/js/') ||
    pathLower.endsWith('.js') ||
    pathLower.endsWith('.css') ||
    pathLower.includes('/css/') ||
    pathLower.includes('/_/css/')
  ) {
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
  }

  return headers;
}

/**
 * Sanitize response headers for client.
 * Normalizes keys, removes hop-by-hop headers, and handles encoding.
 *
 * @param proxyHeaders - Headers from upstream response
 * @returns Sanitized headers object
 */
function sanitizeResponseHeaders(
  proxyHeaders: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(proxyHeaders)) {
    headers[key.trim().toLowerCase()] = value;
  }

  // Remove encoding headers (we decompress before sending)
  delete headers['content-encoding'];
  delete headers['transfer-encoding'];
  delete headers['trailer'];
  delete headers['te'];
  delete headers['connection'];
  delete headers['keep-alive'];

  return headers;
}

/**
 * Update Content-Type header to UTF-8 charset after transformation.
 *
 * @param headers - Response headers
 */
function updateCharsetToUtf8(headers: Record<string, string | string[] | undefined>): void {
  if (!headers['content-type']) return;

  const ct = Array.isArray(headers['content-type'])
    ? headers['content-type'][0]
    : headers['content-type'];

  headers['content-type'] = ct.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
}

// =============================================================================
// Revamp API Handler
// =============================================================================

/**
 * Handle Revamp API requests for HTTP proxy.
 *
 * @param req - Incoming HTTP request
 * @param res - Server response object
 * @param clientIp - Client IP for per-client config
 * @returns true if request was handled, false otherwise
 */
async function handleRevampApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  clientIp: string
): Promise<boolean> {
  const url = req.url || '';

  if (!isRevampEndpoint(url)) {
    return false;
  }

  console.log(`🔧 Revamp API: ${req.method} ${url} (client: ${clientIp})`);

  const body = req.method === 'POST' ? await readRequestBody(req) : '';
  const result = await handleRevampRequest(url, req.method || 'GET', body, clientIp);

  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value);
  }

  res.writeHead(result.statusCode);
  res.end(result.body);
  return true;
}

// =============================================================================
// Domain/URL Blocking
// =============================================================================

/**
 * Check if request should be blocked and send appropriate response.
 *
 * @param res - Server response
 * @param hostname - Target hostname
 * @param targetUrl - Full target URL
 * @param config - Effective configuration
 * @returns true if request was blocked
 */
function checkAndBlockRequest(
  res: ServerResponse,
  hostname: string,
  targetUrl: string,
  config: ReturnType<typeof getEffectiveConfig>
): boolean {
  if (shouldBlockDomain(hostname, config)) {
    console.log(`🚫 Blocked domain: ${hostname}`);
    recordBlocked();
    res.writeHead(204);
    res.end();
    return true;
  }

  if (shouldBlockUrl(targetUrl, config)) {
    console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
    recordBlocked();
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

// =============================================================================
// Content Transformation
// =============================================================================

/**
 * Transform response body based on content type.
 *
 * @param body - Response body buffer
 * @param contentType - Content-Type header value
 * @param targetUrl - Request URL
 * @param config - Effective configuration
 * @param clientIp - Client IP for caching
 * @param proxyHeaders - Response headers (may be modified)
 * @returns Transformed body buffer
 */
async function transformResponseBody(
  body: Buffer,
  contentType: string,
  targetUrl: string,
  config: ReturnType<typeof getEffectiveConfig>,
  clientIp: string,
  proxyHeaders: Record<string, string | string[] | undefined>
): Promise<Buffer> {
  // Transform WebP/AVIF images to JPEG for legacy browsers
  if (needsImageTransform(contentType, targetUrl)) {
    const imageResult = await transformImage(body, contentType, targetUrl);
    if (imageResult.transformed) {
      proxyHeaders['content-type'] = imageResult.contentType;
      recordTransform('images');
      return Buffer.from(imageResult.data);
    }
    return body;
  }

  // Transform text content (JS, CSS, HTML)
  const charset = getCharset(contentType);
  const detectedType = getContentType(
    proxyHeaders as Record<string, string | string[] | undefined>,
    targetUrl
  );

  // Debug: Log content type detection for JS files
  const isJsPath = targetUrl.includes('/js/') || targetUrl.includes('.js');
  if (isJsPath) {
    console.log(`🔍 Transform Debug: detectedType=${detectedType} contentType=${contentType} url=${targetUrl.substring(0, 80)}...`);
  }

  if (detectedType !== 'other') {
    const transformed = await transformContent(body, detectedType, targetUrl, charset, config, clientIp);
    recordTransform(detectedType);
    return Buffer.from(transformed);
  } else if (isJsPath) {
    console.log(`⚠️ JS not detected: contentType header=${proxyHeaders['content-type']}`);
  }

  return body;
}

/**
 * Apply gzip compression if appropriate.
 *
 * @param body - Response body
 * @param contentType - Content-Type header
 * @param acceptEncoding - Client's Accept-Encoding header
 * @param headers - Response headers (will be modified if compressed)
 * @returns Possibly compressed body
 */
async function applyCompressionIfNeeded(
  body: Buffer,
  contentType: string,
  acceptEncoding: string | undefined,
  headers: Record<string, string | string[] | undefined>
): Promise<Buffer> {
  if (
    acceptsGzip(acceptEncoding) &&
    shouldCompress(contentType) &&
    body.length > COMPRESSION_THRESHOLD
  ) {
    const compressed = await compressGzip(body);
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'Accept-Encoding';
    return compressed;
  }
  return body;
}

// =============================================================================
// JSON Logging
// =============================================================================

/**
 * Log JSON request/response if logging is enabled.
 *
 * @param enabled - Whether JSON logging is enabled
 * @param headers - Response headers
 * @param decompressedBody - Decompressed response body (or null)
 * @param clientIp - Client IP
 * @param targetUrl - Request URL
 * @param requestHeaders - Original request headers
 * @param requestBody - Request body (or null)
 */
function logJsonIfEnabled(
  enabled: boolean,
  headers: Record<string, string | string[] | undefined>,
  decompressedBody: Buffer | null,
  clientIp: string,
  targetUrl: string,
  requestHeaders: IncomingMessage['headers'],
  requestBody: Buffer | null
): void {
  if (!enabled || !decompressedBody) return;

  if (!isJsonContentType(headers['content-type'])) return;

  // Create headers copy without encoding for logging
  const headersForLogging = { ...headers };
  delete headersForLogging['content-encoding'];

  logJsonRequest(
    clientIp,
    targetUrl,
    requestHeaders,
    headersForLogging,
    decompressedBody,
    requestBody ?? undefined
  );
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Send error response to client.
 *
 * @param res - Server response
 * @param statusCode - HTTP status code
 * @param message - Error message
 */
function sendErrorResponse(
  res: ServerResponse,
  statusCode: number,
  message: string
): void {
  if (!res.headersSent) {
    res.writeHead(statusCode);
    res.end(message);
  }
}

/**
 * Handle proxy request error.
 *
 * @param err - Error object
 * @param res - Server response
 * @param context - Error context for logging
 */
function handleProxyError(
  err: unknown,
  res: ServerResponse,
  context: string
): void {
  let message: string;
  if (err instanceof AggregateError) {
    // AggregateError contains multiple errors (e.g., DNS resolution failures)
    const errorMessages = err.errors.map((e: Error) => e.message || String(e)).join('; ');
    message = `${err.message}: [${errorMessages}]`;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  console.error(`❌ ${context}: ${message}`);
  recordError();
  sendErrorResponse(res, 502, 'Bad Gateway');
}

// =============================================================================
// Main Proxy Request Handler
// =============================================================================

/**
 * Proxy an HTTP/HTTPS request with content transformation.
 *
 * @param req - Incoming client request
 * @param res - Server response
 * @param targetUrl - Full target URL to proxy
 * @param isHttps - Whether this is an HTTPS request
 * @param clientIp - Optional client IP override
 */
async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  isHttps: boolean,
  clientIp?: string
): Promise<void> {
  const effectiveClientIp = clientIp || getClientIp(req);
  const parsedUrl = new URL(targetUrl);

  // Handle Revamp API endpoints
  if (isRevampEndpoint(parsedUrl.pathname)) {
    req.url = parsedUrl.pathname + parsedUrl.search;
    const handled = await handleRevampApiRequest(req, res, effectiveClientIp);
    if (handled) return;
  }

  const config = getEffectiveConfig(effectiveClientIp);
  recordRequest();

  // Check domain/URL blocking
  if (checkAndBlockRequest(res, parsedUrl.hostname, targetUrl, config)) {
    return;
  }

  // Buffer request body if JSON logging is enabled
  const globalConfig = getConfig();
  const jsonLoggingEnabled = globalConfig.logJsonRequests;
  const requestBody = await bufferRequestBodyIfNeeded(req);

  // Prepare proxy request
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const headers = prepareProxyHeaders(req, parsedUrl, config.spoofUserAgent);

  const options: ProxyRequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers,
    rejectUnauthorized: false,
  };

  return new Promise((resolve, reject) => {
    const proxyReq = requestFn(options, async (proxyRes) => {
      try {
        // Collect response body
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));

        proxyRes.on('end', async () => {
          try {
            let body: Buffer = Buffer.concat(chunks);

            // Decompress response
            const encoding = proxyRes.headers['content-encoding'] as string | undefined;
            body = Buffer.from(await decompressBody(body, encoding));

            // Handle redirects
            const statusCode = proxyRes.statusCode || 200;
            if (isRedirectStatus(statusCode)) {
              markAsRedirect(targetUrl);
            }

            // Transform content (skip for redirects)
            const rawContentType = proxyRes.headers['content-type'] || '';
            const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;

            // Debug: Log transformation decision for JS files
            const isJsPath = targetUrl.includes('/js/') || targetUrl.includes('.js') || targetUrl.includes('javascript');
            if (isJsPath) {
              console.log(`🔍 JS Debug: URL=${targetUrl.substring(0, 100)}... status=${statusCode} bodyLen=${body.length} contentType=${contentType}`);
            }

            if (!isRedirectStatus(statusCode) && body.length > 0) {
              body = await transformResponseBody(
                body,
                contentType,
                targetUrl,
                config,
                effectiveClientIp,
                proxyRes.headers
              );
            } else if (isJsPath) {
              console.log(`⚠️ JS Skipped: isRedirect=${isRedirectStatus(statusCode)} bodyLength=${body.length}`);
            }

            // Prepare response headers
            const responseHeaders = sanitizeResponseHeaders(proxyRes.headers);

            // Update charset for transformed text content
            const finalContentType = getContentType(proxyRes.headers as Record<string, string | string[] | undefined>, targetUrl);
            if (!isRedirectStatus(statusCode) && finalContentType !== 'other' && !needsImageTransform(contentType, targetUrl)) {
              updateCharsetToUtf8(responseHeaders);
            }

            // Save decompressed body before compression (for JSON logging)
            const shouldLog = jsonLoggingEnabled && isJsonContentType(responseHeaders['content-type']);
            const decompressedBody = shouldLog ? body : null;

            // Apply gzip compression
            const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
            const currentContentType = Array.isArray(responseHeaders['content-type'])
              ? responseHeaders['content-type'][0]
              : (responseHeaders['content-type'] || '');
            body = await applyCompressionIfNeeded(body, currentContentType, acceptEncoding, responseHeaders);

            // Update content length
            responseHeaders['content-length'] = String(body.length);

            // Handle CORS
            removeCorsHeaders(responseHeaders);
            const requestOrigin = req.headers['origin'] as string || '*';
            Object.assign(responseHeaders, buildCorsHeaders(requestOrigin));

            // Prevent browser caching for HTML documents since config changes affect transformations
            // This ensures users see updated polyfills when they change settings
            if (finalContentType === 'html') {
              responseHeaders['cache-control'] = 'no-cache, must-revalidate';
              responseHeaders['vary'] = 'Accept-Encoding';
            }

            // Send response
            res.writeHead(statusCode, responseHeaders);
            res.end(body);

            // Log JSON requests
            logJsonIfEnabled(
              jsonLoggingEnabled,
              responseHeaders,
              decompressedBody,
              effectiveClientIp,
              targetUrl,
              req.headers,
              requestBody
            );

            // Record bandwidth
            recordBandwidth(Buffer.concat(chunks).length, body.length);
            resolve();
          } catch (err) {
            handleProxyError(err, res, 'Proxy response processing error');
            reject(err);
          }
        });

        proxyRes.on('error', (err) => {
          handleProxyError(err, res, 'Proxy response error');
          reject(err);
        });
      } catch (err) {
        handleProxyError(err, res, 'Proxy error');
        reject(err);
      }
    });

    proxyReq.on('error', (err) => {
      handleProxyError(err, res, 'Proxy request error');
      reject(err);
    });

    // Send request body
    if (requestBody) {
      if (requestBody.length > 0) {
        proxyReq.write(requestBody);
      }
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  });
}

// =============================================================================
// HTTPS CONNECT Handler
// =============================================================================

/**
 * Handle CONNECT requests for HTTPS proxying.
 * Creates a fake HTTPS server with domain-specific certificate for TLS interception.
 *
 * @param req - CONNECT request
 * @param clientSocket - Client socket
 * @param head - Initial data after CONNECT
 */
function handleConnect(
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer
): void {
  const [hostname, portStr] = (req.url || '').split(':');
  const port = parseInt(portStr, 10) || 443;

  // Check domain blocking
  if (shouldBlockDomain(hostname)) {
    console.log(`🚫 Blocked HTTPS: ${hostname}`);
    recordBlocked();
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  updateConnections(1);
  console.log(`🔒 HTTPS CONNECT: ${hostname}:${port}`);

  // Generate certificate for TLS interception
  const certPair = generateDomainCert(hostname);

  // Create temporary HTTPS server for this connection
  const fakeServer = createHttpsServer(
    { key: certPair.key, cert: certPair.cert },
    async (httpsReq, httpsRes) => {
      const targetUrl = `https://${hostname}${httpsReq.url}`;
      console.log(`🔐 HTTPS: ${httpsReq.method} ${targetUrl}`);

      try {
        await proxyRequest(httpsReq, httpsRes, targetUrl, true);
      } catch (err) {
        let message: string;
        if (err instanceof AggregateError) {
          const errorMessages = err.errors.map((e: Error) => e.message || String(e)).join('; ');
          message = `${err.message}: [${errorMessages}]`;
        } else if (err instanceof Error) {
          message = err.message;
        } else {
          message = String(err);
        }
        console.error(`❌ HTTPS proxy error: ${message}`);
      }
    }
  );

  // Listen on random port and connect client
  fakeServer.listen(0, '127.0.0.1', () => {
    const addr = fakeServer.address();
    if (!addr || typeof addr === 'string') {
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      return;
    }

    const serverSocket = connect(addr.port, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      clientSocket.pipe(serverSocket);
      serverSocket.pipe(clientSocket);
    });

    // Error handling
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
      setTimeout(() => fakeServer.close(), 1000);
    });
  });
}

// =============================================================================
// Server Factory
// =============================================================================

/**
 * Create and start the HTTP proxy server.
 *
 * @param port - Port to listen on
 * @param bindAddress - Address to bind to (default: all interfaces)
 * @returns Node.js HTTP server instance
 */
export function createHttpProxy(port: number, bindAddress: string = '0.0.0.0'): Server {
  const server = createServer(async (req, res) => {
    const targetUrl = req.url || '/';
    console.log(`📡 HTTP: ${req.method} ${targetUrl}`);

    try {
      // Determine full URL for proxy request
      const fullUrl = targetUrl.startsWith('http://')
        ? targetUrl
        : `http://${req.headers.host || 'localhost'}${targetUrl}`;

      await proxyRequest(req, res, fullUrl, false);
    } catch (err) {
      console.error(`❌ HTTP proxy error: ${err}`);
      sendErrorResponse(res, 500, 'Internal Server Error');
    }
  });

  server.on('connect', handleConnect);

  // Handle WebSocket upgrades for remote SW endpoint
  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';

    if (isRemoteSwEndpoint(url)) {
      console.log(`🔌 WebSocket upgrade request for Remote SW: ${url}`);
      remoteSwServer.handleUpgrade(request, socket, head);
    } else {
      // For other upgrade requests, close the socket
      console.log(`⚠️ Unsupported WebSocket upgrade request: ${url}`);
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  server.listen(port, bindAddress, () => {
    console.log(`🌐 HTTP Proxy listening on ${bindAddress}:${port}`);
  });

  return server;
}

export { proxyRequest };
