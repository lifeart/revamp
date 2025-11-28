import { describe, it, expect, beforeEach } from 'vitest';
import {
  transformGridToFlexbox,
  hasGridProperties,
} from './css-grid-fallback.js';

describe('hasGridProperties', () => {
  it('should detect display: grid', () => {
    expect(hasGridProperties('.box { display: grid; }')).toBe(true);
    expect(hasGridProperties('.box { display:grid; }')).toBe(true);
    expect(hasGridProperties('.box { display: GRID; }')).toBe(true);
  });

  it('should detect display: inline-grid', () => {
    expect(hasGridProperties('.box { display: inline-grid; }')).toBe(true);
  });

  it('should detect grid-template properties', () => {
    expect(hasGridProperties('.box { grid-template-columns: 1fr 1fr; }')).toBe(true);
    expect(hasGridProperties('.box { grid-template-rows: auto 100px; }')).toBe(true);
    expect(hasGridProperties('.box { grid-template-areas: "a b"; }')).toBe(true);
  });

  it('should detect grid-column and grid-row', () => {
    expect(hasGridProperties('.box { grid-column: 1 / 3; }')).toBe(true);
    expect(hasGridProperties('.box { grid-row: 1 / 2; }')).toBe(true);
  });

  it('should detect grid-area', () => {
    expect(hasGridProperties('.box { grid-area: header; }')).toBe(true);
  });

  it('should detect grid-gap and gap', () => {
    expect(hasGridProperties('.box { grid-gap: 10px; }')).toBe(true);
    expect(hasGridProperties('.box { gap: 10px; }')).toBe(true);
  });

  it('should return false for non-grid CSS', () => {
    expect(hasGridProperties('.box { color: red; }')).toBe(false);
    expect(hasGridProperties('.box { display: flex; }')).toBe(false);
    expect(hasGridProperties('.box { margin: 10px; }')).toBe(false);
  });
});

describe('transformGridToFlexbox', () => {
  it('should add flexbox fallback for display: grid', () => {
    const css = '.container { display: grid; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('display: -webkit-flex');
    expect(result).toContain('display: flex');
    expect(result).toContain('flex-wrap: wrap');
    expect(result).toContain('-webkit-flex-wrap: wrap');
  });

  it('should add inline-flex fallback for display: inline-grid', () => {
    const css = '.container { display: inline-grid; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('display: -webkit-inline-flex');
    expect(result).toContain('display: inline-flex');
  });

  it('should add webkit prefix for align-items', () => {
    const css = '.container { display: grid; align-items: center; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('-webkit-align-items: center');
  });

  it('should convert justify-items to justify-content', () => {
    const css = '.container { display: grid; justify-items: center; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('justify-content: center');
    expect(result).toContain('-webkit-justify-content: center');
  });

  it('should convert justify-items: start to flex-start', () => {
    const css = '.container { display: grid; justify-items: start; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('justify-content: flex-start');
  });

  it('should convert justify-items: end to flex-end', () => {
    const css = '.container { display: grid; justify-items: end; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('justify-content: flex-end');
  });

  it('should handle place-items shorthand', () => {
    const css = '.container { display: grid; place-items: center start; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('align-items: center');
    expect(result).toContain('-webkit-align-items: center');
    expect(result).toContain('justify-content: start');
    expect(result).toContain('-webkit-justify-content: start');
  });

  it('should handle place-items with single value', () => {
    const css = '.container { display: grid; place-items: center; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('align-items: center');
    expect(result).toContain('-webkit-align-items: center');
  });

  it('should convert grid-column span to flex width', () => {
    const css = '.item { grid-column: span 6; }';
    const result = transformGridToFlexbox(css);
    // span 6 out of 12 columns = 50%
    expect(result).toContain('flex: 0 0 50.00%');
    expect(result).toContain('-webkit-flex: 0 0 50.00%');
  });

  it('should add webkit prefix for align-self', () => {
    const css = '.item { align-self: flex-end; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('-webkit-align-self: flex-end');
  });

  it('should convert justify-self: end to margin-left: auto', () => {
    const css = '.item { justify-self: end; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('margin-left: auto');
  });

  it('should convert justify-self: start to margin-right: auto', () => {
    const css = '.item { justify-self: start; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('margin-right: auto');
  });

  it('should convert justify-self: center to margin auto', () => {
    const css = '.item { justify-self: center; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('margin-left: auto');
    expect(result).toContain('margin-right: auto');
  });

  it('should convert justify-self: flex-end to margin-left: auto', () => {
    const css = '.item { justify-self: flex-end; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('margin-left: auto');
  });

  it('should convert justify-self: flex-start to margin-right: auto', () => {
    const css = '.item { justify-self: flex-start; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('margin-right: auto');
  });

  it('should add comment about Revamp fallback', () => {
    const css = '.container { display: grid; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('Revamp');
    expect(result).toContain('Flexbox fallback');
  });

  it('should preserve non-grid rules', () => {
    const css = `.header { color: red; } .container { display: grid; } .footer { color: blue; }`;
    const result = transformGridToFlexbox(css);
    expect(result).toContain('color: red');
    expect(result).toContain('color: blue');
    expect(result).toContain('display: flex');
  });

  it('should process CSS with grid-template-rows', () => {
    const css = `.container { display: grid; grid-template-rows: auto 100px 1fr; grid-template-columns: 1fr 1fr; }`;
    const result = transformGridToFlexbox(css);
    // grid-template-rows should be captured (coverage line 52) but grid layout preserved
    expect(result).toContain('grid-template-rows');
    expect(result).toContain('grid-template-columns');
    // Flexbox fallback should be added
    expect(result).toContain('display: flex');
  });
});
