/**
 * Tests for the (intentionally absent) Symbol polyfill.
 *
 * The previous string-based fake corrupted iteration semantics, so we
 * deliberately ship no Symbol shim. After loading the polyfill bundle the
 * iPad's native Safari 9 absence of Symbol must be preserved.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { symbolPolyfill } from './symbol.js';

describe('symbol polyfill', () => {
  it('exports an empty string (no shim shipped)', () => {
    expect(symbolPolyfill).toBe('');
  });

  it('does not redefine Symbol when no native Symbol exists', () => {
    // Build a sandbox with no Symbol global, run the polyfill, then assert
    // typeof Symbol stays 'undefined' — matching the iOS 9 baseline.
    const sandbox: { Symbol?: unknown; typeofSymbol?: string } = {};
    const ctx = vm.createContext(sandbox);

    // Strip out the host-provided Symbol so we mirror Safari 9.
    vm.runInContext('this.Symbol = undefined; var Symbol;', ctx);

    vm.runInContext(symbolPolyfill, ctx);

    vm.runInContext('this.typeofSymbol = typeof Symbol;', ctx);
    expect(sandbox.typeofSymbol).toBe('undefined');
  });
});
