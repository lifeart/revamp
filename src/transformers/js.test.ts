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
    // Note: const needs transformation for Safari 9
    expect(needsJsTransform('var arr = [1, 2, 3];')).toBe(false);
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

  it('should transform template literals for Safari 9 compatibility', async () => {
    // Template literals need to be transformed to string concatenation for Safari 9
    const code = `
      // This is a test file with template literals
      const name = 'World';
      const greeting = \`Hello, \${name}!\`;
      const multiline = \`Line 1
      Line 2\`;
      console.log(greeting);
    `;
    const result = await transformJs(code);
    // Template literals should be transformed to string concatenation
    expect(result).not.toContain('`');
    expect(result).toContain('concat');
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

  it('should preserve BigInt exponentiation operator', async () => {
    // BigInt exponentiation must NOT be transformed to Math.pow because Math.pow doesn't work with BigInt
    const code = `
      // This is a test file with BigInt exponentiation
      const bigValue = 10n ** 12n;
      const anotherBig = 2n ** 64n;
      console.log('BigInt result:', bigValue);
    `;
    const result = await transformJs(code);
    // Math.pow doesn't work with BigInt, so ** must be preserved
    expect(result).not.toContain('Math.pow(10n');
    expect(result).not.toContain('Math.pow(2n');
    // The ** operator should still be present (or code uses polyfill)
    expect(result).toContain('10n');
    expect(result).toContain('12n');
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

describe('RSC payload detection', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ transformJs: true });
  });

  afterEach(async () => {
    await shutdownWorkerPool();
    resetConfig();
  });

  it('should skip Next.js RSC payload with self.__next_f.push', async () => {
    const code = 'self.__next_f.push([1,"1a:[\\"$\\",\\"html\\",null]"])';
    const result = await transformJs(code);
    // Should return unchanged - no Babel transformation
    expect(result).toBe(code);
  });

  it('should skip Next.js RSC payload with self.__next_f initialization', async () => {
    const code = '(self.__next_f=self.__next_f||[]).push([0])';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should skip RSC wire format content', async () => {
    const code = '0:["$","html",null,{"lang":"en"}]\n1:["$","head",null,{}]';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should still transform regular JS with arrow functions', async () => {
    // Code must be > 100 bytes to trigger transformation
    const code = `
      const fn = () => console.log("hello");
      const fn2 = (a, b) => a + b;
      const obj = { method: () => this.value };
    `;
    const result = await transformJs(code);
    // Arrow function should be transformed for legacy browsers
    expect(result).toContain('function');
    expect(result).not.toContain('=>');
  });

  it('should skip React component boundary markers ($RC, $RS, $RX)', async () => {
    const code = '$RC("B:1","S:1")';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should skip $RS boundary marker', async () => {
    const code = '$RS("B:2","S:2")';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });

  it('should skip $RX error boundary marker', async () => {
    const code = '$RX("B:3","error message")';
    const result = await transformJs(code);
    expect(result).toBe(code);
  });
});

describe('transformJs with config parameter', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    resetConfig();
    await shutdownWorkerPool();
  });

  it('should use passed config instead of global config for transformJs', async () => {
    // Set global config to enable JS transformation
    updateConfig({ transformJs: true });

    // Code with arrow functions that would normally be transformed
    const code = `
      const fn = () => console.log("hello");
      const fn2 = (a, b) => a + b;
      const obj = { method: () => this.value };
    `;

    // Pass config with JS transformation disabled
    const configWithJsDisabled = {
      transformHtml: true,
      transformJs: false,
      transformCss: true,
      bundleEsModules: true,
      emulateServiceWorkers: true,
      remoteServiceWorkers: false,
      removeAds: true,
      removeTracking: true,
      injectPolyfills: true,
      spoofUserAgentInJs: true,
      targets: ['safari 9', 'ios 9'],
      socks5Port: 1080,
      httpProxyPort: 8080,
      captivePortalPort: 8888,
      bindAddress: '0.0.0.0',
      compressionLevel: 4,
      cacheEnabled: false,
      cacheTTL: 3600,
      cacheDir: './.revamp-cache',
      certDir: './.revamp-certs',
      caKeyFile: 'ca.key',
      caCertFile: 'ca.crt',
      whitelist: [],
      blacklist: [],
      adDomains: [],
      trackingDomains: [],
      trackingUrls: [],
      spoofUserAgent: false,
      logJsonRequests: false,
      jsonLogDir: './.revamp-json-logs',
    };

    const result = await transformJs(code, 'test.js', configWithJsDisabled);

    // Code should be returned unchanged when transformJs is disabled via passed config
    expect(result).toBe(code);
    // Arrow functions should NOT be transformed
    expect(result).toContain('=>');
  });

  it('should transform code when transformJs is enabled via passed config', async () => {
    // Set global config to disable JS transformation
    updateConfig({ transformJs: false });

    // Code with arrow functions
    const code = `
      const fn = () => console.log("hello");
      const fn2 = (a, b) => a + b;
      const obj = { method: () => this.value };
    `;

    // Pass config with JS transformation enabled
    const configWithJsEnabled = {
      transformHtml: true,
      transformJs: true,
      transformCss: true,
      bundleEsModules: true,
      emulateServiceWorkers: true,
      remoteServiceWorkers: false,
      removeAds: true,
      removeTracking: true,
      injectPolyfills: true,
      spoofUserAgentInJs: true,
      targets: ['safari 9', 'ios 9'],
      socks5Port: 1080,
      httpProxyPort: 8080,
      captivePortalPort: 8888,
      bindAddress: '0.0.0.0',
      compressionLevel: 4,
      cacheEnabled: false,
      cacheTTL: 3600,
      cacheDir: './.revamp-cache',
      certDir: './.revamp-certs',
      caKeyFile: 'ca.key',
      caCertFile: 'ca.crt',
      whitelist: [],
      blacklist: [],
      adDomains: [],
      trackingDomains: [],
      trackingUrls: [],
      spoofUserAgent: false,
      logJsonRequests: false,
      jsonLogDir: './.revamp-json-logs',
    };

    const result = await transformJs(code, 'test.js', configWithJsEnabled);

    // Arrow functions should be transformed for legacy browsers
    expect(result).toContain('function');
    expect(result).not.toContain('=>');
  });

  it('should fall back to global config when no config parameter is passed', async () => {
    // Set global config to disable JS transformation
    updateConfig({ transformJs: false });

    const code = `
      const fn = () => console.log("hello");
      const fn2 = (a, b) => a + b;
    `;

    // Call without config parameter - should use global config
    const result = await transformJs(code, 'test.js');

    // Code should be returned unchanged (global config has transformJs: false)
    expect(result).toBe(code);
    expect(result).toContain('=>');
  });
});
