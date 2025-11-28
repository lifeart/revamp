/**
 * Shared Utilities for HTTP and SOCKS5 Proxies
 *
 * This module provides common functionality used by both proxy implementations:
 * - CORS header management
 * - Content type detection and transformation
 * - Compression/decompression utilities
 * - Charset handling (including Windows-1251 for Cyrillic)
 * - Domain/URL blocking for ads and tracking
 * - Response header filtering
 *
 * @module proxy/shared
 */

import { gunzip, brotliDecompress, inflate, gzip } from 'node:zlib';
import { promisify } from 'node:util';

// Promisified zlib functions for non-blocking compression/decompression
const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);
const inflateAsync = promisify(inflate);
const gzipAsync = promisify(gzip);
import { URL } from 'node:url';
import { getConfig, type RevampConfig } from '../config/index.js';
import { getCached, setCache } from '../cache/index.js';
import { transformJs, transformCss, transformHtml, isHtmlDocument } from '../transformers/index.js';
import { recordCacheHit } from '../metrics/index.js';
import type { ContentType } from './types.js';

// Re-export types for convenience
export type { ContentType } from './types.js';

// Re-export config endpoint utilities
export { CONFIG_ENDPOINT, isConfigEndpoint, handleConfigRequest, buildRawHttpResponse } from './config-endpoint.js';

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
]);

// =============================================================================
// Compression Utilities
// =============================================================================

/** Content types that benefit from gzip compression */
const COMPRESSIBLE_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'image/svg+xml',
];

/**
 * Check if content type should be gzip compressed
 *
 * @param contentType - Content-Type header value
 * @returns true if content should be compressed
 */
export function shouldCompress(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return COMPRESSIBLE_TYPES.some(type => ct.includes(type));
}

/**
 * Check if client accepts gzip encoding
 *
 * @param acceptEncoding - Accept-Encoding header value
 * @returns true if client accepts gzip
 */
export function acceptsGzip(acceptEncoding: string | undefined): boolean {
  return (acceptEncoding || '').includes('gzip');
}

// =============================================================================
// Charset Handling
// =============================================================================

/**
 * Extract charset from Content-Type header
 *
 * @param contentType - Content-Type header value
 * @returns Charset name (defaults to 'utf-8')
 */
export function getCharset(contentType: string): string {
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  if (charsetMatch) {
    return charsetMatch[1].toLowerCase().replace(/["']/g, '');
  }
  return 'utf-8';
}

/**
 * Windows-1251 (Cyrillic) to Unicode mapping for bytes 0x80-0xFF
 * Used for Russian/Ukrainian/Bulgarian websites that use this encoding
 */
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

/**
 * Windows-1251 (Cyrillic) decoder
 */
export function decodeWindows1251(buffer: Buffer): string {
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

/**
 * Determine content type from headers and URL
 */
export function getContentType(headers: Record<string, string | string[] | undefined>, url: string): ContentType {
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

/**
 * Decompress response body based on encoding (async, non-blocking)
 */
export async function decompressBody(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding) return body;

  try {
    switch (encoding.toLowerCase()) {
      case 'gzip':
        return await gunzipAsync(body);
      case 'br':
        return await brotliDecompressAsync(body);
      case 'deflate':
        return await inflateAsync(body);
      default:
        return body;
    }
  } catch {
    return body;
  }
}

/**
 * Compress body with gzip (async, non-blocking)
 */
export async function compressGzip(body: Buffer): Promise<Buffer> {
  return await gzipAsync(body);
}

// Binary file signatures (magic bytes)
const BINARY_SIGNATURES = [
  [0x47, 0x49, 0x46, 0x38],       // GIF (GIF87a, GIF89a)
  [0x89, 0x50, 0x4E, 0x47],       // PNG
  [0xFF, 0xD8, 0xFF],              // JPEG
  [0x52, 0x49, 0x46, 0x46],       // WEBP (RIFF)
  [0x00, 0x00, 0x00],              // Various (MP4, etc.)
  [0x50, 0x4B, 0x03, 0x04],       // ZIP/XLSX/DOCX
  [0x25, 0x50, 0x44, 0x46],       // PDF
  [0x1F, 0x8B],                    // GZIP
];

/**
 * Check if buffer contains binary content by looking for common binary file signatures
 */
export function isBinaryContent(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  for (const sig of BINARY_SIGNATURES) {
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

/**
 * Decode buffer to string using the correct charset
 */
export function decodeBufferToString(body: Buffer, charset: string): string {
  const normalizedCharset = charset.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Handle common Russian/Cyrillic encodings
  if (normalizedCharset === 'windows1251' || normalizedCharset === 'cp1251' || normalizedCharset === 'win1251') {
    return decodeWindows1251(body);
  } else if (normalizedCharset === 'iso88591' || normalizedCharset === 'latin1') {
    return body.toString('latin1');
  }

  // Default to UTF-8
  return body.toString('utf-8');
}

/**
 * Transform content (JS, CSS, HTML) based on type and config
 */
export async function transformContent(
  body: Buffer,
  contentType: ContentType,
  url: string,
  charset: string = 'utf-8',
  config?: RevampConfig
): Promise<Buffer> {
  const effectiveConfig = config || getConfig();

  // Safety check: don't transform binary content even if content-type was wrong
  if (isBinaryContent(body)) {
    console.log(`⏭️ Skipping binary content: ${url}`);
    return body;
  }

  // Check cache first (only if cache is enabled in config)
  if (effectiveConfig.cacheEnabled) {
    const cached = await getCached(url, contentType);
    if (cached) {
      console.log(`📦 Cache hit: ${url}`);
      recordCacheHit();
      return cached;
    }
  }

  const text = decodeBufferToString(body, charset);
  let transformed: string;

  switch (contentType) {
    case 'js':
      if (effectiveConfig.transformJs) {
        console.log(`🔧 Transforming JS: ${url}`);
        transformed = await transformJs(text, url);
      } else {
        transformed = text;
      }
      break;
    case 'css':
      if (effectiveConfig.transformCss) {
        console.log(`🎨 Transforming CSS: ${url}`);
        transformed = await transformCss(text, url);
      } else {
        transformed = text;
      }
      break;
    case 'html':
      if (effectiveConfig.transformHtml && isHtmlDocument(text)) {
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

  // Cache the result (only if cache is enabled)
  if (effectiveConfig.cacheEnabled) {
    await setCache(url, contentType, result);
  }

  return result;
}

/**
 * Check if a domain should be blocked (ads/tracking)
 */
export function shouldBlockDomain(hostname: string, config?: RevampConfig): boolean {
  const effectiveConfig = config || getConfig();

  // Check ad domains
  if (effectiveConfig.removeAds) {
    for (const domain of effectiveConfig.adDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }

  // Check tracking domains
  if (effectiveConfig.removeTracking) {
    for (const domain of effectiveConfig.trackingDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a URL should be blocked by pattern
 */
export function shouldBlockUrl(url: string, config?: RevampConfig): boolean {
  const effectiveConfig = config || getConfig();

  // Never block internal Revamp API endpoints
  if (url.includes('/__revamp__/')) {
    return false;
  }

  // Check tracking URL patterns
  if (effectiveConfig.removeTracking) {
    const urlLower = url.toLowerCase();
    for (const pattern of effectiveConfig.trackingUrls) {
      if (urlLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Spoof user agent header if enabled in config
 */
export const SPOOFED_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Apply user agent spoofing if enabled
 */
export function spoofUserAgent(headers: Record<string, string | string[] | undefined>, config?: RevampConfig): void {
  const effectiveConfig = config || getConfig();
  if (effectiveConfig.spoofUserAgent && headers['user-agent']) {
    headers['user-agent'] = SPOOFED_USER_AGENT;
  }
}

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
