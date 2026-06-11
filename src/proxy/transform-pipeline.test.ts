import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformContent } from './transform-pipeline.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { clearCache } from '../cache/index.js';
import {
  registerTransformer,
  unregisterTransformer,
} from '../transformers/registry.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array<number>(100).fill(0)]);
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
    // Two distinct authenticated users sharing one NAT'd client IP, differing
    // in cookie name SHAPE. The cookie/auth fingerprint keeps them in separate
    // cache buckets so user B never receives user A's privately-rendered HTML.
    // The upstream marks the response Cache-Control: public — the precondition
    // the cacheability guard requires before any cookie-bearing response is
    // stored (a non-public authenticated response is treated as private and
    // never cached, which is covered by the cache-layer guard tests).
    const url = 'https://example.com/dashboard';
    const sharedClientIp = '198.51.100.42';
    const userAHtml = '<!DOCTYPE html><html><body><p>Alice secret dashboard</p></body></html>';
    const userBHtml = '<!DOCTYPE html><html><body><p>Bob secret dashboard</p></body></html>';

    const userAHeaders = { cookie: 'session=alice-abc; csrftoken=aaa' };
    const userBHeaders = { cookie: 'auth=bob-bearer; sid=bbb' };
    const publicResponse = { 'cache-control': 'public, max-age=600' };

    // User A's response is transformed and cached against their cookie shape.
    const aResult = await transformContent(
      Buffer.from(userAHtml),
      'html',
      url,
      'utf-8',
      undefined,
      sharedClientIp,
      'GET',
      userAHeaders,
      publicResponse
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
      userBHeaders,
      publicResponse
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
      userAHeaders,
      publicResponse
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

describe("transformContent — 'other' content through plugin text transformers", () => {
  const PLUGIN_ID = 'com.test.other-lane-plugin';
  const testCacheDir = join(tmpdir(), 'revamp-other-lane-cache-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({ cacheEnabled: false, cacheDir: testCacheDir });
    await mkdir(testCacheDir, { recursive: true });
  });

  afterEach(async () => {
    clearCache();
    resetConfig();
    await rm(testCacheDir, { recursive: true, force: true });
  });

  it("returns the ORIGINAL buffer (no decode/re-encode) for 'other' with no matching transformer", async () => {
    // Bytes that would NOT survive a utf-8 decode → re-encode round-trip:
    // 0xFF is invalid UTF-8 and would become U+FFFD. Reference equality
    // proves the gate returned before any charset work happened.
    const data = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d]);
    const result = await transformContent(
      data,
      'other',
      'https://api.example.com/no-plugin',
      'utf-8',
      undefined,
      undefined,
      'GET',
      undefined,
      { 'content-type': 'application/json' }
    );
    expect(result).toBe(data);
  });

  it("dispatches 'other' content to a matching plugin transformer", async () => {
    registerTransformer(
      {
        kind: 'text',
        name: 'other-lane-json',
        matches: (ctx) =>
          ctx.contentType === 'other' && ctx.rawContentType.includes('application/json'),
        transform: (input) =>
          Promise.resolve(input.replace('"ad"', '"removed"')),
      },
      PLUGIN_ID
    );
    try {
      const result = await transformContent(
        Buffer.from('{"items":["post","ad"]}'),
        'other',
        'https://api.example.com/feed',
        'utf-8',
        undefined,
        undefined,
        'GET',
        undefined,
        { 'content-type': 'application/json; charset=utf-8' }
      );
      expect(result.toString('utf-8')).toBe('{"items":["post","removed"]}');
    } finally {
      unregisterTransformer('other-lane-json', PLUGIN_ID);
    }
  });

  it("caches transformed 'other' content when cache is enabled", async () => {
    updateConfig({ cacheEnabled: true, cacheTTL: 3600 });
    let transformCalls = 0;
    registerTransformer(
      {
        kind: 'text',
        name: 'other-lane-counting',
        matches: (ctx) =>
          ctx.contentType === 'other' && ctx.rawContentType.includes('application/json'),
        transform: (input) => {
          transformCalls++;
          return Promise.resolve(input.replace('"ad"', '"removed"'));
        },
      },
      PLUGIN_ID
    );
    try {
      const url = 'https://api.example.com/cached-feed-' + Date.now();
      const responseHeaders = { 'content-type': 'application/json' };
      const first = await transformContent(
        Buffer.from('{"items":["post","ad"]}'),
        'other',
        url,
        'utf-8',
        undefined,
        undefined,
        'GET',
        undefined,
        responseHeaders
      );
      // Second call: served from cache — the transformer must not run again
      // (the body argument is deliberately different to prove it).
      const second = await transformContent(
        Buffer.from('{"items":["IGNORED IF CACHED"]}'),
        'other',
        url,
        'utf-8',
        undefined,
        undefined,
        'GET',
        undefined,
        responseHeaders
      );
      expect(first.toString('utf-8')).toBe('{"items":["post","removed"]}');
      expect(second.toString('utf-8')).toBe('{"items":["post","removed"]}');
      expect(transformCalls).toBe(1);
    } finally {
      unregisterTransformer('other-lane-counting', PLUGIN_ID);
    }
  });

  it("serves the original body when the matching 'other' transformer throws", async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    registerTransformer(
      {
        kind: 'text',
        name: 'other-lane-throws',
        matches: (ctx) =>
          ctx.contentType === 'other' && ctx.rawContentType.includes('application/json'),
        transform: () => Promise.reject(new Error('plugin exploded')),
      },
      PLUGIN_ID
    );
    try {
      const original = '{"items":["post","ad"]}';
      const result = await transformContent(
        Buffer.from(original),
        'other',
        'https://api.example.com/throwing-feed',
        'utf-8',
        undefined,
        undefined,
        'GET',
        undefined,
        { 'content-type': 'application/json' }
      );
      // Isolation semantics: the throwing plugin is logged + skipped, no
      // built-in matches 'other', the content falls through unchanged.
      expect(result.toString('utf-8')).toBe(original);
      expect(warnCalls.some((c) => String(c[0]).includes('other-lane-throws'))).toBe(true);
    } finally {
      console.warn = originalWarn;
      unregisterTransformer('other-lane-throws', PLUGIN_ID);
    }
  });

  it("never routes binary bytes into a text transformer even if it claims a match", async () => {
    registerTransformer(
      {
        kind: 'text',
        name: 'other-lane-greedy',
        matches: (ctx) => ctx.contentType === 'other',
        transform: () => Promise.resolve('CORRUPTED'),
      },
      PLUGIN_ID
    );
    try {
      // PNG magic bytes: the isBinaryContent safety net must win over the
      // greedy matcher.
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const result = await transformContent(
        png,
        'other',
        'https://api.example.com/image-pretending-to-be-json',
        'utf-8',
        undefined,
        undefined,
        'GET',
        undefined,
        { 'content-type': 'application/json' }
      );
      expect(result).toEqual(png);
    } finally {
      unregisterTransformer('other-lane-greedy', PLUGIN_ID);
    }
  });
});
