/**
 * Proxy index
 * Re-exports all proxy components
 */

export { createHttpProxy, proxyRequest } from './http-proxy.js';
export { createSocks5Proxy } from './socks5.js';
export {
  type ContentType,
  CONFIG_ENDPOINT,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  SKIP_RESPONSE_HEADERS,
  shouldCompress,
  acceptsGzip,
  getCharset,
  getContentType,
  decompressBody,
  isBinaryContent,
  decodeWindows1251,
  decodeBufferToString,
  transformContent,
  shouldBlockDomain,
  shouldBlockUrl,
  SPOOFED_USER_AGENT,
  spoofUserAgent,
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
  removeCorsHeaders,
  filterResponseHeaders,
} from './shared.js';
