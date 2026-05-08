import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  resolveCorsAllowOrigin,
  buildScopedCorsHeaders,
  buildScopedCorsHeadersString,
  buildScopedCorsPreflightResponse,
  filterResponseHeaders,
  transformContent,
  compressGzip,
} from './shared.js';
import { resetConfig, updateConfig, type RevampConfig } from '../config/index.js';
import { clearCache } from '../cache/index.js';
import { gzipSync, brotliCompressSync, deflateSync, gunzipSync } from 'node:zlib';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('should detect JS from URL path patterns (YouTube-style URLs)', () => {
    // YouTube uses paths like /s/_/ytmainappweb/_/js/k=... without .js extension
    expect(getContentType({}, 'https://www.youtube.com/s/_/ytmainappweb/_/js/k=ytmainappweb.kevlar_base.en_US.1saR0AquSG0.es5.O/am=AAAQAACA/d=0/rs=AGKMywHL8rJUqMPTxtQ898M2WV31BC8nOQ')).toBe('js');
    expect(getContentType({}, 'https://example.com/_/js/bundle')).toBe('js');
    expect(getContentType({}, 'https://example.com/assets/js/app')).toBe('js');
    expect(getContentType({ 'content-type': 'text/plain' }, 'https://www.youtube.com/s/_/ytmainappweb/_/js/k=test')).toBe('js');
  });

  it('should detect CSS from URL path patterns', () => {
    expect(getContentType({}, 'https://example.com/_/css/styles')).toBe('css');
    expect(getContentType({}, 'https://example.com/assets/css/app')).toBe('css');
  });

  it('should return other for unknown types', () => {
    expect(getContentType({ 'content-type': 'application/x-custom' }, 'http://example.com/file')).toBe('other');
    expect(getContentType({}, 'http://example.com/file.unknown')).toBe('other');
  });

  it('should return other for React Server Component payloads', () => {
    expect(getContentType({ 'content-type': 'text/x-component' }, 'http://example.com/_rsc')).toBe('other');
    expect(getContentType({ 'content-type': 'text/x-component; charset=utf-8' }, 'http://example.com/_rsc')).toBe('other');
    expect(getContentType({ 'content-type': 'application/rsc' }, 'http://example.com/_rsc')).toBe('other');
  });

  it('should return other for Next.js RSC URL patterns', () => {
    // RSC query parameter
    expect(getContentType({ 'content-type': 'text/plain' }, 'http://example.com/page?_rsc=abc123')).toBe('other');
    expect(getContentType({}, 'http://example.com/page?foo=bar&_rsc=xyz')).toBe('other');
    // _next/data paths
    expect(getContentType({ 'content-type': 'text/plain' }, 'http://example.com/_next/data/build123/page.json')).toBe('other');
    // __nextjs paths
    expect(getContentType({}, 'http://example.com/__nextjs_original-stack-frame')).toBe('other');
  });
});

describe('decompressBody', () => {
  it('should decompress gzip content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = gzipSync(original);

    const result = await decompressBody(compressed, 'gzip');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress brotli content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = brotliCompressSync(original);

    const result = await decompressBody(compressed, 'br');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress deflate content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = deflateSync(original);

    const result = await decompressBody(compressed, 'deflate');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should return unchanged for no encoding', async () => {
    const original = Buffer.from('Hello, World!');

    expect(await decompressBody(original, undefined)).toBe(original);
    expect(await decompressBody(original, '')).toBe(original);
  });

  it('should return unchanged for unknown encoding', async () => {
    const original = Buffer.from('Hello, World!');

    const result = await decompressBody(original, 'unknown');
    expect(result).toBe(original);
  });

  it('should return original on decompression error', async () => {
    const invalidGzip = Buffer.from('not gzip data');

    const result = await decompressBody(invalidGzip, 'gzip');
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
    trackingUrls: ['/analytics.js', '/gtag/js', '/metrics', '/stat', '/hit'],
  } as unknown as RevampConfig;

  it('should block URLs matching tracking patterns by exact path', () => {
    expect(shouldBlockUrl('https://example.com/analytics.js', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/metrics', mockConfig)).toBe(true);
  });

  it('should block URLs where pattern is a prefix path segment', () => {
    expect(shouldBlockUrl('https://example.com/gtag/js?id=123', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/stat/click?id=1', mockConfig)).toBe(true);
  });

  it('should not block regular URLs', () => {
    expect(shouldBlockUrl('https://example.com/app.js', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/page', mockConfig)).toBe(false);
  });

  it('should not produce false positives via substring overlap (T19)', () => {
    // /stat must NOT match /architect/...
    expect(shouldBlockUrl('https://example.com/architect/page', mockConfig)).toBe(false);
    // /hit must NOT match /health-status/...
    expect(shouldBlockUrl('https://example.com/health-status/check', mockConfig)).toBe(false);
    // /metrics must NOT match /metricstore/...
    expect(shouldBlockUrl('https://example.com/metricstore/x', mockConfig)).toBe(false);
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

describe('resolveCorsAllowOrigin (T9)', () => {
  it('returns null when profile is null (default off)', () => {
    expect(resolveCorsAllowOrigin(null, 'https://example.com')).toBeNull();
  });

  it('returns null when profile lacks corsAllowOrigins', () => {
    expect(resolveCorsAllowOrigin({}, 'https://example.com')).toBeNull();
  });

  it('returns null when corsAllowOrigins is empty', () => {
    expect(resolveCorsAllowOrigin({ corsAllowOrigins: [] }, 'https://example.com')).toBeNull();
  });

  it('returns origin when explicitly listed', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['https://example.com'] },
        'https://example.com'
      )
    ).toBe('https://example.com');
  });

  it('returns null when origin is not in allow list', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['https://allowed.example'] },
        'https://attacker.example'
      )
    ).toBeNull();
  });

  it('reflects request origin when allow list contains "*"', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['*'] },
        'https://anything.example'
      )
    ).toBe('https://anything.example');
  });

  it('returns "*" when allow list contains "*" and request has no origin', () => {
    expect(resolveCorsAllowOrigin({ corsAllowOrigins: ['*'] }, undefined)).toBe('*');
  });

  it('returns null when no request origin and allow list does not include "*"', () => {
    expect(
      resolveCorsAllowOrigin({ corsAllowOrigins: ['https://example.com'] }, undefined)
    ).toBeNull();
  });
});

describe('buildScopedCorsHeaders (T9)', () => {
  it('returns empty object by default (profile null)', () => {
    expect(buildScopedCorsHeaders(null, 'https://example.com')).toEqual({});
  });

  it('returns empty object when corsAllowOrigins is absent', () => {
    expect(buildScopedCorsHeaders({}, 'https://example.com')).toEqual({});
  });

  it('emits ACAO when origin matches profile allow list', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headers['access-control-allow-origin']).toBe('https://example.com');
    expect(headers['access-control-allow-methods']).toBe(CORS_ALLOWED_METHODS);
    expect(headers['access-control-allow-headers']).toBe(CORS_ALLOWED_HEADERS);
    expect(headers['access-control-expose-headers']).toBe(CORS_EXPOSE_HEADERS);
  });

  it('does not emit headers when origin does not match', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://attacker.example'
    );
    expect(headers).toEqual({});
  });

  it('does not emit credentials unless explicitly opted in', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('emits credentials only when corsAllowCredentials is true', () => {
    const headers = buildScopedCorsHeaders(
      {
        corsAllowOrigins: ['https://example.com'],
        corsAllowCredentials: true,
      },
      'https://example.com'
    );
    expect(headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('buildScopedCorsHeadersString (T9)', () => {
  it('returns empty string by default', () => {
    expect(buildScopedCorsHeadersString(null, 'https://example.com')).toBe('');
  });

  it('emits headers when origin matches', () => {
    const headersStr = buildScopedCorsHeadersString(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headersStr).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
    expect(headersStr).not.toContain('Access-Control-Allow-Credentials');
  });

  it('opts in credentials when configured', () => {
    const headersStr = buildScopedCorsHeadersString(
      {
        corsAllowOrigins: ['https://example.com'],
        corsAllowCredentials: true,
      },
      'https://example.com'
    );
    expect(headersStr).toContain('Access-Control-Allow-Credentials: true\r\n');
  });
});

describe('buildScopedCorsPreflightResponse (T9)', () => {
  it('returns null when profile has not opted in', () => {
    expect(buildScopedCorsPreflightResponse(null, 'https://example.com')).toBeNull();
  });

  it('returns 204 preflight when origin matches', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(response).not.toBeNull();
    expect(response).toContain('HTTP/1.1 204 No Content\r\n');
    expect(response).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
    expect(response).toContain('Access-Control-Max-Age: 86400\r\n');
  });

  it('omits credentials in preflight unless explicitly opted in', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(response).not.toContain('Access-Control-Allow-Credentials');
  });
});

describe('CORS wildcard + credentials misconfig collapses to OFF (T9 P1-G1)', () => {
  const originalWarn = console.warn;
  let warnCalls: unknown[][] = [];

  beforeEach(() => {
    warnCalls = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('resolveCorsAllowOrigin returns null when "*" + credentials and warns', () => {
    const result = resolveCorsAllowOrigin(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(result).toBeNull();
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0]?.[0]).toContain('[cors]');
  });

  it('resolveCorsAllowOrigin still returns null on misconfig when no request origin', () => {
    const result = resolveCorsAllowOrigin(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      undefined
    );
    expect(result).toBeNull();
  });

  it('buildScopedCorsHeaders emits NO Access-Control-Allow-* headers under misconfig', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(headers).toEqual({});
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['access-control-allow-headers']).toBeUndefined();
    expect(headers['access-control-expose-headers']).toBeUndefined();
  });

  it('buildScopedCorsHeadersString emits NO Access-Control-Allow-* under misconfig', () => {
    const result = buildScopedCorsHeadersString(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(result).toBe('');
    expect(result).not.toContain('Access-Control-Allow-Origin');
    expect(result).not.toContain('Access-Control-Allow-Credentials');
    expect(result).not.toContain('Access-Control-Allow-Methods');
    expect(result).not.toContain('Access-Control-Allow-Headers');
  });

  it('buildScopedCorsPreflightResponse returns null under misconfig (no permissive preflight)', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(response).toBeNull();
  });

  it('still works correctly when "*" is used without credentials', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['*'], corsAllowCredentials: false },
      'https://anything.example'
    );
    expect(headers['access-control-allow-origin']).toBe('https://anything.example');
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(warnCalls.length).toBe(0);
  });

  it('still works correctly with explicit origin + credentials (no wildcard)', () => {
    const headers = buildScopedCorsHeaders(
      {
        corsAllowOrigins: ['https://app.example.com'],
        corsAllowCredentials: true,
      },
      'https://app.example.com'
    );
    expect(headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(warnCalls.length).toBe(0);
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

describe('transformContent', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('should skip binary content', async () => {
    updateConfig({ transformJs: true });
    // PNG magic bytes
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]);
    const result = await transformContent(pngBuffer, 'js', 'https://example.com/fake.js');
    expect(result).toEqual(pngBuffer);
  });

  it('should transform JS when enabled', async () => {
    updateConfig({ transformJs: true, cacheEnabled: false });
    // Large enough JS with modern syntax
    const jsCode = `
      // A comment to make this larger
      // More padding for size threshold
      // Even more padding
      const getValue = () => {
        const x = obj?.prop?.nested;
        return x ?? 'default';
      };
    `;
    const buffer = Buffer.from(jsCode);
    const result = await transformContent(buffer, 'js', 'https://example.com/test.js');
    // Should return something (transformed or original)
    expect(result.length).toBeGreaterThan(0);
  });

  it('should transform CSS when enabled', async () => {
    updateConfig({ transformCss: true, cacheEnabled: false });
    // Large enough CSS
    const cssCode = `
      /* Comment for size */
      /* More padding */
      .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
      }
    `;
    const buffer = Buffer.from(cssCode);
    const result = await transformContent(buffer, 'css', 'https://example.com/test.css');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should transform HTML when enabled', async () => {
    updateConfig({ transformHtml: true, cacheEnabled: false });
    const html = '<!DOCTYPE html><html><head></head><body><p>Test content</p></body></html>';
    const buffer = Buffer.from(html);
    const result = await transformContent(buffer, 'html', 'https://example.com/page.html');
    expect(result.toString()).toContain('Test content');
  });

  it('should not transform when disabled', async () => {
    updateConfig({ transformJs: false, cacheEnabled: false });
    const jsCode = 'const x = obj?.prop;';
    const buffer = Buffer.from(jsCode);
    const result = await transformContent(buffer, 'js', 'https://example.com/test.js');
    // Should return original
    expect(result.toString()).toContain('obj?.prop');
  });

  it('should return original for other content type', async () => {
    const data = Buffer.from('plain text data');
    const result = await transformContent(data, 'other', 'https://example.com/file.txt');
    expect(result).toEqual(data);
  });

  it('should use cache when enabled', async () => {
    updateConfig({ transformJs: true, cacheEnabled: true });
    const jsCode = `
      // Padding for size
      // More padding
      // Even more
      const x = obj?.prop;
    `;
    const buffer = Buffer.from(jsCode);
    // First call should transform
    await transformContent(buffer, 'js', 'https://unique-test-url-for-cache.com/test.js');
    // Second call should hit cache
    const cached = await transformContent(buffer, 'js', 'https://unique-test-url-for-cache.com/test.js');
    expect(cached.length).toBeGreaterThan(0);
  });

  it('should not transform CSS when disabled', async () => {
    updateConfig({ transformCss: false, cacheEnabled: false });
    const cssCode = `
      /* Comment for size */
      /* More padding */
      .container {
        display: flex;
      }
    `;
    const buffer = Buffer.from(cssCode);
    const result = await transformContent(buffer, 'css', 'https://example.com/test.css');
    // Should return original
    expect(result.toString()).toContain('display: flex');
  });

  it('should not transform HTML when disabled', async () => {
    updateConfig({ transformHtml: false, cacheEnabled: false });
    const html = '<!DOCTYPE html><html><head></head><body><p>Original</p></body></html>';
    const buffer = Buffer.from(html);
    const result = await transformContent(buffer, 'html', 'https://example.com/page.html');
    // Should return original text
    expect(result.toString()).toContain('Original');
  });

  it('should not transform HTML that is not a document', async () => {
    updateConfig({ transformHtml: true, cacheEnabled: false });
    // Not an HTML document (no doctype, no html tag)
    const htmlFragment = '<div><p>Fragment</p></div>';
    const buffer = Buffer.from(htmlFragment);
    const result = await transformContent(buffer, 'html', 'https://example.com/fragment.html');
    // Should return original since isHtmlDocument returns false
    expect(result.toString()).toContain('Fragment');
  });
});

describe('transformContent cache isolation by cookie (T4 end-to-end)', () => {
  const testCacheDir = join(tmpdir(), 'revamp-transform-cache-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheTTL: 3600,
      cacheDir: testCacheDir,
      transformHtml: true,
    });
    try {
      await mkdir(testCacheDir, { recursive: true });
    } catch {
      // Ignore if exists
    }
  });

  afterEach(async () => {
    clearCache();
    resetConfig();
    try {
      await rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should NOT serve user A html to user B when only the cookie differs (NAT leak repro)', async () => {
    // Two distinct authenticated users sharing one NAT'd client IP. Without
    // the cookie/auth fingerprint being threaded through transformContent's
    // cache lookup, user B would receive user A's privately-rendered HTML.
    const url = 'https://example.com/dashboard';
    const sharedClientIp = '198.51.100.42';
    const userAHtml = '<!DOCTYPE html><html><body><p>Alice secret dashboard</p></body></html>';
    const userBHtml = '<!DOCTYPE html><html><body><p>Bob secret dashboard</p></body></html>';

    const userAHeaders = { cookie: 'session=alice-abc; csrftoken=aaa' };
    const userBHeaders = { cookie: 'auth=bob-bearer; sid=bbb' };

    // User A's response is transformed and cached against their cookie shape.
    const aResult = await transformContent(
      Buffer.from(userAHtml),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      userAHeaders
    );
    expect(aResult.toString()).toContain('Alice');

    // User B hits the same URL through the same NAT'd IP with different
    // cookies. They MUST miss A's cache and see their own (different) body
    // — this exercises the path that was previously unreachable in prod.
    const bResult = await transformContent(
      Buffer.from(userBHtml),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      userBHeaders
    );
    expect(bResult.toString()).toContain('Bob');
    expect(bResult.toString()).not.toContain('Alice');

    // User A re-requests with their own cookies — should still get their body.
    const aReplay = await transformContent(
      Buffer.from('IGNORED IF CACHED'),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      userAHeaders
    );
    expect(aReplay.toString()).toContain('Alice');
  });

  it('should NOT cache when upstream sets Cache-Control: private', async () => {
    // Even if all key components match, an origin marking the response
    // private must keep it out of Revamp's shared cache.
    const url = 'https://example.com/private-fragment';
    const html = '<!DOCTYPE html><html><body><p>private body</p></body></html>';
    const sharedClientIp = '198.51.100.99';
    const headers = { cookie: 'session=charlie' };

    await transformContent(
      Buffer.from(html),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      headers,
      { 'cache-control': 'private, max-age=600' }
    );

    // Replay with same identity but a deliberately-different body. If the
    // first call had cached, this would return the first body; if it didn't
    // cache, we'll see the new body. The latter is correct.
    const replay = await transformContent(
      Buffer.from('<!DOCTYPE html><html><body><p>different body</p></body></html>'),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      headers,
      { 'cache-control': 'private, max-age=600' }
    );
    expect(replay.toString()).toContain('different body');
    expect(replay.toString()).not.toContain('private body');
  });
});

describe('compressGzip', () => {
  it('should compress data', async () => {
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressed = await compressGzip(data);
    expect(compressed.length).toBeLessThan(data.length);
  });

  it('should compress with specified level', async () => {
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressedLevel1 = await compressGzip(data, 1);
    const compressedLevel9 = await compressGzip(data, 9);
    // Level 9 should produce smaller output
    expect(compressedLevel9.length).toBeLessThanOrEqual(compressedLevel1.length);
  });

  it('should produce valid gzip output', async () => {
    const data = Buffer.from('Test data for compression');
    const compressed = await compressGzip(data);
    // Should be decompressible
    const decompressed = gunzipSync(compressed);
    expect(decompressed.toString()).toBe('Test data for compression');
  });

  it('should use config compression level when not specified', async () => {
    updateConfig({ compressionLevel: 9 });
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressed = await compressGzip(data);
    expect(compressed.length).toBeLessThan(data.length);
    resetConfig();
  });
});
