/**
 * Proxy Module
 *
 * Main entry point for the proxy functionality.
 * Provides HTTP and SOCKS5 proxy servers with content transformation.
 *
 * @module proxy
 *
 * @example
 * ```typescript
 * import { createHttpProxy, createSocks5Proxy } from './proxy';
 *
 * // Start HTTP proxy on port 8080
 * const httpServer = createHttpProxy(8080);
 *
 * // Start SOCKS5 proxy on port 1080
 * const socks5Server = createSocks5Proxy(1080, 8080);
 * ```
 */

// =============================================================================
// Proxy Servers
// =============================================================================

export { createHttpProxy, proxyRequest } from './http-proxy.js';
export { createSocks5Proxy } from './socks5.js';

// =============================================================================
// Types
// =============================================================================

export type {
  ContentType,
  HttpResponse,
  ParsedAddress,
  RequestHeaders,
  ResponseHeaders,
  ImageTransformResult,
  CacheMetadata,
} from './types.js';

// =============================================================================
// Config Endpoint
// =============================================================================

export {
  CONFIG_ENDPOINT,
  isConfigEndpoint,
  handleConfigRequest,
  buildRawHttpResponse,
  type ConfigEndpointResult,
} from './config-endpoint.js';

// =============================================================================
// Remote Service Worker Server
// =============================================================================

export {
  remoteSwServer,
  RemoteSwServer,
  isRemoteSwEndpoint,
  getRemoteSwStatus,
} from './remote-sw-server.js';

// =============================================================================
// SOCKS5 Protocol
// =============================================================================

export {
  SOCKS_VERSION,
  AUTH_NO_AUTH,
  AUTH_NO_ACCEPTABLE,
  ADDR_IPV4,
  ADDR_DOMAIN,
  ADDR_IPV6,
  CMD_CONNECT,
  REPLY_SUCCESS,
  REPLY_GENERAL_FAILURE,
  REPLY_NETWORK_UNREACHABLE,
  REPLY_COMMAND_NOT_SUPPORTED,
  REPLY_ADDRESS_TYPE_NOT_SUPPORTED,
  ConnectionState,
  parseAddress,
  createReply,
  isLikelyHttpRequest,
  createAuthResponse,
} from './socks5-protocol.js';

// =============================================================================
// HTTP Client
// =============================================================================

export { makeHttpRequest, makeHttpsRequest } from './http-client.js';

// =============================================================================
// Shared Utilities
// =============================================================================

export {
  // CORS
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
  removeCorsHeaders,

  // Headers
  SKIP_RESPONSE_HEADERS,
  filterResponseHeaders,

  // Compression
  shouldCompress,
  acceptsGzip,
  decompressBody,
  compressGzip,

  // Content
  getCharset,
  getContentType,
  isBinaryContent,
  decodeWindows1251,
  decodeBufferToString,
  transformContent,

  // Blocking
  shouldBlockDomain,
  shouldBlockUrl,

  // User Agent
  SPOOFED_USER_AGENT,
  spoofUserAgent,
} from './shared.js';
