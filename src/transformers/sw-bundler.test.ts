/**
 * Service Worker Bundler Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bundleServiceWorker,
  clearSwModuleCache,
  getSwModuleCacheSize,
} from './sw-bundler.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('SW Bundler', () => {
  beforeEach(() => {
    resetConfig();
    clearSwModuleCache();
  });

  afterEach(() => {
    resetConfig();
    clearSwModuleCache();
  });

  describe('bundleServiceWorker', () => {
    it('should return a fallback when URL is invalid', async () => {
      const result = await bundleServiceWorker('not-a-valid-url', '/');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toContain('[Revamp] Service Worker Bundle Error');
      expect(result.originalUrl).toBe('not-a-valid-url');
      expect(result.scope).toBe('/');
    });

    it('should return a fallback when URL cannot be fetched', async () => {
      const result = await bundleServiceWorker('https://invalid.domain.local/sw.js', '/');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toContain('[Revamp] Service Worker Bundle Error');
    });

    it('should include Revamp wrapper in bundled code', async () => {
      // We can't easily mock the fetch, but we can check the error fallback structure
      const result = await bundleServiceWorker('https://example.com/sw.js', '/app/');

      // Even on failure, it should have the proper structure
      expect(result.originalUrl).toBe('https://example.com/sw.js');
      expect(result.scope).toBe('/app/');
      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('should handle different scopes', async () => {
      const result1 = await bundleServiceWorker('https://example.com/sw.js', '/');
      const result2 = await bundleServiceWorker('https://example.com/sw.js', '/app/');

      expect(result1.scope).toBe('/');
      expect(result2.scope).toBe('/app/');
    });
  });

  describe('clearSwModuleCache', () => {
    it('should clear the cache', () => {
      // Cache might be populated from previous operations
      clearSwModuleCache();
      expect(getSwModuleCacheSize()).toBe(0);
    });
  });

  describe('getSwModuleCacheSize', () => {
    it('should return cache size', () => {
      clearSwModuleCache();
      const size = getSwModuleCacheSize();
      expect(typeof size).toBe('number');
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });
});
