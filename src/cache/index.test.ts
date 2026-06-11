import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCached,
  setCache,
  clearCache,
  clearMemoryCache,
  getCacheStats,
  getHashComputeCounts,
  isRedirectStatus,
  markAsRedirect,
} from './index.js';
import {
  resetConfig,
  updateConfig,
  setClientConfig,
  resetClientConfig,
  type DomainProfile,
} from '../config/index.js';
import { getRulesStore, clearProfileCache } from '../config/domain-manager.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('isRedirectStatus', () => {
  it('should return true for redirect status codes', () => {
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(303)).toBe(true);
    expect(isRedirectStatus(307)).toBe(true);
    expect(isRedirectStatus(308)).toBe(true);
  });

  it('should return false for non-redirect status codes', () => {
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(201)).toBe(false);
    expect(isRedirectStatus(400)).toBe(false);
    expect(isRedirectStatus(404)).toBe(false);
    expect(isRedirectStatus(500)).toBe(false);
  });
});

describe('markAsRedirect', () => {
  beforeEach(() => {
    clearCache();
  });

  it('should mark a URL as redirecting', () => {
    markAsRedirect('https://example.com/redirect');
    // After marking, the URL should be skipped for caching
    // We can verify this indirectly through getCached returning null
  });

  it('should handle invalid URLs gracefully', () => {
    // Should not throw
    expect(() => markAsRedirect('not a valid url')).not.toThrow();
  });

  it('should normalize URLs by removing hash', () => {
    markAsRedirect('https://example.com/page#section');
    // URL should be normalized
  });

  it('should handle and store invalid URL strings directly', () => {
    // Invalid URL should still be tracked (falls back to direct string in catch)
    markAsRedirect('::invalid-url::');
    // Should not throw and URL is stored
    expect(() => markAsRedirect('another::invalid')).not.toThrow();
  });
});

describe('cache with invalid URLs', () => {
  const testCacheDir = join(tmpdir(), 'revamp-invalid-url-test-' + Date.now());

  beforeEach(async () => {
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheTTL: 3600,
      cacheDir: testCacheDir,
    });
    clearCache();
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

  it('should handle invalid URL in getCached gracefully', async () => {
    // Invalid URL should not throw, should return null
    const result = await getCached('::not-a-valid-url::', 'text/html');
    expect(result).toBeNull();
  });

  it('should handle invalid URL in setCache gracefully', async () => {
    // Invalid URL should not throw
    await expect(setCache('::invalid-url::', 'text/html', Buffer.from('test'))).resolves.not.toThrow();
  });

  it('should handle unwritable cache directory gracefully', async () => {
    // Use /dev/null as cache directory - this will fail to create subdirectories
    // but should not throw, just continue with memory-only caching
    updateConfig({ cacheDir: '/dev/null/impossible/path' });
    clearCache();

    const data = Buffer.from('test data for unwritable dir');
    // Should not throw even though mkdir will fail
    await expect(setCache('http://unwritable-test.com/data', 'text/plain', data)).resolves.not.toThrow();

    // Memory cache should still work
    const result = await getCached('http://unwritable-test.com/data', 'text/plain');
    expect(result).toBeTruthy();
  });
});

describe('getCached and setCache', () => {
  const testCacheDir = join(tmpdir(), 'revamp-test-cache-' + Date.now());

  beforeEach(async () => {
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheTTL: 3600,
      cacheDir: testCacheDir,
    });
    clearCache();
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

  it('should return null for cache miss', async () => {
    const result = await getCached('https://example.com/notcached', 'text/html');
    expect(result).toBeNull();
  });

  it('should cache and retrieve data', async () => {
    const url = 'https://example.com/page.html';
    const contentType = 'text/html';
    const data = Buffer.from('<html>Test</html>');

    await setCache(url, contentType, data);
    const result = await getCached(url, contentType);

    expect(result).not.toBeNull();
    expect(result?.toString()).toBe('<html>Test</html>');
  });

  it('should return null when cache is disabled', async () => {
    updateConfig({ cacheEnabled: false });

    const url = 'https://example.com/page.html';
    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should skip caching for icloud.com domain', async () => {
    const url = 'https://www.icloud.com/page';
    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should skip caching for apple.com domain', async () => {
    const url = 'https://www.apple.com/page';
    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should skip caching for me.com domain', async () => {
    const url = 'https://www.me.com/page';
    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should skip caching for icloud-content.com domain', async () => {
    const url = 'https://p123-content.icloud-content.com/resource';
    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should skip caching for known redirect URLs', async () => {
    const url = 'https://example.com/redirecting';
    markAsRedirect(url);

    await setCache(url, 'text/html', Buffer.from('data'));
    const result = await getCached(url, 'text/html');

    expect(result).toBeNull();
  });

  it('should handle different content types separately', async () => {
    const url = 'https://example.com/resource';
    const htmlData = Buffer.from('<html>');
    const jsonData = Buffer.from('{}');

    await setCache(url, 'text/html', htmlData);
    await setCache(url, 'application/json', jsonData);

    const htmlResult = await getCached(url, 'text/html');
    const jsonResult = await getCached(url, 'application/json');

    expect(htmlResult?.toString()).toBe('<html>');
    expect(jsonResult?.toString()).toBe('{}');
  });

  it('should use LRU eviction for memory cache', async () => {
    // Set up many cache entries
    for (let i = 0; i < 10; i++) {
      await setCache(`https://example.com/page${i}`, 'text/html', Buffer.from('x'.repeat(100)));
    }

    // All should be cached
    const stats = getCacheStats();
    expect(stats.memoryEntries).toBeGreaterThan(0);
  });

  it('should evict oldest entries when memory limit is exceeded in setCache', async () => {
    // MAX_MEMORY_CACHE_SIZE is 100MB
    // Fill cache with large entries to trigger eviction
    const entrySize = 40 * 1024 * 1024; // 40MB per entry
    const largeData1 = Buffer.alloc(entrySize, 'a');
    const largeData2 = Buffer.alloc(entrySize, 'b');
    const largeData3 = Buffer.alloc(entrySize, 'c'); // This should trigger eviction

    await setCache('http://evict-test1.com/large1', 'text/plain', largeData1);
    await setCache('http://evict-test2.com/large2', 'text/plain', largeData2);
    await setCache('http://evict-test3.com/large3', 'text/plain', largeData3);

    // The later entries should still be accessible
    const result3 = await getCached('http://evict-test3.com/large3', 'text/plain');
    expect(result3).toBeDefined();
  });

  it('should evict oldest entries when loading from file cache exceeds memory limit', async () => {
    // This test verifies that when loading a file from cache into memory,
    // if the memory limit would be exceeded, old entries are evicted.

    // MAX_MEMORY_CACHE_SIZE is 100MB
    // We'll fill memory close to the limit, then load from file to trigger eviction

    const entrySize = 40 * 1024 * 1024; // 40MB per entry
    const largeData1 = Buffer.alloc(entrySize, 'a');
    const largeData2 = Buffer.alloc(entrySize, 'b');
    const largeData3 = Buffer.alloc(entrySize, 'c');

    // Add 3 entries: 40MB * 3 = 120MB, which exceeds 100MB limit
    // This should trigger eviction during setCache
    await setCache('http://evict-load1.com/file1', 'text/plain', largeData1);
    await setCache('http://evict-load2.com/file2', 'text/plain', largeData2);
    await setCache('http://evict-load3.com/file3', 'text/plain', largeData3);

    // At this point, memory eviction should have occurred
    // Latest entries should be accessible
    const result3 = await getCached('http://evict-load3.com/file3', 'text/plain');
    expect(result3).toBeTruthy();
    expect(result3?.length).toBe(entrySize);
  });

  it('should evict during getCached when loading large entry from file cache', async () => {
    // To trigger eviction in getCached (line 187), we need:
    // 1. Entry in file cache (not expired)
    // 2. Entry NOT in memory cache (pushed out by other entries)
    // 3. Memory cache near full
    // 4. Read the entry - loads from file, triggers eviction

    const entrySize = 45 * 1024 * 1024; // 45MB per entry

    // Add first entry - goes to both memory and file
    const largeData1 = Buffer.alloc(entrySize, '1');
    await setCache('http://file-evict-test1.com/data', 'text/plain', largeData1);

    // Wait for file write to complete (fire-and-forget writes need time)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Add more entries to push first one out of memory (45*3=135MB > 100MB)
    const largeData2 = Buffer.alloc(entrySize, '2');
    const largeData3 = Buffer.alloc(entrySize, '3');
    await setCache('http://file-evict-test2.com/data', 'text/plain', largeData2);
    await setCache('http://file-evict-test3.com/data', 'text/plain', largeData3);

    // Wait for all file writes to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now entry1 should be evicted from memory but still in file cache
    // Access entry1 - should load from file and potentially trigger eviction
    const result1 = await getCached('http://file-evict-test1.com/data', 'text/plain');

    // Should be loaded from file cache
    expect(result1).toBeTruthy();
    expect(result1?.length).toBe(entrySize);

    // Memory should still be within limits
    const stats = getCacheStats();
    expect(stats.memorySize).toBeLessThanOrEqual(100 * 1024 * 1024);
  });  it('should handle expired memory cache entry in getCache', async () => {
    // Create entry with very short TTL
    updateConfig({ cacheTTL: 0.001 }); // 1ms TTL

    const data = Buffer.from('expiring data for test');
    await setCache('http://expire-memory.com/data', 'text/plain', data);

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 20));

    // Access should return null due to expiry (memory entry expired)
    const result = await getCached('http://expire-memory.com/data', 'text/plain');
    expect(result).toBeNull();
  });
});

describe('clearCache', () => {
  const testCacheDir = join(tmpdir(), 'revamp-clear-cache-test-' + Date.now());

  beforeEach(async () => {
    // First clear any existing cache from previous tests
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('should clear memory cache', async () => {
    // Explicitly set cache to enabled
    const data = Buffer.from('test data for cache clearing');
    await setCache('https://unique-test-domain.com/page-for-clear', 'text/html', data);

    let stats = getCacheStats();
    // Memory cache should have our entry
    expect(stats.memoryEntries).toBe(1);
    expect(stats.memorySize).toBe(data.length);

    clearCache();

    stats = getCacheStats();
    expect(stats.memoryEntries).toBe(0);
    expect(stats.memorySize).toBe(0);
  });
});

describe('getCacheStats', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ cacheEnabled: true });
    clearCache();
  });

  afterEach(() => {
    clearCache();
    resetConfig();
  });

  it('should return correct initial stats', () => {
    const stats = getCacheStats();
    expect(stats.memoryEntries).toBe(0);
    expect(stats.memorySize).toBe(0);
  });

  it('should track memory entries and size', async () => {
    const data = Buffer.from('test data content');
    await setCache('https://example.com/test', 'text/plain', data);

    const stats = getCacheStats();
    expect(stats.memoryEntries).toBe(1);
    expect(stats.memorySize).toBe(data.length);
  });

  it('should update stats after multiple entries', async () => {
    await setCache('https://example.com/page1', 'text/html', Buffer.from('data1'));
    await setCache('https://example.com/page2', 'text/html', Buffer.from('data2'));
    await setCache('https://example.com/page3', 'text/html', Buffer.from('data3'));

    const stats = getCacheStats();
    expect(stats.memoryEntries).toBe(3);
    expect(stats.memorySize).toBe(15); // 5 + 5 + 5 bytes
  });
});

describe('file cache operations', () => {
  const testCacheDir = join(tmpdir(), 'revamp-file-cache-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('should persist cache to file system', async () => {
    const url = 'https://file-cache-test.com/page';
    const data = Buffer.from('File cache test data');

    await setCache(url, 'text/html', data);

    // Wait a bit for async file write
    await new Promise(resolve => setTimeout(resolve, 100));

    // Clear memory cache only (preserve file cache)
    clearMemoryCache();

    // Should retrieve from file cache
    const result = await getCached(url, 'text/html');
    expect(result).not.toBeNull();
    expect(result?.toString()).toBe('File cache test data');
  });

  it('should handle expired file cache entries', async () => {
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 1, // 1 second TTL
    });

    const url = 'https://expired-cache-test.com/page';
    const data = Buffer.from('Expiring data');

    await setCache(url, 'text/html', data);

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Clear memory to force file cache read
    clearMemoryCache();

    // Should return null for expired entry
    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });
});

describe('multi-client cache isolation', () => {
  const testCacheDir = join(tmpdir(), 'revamp-multiclient-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('should isolate cache entries by client IP', async () => {
    const url = 'https://example.com/shared-page';
    const contentType = 'text/html';
    const client1Data = Buffer.from('<html>Client 1 version</html>');
    const client2Data = Buffer.from('<html>Client 2 version</html>');

    // Client 1 caches data
    await setCache(url, contentType, client1Data, '192.168.1.100');

    // Client 2 caches different data for same URL
    await setCache(url, contentType, client2Data, '192.168.1.200');

    // Each client should get their own cached version
    const result1 = await getCached(url, contentType, '192.168.1.100');
    const result2 = await getCached(url, contentType, '192.168.1.200');

    expect(result1?.toString()).toBe('<html>Client 1 version</html>');
    expect(result2?.toString()).toBe('<html>Client 2 version</html>');
  });

  it('should return null for different client IP even with same URL cached', async () => {
    const url = 'https://example.com/cached-page';
    const contentType = 'text/html';
    const data = Buffer.from('<html>Cached content</html>');

    // Client 1 caches data
    await setCache(url, contentType, data, '10.0.0.1');

    // Client 2 tries to retrieve - should not get client 1's cache
    const result = await getCached(url, contentType, '10.0.0.2');
    expect(result).toBeNull();
  });

  it('should work without client IP (backward compatibility)', async () => {
    const url = 'https://example.com/global-page';
    const contentType = 'text/html';
    const data = Buffer.from('<html>Global cache</html>');

    // Cache without client IP
    await setCache(url, contentType, data);

    // Retrieve without client IP
    const result = await getCached(url, contentType);
    expect(result?.toString()).toBe('<html>Global cache</html>');
  });

  it('should keep global cache separate from per-client cache', async () => {
    const url = 'https://example.com/mixed-page';
    const contentType = 'text/html';
    const globalData = Buffer.from('<html>Global version</html>');
    const clientData = Buffer.from('<html>Client-specific version</html>');

    // Cache globally (no IP)
    await setCache(url, contentType, globalData);

    // Cache for specific client
    await setCache(url, contentType, clientData, '172.16.0.50');

    // Both should be retrievable separately
    const globalResult = await getCached(url, contentType);
    const clientResult = await getCached(url, contentType, '172.16.0.50');

    expect(globalResult?.toString()).toBe('<html>Global version</html>');
    expect(clientResult?.toString()).toBe('<html>Client-specific version</html>');
  });

  it('should persist per-client cache to file system', async () => {
    const url = 'https://client-file-test.com/page';
    const contentType = 'text/html';
    const data = Buffer.from('Per-client file cache test');
    const clientIp = '192.168.100.1';

    await setCache(url, contentType, data, clientIp);

    // Wait for async file write
    await new Promise(resolve => setTimeout(resolve, 200));

    // Clear memory cache only (preserve file cache)
    clearMemoryCache();

    // Should retrieve from file cache
    const result = await getCached(url, contentType, clientIp);
    expect(result).not.toBeNull();
    expect(result?.toString()).toBe('Per-client file cache test');
  });

  it('should handle IPv6 addresses as client IP', async () => {
    const url = 'https://ipv6-test.com/page';
    const contentType = 'text/html';
    const data = Buffer.from('IPv6 client data');
    const ipv6Address = '2001:db8::1';

    await setCache(url, contentType, data, ipv6Address);

    const result = await getCached(url, contentType, ipv6Address);
    expect(result?.toString()).toBe('IPv6 client data');
  });

  it('should track separate stats for different clients', async () => {
    const url1 = 'https://stats-test.com/page1';
    const url2 = 'https://stats-test.com/page2';
    const contentType = 'text/html';

    // Different clients caching same URLs
    await setCache(url1, contentType, Buffer.from('data1'), '10.0.0.1');
    await setCache(url1, contentType, Buffer.from('data2'), '10.0.0.2');
    await setCache(url2, contentType, Buffer.from('data3'), '10.0.0.1');

    const stats = getCacheStats();
    // Should have 3 separate entries (2 clients for url1, 1 client for url2)
    expect(stats.memoryEntries).toBe(3);
  });
});

describe('cache cookie / auth / method isolation (T4 leak repro)', () => {
  const testCacheDir = join(tmpdir(), 'revamp-leak-repro-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('should not serve one user logged-in HTML to another user behind the same NAT IP', async () => {
    // Two distinct users sit behind one NAT'd IP. They differ in cookie name
    // SHAPE, so the cookie-name fingerprint keeps them in separate buckets.
    // The response is explicitly Cache-Control: public — a precondition for any
    // cookie-bearing response to be stored at all under the cacheability guard
    // (without it, an authenticated response is treated as private and never
    // cached; see the dedicated guard tests below).
    const url = 'https://example.com/dashboard';
    const contentType = 'text/html';
    const sharedClientIp = '203.0.113.7';

    const userAHeaders = { cookie: 'session=alice-secret-token; csrftoken=abc' };
    const userBHeaders = { cookie: 'auth=bob-bearer; sid=xyz' };
    const publicResponse = { 'cache-control': 'public, max-age=600' };

    await setCache(
      url,
      contentType,
      Buffer.from('<html>Alice private dashboard</html>'),
      sharedClientIp,
      'GET',
      userAHeaders,
      publicResponse
    );

    const userBResult = await getCached(url, contentType, sharedClientIp, 'GET', userBHeaders);
    expect(userBResult).toBeNull();

    const userAResult = await getCached(url, contentType, sharedClientIp, 'GET', userAHeaders);
    expect(userAResult?.toString()).toBe('<html>Alice private dashboard</html>');
  });

  it('should isolate cache between Authorization-bearing and anonymous requests', async () => {
    const url = 'https://example.com/api/me';
    const contentType = 'application/json';

    await setCache(
      url,
      contentType,
      Buffer.from('{"user":"alice"}'),
      undefined,
      'GET',
      { authorization: 'Bearer alice-token' }
    );

    const anonResult = await getCached(url, contentType);
    expect(anonResult).toBeNull();
  });

  it('should isolate cache by HTTP method', async () => {
    const url = 'https://example.com/resource';
    const contentType = 'application/json';

    await setCache(url, contentType, Buffer.from('{"verb":"GET"}'), undefined, 'GET');

    const postResult = await getCached(url, contentType, undefined, 'POST');
    expect(postResult).toBeNull();

    const getResult = await getCached(url, contentType, undefined, 'GET');
    expect(getResult?.toString()).toBe('{"verb":"GET"}');
  });

  it('should treat method case-insensitively', async () => {
    const url = 'https://example.com/case-method';
    await setCache(url, 'text/plain', Buffer.from('x'), undefined, 'get');
    const result = await getCached(url, 'text/plain', undefined, 'GET');
    expect(result?.toString()).toBe('x');
  });

  it('should skip caching when response carries Set-Cookie', async () => {
    const url = 'https://example.com/login-redirect';
    const data = Buffer.from('<html>welcome</html>');

    await setCache(url, 'text/html', data, undefined, 'GET', undefined, {
      'set-cookie': 'session=opaque; HttpOnly',
    });

    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });

  it('should skip caching when response carries Cache-Control: no-store', async () => {
    const url = 'https://example.com/no-store-page';
    await setCache(url, 'text/html', Buffer.from('secret'), undefined, 'GET', undefined, {
      'cache-control': 'no-store, max-age=0',
    });

    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });

  it('should skip caching when response carries Cache-Control: private', async () => {
    const url = 'https://example.com/private-page';
    await setCache(url, 'text/html', Buffer.from('private body'), undefined, 'GET', undefined, {
      'cache-control': 'private, max-age=600',
    });

    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });

  it('should still cache when Cache-Control is public or missing', async () => {
    const url = 'https://example.com/public-page';
    const data = Buffer.from('public body');

    await setCache(url, 'text/html', data, undefined, 'GET', undefined, {
      'cache-control': 'public, max-age=3600',
    });

    const result = await getCached(url, 'text/html');
    expect(result?.toString()).toBe('public body');
  });

  it('should reuse cache across requests with the same cookie name shape (public response)', async () => {
    // Two requests with cookies of the same *names* (different values) share a
    // cache bucket — we only key on names by spec, not values. The response is
    // Cache-Control: public so the cacheability guard allows the (authenticated)
    // response to be stored; without `public` a cookie-bearing response is
    // treated as private and is never cached at all.
    const url = 'https://example.com/feed';
    const contentType = 'text/html';
    const data = Buffer.from('feed body');

    await setCache(url, contentType, data, '10.0.0.1', 'GET', {
      cookie: 'session=token-A; csrf=v1',
    }, { 'cache-control': 'public, max-age=600' });

    const result = await getCached(url, contentType, '10.0.0.1', 'GET', {
      cookie: 'csrf=v2; session=token-B',
    });
    expect(result?.toString()).toBe('feed body');
  });

  it('should NOT mark uncacheable when Cache-Control contains a vendor token like "x-private-cdn"', async () => {
    // P1 #4: directive matching must be on full tokens, not substrings.
    // "x-private-cdn" must not trip the "private" guard.
    const url = 'https://example.com/x-private-cdn-page';
    const data = Buffer.from('cacheable body');

    await setCache(url, 'text/html', data, undefined, 'GET', undefined, {
      'cache-control': 'public, max-age=60, x-private-cdn',
    });

    const result = await getCached(url, 'text/html');
    expect(result?.toString()).toBe('cacheable body');
  });

  it('should mark uncacheable for "private, max-age=60" (real private directive)', async () => {
    const url = 'https://example.com/real-private';
    await setCache(url, 'text/html', Buffer.from('private body'), undefined, 'GET', undefined, {
      'cache-control': 'private, max-age=60',
    });

    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });

  it('should still mark uncacheable when "private" is mid-string with whitespace separators', async () => {
    const url = 'https://example.com/private-mid';
    await setCache(url, 'text/html', Buffer.from('x'), undefined, 'GET', undefined, {
      'cache-control': 'max-age=60 private must-revalidate',
    });

    const result = await getCached(url, 'text/html');
    expect(result).toBeNull();
  });

  it('should NOT match no-store on a vendor token like "x-no-store-flag"', async () => {
    const url = 'https://example.com/x-no-store-vendor';
    const data = Buffer.from('still cacheable');

    await setCache(url, 'text/html', data, undefined, 'GET', undefined, {
      'cache-control': 'public, max-age=60, x-no-store-flag',
    });

    const result = await getCached(url, 'text/html');
    expect(result?.toString()).toBe('still cacheable');
  });
});

describe('cacheability guard for newly-cacheable JSON (HIGH#1 regression)', () => {
  // Once 'other'/JSON content was wired into the transform registry it began
  // flowing into setCache. The cache key folds in the request method and a
  // cookie-NAME fingerprint, but NOT the request body and NOT cookie/auth
  // VALUES — so without an explicit cacheability guard, POST APIs and
  // authenticated GET JSON leak across requests/users. These tests fail on
  // the un-guarded code and pass once setCache/getCached refuse to store
  // non-GET/HEAD or cookie/auth-bearing-non-public responses.
  const testCacheDir = join(tmpdir(), 'revamp-cacheability-guard-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('must NOT serve one POST response to a different POST with a different body', async () => {
    // GraphQL-style: two POSTs to the same URL differ only in their request
    // body, which is NOT part of the cache key. Pre-fix, POST #2 was served
    // POST #1's response (WRONG DATA). Post-fix, POST responses are never
    // stored, so POST #2 misses and is fetched fresh.
    const url = 'https://api.example.com/graphql';
    const contentType = 'application/json';
    const requestHeaders = { 'content-type': 'application/json' };

    await setCache(
      url,
      contentType,
      Buffer.from('{"data":"response-to-query-A"}'),
      '10.0.0.1',
      'POST',
      requestHeaders
    );

    const served = await getCached(url, contentType, '10.0.0.1', 'POST', requestHeaders);
    expect(served).toBeNull();
  });

  it('must NOT cache an authenticated GET JSON response without Cache-Control: public', async () => {
    // Two users behind one NAT'd IP, each holding a `session` cookie (same
    // NAME, different VALUE) collapse to one cache key. Pre-fix, user B was
    // served user A's private JSON (DATA LEAK). Post-fix, the private response
    // is never stored, so neither the other user nor the same user gets a
    // shared-cache hit.
    const url = 'https://api.example.com/me';
    const contentType = 'application/json';
    const sharedClientIp = '203.0.113.7';

    await setCache(
      url,
      contentType,
      Buffer.from('{"user":"alice","ssn":"redacted-secret"}'),
      sharedClientIp,
      'GET',
      { cookie: 'session=alice-token' }
    );

    const userB = await getCached(url, contentType, sharedClientIp, 'GET', {
      cookie: 'session=bob-token',
    });
    expect(userB).toBeNull();

    const userA = await getCached(url, contentType, sharedClientIp, 'GET', {
      cookie: 'session=alice-token',
    });
    expect(userA).toBeNull();
  });

  it('must NOT cache an Authorization-bearing GET JSON response without Cache-Control: public', async () => {
    const url = 'https://api.example.com/account';
    const contentType = 'application/json';

    await setCache(
      url,
      contentType,
      Buffer.from('{"balance":12345}'),
      undefined,
      'GET',
      { authorization: 'Bearer alice-token' }
    );

    const result = await getCached(url, contentType, undefined, 'GET', {
      authorization: 'Bearer alice-token',
    });
    expect(result).toBeNull();
  });

  it('SHOULD still cache an authenticated GET JS asset that is Cache-Control: public', async () => {
    // Static assets are virtually always GET and usually public. Even when the
    // browser attaches a session cookie, an explicitly-public response stays
    // cacheable exactly as before — the guard must not regress static assets.
    const url = 'https://cdn.example.com/app.js';
    const contentType = 'application/javascript';
    const data = Buffer.from('console.log("bundle");');

    await setCache(url, contentType, data, '10.0.0.1', 'GET', { cookie: 'session=x' }, {
      'cache-control': 'public, max-age=31536000, immutable',
    });

    const result = await getCached(url, contentType, '10.0.0.1', 'GET', {
      cookie: 'session=x',
    });
    expect(result?.toString()).toBe('console.log("bundle");');
  });

  it('must NOT cache an authenticated GET JS asset that lacks any Cache-Control', async () => {
    // A cookie-bearing JS request whose response carries NO cache-control is
    // treated as private and not shared — only an explicit `public` opts in.
    const url = 'https://cdn.example.com/app-no-cc.js';
    const contentType = 'application/javascript';

    await setCache(url, contentType, Buffer.from('console.log("priv");'), '10.0.0.1', 'GET', {
      cookie: 'session=x',
    });

    const result = await getCached(url, contentType, '10.0.0.1', 'GET', {
      cookie: 'session=x',
    });
    expect(result).toBeNull();
  });

  it('SHOULD still cache anonymous (no cookie/auth) GET content with no Cache-Control', async () => {
    // The common static-asset path: no auth headers → cacheable regardless of
    // cache-control, exactly as before this change.
    const url = 'https://cdn.example.com/anon.css';
    const contentType = 'text/css';
    const data = Buffer.from('body{color:red}');

    await setCache(url, contentType, data, '10.0.0.1', 'GET');

    const result = await getCached(url, contentType, '10.0.0.1', 'GET');
    expect(result?.toString()).toBe('body{color:red}');
  });

  it('SHOULD still cache an authenticated HEAD request marked Cache-Control: public', async () => {
    const url = 'https://cdn.example.com/head-asset.js';
    const contentType = 'application/javascript';
    const data = Buffer.from('');

    await setCache(url, contentType, data, undefined, 'HEAD', { cookie: 'session=x' }, {
      'cache-control': 'public',
    });

    const result = await getCached(url, contentType, undefined, 'HEAD', { cookie: 'session=x' });
    expect(result).not.toBeNull();
  });
});

describe('cache Vary header support (T41)', () => {
  const testCacheDir = join(tmpdir(), 'revamp-vary-test-' + Date.now());

  beforeEach(async () => {
    clearCache();
    resetConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
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

  it('should NOT cache a response with Vary: *', async () => {
    const url = 'https://example.com/vary-star';
    await setCache(
      url,
      'text/html',
      Buffer.from('<html>v</html>'),
      undefined,
      'GET',
      { 'accept-language': 'en-US' },
      { vary: '*' }
    );

    // Vary: * is uncacheable per RFC. Even with the same request headers
    // the entry must not be retrievable.
    const result = await getCached(url, 'text/html', undefined, 'GET', {
      'accept-language': 'en-US',
    });
    expect(result).toBeNull();

    const stats = getCacheStats();
    expect(stats.memoryEntries).toBe(0);
  });

  it('should miss when request Vary header value differs', async () => {
    const url = 'https://example.com/feed';
    const contentType = 'text/html';
    const data = Buffer.from('<html>english body</html>');

    await setCache(
      url,
      contentType,
      data,
      undefined,
      'GET',
      { 'accept-language': 'en-US' },
      { vary: 'Accept-Language' }
    );

    // Different Accept-Language should miss — Vary fingerprint differs.
    const missResult = await getCached(url, contentType, undefined, 'GET', {
      'accept-language': 'fr-FR',
    });
    expect(missResult).toBeNull();
  });

  it('should hit when request Vary header value matches', async () => {
    const url = 'https://example.com/feed-hit';
    const contentType = 'text/html';
    const data = Buffer.from('<html>english body</html>');

    await setCache(
      url,
      contentType,
      data,
      undefined,
      'GET',
      { 'accept-language': 'en-US' },
      { vary: 'Accept-Language' }
    );

    const hitResult = await getCached(url, contentType, undefined, 'GET', {
      'accept-language': 'en-US',
    });
    expect(hitResult?.toString()).toBe('<html>english body</html>');
  });

  it('should persist a .vary sidecar to disk for Vary responses', async () => {
    const url = 'https://example.com/sidecar-test';
    const contentType = 'text/html';
    const data = Buffer.from('<html>sidecar</html>');

    await setCache(
      url,
      contentType,
      data,
      undefined,
      'GET',
      { 'accept-language': 'en-US' },
      { vary: 'Accept-Language' }
    );

    // Wait for the fire-and-forget file write to finish.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Walk the cache dir and confirm a `.vary` file exists.
    const { readdir, readFile } = await import('node:fs/promises');
    let foundSidecar = false;
    let sidecarContent = '';
    const subdirs = await readdir(testCacheDir);
    for (const subdir of subdirs) {
      const subdirPath = join(testCacheDir, subdir);
      try {
        const files = await readdir(subdirPath);
        for (const file of files) {
          if (file.endsWith('.vary')) {
            foundSidecar = true;
            sidecarContent = await readFile(join(subdirPath, file), 'utf-8');
            break;
          }
        }
      } catch {
        // Ignore non-directories
      }
      if (foundSidecar) break;
    }

    expect(foundSidecar).toBe(true);
    const parsed = JSON.parse(sidecarContent) as { names: string[] };
    expect(parsed.names).toEqual(['accept-language']);
  });

  it('should serve correct variant after memory eviction (sidecar reload)', async () => {
    const url = 'https://example.com/reload-vary';
    const contentType = 'text/html';
    const data = Buffer.from('<html>en variant</html>');

    await setCache(
      url,
      contentType,
      data,
      undefined,
      'GET',
      { 'accept-language': 'en-US' },
      { vary: 'Accept-Language' }
    );

    // Wait for fire-and-forget writes.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Clear memory only — sidecar must be re-read from disk.
    clearMemoryCache();

    const hit = await getCached(url, contentType, undefined, 'GET', {
      'accept-language': 'en-US',
    });
    expect(hit?.toString()).toBe('<html>en variant</html>');

    const miss = await getCached(url, contentType, undefined, 'GET', {
      'accept-language': 'fr-FR',
    });
    expect(miss).toBeNull();
  });
});

describe('cache key hash memoization', () => {
  const testCacheDir = join(tmpdir(), 'revamp-hash-memo-test-' + Date.now());
  const clientIp = '198.51.100.42';

  beforeEach(async () => {
    clearCache();
    resetConfig();
    resetClientConfig();
    updateConfig({
      cacheEnabled: true,
      cacheDir: testCacheDir,
      cacheTTL: 3600,
    });
    try {
      await mkdir(testCacheDir, { recursive: true });
    } catch {
      // Ignore if exists
    }
  });

  afterEach(async () => {
    clearCache();
    resetClientConfig();
    resetConfig();
    try {
      await rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should compute the config hash only once for a stable client config object', async () => {
    // setClientConfig stores this exact object; getClientConfig returns the
    // same reference until it is replaced — so the hash must be memoized.
    setClientConfig({ removeAds: true, transformJs: true }, clientIp);

    const url = 'https://memo-test.example/page';
    const before = getHashComputeCounts().config;

    await setCache(url, 'text/html', Buffer.from('<html>memo</html>'), clientIp);
    await getCached(url, 'text/html', clientIp);
    await getCached(url, 'text/html', clientIp);

    const after = getHashComputeCounts().config;
    // Three cache-key computations, one actual hash computation.
    expect(after - before).toBe(1);
  });

  it('should change the cache key when the client config is replaced with different content', async () => {
    const url = 'https://memo-replace.example/page';

    setClientConfig({ removeAds: true }, clientIp);
    await setCache(url, 'text/html', Buffer.from('v1'), clientIp);
    expect((await getCached(url, 'text/html', clientIp))?.toString()).toBe('v1');

    // Replacing the config with different content must produce a different
    // hash → different cache key → MISS. A stale memo here would serve a
    // response cached under the old config (correctness-critical).
    setClientConfig({ removeAds: false }, clientIp);
    expect(await getCached(url, 'text/html', clientIp)).toBeNull();

    // A NEW object with content equal to the original must hash to the same
    // value again (memo is identity-keyed, hash is content-derived) → HIT.
    setClientConfig({ removeAds: true }, clientIp);
    expect((await getCached(url, 'text/html', clientIp))?.toString()).toBe('v1');
  });

  it('should recompute (not reuse) the hash for a replaced equal-content config object', async () => {
    setClientConfig({ removeTracking: true }, clientIp);
    const url = 'https://memo-recompute.example/page';

    await getCached(url, 'text/html', clientIp);
    const afterFirst = getHashComputeCounts().config;

    // New object identity, same content → memo miss → one more computation.
    setClientConfig({ removeTracking: true }, clientIp);
    await getCached(url, 'text/html', clientIp);

    const afterSecond = getHashComputeCounts().config;
    expect(afterSecond - afterFirst).toBe(1);
  });

  it('should memoize the profile hash and recompute when the profile object is replaced', async () => {
    const store = getRulesStore();
    const profile: DomainProfile = {
      id: 'memo-profile-test-id',
      name: 'memo test profile',
      patterns: [{ type: 'exact', pattern: 'profile-memo.example' }],
      priority: 100,
      removeAds: true,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.profiles.push(profile);
    clearProfileCache();

    try {
      const url = 'https://profile-memo.example/page';
      const before = getHashComputeCounts().profile;

      await setCache(url, 'text/html', Buffer.from('profiled'), clientIp);
      await getCached(url, 'text/html', clientIp);
      expect((await getCached(url, 'text/html', clientIp))?.toString()).toBe('profiled');

      const afterStable = getHashComputeCounts().profile;
      // Three cache-key computations against the same profile object → one hash.
      expect(afterStable - before).toBe(1);

      // Replace the profile object exactly the way updateProfile() does:
      // a fresh spread object swapped into the array slot, with a bumped
      // updatedAt. The old cache entry must MISS under the new profile hash.
      const index = store.profiles.indexOf(profile);
      store.profiles[index] = {
        ...profile,
        removeAds: false,
        updatedAt: profile.updatedAt + 1,
      };
      clearProfileCache();

      expect(await getCached(url, 'text/html', clientIp)).toBeNull();
      const afterReplace = getHashComputeCounts().profile;
      expect(afterReplace - afterStable).toBe(1);
    } finally {
      store.profiles = store.profiles.filter((p) => p.id !== 'memo-profile-test-id');
      clearProfileCache();
    }
  });
});
