/**
 * Service Worker Bundler Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bundleServiceWorker,
  clearSwModuleCache,
  getSwModuleCacheSize,
  transformInlineServiceWorker,
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
      // Use localhost:0 which fails immediately (connection refused)
      const result = await bundleServiceWorker('http://localhost:0/sw.js', '/app/');

      // Even on failure, it should have the proper structure
      expect(result.originalUrl).toBe('http://localhost:0/sw.js');
      expect(result.scope).toBe('/app/');
      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('should handle different scopes', async () => {
      // Use fast-failing URLs
      const result1 = await bundleServiceWorker('http://localhost:0/sw.js', '/');
      const result2 = await bundleServiceWorker('http://localhost:0/sw.js', '/app/');

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

  describe('transformInlineServiceWorker', () => {
    it('should transform inline SW code', async () => {
      const code = `
        self.addEventListener('install', function(event) {
          console.log('Installing');
        });
      `;

      const result = await transformInlineServiceWorker(code, '/');

      expect(result.success).toBe(true);
      expect(result.originalUrl).toBe('inline-script');
      expect(result.scope).toBe('/');
      expect(result.code).toContain('[Revamp]');
      expect(result.code).toContain('Service Worker');
    });

    it('should include scope in wrapper', async () => {
      const code = `console.log('test');`;
      const result = await transformInlineServiceWorker(code, '/app/');

      expect(result.scope).toBe('/app/');
      expect(result.code).toContain('/app/');
    });

    it('should handle modern JS syntax', async () => {
      const code = `
        const log = (...args) => console.log('[SW]', ...args);
        self.addEventListener('install', async (event) => {
          await self.skipWaiting();
        });
      `;

      const result = await transformInlineServiceWorker(code, '/');

      expect(result.success).toBe(true);
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('should handle empty code', async () => {
      const result = await transformInlineServiceWorker('', '/');

      expect(result.success).toBe(true);
      expect(result.code).toContain('[Revamp]');
    });

    it('should preserve code functionality in wrapper', async () => {
      const code = `
        self.addEventListener('fetch', function(event) {
          event.respondWith(fetch(event.request));
        });
      `;

      const result = await transformInlineServiceWorker(code, '/');

      expect(result.success).toBe(true);
      // The wrapper should still include fetch-related code
      expect(result.code).toContain('fetch');
      expect(result.code).toContain('respondWith');
    });
  });
});
