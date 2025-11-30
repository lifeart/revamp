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
  parseImportMap,
  getModuleCacheSize,
  isCssUrl,
  generateCssInjectionCode,
  detectTopLevelAwait,
  wrapTopLevelAwait,
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

  describe('getModuleCacheSize', () => {
    it('should return 0 after clearing cache', () => {
      clearModuleCache();
      expect(getModuleCacheSize()).toBe(0);
    });
  });

  describe('parseImportMap', () => {
    it('should parse a valid import map with imports', () => {
      const json = JSON.stringify({
        imports: {
          'lodash': 'https://cdn.example.com/lodash.js',
          'lodash/': 'https://cdn.example.com/lodash/',
        },
      });

      const result = parseImportMap(json);
      expect(result).toBeDefined();
      expect(result?.imports?.lodash).toBe('https://cdn.example.com/lodash.js');
      expect(result?.imports?.['lodash/']).toBe('https://cdn.example.com/lodash/');
    });

    it('should parse a valid import map with scopes', () => {
      const json = JSON.stringify({
        imports: {
          'moment': 'https://cdn.example.com/moment@2.0.0/moment.js',
        },
        scopes: {
          '/legacy/': {
            'moment': 'https://cdn.example.com/moment@1.0.0/moment.js',
          },
        },
      });

      const result = parseImportMap(json);
      expect(result).toBeDefined();
      expect(result?.imports?.moment).toBe('https://cdn.example.com/moment@2.0.0/moment.js');
      expect(result?.scopes?.['/legacy/']?.moment).toBe('https://cdn.example.com/moment@1.0.0/moment.js');
    });

    it('should return undefined for invalid JSON', () => {
      const result = parseImportMap('not valid json');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-object JSON', () => {
      const result = parseImportMap('"string"');
      expect(result).toBeUndefined();
    });

    it('should ignore non-string values in imports', () => {
      const json = JSON.stringify({
        imports: {
          'valid': 'https://example.com/module.js',
          'invalid': 123,
          'alsoInvalid': null,
        },
      });

      const result = parseImportMap(json);
      expect(result).toBeDefined();
      expect(result?.imports?.valid).toBe('https://example.com/module.js');
      expect(result?.imports?.invalid).toBeUndefined();
      expect(result?.imports?.alsoInvalid).toBeUndefined();
    });

    it('should handle empty import map', () => {
      const result = parseImportMap('{}');
      expect(result).toBeDefined();
      expect(result?.imports).toBeUndefined();
      expect(result?.scopes).toBeUndefined();
    });
  });

  describe('bundleEsModule with import map', () => {
    it('should use import map for bare specifier resolution', async () => {
      updateConfig({ transformJs: true });

      const inlineCode = `
        import { helper } from 'my-helpers';
        console.log(helper);
      `;

      // Without import map - should fail to resolve
      const resultWithout = await bundleEsModule('http://example.com/test.js', inlineCode);
      // The bare specifier will be marked as external, so bundling may succeed but won't include the import

      // With import map - would resolve (but we can't fully test without a real server)
      // This at least tests that the import map is accepted
      const importMap = {
        imports: {
          'my-helpers': 'http://example.com/helpers.js',
        },
      };

      const resultWith = await bundleEsModule('http://example.com/test.js', inlineCode, importMap);
      expect(resultWith).toBeDefined();
    });
  });

  describe('CSS module imports', () => {
    it('should handle inline module with CSS import', async () => {
      updateConfig({ transformJs: true });

      // CSS imports should be converted to style injection code
      const inlineCode = `
        import './styles.css';
        console.log('Module with CSS import');
      `;

      const result = await bundleInlineModule(inlineCode, 'http://example.com/module.js');
      // The result should contain the module code (CSS import will be marked external or error gracefully)
      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
    });
  });

  describe('top-level await handling', () => {
    it('should bundle module with top-level await', async () => {
      updateConfig({ transformJs: true });

      const inlineCode = `
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        await delay(10);
        const result = 'done';
        console.log(result);
      `;

      const result = await bundleInlineModule(inlineCode, 'http://example.com/tla-module.js');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      // The code should be wrapped in an async IIFE
      expect(result.code).toContain('async');
    });

    it('should handle TLA with exports', async () => {
      updateConfig({ transformJs: true });

      const inlineCode = `
        const data = await Promise.resolve({ value: 42 });
        export const value = data.value;
      `;

      const result = await bundleInlineModule(inlineCode, 'http://example.com/tla-export.js');
      expect(result).toBeDefined();
      // Should handle without crashing
      expect(result.code).toBeDefined();
    });
  });

  describe('dynamic imports', () => {
    it('should handle code with dynamic import()', async () => {
      updateConfig({ transformJs: true });

      const inlineCode = `
        async function loadModule() {
          const mod = await import('./dynamic.js');
          return mod;
        }
        loadModule();
      `;

      const result = await bundleInlineModule(inlineCode, 'http://example.com/dynamic-test.js');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      // Dynamic imports should be handled somehow (either bundled or converted to runtime loader)
      expect(result.code).toBeDefined();
    });
  });

  describe('getModuleShimScript', () => {
    it('should include dynamic import runtime', () => {
      const shim = getModuleShimScript();
      expect(shim).toContain('__revampDynamicImport');
    });

    it('should include TLA exports storage', () => {
      const shim = getModuleShimScript();
      expect(shim).toContain('__tlaExports');
    });
  });

  describe('isCssUrl', () => {
    it('should return true for .css URLs', () => {
      expect(isCssUrl('http://example.com/styles.css')).toBe(true);
      expect(isCssUrl('https://cdn.example.com/path/to/file.css')).toBe(true);
      expect(isCssUrl('/styles.css')).toBe(true);
      expect(isCssUrl('./styles.css')).toBe(true);
    });

    it('should return true for .CSS (case insensitive)', () => {
      expect(isCssUrl('http://example.com/STYLES.CSS')).toBe(true);
      expect(isCssUrl('http://example.com/Styles.Css')).toBe(true);
    });

    it('should return false for non-CSS URLs', () => {
      expect(isCssUrl('http://example.com/script.js')).toBe(false);
      expect(isCssUrl('http://example.com/styles.scss')).toBe(false);
      expect(isCssUrl('http://example.com/styles.less')).toBe(false);
      expect(isCssUrl('http://example.com/index.html')).toBe(false);
    });

    it('should handle URLs with query strings', () => {
      expect(isCssUrl('http://example.com/styles.css?v=123')).toBe(true);
      expect(isCssUrl('http://example.com/api?file=styles.css')).toBe(false);
    });

    it('should handle malformed URLs gracefully', () => {
      expect(isCssUrl('styles.css')).toBe(true);
      expect(isCssUrl('styles.js')).toBe(false);
    });
  });

  describe('generateCssInjectionCode', () => {
    it('should generate valid JavaScript code', () => {
      const css = 'body { color: red; }';
      const url = 'http://example.com/styles.css';
      const code = generateCssInjectionCode(css, url);

      expect(code).toContain('document.createElement');
      expect(code).toContain('style');
      expect(code).toContain('body { color: red; }');
    });

    it('should include data attribute with source URL', () => {
      const css = '.test { margin: 0; }';
      const url = 'http://example.com/test.css';
      const code = generateCssInjectionCode(css, url);

      expect(code).toContain('data-revamp-css-module');
      expect(code).toContain(url);
    });

    it('should escape backticks in CSS', () => {
      const css = '.test::before { content: "`"; }';
      const url = 'http://example.com/styles.css';
      const code = generateCssInjectionCode(css, url);

      expect(code).toContain('\\`');
    });

    it('should escape dollar signs in CSS', () => {
      const css = '.price::after { content: "$100"; }';
      const url = 'http://example.com/styles.css';
      const code = generateCssInjectionCode(css, url);

      expect(code).toContain('\\$');
    });

    it('should escape backslashes in CSS', () => {
      const css = '.icon { content: "\\e001"; }';
      const url = 'http://example.com/styles.css';
      const code = generateCssInjectionCode(css, url);

      expect(code).toContain('\\\\');
    });
  });

  describe('detectTopLevelAwait', () => {
    it('should detect simple top-level await', () => {
      expect(detectTopLevelAwait('const data = await fetch("/api");')).toBe(true);
      expect(detectTopLevelAwait('await Promise.resolve();')).toBe(true);
    });

    it('should detect await with variable declaration', () => {
      expect(detectTopLevelAwait('const result = await someAsyncFn();')).toBe(true);
      expect(detectTopLevelAwait('let value = await getValue();')).toBe(true);
      expect(detectTopLevelAwait('var x = await getX();')).toBe(true);
    });

    it('should detect await with export', () => {
      expect(detectTopLevelAwait('export const data = await fetchData();')).toBe(true);
    });

    it('should NOT detect await inside async function', () => {
      const code = `
        async function fetchData() {
          const result = await fetch('/api');
          return result;
        }
      `;
      expect(detectTopLevelAwait(code)).toBe(false);
    });

    it('should NOT detect await inside async arrow function', () => {
      const code = `
        const fetchData = async () => {
          const result = await fetch('/api');
          return result;
        };
      `;
      expect(detectTopLevelAwait(code)).toBe(false);
    });

    it('should NOT detect await inside async method', () => {
      const code = `
        const obj = {
          async getData() {
            return await fetch('/api');
          }
        };
      `;
      expect(detectTopLevelAwait(code)).toBe(false);
    });

    it('should NOT detect await in string literals', () => {
      expect(detectTopLevelAwait('const str = "await is not async";')).toBe(false);
      expect(detectTopLevelAwait("const str = 'await this';")).toBe(false);
      expect(detectTopLevelAwait('const str = `await template`;')).toBe(false);
    });

    it('should NOT detect await in comments', () => {
      expect(detectTopLevelAwait('// await fetch("/api")\nconst x = 1;')).toBe(false);
      expect(detectTopLevelAwait('/* await Promise.resolve() */\nconst x = 1;')).toBe(false);
    });

    it('should handle code without await', () => {
      expect(detectTopLevelAwait('const x = 1; console.log(x);')).toBe(false);
      expect(detectTopLevelAwait('function sync() { return 1; }')).toBe(false);
    });

    it('should detect TLA even with nested async functions', () => {
      const code = `
        async function helper() {
          return await fetch('/helper');
        }
        const data = await helper();
      `;
      expect(detectTopLevelAwait(code)).toBe(true);
    });

    it('should handle nested functions correctly', () => {
      const code = `
        function outer() {
          async function inner() {
            await fetch('/api');
          }
          inner();
        }
      `;
      expect(detectTopLevelAwait(code)).toBe(false);
    });
  });

  describe('wrapTopLevelAwait', () => {
    it('should wrap code in async IIFE', () => {
      const code = 'const data = await fetch("/api");';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('(async function()');
      expect(wrapped).toContain('})()');
      expect(wrapped).toContain(code);
    });

    it('should include error handling', () => {
      const code = 'await doSomething();';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('try {');
      expect(wrapped).toContain('catch (e)');
    });

    it('should transform exports to window.__tlaExports', () => {
      const code = 'export const value = await getValue();';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('window.__tlaExports');
    });

    it('should handle export default', () => {
      const code = 'export default await createApp();';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('window.__tlaExports.default');
    });

    it('should handle code without exports', () => {
      const code = 'const result = await fetchData();\nconsole.log(result);';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('async function');
      expect(wrapped).toContain(code);
    });

    it('should use strict mode', () => {
      const code = 'await init();';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain("'use strict'");
    });
  });
});
