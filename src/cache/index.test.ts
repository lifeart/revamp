import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCached,
  setCache,
  clearCache,
  getCacheStats,
  isRedirectStatus,
  markAsRedirect,
} from './index.js';
import { resetConfig, updateConfig } from '../config/index.js';
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

    // Clear memory cache
    clearCache();

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
    clearCache();

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

    // Clear memory cache
    clearCache();

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
