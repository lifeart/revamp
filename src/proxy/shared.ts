/**
 * Shared Utilities for HTTP and SOCKS5 Proxies — compatibility facade.
 *
 * This module used to be a 900-line god module; its contents now live in
 * focused modules and this file only re-exports them so existing importers
 * keep working. New code should import from the specific module instead:
 *
 * - {@link module:proxy/cors}                CORS constants/builders + response header filtering
 * - {@link module:proxy/compression}         gzip/brotli/deflate helpers
 * - {@link module:proxy/charset}             charset extraction + Windows-1251 decoding
 * - {@link module:proxy/content-type}        content-type detection + binary sniffing
 * - {@link module:proxy/blocking}            domain/URL blocking (+ plugin-hook variants)
 * - {@link module:proxy/transform-pipeline}  the transformContent orchestrator
 * - {@link module:proxy/user-agent}          User-Agent spoofing
 *
 * @module proxy/shared
 */

// Re-export types for convenience
export type { ContentType } from './types.js';

// Re-export config endpoint utilities
export { CONFIG_ENDPOINT, isConfigEndpoint, handleConfigRequest, buildRawHttpResponse } from './config-endpoint.js';

// CORS constants/builders + response header filtering
export {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  SKIP_RESPONSE_HEADERS,
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
  removeCorsHeaders,
  resolveCorsAllowOrigin,
  buildScopedCorsHeaders,
  buildScopedCorsHeadersString,
  buildScopedCorsPreflightResponse,
  filterResponseHeaders,
} from './cors.js';

// Compression utilities
export {
  shouldCompress,
  acceptsGzip,
  decompressBody,
  compressGzip,
} from './compression.js';

// Charset handling
export {
  getCharset,
  decodeWindows1251,
  decodeBufferToString,
} from './charset.js';

// Content type detection
export {
  getContentType,
  isBinaryContent,
} from './content-type.js';

// Domain/URL blocking
export {
  shouldBlockDomain,
  shouldBlockDomainAsync,
  shouldBlockUrl,
  shouldBlockUrlAsync,
} from './blocking.js';

// Transform pipeline
export { transformContent } from './transform-pipeline.js';

// User-Agent spoofing
export { SPOOFED_USER_AGENT, spoofUserAgent } from './user-agent.js';

// Re-export filter context creation for use in proxy handlers
export { createFilterContext, type FilterContext } from '../filters/index.js';
