/**
 * Proxy Types
 * Shared type definitions for HTTP and SOCKS5 proxies
 */

import type { IncomingHttpHeaders } from 'node:http';

/**
 * Content type categories for transformation decisions
 * - 'js': JavaScript content that needs Babel transformation
 * - 'css': CSS content that needs PostCSS transformation  
 * - 'html': HTML content that may need polyfill injection
 * - 'other': Binary or other content that should pass through unchanged
 */
export type ContentType = 'js' | 'css' | 'html' | 'other';

/**
 * HTTP response structure used internally
 */
export interface HttpResponse {
  /** HTTP status code (e.g., 200, 404, 502) */
  statusCode: number;
  /** HTTP status message (e.g., "OK", "Not Found") */
  statusMessage: string;
  /** Response headers */
  headers: Record<string, string | string[] | undefined>;
  /** Response body as Buffer */
  body: Buffer;
}

/**
 * Parsed SOCKS5 address information
 */
export interface ParsedAddress {
  /** Target hostname or IP address */
  host: string;
  /** Target port number */
  port: number;
  /** SOCKS5 address type (1=IPv4, 3=Domain, 4=IPv6) */
  addressType: number;
}

/**
 * HTTP request headers as a simple string map
 */
export type RequestHeaders = Record<string, string>;

/**
 * Response headers that can contain single or multiple values
 */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/**
 * Image transformation result
 */
export interface ImageTransformResult {
  /** Whether transformation was applied */
  transformed: boolean;
  /** Transformed image data (or original if not transformed) */
  data: Buffer;
  /** Content-Type of the result */
  contentType: string;
}

/**
 * Cache entry metadata
 */
export interface CacheMetadata {
  /** Original URL */
  url: string;
  /** Content type */
  contentType: string;
  /** Timestamp when cached */
  timestamp: number;
}
