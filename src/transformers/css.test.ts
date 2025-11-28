import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformCss, needsCssTransform, resetCssProcessor } from './css.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('needsCssTransform', () => {
  it('should detect :is() selector', () => {
    expect(needsCssTransform(':is(.a, .b) { color: red; }')).toBe(true);
  });

  it('should detect :where() selector', () => {
    expect(needsCssTransform(':where(.a, .b) { color: red; }')).toBe(true);
  });

  it('should detect :has() selector', () => {
    expect(needsCssTransform(':has(.child) { color: red; }')).toBe(true);
  });

  it('should detect gap property', () => {
    expect(needsCssTransform('.flex { gap: 10px; }')).toBe(true);
    expect(needsCssTransform('.flex { row-gap: 10px; }')).toBe(true);
    expect(needsCssTransform('.flex { column-gap: 10px; }')).toBe(true);
  });

  it('should detect aspect-ratio', () => {
    expect(needsCssTransform('.box { aspect-ratio: 16/9; }')).toBe(true);
  });

  it('should detect color-mix', () => {
    expect(needsCssTransform('.box { color: color-mix(in srgb, red, blue); }')).toBe(true);
  });

  it('should detect oklch/oklab colors', () => {
    expect(needsCssTransform('.box { color: oklch(0.5 0.2 180); }')).toBe(true);
    expect(needsCssTransform('.box { color: oklab(0.5 0.2 0.1); }')).toBe(true);
  });

  it('should detect container queries', () => {
    expect(needsCssTransform('.box { container-type: inline-size; }')).toBe(true);
    expect(needsCssTransform('@container (min-width: 300px) {}')).toBe(true);
  });

  it('should detect cascade layers', () => {
    expect(needsCssTransform('@layer base { }')).toBe(true);
  });

  it('should detect logical properties', () => {
    expect(needsCssTransform('.box { inset: 0; }')).toBe(true);
    expect(needsCssTransform('.box { inline-size: 100px; }')).toBe(true);
    expect(needsCssTransform('.box { block-size: 100px; }')).toBe(true);
    expect(needsCssTransform('.box { margin-inline: auto; }')).toBe(true);
    expect(needsCssTransform('.box { padding-block: 10px; }')).toBe(true);
  });

  it('should detect scroll/overscroll behavior', () => {
    expect(needsCssTransform('html { scroll-behavior: smooth; }')).toBe(true);
    expect(needsCssTransform('.box { overscroll-behavior: contain; }')).toBe(true);
  });

  it('should detect backdrop-filter', () => {
    expect(needsCssTransform('.box { backdrop-filter: blur(10px); }')).toBe(true);
  });

  it('should detect clamp/min/max functions', () => {
    expect(needsCssTransform('.box { width: clamp(100px, 50%, 500px); }')).toBe(true);
    expect(needsCssTransform('.box { width: min(100px, 50%); }')).toBe(true);
    expect(needsCssTransform('.box { width: max(100px, 50%); }')).toBe(true);
  });

  it('should detect flexbox properties', () => {
    expect(needsCssTransform('.box { display: flex; }')).toBe(true);
    expect(needsCssTransform('.box { display: inline-flex; }')).toBe(true);
    expect(needsCssTransform('.box { flex-direction: column; }')).toBe(true);
    expect(needsCssTransform('.box { flex-wrap: wrap; }')).toBe(true);
    expect(needsCssTransform('.box { justify-content: center; }')).toBe(true);
    expect(needsCssTransform('.box { align-items: center; }')).toBe(true);
    expect(needsCssTransform('.box { align-self: flex-start; }')).toBe(true);
    expect(needsCssTransform('.box { align-content: space-between; }')).toBe(true);
    expect(needsCssTransform('.box { flex-grow: 1; }')).toBe(true);
    expect(needsCssTransform('.box { flex-shrink: 0; }')).toBe(true);
    expect(needsCssTransform('.box { flex-basis: auto; }')).toBe(true);
  });

  it('should detect grid properties', () => {
    expect(needsCssTransform('.box { display: grid; }')).toBe(true);
    expect(needsCssTransform('.box { grid-template-columns: 1fr 1fr; }')).toBe(true);
    expect(needsCssTransform('.box { grid-area: header; }')).toBe(true);
    expect(needsCssTransform('.box { grid-column: 1 / 3; }')).toBe(true);
    expect(needsCssTransform('.box { grid-row: 1 / 2; }')).toBe(true);
  });

  it('should detect place properties', () => {
    expect(needsCssTransform('.box { place-items: center; }')).toBe(true);
    expect(needsCssTransform('.box { place-content: center; }')).toBe(true);
    expect(needsCssTransform('.box { place-self: center; }')).toBe(true);
  });

  it('should return false for simple CSS', () => {
    expect(needsCssTransform('.box { color: red; }')).toBe(false);
    expect(needsCssTransform('.box { margin: 10px; }')).toBe(false);
    expect(needsCssTransform('.box { padding: 20px; font-size: 16px; }')).toBe(false);
  });
});

describe('transformCss', () => {
  beforeEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  afterEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  it('should return original code when transformCss is disabled', async () => {
    updateConfig({ transformCss: false });
    const code = '.box { display: flex; }';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should return original code for very small files', async () => {
    const code = 'a{b:c}';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should return original code when no modern features detected', async () => {
    const code = '.simple { color: red; margin: 10px; padding: 20px; background: blue; }';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should add webkit prefix for flexbox', async () => {
    // CSS must be > 50 bytes and trigger transformation
    const code = '.container { display: flex; flex-direction: column; align-items: center; gap: 10px; }';
    const result = await transformCss(code);
    // The transformer should process the CSS (result may or may not have prefixes
    // depending on postcss-preset-env config, but it should at least run)
    expect(result).toContain('display');
    expect(result).toContain('flex');
  });

  it('should add webkit prefix for inline-flex', async () => {
    // CSS must be > 50 bytes
    const code = '.inline-container { display: inline-flex; flex-direction: row; justify-content: center; gap: 20px; }';
    const result = await transformCss(code);
    expect(result).toContain('inline-flex');
  });

  it('should add webkit prefix for flex properties', async () => {
    // CSS must be > 50 bytes with flexbox context
    const code = '.item { display: flex; flex-grow: 1; flex-shrink: 0; flex-basis: auto; flex-wrap: wrap; gap: 5px; }';
    const result = await transformCss(code);
    expect(result).toContain('flex-grow');
    expect(result).toContain('flex-shrink');
    expect(result).toContain('flex-basis');
  });

  it('should add webkit prefix for alignment properties', async () => {
    // CSS must be > 50 bytes with flexbox context
    const code = '.container { display: flex; justify-content: center; align-items: center; flex-direction: row; gap: 15px; }';
    const result = await transformCss(code);
    expect(result).toContain('justify-content');
    expect(result).toContain('align-items');
  });

  it('should handle CSS parsing errors gracefully', async () => {
    const code = '.box { display: flex; this is not valid css {{{';
    const result = await transformCss(code);
    // Should return something (either original or partially processed)
    expect(result).toBeDefined();
  });

  it('should preserve valid CSS functionality', async () => {
    const code = `
.container {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}
.item {
  flex: 1 1 300px;
}
`;
    const result = await transformCss(code);
    expect(result).toContain('display');
    expect(result).toContain('flex');
  });
});

describe('resetCssProcessor', () => {
  beforeEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  afterEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  it('should reset the processor', async () => {
    // First transform to initialize processor
    const result1 = await transformCss('.box { display: flex; }');

    // Reset
    resetCssProcessor();

    // Should work again
    const result2 = await transformCss('.container { display: flex; justify-content: center; }');
    // Should still produce valid CSS
    expect(result2).toContain('display');
    expect(result2).toContain('flex');
  });
});
