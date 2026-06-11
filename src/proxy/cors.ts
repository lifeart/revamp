/**
 * CORS Constants, Builders, and Response Header Filtering
 *
 * Everything about cross-origin response headers in one place: the
 * permissive constants, the profile-scoped (T9 opt-in) builders for both
 * object-shaped and raw-HTTP-string responses, and the response-header
 * filtering that strips upstream CORS/CSP/hop-by-hop headers so we control
 * exactly what reaches the client.
 *
 * @module proxy/cors
 */

import { log } from '../logger/log.js';

// =============================================================================
// CORS Constants
// =============================================================================

/** HTTP methods allowed in CORS requests */
export const CORS_ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH';

/** Headers allowed in CORS requests (includes common API headers) */
export const CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, X-File-Size, X-File-Type, X-Client-Data, X-Goog-Api-Key, X-Goog-AuthUser, X-Goog-Visitor-Id, X-Origin, X-Referer, X-Same-Domain, X-Upload-Content-Type, X-Upload-Content-Length, X-YouTube-Client-Name, X-YouTube-Client-Version, pwa';

/** Headers exposed to client-side JavaScript */
export const CORS_EXPOSE_HEADERS = 'Content-Type, Content-Length, Content-Disposition, Cache-Control, ETag, Last-Modified, X-Request-Id';

// =============================================================================
// Header Filtering
// =============================================================================

/**
 * Headers to skip when proxying responses.
 * Includes:
 * - Hop-by-hop headers (connection, keep-alive, etc.)
 * - CORS headers (we replace with permissive ones)
 * - CSP headers (removed to allow injected scripts/polyfills)
 * - Cross-Origin isolation headers (CORP/COEP/COOP) to prevent OpaqueResponseBlocking
 */
export const SKIP_RESPONSE_HEADERS = new Set([
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
  // Remove Cross-Origin isolation headers to prevent OpaqueResponseBlocking
  // These headers can block resources when loaded cross-origin
  'cross-origin-resource-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
]);

/**
 * Build CORS headers object for response
 */
export function buildCorsHeaders(requestOrigin: string = '*'): Record<string, string> {
  return {
    'access-control-allow-origin': requestOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': CORS_ALLOWED_METHODS,
    'access-control-allow-headers': CORS_ALLOWED_HEADERS,
    'access-control-expose-headers': CORS_EXPOSE_HEADERS,
  };
}

/**
 * Build CORS preflight response headers string (for raw HTTP responses)
 */
export function buildCorsPreflightResponse(requestOrigin: string = '*'): string {
  return (
    'HTTP/1.1 204 No Content\r\n' +
    `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
    `Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n` +
    `Access-Control-Allow-Headers: ${CORS_ALLOWED_HEADERS}\r\n` +
    'Access-Control-Allow-Credentials: true\r\n' +
    'Access-Control-Max-Age: 86400\r\n' +
    'Content-Length: 0\r\n' +
    'Connection: close\r\n' +
    '\r\n'
  );
}

/**
 * Build CORS headers string for raw HTTP responses
 */
export function buildCorsHeadersString(requestOrigin: string = '*'): string {
  return (
    `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
    'Access-Control-Allow-Credentials: true\r\n' +
    `Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n` +
    `Access-Control-Allow-Headers: ${CORS_ALLOWED_HEADERS}\r\n` +
    `Access-Control-Expose-Headers: ${CORS_EXPOSE_HEADERS}\r\n`
  );
}

/**
 * Remove CORS headers from a headers object (to replace with our own)
 */
export function removeCorsHeaders(headers: Record<string, string | string[] | undefined>): void {
  delete headers['access-control-allow-origin'];
  delete headers['access-control-allow-methods'];
  delete headers['access-control-allow-headers'];
  delete headers['access-control-expose-headers'];
  delete headers['access-control-allow-credentials'];
  delete headers['access-control-max-age'];
}

/**
 * Resolve which CORS Allow-Origin value (if any) should be injected for a
 * proxied response (T9).
 *
 * Default behaviour: do not inject any CORS headers. Profiles must opt in
 * with `corsAllowOrigins` to expand cross-origin reachability for that
 * domain. Returns `null` when no header should be injected.
 *
 * `'*'` in `corsAllowOrigins` is honoured as a wildcard that matches any
 * origin and is reflected verbatim. For any other entry, the upstream
 * client `Origin` header must match exactly (no subdomain wildcards).
 *
 * Per the Fetch spec, `Access-Control-Allow-Credentials: true` is
 * incompatible with `Access-Control-Allow-Origin: *`; reflecting the
 * request origin under a `*` allow-list while also emitting credentials
 * would let any site read credentialed responses cross-origin. To prevent
 * a credential leak, this misconfiguration collapses to OFF (returns
 * `null`) rather than to a permissive injection.
 */
export function resolveCorsAllowOrigin(
  profile:
    | { corsAllowOrigins?: string[]; corsAllowCredentials?: boolean }
    | null
    | undefined,
  requestOrigin: string | undefined
): string | null {
  const allowList = profile?.corsAllowOrigins;
  if (!allowList || allowList.length === 0) {
    return null;
  }

  if (profile?.corsAllowCredentials === true && allowList.includes('*')) {
    log.warn(
      '[cors] credentials cannot be combined with wildcard origin; treating profile as CORS-disabled'
    );
    return null;
  }

  if (allowList.includes('*')) {
    return requestOrigin && requestOrigin !== '' ? requestOrigin : '*';
  }

  if (!requestOrigin) {
    return null;
  }

  return allowList.includes(requestOrigin) ? requestOrigin : null;
}

/**
 * Build the CORS header set to inject for a proxied response, gated by the
 * matched domain profile (T9). Returns an empty object when the profile has
 * not opted in or the request `Origin` does not match the allow list — the
 * default Revamp posture is "no CORS injection."
 */
export function buildScopedCorsHeaders(
  profile: { corsAllowOrigins?: string[]; corsAllowCredentials?: boolean } | null | undefined,
  requestOrigin: string | undefined
): Record<string, string> {
  const allowOrigin = resolveCorsAllowOrigin(profile, requestOrigin);
  if (allowOrigin === null) {
    return {};
  }

  const headers: Record<string, string> = {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': CORS_ALLOWED_METHODS,
    'access-control-allow-headers': CORS_ALLOWED_HEADERS,
    'access-control-expose-headers': CORS_EXPOSE_HEADERS,
  };

  if (profile?.corsAllowCredentials === true) {
    headers['access-control-allow-credentials'] = 'true';
  }

  return headers;
}

/**
 * Raw HTTP-response variant of {@link buildScopedCorsHeaders} for the
 * SOCKS5 path that builds responses by string concatenation. Returns an
 * empty string when no CORS injection should occur (T9 default).
 */
export function buildScopedCorsHeadersString(
  profile: { corsAllowOrigins?: string[]; corsAllowCredentials?: boolean } | null | undefined,
  requestOrigin: string | undefined
): string {
  const allowOrigin = resolveCorsAllowOrigin(profile, requestOrigin);
  if (allowOrigin === null) {
    return '';
  }

  let result =
    `Access-Control-Allow-Origin: ${allowOrigin}\r\n` +
    `Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n` +
    `Access-Control-Allow-Headers: ${CORS_ALLOWED_HEADERS}\r\n` +
    `Access-Control-Expose-Headers: ${CORS_EXPOSE_HEADERS}\r\n`;
  if (profile?.corsAllowCredentials === true) {
    result += 'Access-Control-Allow-Credentials: true\r\n';
  }
  return result;
}

/**
 * Raw HTTP-response variant of the CORS preflight builder, gated by the
 * matched domain profile (T9). Returns `null` when the profile has not
 * opted in — callers should reply with a non-permissive 403/204 in that
 * case rather than a permissive preflight.
 */
export function buildScopedCorsPreflightResponse(
  profile: { corsAllowOrigins?: string[]; corsAllowCredentials?: boolean } | null | undefined,
  requestOrigin: string | undefined
): string | null {
  const allowOrigin = resolveCorsAllowOrigin(profile, requestOrigin);
  if (allowOrigin === null) {
    return null;
  }

  let response =
    'HTTP/1.1 204 No Content\r\n' +
    `Access-Control-Allow-Origin: ${allowOrigin}\r\n` +
    `Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n` +
    `Access-Control-Allow-Headers: ${CORS_ALLOWED_HEADERS}\r\n`;
  if (profile?.corsAllowCredentials === true) {
    response += 'Access-Control-Allow-Credentials: true\r\n';
  }
  response +=
    'Access-Control-Max-Age: 86400\r\n' +
    'Content-Length: 0\r\n' +
    'Connection: close\r\n' +
    '\r\n';
  return response;
}

/**
 * Filter headers for proxying - removes hop-by-hop and problematic headers
 */
export function filterResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  skipSet: Set<string> = SKIP_RESPONSE_HEADERS
): Record<string, string | string[] | undefined> {
  const filtered: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase().trim();
    if (!skipSet.has(lowerKey)) {
      filtered[lowerKey] = value;
    }
  }
  return filtered;
}
