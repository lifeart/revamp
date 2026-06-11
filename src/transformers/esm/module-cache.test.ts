/**
 * Tests for the ES Module Bundler LRU module cache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LruCache,
  MAX_CACHE_SIZE,
  moduleCache,
  clearModuleCache,
  getModuleCacheSize,
  pruneModuleCacheIfNeeded,
} from './module-cache.js';

describe('LruCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      expect(cache.size).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      const cache = new LruCache<string, number>(3);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should report has() without refreshing recency', () => {
      const cache = new LruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      // has() must NOT refresh 'a' — inserting 'c' should still evict it
      expect(cache.has('a')).toBe(true);
      cache.set('c', 3);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
    });

    it('should clear all entries', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('eviction order', () => {
    it('should evict the oldest entry when over the limit', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // 'a' is oldest — evicted

      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should evict only as many entries as needed, in LRU order', () => {
      const cache = new LruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      cache.set('d', 4); // evicts 'b'

      expect(cache.keys()).toEqual(['c', 'd']);
    });

    it('should never grow past the limit', () => {
      const cache = new LruCache<number, number>(5);
      for (let i = 0; i < 20; i++) {
        cache.set(i, i);
        expect(cache.size).toBeLessThanOrEqual(5);
      }
      // Only the 5 most recent inserts survive
      expect(cache.keys()).toEqual([15, 16, 17, 18, 19]);
    });
  });

  describe('refresh-on-get', () => {
    it('should refresh recency on get so the entry survives eviction', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Touch 'a' — now 'b' is the least recently used
      expect(cache.get('a')).toBe(1);
      cache.set('d', 4); // evicts 'b', not 'a'

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should move the key to most-recently-used position on get', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.get('a');
      expect(cache.keys()).toEqual(['b', 'c', 'a']);
    });

    it('should refresh recency on overwrite via set', () => {
      const cache = new LruCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.set('a', 10); // overwrite refreshes 'a'
      expect(cache.keys()).toEqual(['b', 'c', 'a']);
      expect(cache.get('a')).toBe(10);
      expect(cache.size).toBe(3);
    });
  });

  describe('evictToLimit', () => {
    it('should evict oldest entries down to the limit', () => {
      const cache = new LruCache<string, number>(10);
      for (let i = 0; i < 5; i++) {
        cache.set(`k${i}`, i);
      }
      // Nothing over the limit yet
      cache.evictToLimit();
      expect(cache.size).toBe(5);
    });
  });
});

describe('shared module cache helpers', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('clearModuleCache should empty the shared cache', () => {
    moduleCache.set('http://example.com/a.js', { content: 'a', url: 'http://example.com/a.js' });
    expect(getModuleCacheSize()).toBe(1);
    clearModuleCache();
    expect(getModuleCacheSize()).toBe(0);
  });

  it('shared cache should be bounded at MAX_CACHE_SIZE with LRU eviction', () => {
    for (let i = 0; i < MAX_CACHE_SIZE + 10; i++) {
      const url = `http://example.com/mod${i}.js`;
      moduleCache.set(url, { content: `mod${i}`, url });
    }
    expect(getModuleCacheSize()).toBe(MAX_CACHE_SIZE);
    // The 10 oldest entries were evicted, the newest survive
    expect(moduleCache.has('http://example.com/mod0.js')).toBe(false);
    expect(moduleCache.has('http://example.com/mod9.js')).toBe(false);
    expect(moduleCache.has('http://example.com/mod10.js')).toBe(true);
    expect(moduleCache.has(`http://example.com/mod${MAX_CACHE_SIZE + 9}.js`)).toBe(true);
  });

  it('pruneModuleCacheIfNeeded should be a no-op when within the limit', () => {
    moduleCache.set('http://example.com/a.js', { content: 'a', url: 'http://example.com/a.js' });
    pruneModuleCacheIfNeeded();
    expect(getModuleCacheSize()).toBe(1);
    expect(moduleCache.has('http://example.com/a.js')).toBe(true);
  });
});
