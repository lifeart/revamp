/**
 * Tests for ES Module Bundler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bundleEsModule,
  bundleInlineModule,
  clearModuleCache,
  isModuleScript,
  getModuleShimScript,
} from './esm-bundler.js';
import { updateConfig, resetConfig } from '../config/index.js';

describe('ES Module Bundler', () => {
  beforeEach(() => {
    resetConfig();
    clearModuleCache();
  });

  afterEach(() => {
    resetConfig();
    clearModuleCache();
  });

  describe('isModuleScript', () => {
    it('should return true for "module" type', () => {
      expect(isModuleScript('module')).toBe(true);
    });

    it('should return false for empty type', () => {
      expect(isModuleScript('')).toBe(false);
      expect(isModuleScript(undefined)).toBe(false);
    });

    it('should return false for other types', () => {
      expect(isModuleScript('text/javascript')).toBe(false);
      expect(isModuleScript('application/json')).toBe(false);
    });
  });

  describe('getModuleShimScript', () => {
    it('should return a script tag with ES Module shim', () => {
      const shim = getModuleShimScript();
      expect(shim).toContain('<script>');
      expect(shim).toContain('ES Module Shim');
      expect(shim).toContain('__revampModules');
    });
  });

  describe('bundleInlineModule', () => {
    it('should bundle simple inline module code', async () => {
      updateConfig({ transformJs: true });
      const code = `const x = 1; console.log(x);`;
      const result = await bundleInlineModule(code, 'http://example.com/test.js');

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      // The bundled code should be wrapped in IIFE (esbuild format)
      expect(result.code).toContain('console');
    });

    it('should handle arrow functions and modern syntax', async () => {
      updateConfig({ transformJs: true });
      const code = `
        const add = (a, b) => a + b;
        const result = add(1, 2);
        console.log(result);
      `;
      const result = await bundleInlineModule(code, 'http://example.com/test.js');

      expect(result.success).toBe(true);
      // Arrow functions should be transformed to regular functions for legacy browsers
      expect(result.code).toBeDefined();
    });

    it('should return original code when transformJs is disabled', async () => {
      updateConfig({ transformJs: false });
      const code = `const x = 1;`;
      const result = await bundleInlineModule(code, 'http://example.com/test.js');

      expect(result.success).toBe(true);
      expect(result.code).toContain('const x = 1');
    });
  });

  describe('bundleEsModule', () => {
    it('should return error for unreachable URLs', async () => {
      updateConfig({ transformJs: true });
      const result = await bundleEsModule('http://localhost:99999/nonexistent.js');

      // Should return an error fallback
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toContain('[Revamp] Failed to bundle');
    });

    it('should bundle inline code when provided', async () => {
      updateConfig({ transformJs: true });
      const inlineCode = `
        export const greeting = 'Hello';
        console.log(greeting);
      `;
      const result = await bundleEsModule('http://example.com/inline.js', inlineCode);

      expect(result.success).toBe(true);
      expect(result.code).toContain('Hello');
    });
  });

  describe('clearModuleCache', () => {
    it('should clear the module cache without errors', () => {
      expect(() => clearModuleCache()).not.toThrow();
    });
  });
});
