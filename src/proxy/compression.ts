/**
 * Compression Utilities
 *
 * Async (non-blocking) gzip/brotli/deflate helpers shared by both proxy
 * implementations: decompress upstream bodies before transformation and
 * re-compress responses for clients that accept gzip.
 *
 * @module proxy/compression
 */

import { gunzip, brotliDecompress, inflate, gzip } from 'node:zlib';
import { log } from '../logger/log.js';
import { promisify } from 'node:util';
import { getConfig } from '../config/index.js';
import { recordError } from '../metrics/index.js';

// Promisified zlib functions for non-blocking compression/decompression
const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);
const inflateAsync = promisify(inflate);
const gzipAsync = promisify(gzip);

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

/**
 * Decompress response body based on encoding (async, non-blocking)
 */
export async function decompressBody(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding) return body;

  const normalizedEncoding = encoding.toLowerCase().trim();

  try {
    switch (normalizedEncoding) {
      case 'gzip':
        return await gunzipAsync(body);
      case 'br':
        return await brotliDecompressAsync(body);
      case 'deflate':
        return await inflateAsync(body);
      default:
        return body;
    }
  } catch (err) {
    log.warn(`[proxy/decompress] ${normalizedEncoding} failed, passing body through`, err);
    recordError();
    return body;
  }
}

/**
 * Compress body with gzip (async, non-blocking)
 *
 * @param body - Buffer to compress
 * @param level - Compression level 1-9 (1=fastest, 9=smallest). Defaults to config value.
 */
export async function compressGzip(body: Buffer, level?: number): Promise<Buffer> {
  const effectiveLevel = level ?? getConfig().compressionLevel;
  return await gzipAsync(body, { level: effectiveLevel });
}
