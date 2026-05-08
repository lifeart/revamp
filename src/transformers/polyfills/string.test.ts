/**
 * Tests for string polyfills (Safari 9).
 *
 * We exercise the polyfills inside a fresh vm sandbox where the relevant
 * String.prototype methods are deleted, so the polyfill's `if (!…)` guards
 * actually install our implementation.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { stringPolyfill } from './string.js';

interface StringSandbox {
  String: StringConstructor;
  result?: unknown;
}

function makeSandbox(): vm.Context {
  const sandbox: StringSandbox = { String };
  const ctx = vm.createContext(sandbox);

  // Remove the methods we polyfill so the polyfill installs its versions.
  vm.runInContext(
    `
    delete String.prototype.includes;
    delete String.prototype.startsWith;
    delete String.prototype.endsWith;
    delete String.prototype.repeat;
    delete String.prototype.padStart;
    delete String.prototype.padEnd;
    delete String.prototype.trimStart;
    delete String.prototype.trimEnd;
    delete String.prototype.replaceAll;
    delete String.prototype.matchAll;
    delete String.prototype.trimLeft;
    delete String.prototype.trimRight;
    `,
    ctx,
  );

  vm.runInContext(stringPolyfill, ctx);
  return ctx;
}

describe('stringPolyfill', () => {
  describe('replaceAll', () => {
    it('replaces all occurrences of a string', () => {
      const ctx = makeSandbox();
      vm.runInContext(`this.result = 'a-b-c-b'.replaceAll('b', 'X');`, ctx);
      expect((ctx as unknown as StringSandbox).result).toBe('a-X-c-X');
    });

    it('replaces with an empty search inserting between code units', () => {
      const ctx = makeSandbox();
      vm.runInContext(`this.result = 'abc'.replaceAll('', '-');`, ctx);
      expect((ctx as unknown as StringSandbox).result).toBe('-a-b-c-');
    });

    it('throws TypeError when given a non-global RegExp', () => {
      const ctx = makeSandbox();
      vm.runInContext(
        `try { 'abc'.replaceAll(/b/, 'X'); this.errName = null; this.errMessage = null; } catch (e) { this.errName = e.constructor.name; this.errMessage = e.message; }`,
        ctx,
      );
      const sandbox = ctx as unknown as { errName: string | null; errMessage: string | null };
      expect(sandbox.errName).toBe('TypeError');
      expect(sandbox.errMessage).toContain('non-global RegExp');
    });

    it('accepts a global RegExp', () => {
      const ctx = makeSandbox();
      vm.runInContext(`this.result = 'a1b2c3'.replaceAll(/\\d/g, '#');`, ctx);
      expect((ctx as unknown as StringSandbox).result).toBe('a#b#c#');
    });

    it('supports a function replacement', () => {
      const ctx = makeSandbox();
      vm.runInContext(
        `this.result = 'aaa'.replaceAll('a', function(m, i) { return String(i); });`,
        ctx,
      );
      expect((ctx as unknown as StringSandbox).result).toBe('012');
    });

    it('supports $& backreference in string replacement', () => {
      const ctx = makeSandbox();
      vm.runInContext(`this.result = 'abc'.replaceAll('b', '[$&]');`, ctx);
      expect((ctx as unknown as StringSandbox).result).toBe('a[b]c');
    });
  });

  describe('matchAll', () => {
    it('returns an iterator yielding match arrays', () => {
      const ctx = makeSandbox();
      vm.runInContext(
        `
        var it = 'a1 b22 c333'.matchAll(/[a-z](\\d+)/g);
        var collected = [];
        var step = it.next();
        while (!step.done) {
          collected.push([step.value[0], step.value[1], step.value.index]);
          step = it.next();
        }
        this.result = collected;
        `,
        ctx,
      );
      expect((ctx as unknown as StringSandbox).result).toEqual([
        ['a1', '1', 0],
        ['b22', '22', 3],
        ['c333', '333', 7],
      ]);
    });

    it('throws TypeError on non-global RegExp', () => {
      const ctx = makeSandbox();
      vm.runInContext(
        `try { 'abc'.matchAll(/a/); this.errName = null; this.errMessage = null; } catch (e) { this.errName = e.constructor.name; this.errMessage = e.message; }`,
        ctx,
      );
      const sandbox = ctx as unknown as { errName: string | null; errMessage: string | null };
      expect(sandbox.errName).toBe('TypeError');
      expect(sandbox.errMessage).toContain('non-global RegExp');
    });

    it('promotes a string argument to a global regex', () => {
      const ctx = makeSandbox();
      vm.runInContext(
        `
        var it = 'aaa'.matchAll('a');
        var n = 0; var step = it.next();
        while (!step.done) { n++; step = it.next(); }
        this.result = n;
        `,
        ctx,
      );
      expect((ctx as unknown as StringSandbox).result).toBe(3);
    });
  });
});
