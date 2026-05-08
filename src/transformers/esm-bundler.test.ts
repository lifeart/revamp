/**
 * Tests for ES Module Bundler
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

      // Without import map the bare specifier will be marked as external, so
      // bundling may succeed but won't include the import. We don't assert on
      // that path here — the focus is that the import map IS accepted below.

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

    it('does not use eval to execute remote modules (T10)', () => {
      const shim = getModuleShimScript();
      // The legacy implementation did `eval(wrappedCode)`, which exposed the
      // surrounding shim closure to upstream JS — that's RCE-adjacent. The
      // replacement uses `new Function(...)` so remote code only sees the
      // formal parameters we hand it.
      expect(shim).not.toMatch(/\beval\s*\(/);
      expect(shim).toContain('new Function');
    });

    it('passes module/exports/require as named parameters (T10)', () => {
      const shim = getModuleShimScript();
      expect(shim).toContain("'module'");
      expect(shim).toContain("'exports'");
      expect(shim).toContain("'require'");
    });

    it('isolates wrapped code from the enclosing shim scope (T10)', () => {
      // The replacement contract: `new Function('module', 'exports', 'require', code)`
      // creates a function whose only visible identifiers are its formal
      // parameters and globals. Local variables in the surrounding shim are
      // not in the wrapped code's scope, so a sentinel can't be captured.
      // We mirror the production substitution here so a future regression
      // (e.g. someone reintroducing `eval`) would fail this assertion.
      const SECRET_FROM_SHIM = 'shim-only-secret';
      void SECRET_FROM_SHIM; // referenced so a naive "unused var" lint isn't triggered

      const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- T10: this test exists precisely to assert `new Function` scope-narrowing semantics.
      const factory = new Function(
        'module',
        'exports',
        'require',
        'try { module.exports.leaked = SECRET_FROM_SHIM; } ' +
          'catch (e) { module.exports.leaked = null; module.exports.error = e.name; }'
      );
      factory.call(undefined, moduleObj, moduleObj.exports, undefined);

      expect(moduleObj.exports.leaked).toBeNull();
      expect(moduleObj.exports.error).toBe('ReferenceError');
    });

    it('exposes module.exports / exports / require to wrapped code (T10)', () => {
      // Sanity: scope narrowing must not break the legitimate CommonJS-style
      // surface. A wrapped module assigning to `module.exports` should be
      // observable on the enclosing module object, mirroring the shim's flow.
      const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
      const requireStub = (name: string): string => `stub:${name}`;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- T10: this test exists precisely to assert `new Function` scope-narrowing semantics.
      const factory = new Function(
        'module',
        'exports',
        'require',
        'exports.inline = "inline-set"; ' +
          'module.exports = { inline: exports.inline, viaRequire: require("dep") };'
      );
      factory.call(undefined, moduleObj, moduleObj.exports, requireStub);

      expect(moduleObj.exports).toEqual({
        inline: 'inline-set',
        viaRequire: 'stub:dep',
      });
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

    // T35: Babel emits `for await (const x of y)` as ForOfStatement with
    // `await: true`, NOT as AwaitExpression. The detector must visit
    // ForOfStatement too or classic `for-of` ships to iOS 9 → SyntaxError.
    it('detects top-level `for await` (T35)', () => {
      expect(
        detectTopLevelAwait('for await (const x of asyncIter()) {}'),
      ).toBe(true);
    });

    it('does NOT flag `for await` inside an async function (T35)', () => {
      const code = `
        async function f() {
          for await (const x of y) {}
        }
      `;
      expect(detectTopLevelAwait(code)).toBe(false);
    });
  });

  describe('wrapTopLevelAwait', () => {
    it('wraps a bare top-level await in an async IIFE', () => {
      const code = 'const data = await fetch("/api");';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toMatch(/\(async\s+function\s*\(\)/);
      expect(wrapped).toContain('await fetch');
    });

    it('includes try/catch error handling around the IIFE body', () => {
      const code = 'await doSomething();';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toContain('try {');
      expect(wrapped).toContain('catch (e)');
      expect(wrapped).toContain('Top-level await error');
    });

    it('preserves named binding via let-hoist + export specifier (T6 a)', () => {
      const code = `export const x = await fetch('/x');`;
      const wrapped = wrapTopLevelAwait(code);

      // `x` is hoisted as `let x;` so the export specifier finds it.
      expect(wrapped).toMatch(/\blet\s+x\b/);
      // The export survives — esbuild needs to see it for bundling.
      expect(wrapped).toMatch(/export\s*\{\s*x\s*\}/);
      // The await initializer is moved into the IIFE.
      expect(wrapped).toContain('await fetch');
      expect(wrapped).toMatch(/x\s*=\s*await\s+fetch/);
    });

    it('preserves default export through a synthetic binding (T6 b)', () => {
      const code = `export default await import('y');`;
      const wrapped = wrapTopLevelAwait(code);

      // A synthetic binding is hoisted as `let __revampTlaDefault…;`.
      expect(wrapped).toMatch(/let\s+__revampTlaDefault/);
      // And re-exported as default.
      expect(wrapped).toMatch(/export\s+default\s+__revampTlaDefault/);
      // The await initializer landed in the IIFE.
      expect(wrapped).toContain('await import');
    });

    it('keeps re-exports at top level alongside TLA bindings (T6 c)', () => {
      const code = `
        export { foo } from 'mod';
        export const x = await fetch('/x');
        export { bar } from 'other';
      `;
      const wrapped = wrapTopLevelAwait(code);

      // Re-exports must survive untouched so esbuild can resolve them.
      expect(wrapped).toMatch(/export\s*\{\s*foo\s*\}\s*from\s*["']mod["']/);
      expect(wrapped).toMatch(/export\s*\{\s*bar\s*\}\s*from\s*["']other["']/);
      // The TLA binding still gets the let-hoist + named export treatment.
      expect(wrapped).toMatch(/\blet\s+x\b/);
      expect(wrapped).toMatch(/export\s*\{\s*x\s*\}/);
    });

    it('produces parseable JS that round-trips through Babel', async () => {
      const code = `
        import dep from './dep.js';
        export const x = await fetch('/x');
        export default await import('y');
        export { foo } from 'mod';
        const local = await Promise.resolve(1);
        console.log(local);
      `;
      const wrapped = wrapTopLevelAwait(code);

      const babel = await import('@babel/core');
      expect(() =>
        babel.parseSync(wrapped, { sourceType: 'module', babelrc: false, configFile: false }),
      ).not.toThrow();
    });

    it('handles code without exports by wrapping in async IIFE', () => {
      const code = 'const result = await fetchData();\nconsole.log(result);';
      const wrapped = wrapTopLevelAwait(code);

      expect(wrapped).toMatch(/\(async\s+function\s*\(\)/);
      expect(wrapped).toContain('await fetchData');
      // No bogus export gets emitted.
      expect(wrapped).not.toMatch(/^export/m);
    });

    // Regression tests for review round 1: prior to the fix, these export
    // shapes coexisting with TLA would be swept into the async IIFE, and Babel
    // would reject the output with "'import' and 'export' may only appear at
    // the top level". Each test asserts the output round-trips through Babel
    // AND that the export node still exists at the program top level.
    describe('regression: export shapes coexisting with TLA', () => {
      const parse = async (src: string): Promise<unknown> => {
        const babelMod = await import('@babel/core');
        return babelMod.parseSync(src, {
          sourceType: 'module',
          babelrc: false,
          configFile: false,
        });
      };

      const topLevelHasExport = (
        ast: unknown,
        predicate: (node: unknown) => boolean,
      ): boolean => {
        const root = ast as
          | { type?: string; program?: { body?: unknown[] } }
          | null
          | undefined;
        if (!root || root.type !== 'File') return false;
        const body = root.program?.body;
        if (!Array.isArray(body)) return false;
        return body.some(predicate);
      };

      it('keeps `export default function` at top level when TLA is present', async () => {
        const code = `
          const data = await fetch('/api');
          export default function foo() { return data; }
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        // The export still exists at the top level (not buried in the IIFE).
        const found = topLevelHasExport(ast, (n) => {
          const node = n as { type?: string; declaration?: { type?: string } };
          return (
            node.type === 'ExportDefaultDeclaration' &&
            node.declaration?.type === 'FunctionDeclaration'
          );
        });
        expect(found).toBe(true);
        // The TLA initializer landed somewhere — function/class declarations
        // never touched the IIFE.
        expect(wrapped).toContain('await fetch');
      });

      it('keeps `export default class` at top level when TLA is present', async () => {
        const code = `
          const data = await fetch('/api');
          export default class Foo { constructor() { this.data = data; } }
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        const found = topLevelHasExport(ast, (n) => {
          const node = n as { type?: string; declaration?: { type?: string } };
          return (
            node.type === 'ExportDefaultDeclaration' &&
            node.declaration?.type === 'ClassDeclaration'
          );
        });
        expect(found).toBe(true);
        expect(wrapped).toContain('await fetch');
      });

      it('keeps specifier-only `export { helper }` at top level when TLA is present', async () => {
        const code = `
          function helper() { return 1; }
          const x = await Promise.resolve(1);
          export { helper };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        const found = topLevelHasExport(ast, (n) => {
          const node = n as {
            type?: string;
            declaration?: unknown;
            source?: unknown;
            specifiers?: { exported?: { name?: string } }[];
          };
          return (
            node.type === 'ExportNamedDeclaration' &&
            !node.declaration &&
            !node.source &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some((s) => s.exported?.name === 'helper')
          );
        });
        expect(found).toBe(true);
      });

      it('keeps aliased `export { foo as bar }` at top level when TLA is present', async () => {
        const code = `
          function foo() { return 1; }
          const x = await Promise.resolve(1);
          export { foo as bar };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        const found = topLevelHasExport(ast, (n) => {
          const node = n as {
            type?: string;
            declaration?: unknown;
            source?: unknown;
            specifiers?: {
              local?: { name?: string };
              exported?: { name?: string };
            }[];
          };
          return (
            node.type === 'ExportNamedDeclaration' &&
            !node.declaration &&
            !node.source &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some(
              (s) => s.local?.name === 'foo' && s.exported?.name === 'bar',
            )
          );
        });
        expect(found).toBe(true);
      });

      it('keeps `export * from "mod"` at top level when TLA is present', async () => {
        const code = `
          const x = await Promise.resolve(1);
          export * from 'mod';
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        const found = topLevelHasExport(ast, (n) => {
          const node = n as {
            type?: string;
            source?: { value?: string };
            exported?: unknown;
          };
          return (
            node.type === 'ExportAllDeclaration' &&
            node.source?.value === 'mod' &&
            !node.exported
          );
        });
        expect(found).toBe(true);
      });

      it('keeps `export * as ns from "mod"` at top level when TLA is present', async () => {
        const code = `
          const x = await Promise.resolve(1);
          export * as ns from 'mod';
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(ast).not.toBeNull();
        // Babel emits this as ExportNamedDeclaration with an
        // ExportNamespaceSpecifier (rather than ExportAllDeclaration with
        // `exported`), so we accept either shape.
        const found = topLevelHasExport(ast, (n) => {
          const node = n as {
            type?: string;
            source?: { value?: string };
            exported?: { name?: string };
            specifiers?: { type?: string; exported?: { name?: string } }[];
          };
          if (node.source?.value !== 'mod') return false;
          if (
            node.type === 'ExportAllDeclaration' &&
            node.exported?.name === 'ns'
          ) {
            return true;
          }
          if (
            node.type === 'ExportNamedDeclaration' &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some(
              (s) =>
                s.type === 'ExportNamespaceSpecifier' &&
                s.exported?.name === 'ns',
            )
          ) {
            return true;
          }
          return false;
        });
        expect(found).toBe(true);
      });
    });

    // Regression tests for review round 2: classes are TDZ-bound and must
    // NOT be hoisted out of the IIFE (would break `extends` and static
    // field references to TLA-initialized bindings). Specifier-only exports
    // referencing non-function locals (`let x = 1; export { x as default }`)
    // must hoist the local as `let` at top level so esbuild can resolve it.
    describe('regression: round 2 — class TDZ + specifier-only export locals', () => {
      const parse = async (src: string): Promise<unknown> => {
        const babelMod = await import('@babel/core');
        return babelMod.parseSync(src, {
          sourceType: 'module',
          babelrc: false,
          configFile: false,
        });
      };

      type ProgramNode = {
        type?: string;
        program?: { body?: unknown[] };
      };

      const getTopLevelBody = (ast: unknown): unknown[] => {
        const root = ast as ProgramNode | null | undefined;
        if (!root || root.type !== 'File') return [];
        const body = root.program?.body;
        return Array.isArray(body) ? body : [];
      };

      const findTopLevelClass = (ast: unknown, name: string): boolean =>
        getTopLevelBody(ast).some((n) => {
          const node = n as { type?: string; id?: { name?: string } };
          return node.type === 'ClassDeclaration' && node.id?.name === name;
        });

      const findTopLevelFunction = (ast: unknown, name: string): boolean =>
        getTopLevelBody(ast).some((n) => {
          const node = n as { type?: string; id?: { name?: string } };
          return node.type === 'FunctionDeclaration' && node.id?.name === name;
        });

      const findTopLevelLet = (ast: unknown, name: string): boolean =>
        getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            kind?: string;
            declarations?: { id?: { name?: string } }[];
          };
          return (
            node.type === 'VariableDeclaration' &&
            node.kind === 'let' &&
            Array.isArray(node.declarations) &&
            node.declarations.some((d) => d.id?.name === name)
          );
        });

      it('hoists `let` referenced by specifier-only export so esbuild can resolve it (P0-B)', async () => {
        // `let x = 1; const y = await Promise.resolve(2); export { x as default };`
        // Before the fix: `let x = 1` was swept into the IIFE, leaving the
        // top-level `export { x as default }` with no binding to resolve.
        const code = `
          let x = 1;
          const y = await Promise.resolve(2);
          export { x as default };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        // `x` must be hoisted as `let x;` at top level.
        expect(findTopLevelLet(ast, 'x')).toBe(true);
        // The specifier-only export survives at top level.
        const hasExport = getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            declaration?: unknown;
            source?: unknown;
            specifiers?: {
              local?: { name?: string };
              exported?: { name?: string };
            }[];
          };
          return (
            node.type === 'ExportNamedDeclaration' &&
            !node.declaration &&
            !node.source &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some(
              (s) => s.local?.name === 'x' && s.exported?.name === 'default',
            )
          );
        });
        expect(hasExport).toBe(true);
        // The initializer `x = 1` lands inside the IIFE as an assignment so
        // execution order matches the original module.
        expect(wrapped).toMatch(/x\s*=\s*1\b/);
      });

      it('keeps subclass with TLA `extends` clause INSIDE the IIFE (P0-A class TDZ)', async () => {
        // `class Sub extends (await Promise.resolve(class {})) {}` — the
        // extends expression contains TLA so this whole thing must stay in
        // the IIFE. Even without explicit await in extends, a class that
        // could reference TLA-initialized bindings must not be hoisted.
        const code = `
          const Base = await Promise.resolve(class {});
          class Sub extends Base {}
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        // `Sub` must NOT appear at the top level — it would throw
        // ReferenceError because `Base` is initialized inside the IIFE.
        expect(findTopLevelClass(ast, 'Sub')).toBe(false);
        // The class lives inside the IIFE body.
        expect(wrapped).toMatch(/class\s+Sub\s+extends\s+Base/);
      });

      it('keeps class with static-field reference to TLA binding INSIDE the IIFE (P0-A)', async () => {
        // `class Foo { static bar = before; }` where `const before = await ...`
        // — the static initializer runs at class declaration time and would
        // throw ReferenceError if `Foo` is hoisted out of the IIFE.
        const code = `
          const before = await Promise.resolve(42);
          class Foo { static bar = before; }
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelClass(ast, 'Foo')).toBe(false);
        expect(wrapped).toContain('class Foo');
      });

      it('keeps function declarations at top level (functions are hoisted)', async () => {
        // Functions ARE hoisted in spec — moving them to top level is sound.
        const code = `
          function fnDecl() { return 1; }
          const x = await Promise.resolve(1);
          fnDecl();
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelFunction(ast, 'fnDecl')).toBe(true);
      });

      it('preserves `export default 42` (literal default) alongside TLA elsewhere', async () => {
        // The literal `42` is wrapped in a synthetic binding and re-exported
        // as default. This was working before; this test guards it.
        const code = `
          const x = await Promise.resolve(1);
          export default 42;
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        // The default export node still exists at the top level.
        const hasDefault = getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            declaration?: { type?: string; name?: string };
          };
          return (
            node.type === 'ExportDefaultDeclaration' &&
            node.declaration?.type === 'Identifier' &&
            typeof node.declaration?.name === 'string' &&
            node.declaration.name.startsWith('__revampTlaDefault')
          );
        });
        expect(hasDefault).toBe(true);
        // The literal `42` lands in the IIFE as an assignment.
        expect(wrapped).toMatch(/__revampTlaDefault\d*\s*=\s*42/);
      });

      it('hoists class to top level when referenced by specifier-only export (P0-B class)', async () => {
        // `class someClass {}; const y = await ...; export { someClass };`
        // — esbuild needs `someClass` at the top level to resolve the
        // export. Generic class declarations stay in the IIFE; only those
        // referenced by specifier-only export get top-level hoisting.
        const code = `
          class someClass {}
          const y = await Promise.resolve(1);
          export { someClass };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelClass(ast, 'someClass')).toBe(true);
        // The export specifier itself is at the top level.
        const hasExport = getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            declaration?: unknown;
            source?: unknown;
            specifiers?: { local?: { name?: string } }[];
          };
          return (
            node.type === 'ExportNamedDeclaration' &&
            !node.declaration &&
            !node.source &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some((s) => s.local?.name === 'someClass')
          );
        });
        expect(hasExport).toBe(true);
      });
    });

    // T35: `for await` is a ForOfStatement with `await: true`. Classic
    // `for-of` cannot consume an async iterator, so the whole statement
    // must move into the async IIFE.
    describe('regression: T35 — `for await` moves into the IIFE', () => {
      const parse = async (src: string): Promise<unknown> => {
        const babelMod = await import('@babel/core');
        return babelMod.parseSync(src, {
          sourceType: 'module',
          babelrc: false,
          configFile: false,
        });
      };

      const findTopLevelForAwait = (ast: unknown): boolean => {
        const root = ast as
          | { type?: string; program?: { body?: unknown[] } }
          | null
          | undefined;
        if (!root || root.type !== 'File') return false;
        const body = root.program?.body;
        if (!Array.isArray(body)) return false;
        return body.some((n) => {
          const node = n as { type?: string; await?: boolean };
          return node.type === 'ForOfStatement' && node.await === true;
        });
      };

      it('moves a top-level `for await` into the async IIFE', async () => {
        const code = 'for await (const x of asyncIter()) { console.log(x); }';
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelForAwait(ast)).toBe(false);
        expect(wrapped).toMatch(/for\s+await\s*\(/);
        expect(wrapped).toMatch(/\(async\s+function\s*\(\)/);
      });
    });

    // T36: a class hoisted to top level by a specifier-only export must
    // stay INSIDE the IIFE if its extends clause / decorators / static
    // initializers reference any IIFE-bound binding. Otherwise the class
    // body evaluates at top-level time when those bindings are still
    // unassigned (`undefined` for `let`-hoisted exports) or undeclared
    // (ReferenceError for IIFE-private locals).
    describe('regression: T36 — class with IIFE-bound dependency', () => {
      const parse = async (src: string): Promise<unknown> => {
        const babelMod = await import('@babel/core');
        return babelMod.parseSync(src, {
          sourceType: 'module',
          babelrc: false,
          configFile: false,
        });
      };

      type ProgramNode = {
        type?: string;
        program?: { body?: unknown[] };
      };

      const getTopLevelBody = (ast: unknown): unknown[] => {
        const root = ast as ProgramNode | null | undefined;
        if (!root || root.type !== 'File') return [];
        const body = root.program?.body;
        return Array.isArray(body) ? body : [];
      };

      const findTopLevelClass = (ast: unknown, name: string): boolean =>
        getTopLevelBody(ast).some((n) => {
          const node = n as { type?: string; id?: { name?: string } };
          return node.type === 'ClassDeclaration' && node.id?.name === name;
        });

      const findTopLevelLet = (ast: unknown, name: string): boolean =>
        getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            kind?: string;
            declarations?: { id?: { name?: string } }[];
          };
          return (
            node.type === 'VariableDeclaration' &&
            node.kind === 'let' &&
            Array.isArray(node.declarations) &&
            node.declarations.some((d) => d.id?.name === name)
          );
        });

      it('hoist-and-assigns when superClass is an IIFE-bound binding', async () => {
        const code = `
          const Base = await getBase();
          class Foo extends Base {}
          export { Foo };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelLet(ast, 'Foo')).toBe(true);
        expect(findTopLevelClass(ast, 'Foo')).toBe(false);
        expect(wrapped).toMatch(/Foo\s*=\s*class\s+extends\s+Base/);
        expect(wrapped).toMatch(/Base\s*=\s*await\s+getBase/);
        const hasExport = getTopLevelBody(ast).some((n) => {
          const node = n as {
            type?: string;
            declaration?: unknown;
            source?: unknown;
            specifiers?: { local?: { name?: string } }[];
          };
          return (
            node.type === 'ExportNamedDeclaration' &&
            !node.declaration &&
            !node.source &&
            Array.isArray(node.specifiers) &&
            node.specifiers.some((s) => s.local?.name === 'Foo')
          );
        });
        expect(hasExport).toBe(true);
      });

      it('leaves class at top level when superClass is an import', async () => {
        const code = `
          import { Base } from './x';
          const y = await Promise.resolve(1);
          class Foo extends Base {}
          export { Foo };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelClass(ast, 'Foo')).toBe(true);
        expect(findTopLevelLet(ast, 'Foo')).toBe(false);
      });

      it('hoist-and-assigns when a static initializer references an IIFE binding', async () => {
        const code = `
          const PRE = await pre();
          class Foo { static x = PRE; }
          export { Foo };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelClass(ast, 'Foo')).toBe(false);
        expect(findTopLevelLet(ast, 'Foo')).toBe(true);
        expect(wrapped).toMatch(/Foo\s*=\s*class/);
        expect(wrapped).toContain('static x = PRE');
      });

      it('leaves class at top level when superClass is a global', async () => {
        const code = `
          class Foo extends Promise {}
          const x = await Promise.resolve(1);
          export { Foo };
        `;
        const wrapped = wrapTopLevelAwait(code);

        const ast = await parse(wrapped);
        expect(findTopLevelClass(ast, 'Foo')).toBe(true);
        expect(findTopLevelLet(ast, 'Foo')).toBe(false);
      });
    });
  });
});
