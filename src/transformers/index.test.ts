/**
 * Transformers Index Module Tests
 * Tests for re-exported functions from transformer index
 */

import { describe, it, expect } from 'vitest';
import {
  transformJs,
  needsJsTransform,
  shutdownWorkerPool,
  prewarmWorkerPool,
  transformCss,
  needsCssTransform,
  resetCssProcessor,
  transformHtml,
  isHtmlDocument,
} from './index.js';

describe('transformers index', () => {
  describe('JS transformer exports', () => {
    it('should export transformJs function', () => {
      expect(typeof transformJs).toBe('function');
    });

    it('should export needsJsTransform function', () => {
      expect(typeof needsJsTransform).toBe('function');
    });

    it('should export shutdownWorkerPool function', () => {
      expect(typeof shutdownWorkerPool).toBe('function');
    });

    it('should export prewarmWorkerPool function', () => {
      expect(typeof prewarmWorkerPool).toBe('function');
    });
  });

  describe('CSS transformer exports', () => {
    it('should export transformCss function', () => {
      expect(typeof transformCss).toBe('function');
    });

    it('should export needsCssTransform function', () => {
      expect(typeof needsCssTransform).toBe('function');
    });

    it('should export resetCssProcessor function', () => {
      expect(typeof resetCssProcessor).toBe('function');
    });
  });

  describe('HTML transformer exports', () => {
    it('should export transformHtml function', () => {
      expect(typeof transformHtml).toBe('function');
    });

    it('should export isHtmlDocument function', () => {
      expect(typeof isHtmlDocument).toBe('function');
    });
  });

  describe('exported functions work correctly', () => {
    it('needsJsTransform should work', () => {
      const result = needsJsTransform('const x = 1;');
      expect(typeof result).toBe('boolean');
    });

    it('needsCssTransform should work', () => {
      const result = needsCssTransform('.test { display: flex; }');
      expect(typeof result).toBe('boolean');
    });

    it('isHtmlDocument should work', () => {
      expect(isHtmlDocument('<!DOCTYPE html>')).toBe(true);
      expect(isHtmlDocument('not html')).toBe(false);
    });
  });
});
