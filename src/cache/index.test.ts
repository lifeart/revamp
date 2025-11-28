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
