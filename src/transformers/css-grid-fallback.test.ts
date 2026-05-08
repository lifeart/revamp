import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  transformGridToFlexbox,
  hasGridProperties,
  parseGridTemplateColumns,
  _resetGridFallbackWarningCache,
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

  it('should detect grid-gap (grid-only)', () => {
    expect(hasGridProperties('.box { grid-gap: 10px; }')).toBe(true);
    expect(hasGridProperties('.box { grid-row-gap: 10px; }')).toBe(true);
    expect(hasGridProperties('.box { grid-column-gap: 10px; }')).toBe(true);
  });

  it('should NOT treat standalone `gap` as grid', () => {
    // gap is shared with flexbox; on its own it does not indicate a grid.
    expect(hasGridProperties('.box { gap: 10px; }')).toBe(false);
    expect(hasGridProperties('.box { display: flex; gap: 8px; }')).toBe(false);
    expect(
      hasGridProperties('.box { display: flex; gap: 8px; flex-direction: row; }')
    ).toBe(false);
  });

  it('should return false for non-grid CSS', () => {
    expect(hasGridProperties('.box { color: red; }')).toBe(false);
    expect(hasGridProperties('.box { display: flex; }')).toBe(false);
    expect(hasGridProperties('.box { margin: 10px; }')).toBe(false);
  });
});

describe('parseGridTemplateColumns', () => {
  it('parses repeat(N, 1fr) into N equal columns', () => {
    const r = parseGridTemplateColumns('repeat(3, 1fr)');
    expect(r).not.toBeNull();
    expect(r!.columnCount).toBe(3);
    expect(r!.columnPercents.map((p) => p.toFixed(2))).toEqual([
      '33.33',
      '33.33',
      '33.33',
    ]);
  });

  it('parses an explicit fr-only list proportionally', () => {
    const r = parseGridTemplateColumns('1fr 2fr 1fr');
    expect(r).not.toBeNull();
    expect(r!.columnCount).toBe(3);
    expect(r!.columnPercents.map((p) => p.toFixed(2))).toEqual([
      '25.00',
      '50.00',
      '25.00',
    ]);
  });

  it('returns null for mixed fixed/fr lists', () => {
    expect(parseGridTemplateColumns('200px 1fr 200px')).toBeNull();
  });

  it('returns null for auto / minmax / named lines / areas', () => {
    expect(parseGridTemplateColumns('auto 1fr')).toBeNull();
    expect(parseGridTemplateColumns('minmax(100px, 1fr) 1fr')).toBeNull();
    expect(parseGridTemplateColumns('[start] 1fr [end]')).toBeNull();
    expect(parseGridTemplateColumns('repeat(auto-fill, 1fr)')).toBeNull();
    expect(parseGridTemplateColumns('repeat(3, 100px)')).toBeNull();
    expect(parseGridTemplateColumns('')).toBeNull();
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

  it('should convert grid-column span to flex width when document has a 12-column grid', () => {
    // Backward-compat path: if any rule in the same stylesheet declares
    // `repeat(12, 1fr)`, span N rules can opt into the legacy 12-column
    // assumption even when their parent isn't a structural prefix match.
    const css =
      '.grid { display: grid; grid-template-columns: repeat(12, 1fr); } .item { grid-column: span 6; }';
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

describe('transformGridToFlexbox — Batch I-2 (T5) shape parsing', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetGridFallbackWarningCache();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('translates `repeat(3, 1fr)` to a flexbox container', () => {
    const css =
      '.container { display: grid; grid-template-columns: repeat(3, 1fr); }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('display: flex');
    expect(result).toContain('display: -webkit-flex');
    expect(result).toContain('flex-wrap: wrap');
    // The shape must be recognized — no warning emitted.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('translates explicit fr-only list `1fr 2fr 1fr` to a flexbox container', () => {
    const css =
      '.container { display: grid; grid-template-columns: 1fr 2fr 1fr; }';
    const result = transformGridToFlexbox(css);
    expect(result).toContain('display: flex');
    expect(warnSpy).not.toHaveBeenCalled();

    // Sanity-check the parser produces the documented 25/50/25 split.
    const parsed = parseGridTemplateColumns('1fr 2fr 1fr');
    expect(parsed).not.toBeNull();
    expect(parsed!.columnPercents.map((p) => p.toFixed(2))).toEqual([
      '25.00',
      '50.00',
      '25.00',
    ]);
  });

  it('leaves `200px 1fr 200px` rules unchanged (mixed fixed/fr bails)', () => {
    const css =
      '.container { display: grid; grid-template-columns: 200px 1fr 200px; }';
    const result = transformGridToFlexbox(css);
    expect(result).not.toContain('display: flex');
    expect(result).not.toContain('-webkit-flex');
    expect(result).not.toContain('Revamp: Flexbox fallback');
    expect(warnSpy).toHaveBeenCalledWith(
      '[css-grid] unsupported grid shape, leaving rule unchanged:',
      '.container'
    );
  });

  it('leaves grid-template-areas rules unchanged (named areas bail)', () => {
    const css =
      `.container { display: grid; grid-template-areas: 'header header' 'main side'; }`;
    const result = transformGridToFlexbox(css);
    expect(result).not.toContain('display: flex');
    expect(result).not.toContain('-webkit-flex');
    expect(result).toContain('grid-template-areas');
  });

  it('leaves `display: flex; gap: 8px` unchanged (NOT a grid)', () => {
    const css = '.row { display: flex; gap: 8px; }';
    const result = transformGridToFlexbox(css);
    // No grid was detected — no extra display:flex prepended.
    const flexCount = (result.match(/display:\s*flex/g) ?? []).length;
    expect(flexCount).toBe(1);
    expect(result).not.toContain('-webkit-flex');
    expect(result).not.toContain('Revamp: Flexbox fallback');
  });

  it('leaves `display: flex; gap: 8px; flex-direction: row` unchanged', () => {
    const css = '.row { display: flex; gap: 8px; flex-direction: row; }';
    const result = transformGridToFlexbox(css);
    const flexCount = (result.match(/display:\s*flex/g) ?? []).length;
    expect(flexCount).toBe(1);
    expect(result).not.toContain('-webkit-flex');
  });

  it('translates parent + child when parent is repeat(12, 1fr) and child is span 6', () => {
    const css =
      '.parent { display: grid; grid-template-columns: repeat(12, 1fr); } ' +
      '.parent .child { grid-column: span 6; }';
    const result = transformGridToFlexbox(css);
    // Parent translated.
    expect(result).toContain('display: flex');
    expect(result).toContain('flex-wrap: wrap');
    // Child rewritten as 6/12 = 50%.
    expect(result).toContain('flex: 0 0 50.00%');
    expect(result).toContain('-webkit-flex: 0 0 50.00%');
  });

  it('leaves child span rules untouched when parent bailed (200px 1fr 200px)', () => {
    const css =
      '.parent { display: grid; grid-template-columns: 200px 1fr 200px; } ' +
      '.parent .child { grid-column: span 2; }';
    const result = transformGridToFlexbox(css);
    // Parent unchanged.
    expect(result).not.toContain('display: flex');
    expect(result).not.toContain('-webkit-flex');
    // Child unchanged.
    expect(result).not.toContain('flex: 0 0');
    // Both selectors should produce a warning.
    expect(warnSpy).toHaveBeenCalledWith(
      '[css-grid] unsupported grid shape, leaving rule unchanged:',
      '.parent'
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[css-grid] unsupported grid shape, leaving rule unchanged:',
      '.parent .child'
    );
  });

  it('dedupes warnings per selector across the same process invocation', () => {
    // Same selector encountered twice: one warning total (until cache reset).
    const css =
      '.bad { display: grid; grid-template-columns: 200px 1fr; } ' +
      '.bad { grid-template-columns: 200px 1fr; }';
    transformGridToFlexbox(css);
    const calls = warnSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === '[css-grid] unsupported grid shape, leaving rule unchanged:' && c[1] === '.bad'
    );
    expect(calls.length).toBe(1);
  });
});
