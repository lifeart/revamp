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
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';
import { resolveBucketClientIp } from './socks5.js';
import { getEffectiveConfig, getEffectiveConfigForRequestAsync, getConfig } from '../config/index.js';
import {
  recordRequest,
  recordBlocked,
  recordError,
  recordHostBlocked,
  recordHostError,
  updateConnections,
} from '../metrics/index.js';
import { generateDomainCert, CertRateLimitError } from '../certs/index.js';
import {
  shouldCompress,
  acceptsGzip,
  compressGzip,
  shouldBlockDomain,
  shouldBlockUrl,
  removeCorsHeaders,
  buildScopedCorsHeaders,
} from './shared.js';
import {
  processProxiedResponse,
  requestWithBody,
  ResponseBodyTooLargeError,
  type RequestWithBodyOptions,
  type ProcessedProxyResponse,
} from './http-client.js';
import {
  applyPreRequestHooks,
  buildRequestContext,
  newRequestId,
} from './proxy-hooks.js';
import type { RequestContext } from '../plugins/hooks.js';
import type { DomainProfile } from '../config/domain-rules.js';
import { isRevampEndpoint, handleRevampRequest } from './revamp-api.js';
import { remoteSwServer, isRemoteSwEndpoint } from './remote-sw-server.js';

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
  // Remove Origin header to prevent upstream CORS issues (e.g., fonts.gstatic.com).
  // When proxying, the browser's Origin doesn't match what upstream servers expect.
  // CORS injection on responses is opt-in per domain profile (T9).
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
 * Thrown by `bufferRequestBody` when the inbound request body exceeds the
 * configured `maxRequestBodyBytes`. Callers translate this into a `413`
 * client response (P1-3).
 */
export class RequestBodyTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Request body exceeds max (${limitBytes} bytes)`);
    this.name = 'RequestBodyTooLargeError';
  }
}

/** Default cap on inbound request body size when config doesn't specify. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;

/**
 * Buffer the entire request body. The legacy implementation only buffered
 * when JSON logging was enabled and otherwise streamed via `req.pipe`; the
 * linearised flow buffers unconditionally so the upstream call can be a
 * single awaited helper (T17). Callers that don't expect a body still get a
 * zero-length buffer.
 *
 * P1-3: previously this concatenated every chunk until `end` with no cap, so
 * a 1 GB upload would OOM the iPad-class host. We now enforce a config-driven
 * `maxRequestBodyBytes` (default 50 MB) and reject with
 * `RequestBodyTooLargeError` so the caller can return 413.
 */
async function bufferRequestBody(req: IncomingMessage): Promise<Buffer> {
  const maxBytes = getConfig().maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new RequestBodyTooLargeError(maxBytes);
        // Destroy the underlying stream so we stop receiving — without this
        // the client may keep uploading megabytes after we've already given
        // up on the request.
        req.destroy(err);
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
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
 * Send the blocked response. T20: when the client prefers HTML (i.e. it's a
 * browser navigation), render a small explanatory page with a link to the
 * admin panel; otherwise keep the prior machine-friendly 204 status.
 */
function sendBlockedResponse(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  reason: string
): void {
  if (clientAcceptsHtml(req)) {
    const body = buildBlockedNavigationPage(hostname, reason);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }
  res.writeHead(204);
  res.end();
}

/**
 * Check if request should be blocked and send appropriate response.
 *
 * @param req - Incoming request (used to detect HTML preference)
 * @param res - Server response
 * @param hostname - Target hostname
 * @param targetUrl - Full target URL
 * @param config - Effective configuration
 * @returns true if request was blocked
 */
function checkAndBlockRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  targetUrl: string,
  config: ReturnType<typeof getEffectiveConfig>
): boolean {
  if (shouldBlockDomain(hostname, config)) {
    console.log(`🚫 Blocked domain: ${hostname}`);
    recordBlocked();
    recordHostBlocked(targetUrl);
    sendBlockedResponse(req, res, hostname, `Domain blocked by Revamp: ${hostname}`);
    return true;
  }

  if (shouldBlockUrl(targetUrl, config)) {
    console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
    recordBlocked();
    recordHostBlocked(targetUrl);
    sendBlockedResponse(req, res, hostname, `Tracking URL blocked by Revamp: ${targetUrl}`);
    return true;
  }

  return false;
}

// =============================================================================
// Compression
// =============================================================================

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

/** TLS error codes/strings that indicate upstream certificate validation failure */
const TLS_CERT_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID',
  'CRL_HAS_EXPIRED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
  'OUT_OF_MEM',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG',
  'CERT_REVOKED',
  'INVALID_CA',
  'PATH_LENGTH_EXCEEDED',
  'INVALID_PURPOSE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Detect whether an error originated from upstream TLS certificate validation.
 *
 * The TLS error codes set is the precise signal; the message regex is a
 * narrow fallback for the handful of TLS errors Node surfaces without a
 * stable `code` (older Node versions, OpenSSL quirks). Tightened from the
 * earlier loose `/certificate/i` pattern after Round 1 review.
 */
function isUpstreamCertError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && TLS_CERT_ERROR_CODES.has(code)) {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  if (
    typeof message === 'string' &&
    /(unable to verify|self-signed|self signed|altname|tls)/i.test(message)
  ) {
    return true;
  }
  return false;
}

/**
 * Escape HTML special characters to prevent injection in the error page.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a 502 HTML page for upstream certificate validation failure.
 */
function buildUpstreamCertFailurePage(hostname: string, reason: string): string {
  const safeHost = escapeHtml(hostname);
  const safeReason = escapeHtml(reason);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>502 - Upstream Certificate Failed Validation</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.4em; }
code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
.reason { background: #fff7e6; border-left: 4px solid #d97706; padding: 0.6em 1em; margin: 1em 0; }
</style>
</head>
<body>
<h1>Upstream certificate failed validation</h1>
<p>Revamp could not securely connect to <code>${safeHost}</code> because the server's TLS certificate did not validate.</p>
<div class="reason">${safeReason}</div>
<p>This block is intentional: Revamp re-signs upstream traffic with its own CA, so accepting an invalid upstream certificate would silently launder it into a trusted-looking connection on your device.</p>
<p>If you knowingly need to bypass this (e.g., development or self-hosted services), set <code>allowInsecureUpstream: true</code> in your Revamp config.</p>
</body>
</html>`;
}

/**
 * Build a 200 HTML page for blocked navigation requests (T20). Returns 200
 * (not 4xx) so iOS Safari renders the page rather than its own opaque
 * "could not connect" overlay; the body explains the block and links to the
 * admin domain panel where the user can change rules.
 */
function buildBlockedNavigationPage(hostname: string, reason: string): string {
  const safeHost = escapeHtml(hostname);
  const safeReason = escapeHtml(reason);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Blocked by Revamp - ${safeHost}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.4em; }
code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
.reason { background: #fef2f2; border-left: 4px solid #dc2626; padding: 0.6em 1em; margin: 1em 0; }
a { color: #2563eb; }
</style>
</head>
<body>
<h1>Blocked by Revamp</h1>
<p>Revamp blocked the request to <code>${safeHost}</code>.</p>
<div class="reason">${safeReason}</div>
<p>Edit or disable the matching rule in the <a href="/__revamp__/admin/domains.html">Domain Profiles admin panel</a>.</p>
</body>
</html>`;
}

/**
 * Build a 502 HTML page for generic upstream errors (T20). Distinct from the
 * cert-failure variant because the recovery suggestion is different: the
 * common upstream-error cause we can guide the user toward is a busted
 * transformation, so we link to the admin panel where JS transform can be
 * disabled per-domain.
 */
function buildUpstreamErrorPage(url: string, reason: string): string {
  const safeUrl = escapeHtml(url);
  const safeReason = escapeHtml(reason);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>502 - Upstream Error</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.4em; }
code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; word-break: break-all; }
.reason { background: #fff7e6; border-left: 4px solid #d97706; padding: 0.6em 1em; margin: 1em 0; }
a { color: #2563eb; }
</style>
</head>
<body>
<h1>Upstream error</h1>
<p>Revamp could not load <code>${safeUrl}</code>.</p>
<div class="reason">${safeReason}</div>
<p>If this site loads outside Revamp, try disabling JS transform for this domain in the <a href="/__revamp__/admin/domains.html">Domain Profiles admin panel</a>.</p>
</body>
</html>`;
}

/**
 * Detect whether the client request prefers an HTML response.
 */
function clientAcceptsHtml(req: IncomingMessage): boolean {
  const accept = req.headers['accept'];
  const value = Array.isArray(accept) ? accept.join(',') : accept;
  if (!value) return false;
  return /text\/html/i.test(value);
}

/**
 * Send an upstream-cert-failure 502 response.
 * HTML is returned when the client accepts text/html, otherwise plain text.
 */
function sendUpstreamCertFailure(
  res: ServerResponse,
  hostname: string,
  err: unknown,
  acceptsHtml: boolean
): void {
  if (res.headersSent) return;
  const reason = err instanceof Error ? err.message : String(err);
  if (acceptsHtml) {
    const body = buildUpstreamCertFailurePage(hostname, reason);
    res.writeHead(502, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  } else {
    const body = `502 Bad Gateway: upstream certificate failed validation for ${hostname}: ${reason}`;
    res.writeHead(502, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  }
}

/**
 * Flatten any thrown value (Error, AggregateError, primitive) to a single
 * human-readable string. Replaces a duplicated AggregateError-handling block
 * that previously lived in both the `proxyRequest` rejection path and the
 * CONNECT handler's catch (T17).
 */
function flattenError(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map((e: Error) => e.message || String(e)).join('; ');
    return `${err.message}: [${inner}]`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Send a generic upstream-error 502 response. T20: HTML when client accepts
 * text/html, plain text otherwise (the plain-text body still embeds the
 * reason so callers like the body-size-limit path keep their machine-friendly
 * detail in the response).
 */
function sendUpstreamErrorResponse(
  req: IncomingMessage | null,
  res: ServerResponse,
  url: string,
  reason: string
): void {
  if (res.headersSent) return;
  if (req && clientAcceptsHtml(req)) {
    const body = buildUpstreamErrorPage(url, reason);
    res.writeHead(502, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }
  const body = `502 Bad Gateway: ${reason}`;
  res.writeHead(502, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/**
 * Handle proxy request error.
 *
 * @param err - Error object
 * @param req - Incoming request (for HTML content-negotiation; nullable for
 *   call sites that occur before request parsing)
 * @param res - Server response
 * @param context - Error context for logging
 * @param url - The URL we were trying to proxy, for the HTML page
 */
function handleProxyError(
  err: unknown,
  req: IncomingMessage | null,
  res: ServerResponse,
  context: string,
  url: string
): void {
  const reason = flattenError(err);
  console.error(`❌ ${context}: ${reason}`);
  recordError();
  recordHostError(url);
  sendUpstreamErrorResponse(req, res, url, reason);
}

// =============================================================================
// Main Proxy Request Handler
// =============================================================================

/**
 * Outcome of `prepareRequest`. Either `blocked` is true (caller already
 * sent a response and should return) or the upstream-call inputs are
 * populated for `executeUpstream`.
 */
interface PreparedRequest {
  blocked: boolean;
  url: string;
  options: RequestWithBodyOptions;
  requestContext: RequestContext;
  effectiveClientIp: string;
  effectiveHeaders: Record<string, string | string[] | undefined>;
  requestBody: Buffer;
  /** Matched domain profile, used downstream for opt-in CORS injection (T9). */
  profile: DomainProfile | null;
}

/**
 * Phase 1 of `proxyRequest` (T17): build the request context, run the
 * `request:pre` hook chain, apply built-in domain/URL blocking, and produce
 * the inputs `executeUpstream` needs. May write a final response and
 * return `{ blocked: true }`, in which case the caller must return early.
 */
async function prepareRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  isHttps: boolean,
  effectiveClientIp: string
): Promise<PreparedRequest> {
  const parsedUrl = new URL(targetUrl);
  const { config, profile } = await getEffectiveConfigForRequestAsync(
    parsedUrl.hostname,
    effectiveClientIp
  );
  recordRequest();

  const requestContext = buildRequestContext({
    url: targetUrl,
    method: req.method || 'GET',
    headers: req.headers as Record<string, string | string[] | undefined>,
    clientIp: effectiveClientIp,
    hostname: parsedUrl.hostname,
    config,
    profile,
    isHttps,
    requestId: newRequestId(),
    startTime: Date.now(),
  });

  const preOutcome = await applyPreRequestHooks(requestContext);
  if (preOutcome.blocked) {
    console.log(`🔌 Request blocked by plugin: ${preOutcome.stoppedBy || 'unknown'}`);
    recordBlocked();
    recordHostBlocked(targetUrl);
    const blocked = preOutcome.blockedResponse;
    if (blocked) {
      res.writeHead(blocked.statusCode, blocked.headers);
      res.end(blocked.body);
    } else {
      sendBlockedResponse(
        req,
        res,
        parsedUrl.hostname,
        `Request blocked by plugin: ${preOutcome.stoppedBy || 'unknown'}`
      );
    }
    return blockedSentinel();
  }

  // Plugin-driven URL/headers modifications surface here.
  targetUrl = preOutcome.url;
  Object.assign(req.headers, preOutcome.headers);

  // Re-parse if a plugin rewrote the URL — port and pathname may have
  // changed and feed directly into the upstream options.
  const finalUrl = new URL(targetUrl);

  if (checkAndBlockRequest(req, res, finalUrl.hostname, targetUrl, config)) {
    return blockedSentinel();
  }

  const globalConfig = getConfig();
  const requestBody = await bufferRequestBody(req);
  const headers = prepareProxyHeaders(req, finalUrl, config.spoofUserAgent);

  const options: RequestWithBodyOptions = {
    hostname: finalUrl.hostname,
    port: finalUrl.port || (isHttps ? 443 : 80),
    path: finalUrl.pathname + finalUrl.search,
    method: req.method || 'GET',
    headers,
    rejectUnauthorized: globalConfig.allowInsecureUpstream !== true,
    secure: isHttps,
  };

  return {
    blocked: false,
    url: targetUrl,
    options,
    requestContext,
    effectiveClientIp,
    effectiveHeaders: req.headers as Record<string, string | string[] | undefined>,
    requestBody,
    profile,
  };
}

/** Sentinel for `prepareRequest` short-circuits. */
function blockedSentinel(): PreparedRequest {
  return {
    blocked: true,
    url: '',
    options: {
      hostname: '',
      port: 0,
      path: '',
      method: 'GET',
      headers: {},
      secure: false,
    },
    requestContext: {} as RequestContext,
    effectiveClientIp: '',
    effectiveHeaders: {},
    requestBody: Buffer.alloc(0),
    profile: null,
  };
}

/**
 * Phase 2: issue the upstream request and feed the response through
 * `processProxiedResponse` (transform + post-response hooks).
 */
async function executeUpstream(
  prepared: PreparedRequest
): Promise<ProcessedProxyResponse> {
  const raw = await requestWithBody(prepared.options, prepared.requestBody);

  return processProxiedResponse({
    rawBody: raw.body,
    upstreamHeaders: raw.headers,
    upstreamStatusCode: raw.statusCode,
    upstreamStatusMessage: raw.statusMessage,
    url: prepared.url,
    method: prepared.options.method,
    clientIp: prepared.effectiveClientIp,
    requestHeaders: prepared.effectiveHeaders,
    requestBody: prepared.requestBody,
    runPostResponseHook: true,
    requestContext: prepared.requestContext,
  });
}

/**
 * Phase 3: apply CORS (T9: opt-in per profile only), no-cache (HTML),
 * gzip compression, content-length, then write the response to the client.
 */
async function sendProcessedResponse(
  req: IncomingMessage,
  res: ServerResponse,
  processed: ProcessedProxyResponse,
  profile: DomainProfile | null
): Promise<void> {
  let body = processed.body;
  const headers = sanitizeResponseHeaders(processed.headers);

  const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
  const currentContentType = Array.isArray(headers['content-type'])
    ? headers['content-type'][0]
    : (headers['content-type'] || '');
  body = await applyCompressionIfNeeded(body, currentContentType, acceptEncoding, headers);

  headers['content-length'] = String(body.length);

  // T9: strip whatever CORS headers the upstream advertised (we don't want
  // to leak them through verbatim) and only re-emit them when the matched
  // domain profile has explicitly opted in via `corsAllowOrigins`.
  removeCorsHeaders(headers);
  const requestOrigin = req.headers['origin'] as string | undefined;
  const scopedCors = buildScopedCorsHeaders(profile, requestOrigin);
  if (Object.keys(scopedCors).length > 0) {
    Object.assign(headers, scopedCors);
  }

  // Prevent browser caching for HTML so config changes (e.g. polyfill set)
  // become visible without a hard reload on legacy devices.
  if (processed.contentType === 'html') {
    headers['cache-control'] = 'no-cache, must-revalidate';
    headers['vary'] = 'Accept-Encoding';
  }

  res.writeHead(processed.statusCode, headers);
  res.end(body);
}

/**
 * Proxy an HTTP/HTTPS request with content transformation.
 *
 * Linearised in T17 from a 247-line nested-callback implementation into a
 * sequence of `prepareRequest` → `executeUpstream` → `sendProcessedResponse`.
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

  if (isRevampEndpoint(parsedUrl.pathname)) {
    req.url = parsedUrl.pathname + parsedUrl.search;
    const handled = await handleRevampApiRequest(req, res, effectiveClientIp);
    if (handled) return;
  }

  let prepared: PreparedRequest;
  try {
    prepared = await prepareRequest(req, res, targetUrl, isHttps, effectiveClientIp);
  } catch (err) {
    // P1-3: translate body-size-limit errors into a 413 instead of the
    // generic 502 path, so clients see "I sent too much" rather than
    // "upstream broke" — and so the iPad host doesn't keep buffering.
    if (err instanceof RequestBodyTooLargeError) {
      console.warn(`[http-proxy] request body exceeds max (${err.limitBytes} bytes)`);
      recordError();
      recordHostError(targetUrl);
      sendErrorResponse(res, 413, 'Payload Too Large');
      return;
    }
    handleProxyError(err, req, res, 'Proxy prepare error', targetUrl);
    return;
  }
  if (prepared.blocked) return;

  let processed: ProcessedProxyResponse;
  try {
    processed = await executeUpstream(prepared);
  } catch (err) {
    if (isUpstreamCertError(err)) {
      console.error(
        `❌ Upstream cert validation failed for ${parsedUrl.hostname}: ${flattenError(err)}`
      );
      recordError();
      sendUpstreamCertFailure(res, parsedUrl.hostname, err, clientAcceptsHtml(req));
      return;
    }
    // P1-3: upstream tried to deliver more bytes than `maxResponseBodyBytes`
    // allows — surface as 502 with a small explanation so the client knows
    // it's an upstream-side issue, not a malformed request.
    if (err instanceof ResponseBodyTooLargeError) {
      console.warn(
        `[http-proxy] upstream response exceeds max (${err.limitBytes} bytes) for ${parsedUrl.hostname}`
      );
      recordError();
      recordHostError(targetUrl);
      sendUpstreamErrorResponse(
        req,
        res,
        targetUrl,
        `upstream response exceeds maximum allowed size (${err.limitBytes} bytes)`
      );
      return;
    }
    handleProxyError(err, req, res, 'Proxy request error', targetUrl);
    return;
  }

  try {
    await sendProcessedResponse(req, res, processed, prepared.profile);
  } catch (err) {
    handleProxyError(err, req, res, 'Proxy send error', targetUrl);
  }
}

// =============================================================================
// HTTPS CONNECT Handler
// =============================================================================

/**
 * Forward an intercepted WebSocket upgrade to the upstream HTTPS server,
 * honouring the global `allowInsecureUpstream` flag for TLS validation.
 *
 * Exported for integration tests; not part of the public API.
 *
 * @param httpsReq - Incoming upgrade request (decrypted by the fake HTTPS server)
 * @param socket - Client-side socket (pre-upgrade)
 * @param upgradeHead - Initial data sent by the client after the upgrade headers
 * @param hostname - Upstream hostname
 * @param port - Upstream port
 */
export function forwardWebSocketUpgrade(
  httpsReq: IncomingMessage,
  socket: Duplex,
  upgradeHead: Buffer,
  hostname: string,
  port: number
): void {
  const targetHost = `${hostname}:${port}`;
  console.log(`🔌 WebSocket upgrade: wss://${targetHost}${httpsReq.url}`);

  const allowInsecure = getConfig().allowInsecureUpstream === true;

  // Create a direct TLS connection to the target server for WebSocket.
  // Default to validating the upstream certificate; users may opt in to
  // skipping validation via `allowInsecureUpstream` (T8).
  void import('node:tls').then(({ connect: tlsConnect }) => {
    const targetSocket = tlsConnect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: !allowInsecure,
      },
      () => {
        // Build the upgrade request to send to the target server
        const headers = httpsReq.headers;
        let upgradeRequest = `${httpsReq.method ?? 'GET'} ${httpsReq.url ?? '/'} HTTP/1.1\r\n`;
        upgradeRequest += `Host: ${targetHost}\r\n`;

        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase() !== 'host' && value !== undefined) {
            const headerValue = Array.isArray(value) ? value.join(', ') : value;
            upgradeRequest += `${key}: ${headerValue}\r\n`;
          }
        }
        upgradeRequest += '\r\n';

        // Send the upgrade request
        targetSocket.write(upgradeRequest);

        // If there's initial data, send it too
        if (upgradeHead.length > 0) {
          targetSocket.write(upgradeHead);
        }

        // Pipe data between client and target
        socket.pipe(targetSocket);
        targetSocket.pipe(socket);
      }
    );

    targetSocket.on('error', (err: Error) => {
      console.error(`❌ WebSocket target error: ${err.message}`);
      // Surface upstream cert failures as a 502 close frame on the client side
      // so the client never sees a happy upgrade for a MITM'd upstream.
      if (!socket.destroyed) {
        if (isUpstreamCertError(err)) {
          try {
            socket.write(
              `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n` +
                `Upstream certificate failed validation for ${hostname}: ${err.message}`
            );
          } catch (writeErr) {
            console.warn('[ws-upgrade] failed to write 502 to client:', writeErr);
          }
        }
        socket.end();
      }
    });

    socket.on('error', (err: Error) => {
      console.error(`❌ WebSocket client error: ${err.message}`);
      targetSocket.end();
    });

    socket.on('close', () => {
      targetSocket.end();
    });

    targetSocket.on('close', () => {
      if (!socket.destroyed) {
        socket.end();
      }
    });
  });
}

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
  // P1-1: when the socket has no remoteAddress `getClientIp` returns ''.
  // Without `resolveBucketClientIp` `enforceMintRateLimit('')` would
  // collapse every unknown client into a single shared 30/min bucket —
  // trivial DoS vector. The shared helper assigns each unknown connection
  // its own synthetic bucket and logs the fallback.
  const clientIp = resolveBucketClientIp(getClientIp(req));

  // Check domain blocking
  if (shouldBlockDomain(hostname)) {
    console.log(`🚫 Blocked HTTPS: ${hostname}`);
    recordBlocked();
    recordHostBlocked(`https://${hostname}/`);
    // T20: a plain 403 over CONNECT can't render HTML — the TLS handshake
    // hasn't happened yet, so the iPad sees a connection failure either way.
    // Keep the machine-friendly 403; HTML-aware blocking happens on the
    // post-CONNECT inner request (proxyRequest path).
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  updateConnections(1);
  console.log(`🔒 HTTPS CONNECT: ${hostname}:${port}`);

  // Generate certificate for TLS interception (rate-limited per client IP).
  // P1-2: previously the non-rate-limit branch re-threw, which inside this
  // synchronous `server.on('connect')` handler surfaces as
  // `uncaughtException` and can crash the process. Log + record + close the
  // client socket gracefully instead.
  let certPair: ReturnType<typeof generateDomainCert>;
  try {
    certPair = generateDomainCert(hostname, clientIp);
  } catch (err) {
    if (err instanceof CertRateLimitError) {
      console.warn(`[http-proxy] cert mint rate limit exceeded for ${clientIp}`);
      recordError();
      clientSocket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return;
    }
    console.error('[http-proxy] cert mint failed', err);
    recordError();
    clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    return;
  }

  // Create temporary HTTPS server for this connection
  const fakeServer = createHttpsServer(
    { key: certPair.key, cert: certPair.cert },
    async (httpsReq, httpsRes) => {
      const targetUrl = `https://${hostname}${httpsReq.url}`;
      console.log(`🔐 HTTPS: ${httpsReq.method} ${targetUrl}`);

      try {
        await proxyRequest(httpsReq, httpsRes, targetUrl, true, clientIp);
      } catch (err) {
        console.error(`❌ HTTPS proxy error: ${flattenError(err)}`);
      }
    }
  );

  // Handle WebSocket upgrade requests through the fake HTTPS server
  fakeServer.on('upgrade', async (httpsReq, socket, upgradeHead) => {
    const url = httpsReq.url || '';

    // Check if this is a Revamp internal WebSocket endpoint
    if (isRemoteSwEndpoint(url)) {
      console.log(`🔌 HTTPS WebSocket upgrade for Remote SW: ${url}`);
      try {
        // Ensure server is initialized before handling upgrade
        if (!remoteSwServer.isInitialized()) {
          console.log(`🔌 Initializing Remote SW server...`);
          await remoteSwServer.initialize();
        }
        await remoteSwServer.handleUpgrade(httpsReq, socket, upgradeHead);
      } catch (err) {
        console.error(`❌ Remote SW upgrade error:`, err);
        socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      }
      return;
    }

    forwardWebSocketUpgrade(httpsReq, socket, upgradeHead, hostname, port);
  });

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
  server.on('upgrade', async (request, socket, head) => {
    const url = request.url || '';

    if (isRemoteSwEndpoint(url)) {
      console.log(`🔌 WebSocket upgrade request for Remote SW: ${url}`);
      try {
        // Ensure server is initialized before handling upgrade
        if (!remoteSwServer.isInitialized()) {
          console.log(`🔌 Initializing Remote SW server...`);
          await remoteSwServer.initialize();
        }
        await remoteSwServer.handleUpgrade(request, socket, head);
      } catch (err) {
        console.error(`❌ Remote SW upgrade error:`, err);
        socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      }
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
