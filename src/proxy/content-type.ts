/**
 * Content Type Detection
 *
 * Determines the coarse transformable content type (js/css/html/other) from
 * response headers and URL patterns, plus magic-byte binary detection used as
 * a safety net before any text transformation.
 *
 * @module proxy/content-type
 */

import { URL } from 'node:url';
import type { ContentType } from './types.js';

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

  // Skip React Server Component payloads - these contain JSON data, not executable JS
  if (contentType.includes('text/x-component') ||
      contentType.includes('application/rsc')) {
    return 'other';
  }

  // Check for RSC URL patterns (Next.js RSC requests)
  const urlLower = url.toLowerCase();
  if (urlLower.includes('_rsc=') || urlLower.includes('?rsc=') || urlLower.includes('&rsc=') ||
      urlLower.includes('_next/data/') || urlLower.includes('__nextjs_')) {
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
  // or if content-type is generic text/plain
  const pathname = new URL(url, 'http://localhost').pathname.toLowerCase();

  if (!contentType || contentType.includes('text/plain')) {
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

  // Special URL pattern detection for CDN/dynamic JS URLs without extension
  // YouTube uses paths like /s/_/ytmainappweb/_/js/...
  if (!contentType || contentType.includes('text/plain')) {
    if (pathname.includes('/js/') || pathname.includes('/_/js/') || pathname.includes('.js.')) {
      return 'js';
    }
    if (pathname.includes('/css/') || pathname.includes('/_/css/')) {
      return 'css';
    }
  }

  return 'other';
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
