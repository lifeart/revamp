import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  needsJsTransform,
  transformJs,
  shutdownWorkerPool,
  prewarmWorkerPool,
} from './js.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('needsJsTransform', () => {
  it('should detect optional chaining', () => {
    expect(needsJsTransform('const x = obj?.foo;')).toBe(true);
    expect(needsJsTransform('const x = obj?.foo?.bar;')).toBe(true);
  });

  it('should detect nullish coalescing', () => {
    expect(needsJsTransform('const x = y ?? z;')).toBe(true);
  });

  it('should detect async generators', () => {
    expect(needsJsTransform('async function* gen() {}')).toBe(true);
  });

  it('should detect for-await-of', () => {
    expect(needsJsTransform('for await (const x of iter) {}')).toBe(true);
  });

  it('should detect private class fields', () => {
    expect(needsJsTransform('class Foo { #bar = 1; }')).toBe(true);
  });

  it('should detect static blocks', () => {
    expect(needsJsTransform('class Foo { static { this.x = 1; } }')).toBe(true);
  });

  it('should detect dynamic import', () => {
    expect(needsJsTransform("const m = import('./module.js')")).toBe(true);
  });

  it('should detect BigInt', () => {
    expect(needsJsTransform('const x = 123n;')).toBe(true);
    expect(needsJsTransform('const x = BigInt(123);')).toBe(true);
  });

  it('should detect Array.prototype.flat', () => {
    expect(needsJsTransform('arr.flat()')).toBe(false); // Not matched by exact pattern
    expect(needsJsTransform('Array.prototype.flat')).toBe(true);
  });

  it('should detect Object.fromEntries', () => {
    expect(needsJsTransform('Object.fromEntries(entries)')).toBe(true);
  });

  it('should detect String.prototype.matchAll', () => {
    expect(needsJsTransform('String.prototype.matchAll')).toBe(true);
  });

  it('should detect Promise.allSettled', () => {
    expect(needsJsTransform('Promise.allSettled(promises)')).toBe(true);
  });

  it('should detect globalThis', () => {
    expect(needsJsTransform('globalThis.foo = 1;')).toBe(true);
  });

  it('should return false for simple code', () => {
    expect(needsJsTransform('var x = 1;')).toBe(false);
    expect(needsJsTransform('function foo() { return 42; }')).toBe(false);
    expect(needsJsTransform('const arr = [1, 2, 3];')).toBe(false);
  });

  it('should handle spread operator detection', () => {
    // Spread at the start of identifer
    expect(needsJsTransform('const x = { ...obj };')).toBe(true);
  });
});

describe('transformJs', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    await shutdownWorkerPool();
    resetConfig();
  });

  it('should return original code when transformJs is disabled', async () => {
    updateConfig({ transformJs: false });
    const code = 'const x = obj?.foo ?? "default";';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should return original code for very small files', async () => {
    const code = 'x=1';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should return original code when no modern features detected', async () => {
    const code = 'function foo() { return 42; } console.log(foo());';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should transform optional chaining', async () => {
    // Need code > 100 bytes and with modern features
    const code = `
      // This is a test file with enough content to trigger transformation
      const config = { foo: { bar: { baz: 42 } } };
      const value = config?.foo?.bar?.baz;
      console.log('Result:', value);
    `;
    const result = await transformJs(code);
    expect(result).not.toContain('?.');
    expect(result).toContain('config');
  });

  it('should transform nullish coalescing', async () => {
    // Need code > 100 bytes and with modern features
    const code = `
      // This is a test file with enough content to trigger transformation
      const maybeNull = null;
      const defaultValue = 'fallback';
      const result = maybeNull ?? defaultValue;
      console.log('Result:', result);
    `;
    const result = await transformJs(code);
    expect(result).not.toContain('??');
  });

  it('should handle syntax errors gracefully', async () => {
    // Code has syntax error but is > 100 bytes
    const code = `
      // This is a test file with modern syntax that has errors
      const obj = { foo: { bar: 123 } };
      const value = obj?.foo;
      this is not valid javascript and should fail to parse{{{
    `;
    const result = await transformJs(code);
    // Should return original code on error
    expect(result).toContain('obj');
  });

  it('should handle non-ignorable babel errors', async () => {
    // Code that triggers a babel error that doesn't match ignorable patterns
    // Very deeply nested code can cause stack overflow-like errors
    const code = `
      // Code with enough content to pass threshold
      const x = obj?.foo?.bar?.baz;
      const y = value ?? defaultValue;
      ${Array(200).fill('((((').join('')}
      ${Array(200).fill(')))).foo').join('')}
    `;
    const result = await transformJs(code);
    // Should return original code on error
    expect(result).toContain('const x');
  });

  it('should preserve functionality of valid code', async () => {
    // Code must be > 100 bytes and contain modern features
    const code = `
      // This is a test file that should be transformed correctly
      const configuration = { debug: true, verbose: false };
      const isDebugMode = configuration?.debug ?? false;
      console.log('Debug mode enabled:', isDebugMode);
    `;
    const result = await transformJs(code);
    // Result should be valid JS that doesn't use modern features
    expect(result).not.toContain('??');
    expect(result).not.toContain('?.');
  });
});

describe('prewarmWorkerPool', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    await shutdownWorkerPool();
    resetConfig();
  });

  it('should not prewarm when transformJs is disabled', async () => {
    updateConfig({ transformJs: false });
    // Should complete without error
    await prewarmWorkerPool();
  });

  it('should prewarm when transformJs is enabled', async () => {
    updateConfig({ transformJs: true });
    // Should complete without error
    await prewarmWorkerPool();
  });
});

describe('shutdownWorkerPool', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    resetConfig();
  });

  it('should handle shutdown when pool is not initialized', async () => {
    // Should complete without error
    await shutdownWorkerPool();
  });

  it('should shutdown an active pool', async () => {
    // Initialize pool by running a transform
    const code = `
      const x = obj?.foo ?? 'default';
      console.log(x);
    `;
    await transformJs(code);

    // Shutdown should work
    await shutdownWorkerPool();

    // Should be able to transform again (pool re-initializes)
    const result = await transformJs(code);
    expect(result).toBeDefined();

    await shutdownWorkerPool();
  });
});
