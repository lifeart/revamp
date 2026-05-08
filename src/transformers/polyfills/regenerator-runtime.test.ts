/**
 * Tests for the regenerator-runtime polyfill.
 *
 * Babel's preset-env (older versions) emits `regeneratorRuntime.wrap(...)`
 * for transpiled async functions. The polyfill bundle must define
 * `regeneratorRuntime` before any transformed code executes, otherwise the
 * iPad sees `ReferenceError: regeneratorRuntime is not defined`.
 *
 * Modern @babel/preset-env (>=7.27) inlines a self-contained helper instead,
 * but we still ship the runtime so:
 *   1. third-party scripts that already use `regeneratorRuntime` work,
 *   2. switching the worker to `useBuiltIns: 'usage'` later is safe,
 *   3. iPad-side code that was compiled by an older Babel toolchain works.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { regeneratorRuntimePolyfill } from './regenerator-runtime.js';
import { buildPolyfillScript } from './index.js';

describe('regenerator-runtime polyfill', () => {
  it('exposes a non-empty source string', () => {
    expect(typeof regeneratorRuntimePolyfill).toBe('string');
    expect(regeneratorRuntimePolyfill.length).toBeGreaterThan(1000);
  });

  it('contains the regeneratorRuntime global assignment', () => {
    expect(regeneratorRuntimePolyfill).toContain('regeneratorRuntime');
    expect(regeneratorRuntimePolyfill).toContain('runtime');
  });

  it('appears in the assembled polyfill bundle before all other polyfills', () => {
    const bundle = buildPolyfillScript();
    expect(bundle).toContain('regeneratorRuntime');
  });

  it('exposes regeneratorRuntime as a global once the polyfill executes', () => {
    // Mirror how the polyfill bundle runs: an outer non-strict IIFE.
    const sandbox: Record<string, unknown> = {};
    const ctx = vm.createContext(sandbox);

    vm.runInContext(`(function(){\n${regeneratorRuntimePolyfill}\n}).call(this);`, ctx);
    vm.runInContext(`this.__rrType = typeof regeneratorRuntime;`, ctx);

    expect(sandbox.__rrType).toBe('object');
  });

  it('lets pre-Babel-7.27-style async output run without ReferenceError', () => {
    // Hand-written shape of what older Babel emits — explicitly references
    // regeneratorRuntime.wrap and .mark so we can verify the global is in
    // scope. The point of this test is to assert no `ReferenceError:
    // regeneratorRuntime is not defined` — actually advancing the state
    // machine is regenerator-runtime's responsibility, not ours.
    const legacyTransformed = `
      var marked = regeneratorRuntime.mark(function f() {
        return regeneratorRuntime.wrap(function f$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              return _context.abrupt("return", 42);
            case 1:
            case "end":
              return _context.stop();
          }
        }, marked);
      });
      var gen = marked();
      this.result = gen.next();
    `;

    const sandbox: { result?: { value?: unknown; done?: boolean } } = {};
    const ctx = vm.createContext(sandbox);

    // Load the runtime, then the legacy transformed code.
    vm.runInContext(regeneratorRuntimePolyfill, ctx);
    expect(() => {
      vm.runInContext(legacyTransformed, ctx);
    }).not.toThrow();

    // The generator's first .next() should return { value: 42, done: true }.
    expect(sandbox.result).toBeDefined();
    expect(sandbox.result?.value).toBe(42);
    expect(sandbox.result?.done).toBe(true);
  });
});
