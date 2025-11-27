import { describe, it, expect } from 'vitest';
import {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  SKIP_RESPONSE_HEADERS,
  shouldCompress,
  acceptsGzip,
  getCharset,
  decodeWindows1251,
  getContentType,
  decompressBody,
  isBinaryContent,
  decodeBufferToString,
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
import type { RevampConfig } from '../config/index.js';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';

describe('CORS Constants', () => {
  it('should have correct allowed methods', () => {
    expect(CORS_ALLOWED_METHODS).toContain('GET');
    expect(CORS_ALLOWED_METHODS).toContain('POST');
    expect(CORS_ALLOWED_METHODS).toContain('PUT');
    expect(CORS_ALLOWED_METHODS).toContain('DELETE');
    expect(CORS_ALLOWED_METHODS).toContain('OPTIONS');
    expect(CORS_ALLOWED_METHODS).toContain('HEAD');
    expect(CORS_ALLOWED_METHODS).toContain('PATCH');
  });

  it('should have common headers in allowed headers', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('Content-Type');
    expect(CORS_ALLOWED_HEADERS).toContain('Authorization');
    expect(CORS_ALLOWED_HEADERS).toContain('X-Requested-With');
  });

  it('should expose common response headers', () => {
    expect(CORS_EXPOSE_HEADERS).toContain('Content-Type');
    expect(CORS_EXPOSE_HEADERS).toContain('Content-Length');
    expect(CORS_EXPOSE_HEADERS).toContain('Cache-Control');
  });
});

describe('SKIP_RESPONSE_HEADERS', () => {
  it('should skip hop-by-hop headers', () => {
    expect(SKIP_RESPONSE_HEADERS.has('transfer-encoding')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('connection')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('keep-alive')).toBe(true);
  });

  it('should skip CORS headers (we replace them)', () => {
    expect(SKIP_RESPONSE_HEADERS.has('access-control-allow-origin')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('access-control-allow-methods')).toBe(true);
  });

  it('should skip CSP headers', () => {
    expect(SKIP_RESPONSE_HEADERS.has('content-security-policy')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('x-content-security-policy')).toBe(true);
  });
});

describe('shouldCompress', () => {
  it('should return true for text content types', () => {
    expect(shouldCompress('text/html')).toBe(true);
    expect(shouldCompress('text/css')).toBe(true);
    expect(shouldCompress('text/plain')).toBe(true);
    expect(shouldCompress('text/html; charset=utf-8')).toBe(true);
  });

  it('should return true for JSON', () => {
    expect(shouldCompress('application/json')).toBe(true);
    expect(shouldCompress('application/json; charset=utf-8')).toBe(true);
  });

  it('should return true for JavaScript', () => {
    expect(shouldCompress('application/javascript')).toBe(true);
    expect(shouldCompress('text/javascript')).toBe(true);
  });

  it('should return true for XML types', () => {
    expect(shouldCompress('application/xml')).toBe(true);
    expect(shouldCompress('application/xhtml+xml')).toBe(true);
    expect(shouldCompress('image/svg+xml')).toBe(true);
  });

  it('should return false for binary types', () => {
    expect(shouldCompress('image/png')).toBe(false);
    expect(shouldCompress('image/jpeg')).toBe(false);
    expect(shouldCompress('application/octet-stream')).toBe(false);
    expect(shouldCompress('video/mp4')).toBe(false);
  });
});

describe('acceptsGzip', () => {
  it('should return true if gzip is in accept-encoding', () => {
    expect(acceptsGzip('gzip, deflate')).toBe(true);
    expect(acceptsGzip('gzip')).toBe(true);
    expect(acceptsGzip('deflate, gzip, br')).toBe(true);
  });

  it('should return false if gzip is not accepted', () => {
    expect(acceptsGzip('deflate')).toBe(false);
    expect(acceptsGzip('br')).toBe(false);
    expect(acceptsGzip('')).toBe(false);
  });

  it('should handle undefined', () => {
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('getCharset', () => {
  it('should extract charset from content-type', () => {
    expect(getCharset('text/html; charset=utf-8')).toBe('utf-8');
    expect(getCharset('text/html; charset=UTF-8')).toBe('utf-8');
    expect(getCharset('text/html; charset=windows-1251')).toBe('windows-1251');
  });

  it('should handle quoted charset', () => {
    expect(getCharset('text/html; charset="utf-8"')).toBe('utf-8');
    expect(getCharset("text/html; charset='utf-8'")).toBe('utf-8');
  });

  it('should return utf-8 as default', () => {
    expect(getCharset('text/html')).toBe('utf-8');
    expect(getCharset('')).toBe('utf-8');
  });
});

describe('decodeWindows1251', () => {
  it('should decode ASCII characters unchanged', () => {
    const buffer = Buffer.from('Hello', 'ascii');
    expect(decodeWindows1251(buffer)).toBe('Hello');
  });

  it('should decode Cyrillic characters', () => {
    // Windows-1251 encoded "Привет" (Hello in Russian)
    // П=0xCF, р=0xF0, и=0xE8, в=0xE2, е=0xE5, т=0xF2
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeWindows1251(buffer)).toBe('Привет');
  });

  it('should handle mixed ASCII and Cyrillic', () => {
    // "Hi Мир" - H=0x48, i=0x69, space=0x20, М=0xCC, и=0xE8, р=0xF0
    const buffer = Buffer.from([0x48, 0x69, 0x20, 0xcc, 0xe8, 0xf0]);
    expect(decodeWindows1251(buffer)).toBe('Hi Мир');
  });
});

describe('getContentType', () => {
  it('should detect JavaScript from content-type', () => {
    expect(getContentType({ 'content-type': 'application/javascript' }, 'http://example.com/file')).toBe('js');
    expect(getContentType({ 'content-type': 'text/javascript' }, 'http://example.com/file')).toBe('js');
    expect(getContentType({ 'content-type': 'application/ecmascript' }, 'http://example.com/file')).toBe('js');
  });

  it('should detect CSS from content-type', () => {
    expect(getContentType({ 'content-type': 'text/css' }, 'http://example.com/file')).toBe('css');
    expect(getContentType({ 'content-type': 'text/css; charset=utf-8' }, 'http://example.com/file')).toBe('css');
  });

  it('should detect HTML from content-type', () => {
    expect(getContentType({ 'content-type': 'text/html' }, 'http://example.com/file')).toBe('html');
    expect(getContentType({ 'content-type': 'text/html; charset=utf-8' }, 'http://example.com/file')).toBe('html');
  });

  it('should return other for binary types', () => {
    expect(getContentType({ 'content-type': 'image/png' }, 'http://example.com/file.png')).toBe('other');
    expect(getContentType({ 'content-type': 'image/jpeg' }, 'http://example.com/file.jpg')).toBe('other');
    expect(getContentType({ 'content-type': 'video/mp4' }, 'http://example.com/file.mp4')).toBe('other');
    expect(getContentType({ 'content-type': 'application/pdf' }, 'http://example.com/file.pdf')).toBe('other');
    expect(getContentType({ 'content-type': 'application/octet-stream' }, 'http://example.com/file')).toBe('other');
  });

  it('should fallback to URL extension when no content-type', () => {
    expect(getContentType({}, 'http://example.com/script.js')).toBe('js');
    expect(getContentType({}, 'http://example.com/script.mjs')).toBe('js');
    expect(getContentType({}, 'http://example.com/style.css')).toBe('css');
    expect(getContentType({}, 'http://example.com/page.html')).toBe('html');
    expect(getContentType({}, 'http://example.com/page.htm')).toBe('html');
    expect(getContentType({}, 'http://example.com/')).toBe('html');
  });

  it('should return other for unknown types', () => {
    expect(getContentType({ 'content-type': 'application/x-custom' }, 'http://example.com/file')).toBe('other');
    expect(getContentType({}, 'http://example.com/file.unknown')).toBe('other');
  });
});

describe('decompressBody', () => {
  it('should decompress gzip content', () => {
    const original = Buffer.from('Hello, World!');
    const compressed = gzipSync(original);

    const result = decompressBody(compressed, 'gzip');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress brotli content', () => {
    const original = Buffer.from('Hello, World!');
    const compressed = brotliCompressSync(original);

    const result = decompressBody(compressed, 'br');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress deflate content', () => {
    const original = Buffer.from('Hello, World!');
    const compressed = deflateSync(original);

    const result = decompressBody(compressed, 'deflate');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should return unchanged for no encoding', () => {
    const original = Buffer.from('Hello, World!');

    expect(decompressBody(original, undefined)).toBe(original);
    expect(decompressBody(original, '')).toBe(original);
  });

  it('should return unchanged for unknown encoding', () => {
    const original = Buffer.from('Hello, World!');

    const result = decompressBody(original, 'unknown');
    expect(result).toBe(original);
  });

  it('should return original on decompression error', () => {
    const invalidGzip = Buffer.from('not gzip data');

    const result = decompressBody(invalidGzip, 'gzip');
    expect(result).toBe(invalidGzip);
  });
});

describe('isBinaryContent', () => {
  it('should detect PNG signature', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isBinaryContent(pngHeader)).toBe(true);
  });

  it('should detect JPEG signature', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(isBinaryContent(jpegHeader)).toBe(true);
  });

  it('should detect GIF signature', () => {
    const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    expect(isBinaryContent(gifHeader)).toBe(true);
  });

  it('should detect PDF signature', () => {
    const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    expect(isBinaryContent(pdfHeader)).toBe(true);
  });

  it('should detect ZIP signature', () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(isBinaryContent(zipHeader)).toBe(true);
  });

  it('should detect GZIP signature', () => {
    const gzipHeader = Buffer.from([0x1f, 0x8b, 0x08, 0x00]); // 4 bytes for signature check
    expect(isBinaryContent(gzipHeader)).toBe(true);
  });

  it('should not detect text content as binary', () => {
    const textContent = Buffer.from('Hello, World!');
    expect(isBinaryContent(textContent)).toBe(false);
  });

  it('should not detect HTML as binary', () => {
    const htmlContent = Buffer.from('<!DOCTYPE html><html>');
    expect(isBinaryContent(htmlContent)).toBe(false);
  });

  it('should return false for small buffers', () => {
    expect(isBinaryContent(Buffer.from([0x89]))).toBe(false);
    expect(isBinaryContent(Buffer.from([]))).toBe(false);
  });
});

describe('decodeBufferToString', () => {
  it('should decode UTF-8 by default', () => {
    const buffer = Buffer.from('Hello, мир!', 'utf-8');
    expect(decodeBufferToString(buffer, 'utf-8')).toBe('Hello, мир!');
  });

  it('should decode Windows-1251', () => {
    // Windows-1251 encoded "Привет"
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeBufferToString(buffer, 'windows-1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'cp1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'win1251')).toBe('Привет');
  });

  it('should decode ISO-8859-1 (Latin1)', () => {
    const buffer = Buffer.from([0xc0, 0xc1, 0xc2]); // À Á Â
    expect(decodeBufferToString(buffer, 'iso-8859-1')).toBe('ÀÁÂ');
    expect(decodeBufferToString(buffer, 'latin1')).toBe('ÀÁÂ');
  });

  it('should normalize charset names', () => {
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeBufferToString(buffer, 'Windows-1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'WINDOWS-1251')).toBe('Привет');
  });
});

describe('shouldBlockDomain', () => {
  const mockConfig = {
    transformJs: true,
    transformCss: true,
    transformHtml: true,
    removeAds: true,
    removeTracking: true,
    spoofUserAgent: false,
    cacheEnabled: true,
    cacheTTL: 3600000,
    adDomains: ['doubleclick.net', 'googlesyndication.com', 'ads.example.com'],
    trackingDomains: ['google-analytics.com', 'facebook.com/tr'],
    trackingUrls: [],
  } as unknown as RevampConfig;

  it('should block ad domains when removeAds is enabled', () => {
    expect(shouldBlockDomain('ad.doubleclick.net', mockConfig)).toBe(true);
    expect(shouldBlockDomain('pagead2.googlesyndication.com', mockConfig)).toBe(true);
    expect(shouldBlockDomain('ads.example.com', mockConfig)).toBe(true);
  });

  it('should block tracking domains when removeTracking is enabled', () => {
    expect(shouldBlockDomain('www.google-analytics.com', mockConfig)).toBe(true);
  });

  it('should not block regular domains', () => {
    expect(shouldBlockDomain('example.com', mockConfig)).toBe(false);
    expect(shouldBlockDomain('google.com', mockConfig)).toBe(false);
  });

  it('should not block when removeAds is disabled', () => {
    const configNoAds = { ...mockConfig, removeAds: false };
    expect(shouldBlockDomain('ad.doubleclick.net', configNoAds)).toBe(false);
  });

  it('should not block tracking when removeTracking is disabled', () => {
    const configNoTracking = { ...mockConfig, removeTracking: false };
    expect(shouldBlockDomain('www.google-analytics.com', configNoTracking)).toBe(false);
  });
});

describe('shouldBlockUrl', () => {
  const mockConfig = {
    removeTracking: true,
    trackingUrls: ['/analytics.js', '/gtag/js', 'utm_source=', '/metrics'],
  } as unknown as RevampConfig;

  it('should block URLs matching tracking patterns', () => {
    expect(shouldBlockUrl('https://example.com/analytics.js', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/gtag/js?id=123', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/page?utm_source=google', mockConfig)).toBe(true);
  });

  it('should not block regular URLs', () => {
    expect(shouldBlockUrl('https://example.com/app.js', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/page', mockConfig)).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(shouldBlockUrl('https://example.com/ANALYTICS.JS', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/Analytics.js', mockConfig)).toBe(true);
  });

  it('should not block when removeTracking is disabled', () => {
    const configNoTracking = { ...mockConfig, removeTracking: false };
    expect(shouldBlockUrl('https://example.com/analytics.js', configNoTracking)).toBe(false);
  });

  it('should never block internal Revamp API endpoints', () => {
    // Even though /metrics is in the block list, /__revamp__/metrics should NOT be blocked
    expect(shouldBlockUrl('https://example.com/__revamp__/metrics', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://2ip.ru/__revamp__/metrics', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/metrics/json', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/config', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/pac/socks5', mockConfig)).toBe(false);
  });
});

describe('SPOOFED_USER_AGENT', () => {
  it('should be a Chrome user agent', () => {
    expect(SPOOFED_USER_AGENT).toContain('Chrome');
    expect(SPOOFED_USER_AGENT).toContain('Mozilla/5.0');
  });
});

describe('spoofUserAgent', () => {
  const mockConfig = {
    spoofUserAgent: true,
  } as unknown as RevampConfig;

  it('should replace user-agent when spoofing is enabled', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'user-agent': 'Safari/9.0',
    };

    spoofUserAgent(headers, mockConfig);

    expect(headers['user-agent']).toBe(SPOOFED_USER_AGENT);
  });

  it('should not add user-agent if not present', () => {
    const headers: Record<string, string | string[] | undefined> = {};

    spoofUserAgent(headers, mockConfig);

    expect(headers['user-agent']).toBeUndefined();
  });

  it('should not replace when spoofing is disabled', () => {
    const configNoSpoof = { ...mockConfig, spoofUserAgent: false };
    const headers: Record<string, string | string[] | undefined> = {
      'user-agent': 'Safari/9.0',
    };

    spoofUserAgent(headers, configNoSpoof);

    expect(headers['user-agent']).toBe('Safari/9.0');
  });
});

describe('buildCorsHeaders', () => {
  it('should return CORS headers with default origin', () => {
    const headers = buildCorsHeaders();

    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(headers['access-control-allow-methods']).toBe(CORS_ALLOWED_METHODS);
    expect(headers['access-control-allow-headers']).toBe(CORS_ALLOWED_HEADERS);
    expect(headers['access-control-expose-headers']).toBe(CORS_EXPOSE_HEADERS);
  });

  it('should use custom origin', () => {
    const headers = buildCorsHeaders('https://example.com');

    expect(headers['access-control-allow-origin']).toBe('https://example.com');
  });
});

describe('buildCorsPreflightResponse', () => {
  it('should build a 204 No Content response', () => {
    const response = buildCorsPreflightResponse();

    expect(response).toContain('HTTP/1.1 204 No Content\r\n');
    expect(response).toContain('Access-Control-Allow-Origin: *\r\n');
    expect(response).toContain('Access-Control-Max-Age: 86400\r\n');
    expect(response).toContain('Content-Length: 0\r\n');
    expect(response).toContain('\r\n\r\n');
  });

  it('should use custom origin', () => {
    const response = buildCorsPreflightResponse('https://example.com');

    expect(response).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
  });
});

describe('buildCorsHeadersString', () => {
  it('should build CORS headers as string', () => {
    const headers = buildCorsHeadersString();

    expect(headers).toContain('Access-Control-Allow-Origin: *\r\n');
    expect(headers).toContain('Access-Control-Allow-Credentials: true\r\n');
    expect(headers).toContain(`Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n`);
  });
});

describe('removeCorsHeaders', () => {
  it('should remove all CORS headers from object', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'access-control-allow-origin': 'https://example.com',
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'Content-Type',
      'access-control-expose-headers': 'X-Custom',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400',
    };

    removeCorsHeaders(headers);

    expect(headers['content-type']).toBe('text/html');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['access-control-allow-headers']).toBeUndefined();
    expect(headers['access-control-expose-headers']).toBeUndefined();
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(headers['access-control-max-age']).toBeUndefined();
  });
});

describe('filterResponseHeaders', () => {
  it('should filter out skip headers', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'transfer-encoding': 'chunked',
      'content-encoding': 'gzip',
      'connection': 'keep-alive',
      'x-custom': 'value',
    };

    const filtered = filterResponseHeaders(headers);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-custom']).toBe('value');
    expect(filtered['transfer-encoding']).toBeUndefined();
    expect(filtered['content-encoding']).toBeUndefined();
    expect(filtered['connection']).toBeUndefined();
  });

  it('should normalize header names to lowercase', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'Content-Type': 'text/html',
      'X-Custom-Header': 'value',
    };

    const filtered = filterResponseHeaders(headers);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-custom-header']).toBe('value');
  });

  it('should use custom skip set', () => {
    const customSkip = new Set(['x-skip-me']);
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'x-skip-me': 'should be skipped',
      'x-keep-me': 'should be kept',
    };

    const filtered = filterResponseHeaders(headers, customSkip);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-keep-me']).toBe('should be kept');
    expect(filtered['x-skip-me']).toBeUndefined();
  });
});
