/**
 * CSS Grid to Flexbox Fallback
 * Transforms CSS Grid layouts to Flexbox for Safari 9 compatibility.
 *
 * Supported grid-template-columns shapes:
 *   - `repeat(N, 1fr)` → N equal-width flex children (100/N % each)
 *   - explicit fr-only list (e.g. `1fr 2fr 1fr`) → proportional widths
 *
 * Unsupported shapes (mixed fixed/fr, `auto`, `minmax()`, named lines/areas, etc.)
 * are left untouched and a one-off debug warning is emitted per unique rule
 * selector so misconfigured sites are visible without spamming logs.
 */

import postcss, { Root, Rule, Declaration } from 'postcss';

/**
 * Properties that are unambiguously grid-only. Standalone `gap` is intentionally
 * excluded — it is shared with flexbox and on its own does not indicate a grid.
 */
const GRID_ONLY_PROPERTIES: ReadonlyArray<string> = [
  'grid',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-area',
  'grid-row',
  'grid-column',
  'grid-row-start',
  'grid-row-end',
  'grid-column-start',
  'grid-column-end',
  'grid-gap',
  'grid-row-gap',
  'grid-column-gap',
];

const GRID_ONLY_PROPERTY_PATTERN = new RegExp(
  `(^|[^-a-z0-9])(${GRID_ONLY_PROPERTIES.map((p) =>
    p.replace(/-/g, '\\-')
  ).join('|')})\\s*:`,
  'i'
);

const DISPLAY_GRID_PATTERN = /display\s*:\s*(?:grid|inline-grid)\b/i;

/**
 * Dedup set for unsupported-shape warnings (one log per selector per process).
 */
const warnedSelectors = new Set<string>();

/**
 * Reset the dedup state. Exposed for tests so warnings can be re-asserted in
 * isolation. Not part of the public production API.
 */
export function _resetGridFallbackWarningCache(): void {
  warnedSelectors.clear();
}

/**
 * Result of attempting to translate a `grid-template-columns` value to a
 * proportional list of flex-basis percentages.
 */
interface ParsedColumns {
  /** Per-column flex-basis percentages, e.g. `[33.3333, 33.3333, 33.3333]`. */
  columnPercents: number[];
  /** Total column count (== columnPercents.length). */
  columnCount: number;
}

/**
 * Parse a `grid-template-columns` value into column percentages.
 *
 * Returns `null` if the shape is not supported (caller should bail out).
 *
 * Supported:
 *   - `repeat(N, 1fr)` where N is a positive integer
 *   - whitespace-separated list of `<number>fr` tokens (no other tokens allowed)
 *
 * Anything else — fixed lengths (`px`, `%`, `em`, ...), `auto`, `minmax(...)`,
 * named lines (`[name]`), grid-template-areas, mixed fr+fixed, or even nested
 * `repeat()` — returns `null`.
 */
export function parseGridTemplateColumns(value: string): ParsedColumns | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Reject named lines / areas anywhere in the value.
  if (/[\[\]"']/.test(trimmed)) {
    return null;
  }

  // Form 1: repeat(N, 1fr) — only the trivial 1fr case is supported.
  const repeatMatch = /^repeat\(\s*(\d+)\s*,\s*1fr\s*\)$/i.exec(trimmed);
  if (repeatMatch) {
    const n = parseInt(repeatMatch[1], 10);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    const each = 100 / n;
    return {
      columnPercents: Array.from({ length: n }, () => each),
      columnCount: n,
    };
  }

  // Form 2: list of fr-only tokens.
  // Reject anything that looks like a function call or a unit other than fr.
  if (/[()]/.test(trimmed)) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const frValues: number[] = [];
  for (const token of tokens) {
    const m = /^(\d+(?:\.\d+)?)fr$/i.exec(token);
    if (!m) {
      return null;
    }
    const fr = parseFloat(m[1]);
    if (!Number.isFinite(fr) || fr <= 0) {
      return null;
    }
    frValues.push(fr);
  }

  if (frValues.length === 0) {
    return null;
  }

  const total = frValues.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return null;
  }

  return {
    columnPercents: frValues.map((fr) => (fr / total) * 100),
    columnCount: frValues.length,
  };
}

/**
 * Format a percentage to the same 2-decimal style used by the existing tests.
 */
function formatPercent(p: number): string {
  return p.toFixed(2);
}

/**
 * Emit (at most once per selector) a debug-level warning that an unsupported
 * grid shape was encountered. Goes to console.warn so misconfigured sites are
 * visible without throwing or duplicating output across pages.
 */
function warnUnsupportedShape(selector: string): void {
  if (warnedSelectors.has(selector)) {
    return;
  }
  warnedSelectors.add(selector);
  console.warn(
    '[css-grid] unsupported grid shape, leaving rule unchanged:',
    selector
  );
}

/**
 * First pass: collect every rule that declares `display: grid` (or
 * `inline-grid`) along with its parsed grid-template-columns (if any).
 *
 * The result lets pass 2 know whether a child `grid-column: span N` should be
 * rewritten — only if its parent grid container was successfully translated.
 *
 * Selector matching for parent/child is intentionally conservative: a child
 * rule is considered "covered" iff its selector starts with the parent's
 * selector followed by whitespace, `>`, `+`, `~`, `,`, or end-of-string. That
 * captures `.parent .child`, `.parent > .child`, `.parent.child` (no — that's
 * compound, see below), etc. We don't try to be a real CSS engine.
 *
 * Additionally, if the document contains a `repeat(12, 1fr)` rule anywhere we
 * keep the legacy "assume 12-column" behavior for `grid-column: span N` rules
 * whose parent we can't otherwise identify. This preserves backward-compat
 * with the original Bootstrap-style assumption when the CSS author opted in.
 */
interface GridContainerInfo {
  selector: string;
  columns: ParsedColumns | null;
}

function collectGridContainers(root: Root): {
  containers: GridContainerInfo[];
  hasTwelveColumnGrid: boolean;
} {
  const containers: GridContainerInfo[] = [];
  let hasTwelveColumnGrid = false;

  root.walkRules((rule: Rule) => {
    let isGrid = false;
    let templateColumns: string | null = null;
    let hasNamedAreas = false;

    rule.walkDecls((decl: Declaration) => {
      if (
        decl.prop === 'display' &&
        (decl.value === 'grid' || decl.value === 'inline-grid')
      ) {
        isGrid = true;
      }
      if (decl.prop === 'grid-template-columns') {
        templateColumns = decl.value;
      }
      if (decl.prop === 'grid-template-areas') {
        hasNamedAreas = true;
      }
      if (decl.prop === 'grid-template' || decl.prop === 'grid') {
        if (/["']/.test(decl.value)) {
          hasNamedAreas = true;
        }
      }
    });

    if (!isGrid) {
      return;
    }

    // A container with named areas can never be safely translated — record it
    // as untranslated so child `grid-column: span N` rules also bail.
    const columns = hasNamedAreas
      ? null
      : templateColumns !== null
        ? parseGridTemplateColumns(templateColumns)
        : null;

    containers.push({ selector: rule.selector, columns });

    if (columns && columns.columnCount === 12) {
      hasTwelveColumnGrid = true;
    }
  });

  return { containers, hasTwelveColumnGrid };
}

/**
 * Decide whether a given child rule's `grid-column: span N` should be
 * rewritten, and with what column count.
 *
 * Returns the column count to use as the denominator, or `null` to bail.
 */
function resolveSpanContext(
  childSelector: string,
  containers: GridContainerInfo[],
  hasTwelveColumnGrid: boolean
): number | null {
  // Find a translated container whose selector is a prefix of the child
  // selector in a structural sense.
  for (const c of containers) {
    if (!c.columns) {
      continue;
    }
    if (selectorContains(c.selector, childSelector)) {
      return c.columns.columnCount;
    }
  }

  // No matching translated parent. If a 12-column grid exists somewhere in the
  // document, fall back to that (preserves existing behavior for Bootstrap-
  // style sheets where the parent selector relationship isn't easily recovered
  // via prefix matching). Otherwise: bail.
  return hasTwelveColumnGrid ? 12 : null;
}

/**
 * Heuristic: does `parent` plausibly contain `child` as a descendant per the
 * selector strings alone? We only accept the simple cases where `child`
 * literally starts with `parent` followed by a combinator. Anything fancier
 * (`:where(...)`, attribute selectors with whitespace, etc.) returns false.
 */
function selectorContains(parent: string, child: string): boolean {
  if (parent === child) {
    return true;
  }
  // Each can be a comma-separated list. Match if any pair matches.
  const parents = parent.split(',').map((s) => s.trim()).filter(Boolean);
  const children = child.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parents) {
    for (const c of children) {
      if (c === p) {
        return true;
      }
      if (c.startsWith(p)) {
        const next = c.charAt(p.length);
        if (next === ' ' || next === '>' || next === '+' || next === '~') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Convert CSS Grid properties to Flexbox equivalents.
 *
 * Two-pass strategy:
 *   1. Walk all rules and remember which `display: grid` containers had a
 *      grid-template-columns we could parse.
 *   2. Walk again and rewrite. `grid-column: span N` rules are only rewritten
 *      when a translated parent grid container exists (or, as a backstop, when
 *      a `repeat(12, 1fr)` rule exists somewhere — preserving the legacy
 *      Bootstrap assumption opt-in).
 */
export function transformGridToFlexbox(css: string): string {
  const root = postcss.parse(css);

  const { containers, hasTwelveColumnGrid } = collectGridContainers(root);

  root.walkRules((rule: Rule) => {
    let hasGrid = false;
    let templateColumnsValue: string | null = null;
    let hasNamedAreas = false;
    const flexDeclarations: Declaration[] = [];

    rule.walkDecls((decl: Declaration) => {
      // Detect grid container
      if (
        decl.prop === 'display' &&
        (decl.value === 'grid' || decl.value === 'inline-grid')
      ) {
        hasGrid = true;
        const flexDisplay = decl.value === 'inline-grid' ? 'inline-flex' : 'flex';
        flexDeclarations.push(
          postcss.decl({ prop: 'display', value: `-webkit-${flexDisplay}` })
        );
        flexDeclarations.push(
          postcss.decl({ prop: 'display', value: flexDisplay })
        );
        flexDeclarations.push(
          postcss.decl({ prop: '-webkit-flex-wrap', value: 'wrap' })
        );
        flexDeclarations.push(
          postcss.decl({ prop: 'flex-wrap', value: 'wrap' })
        );
      }

      if (decl.prop === 'grid-template-columns') {
        templateColumnsValue = decl.value;
      }

      // grid-template-areas always bails — there is no flexbox equivalent.
      if (decl.prop === 'grid-template-areas') {
        hasNamedAreas = true;
      }
      // The shorthand `grid-template` and `grid` can also embed area strings.
      if (decl.prop === 'grid-template' || decl.prop === 'grid') {
        if (/["']/.test(decl.value)) {
          hasNamedAreas = true;
        }
      }

      // align-items: same in flex; just add the -webkit- prefix.
      if (decl.prop === 'align-items') {
        flexDeclarations.push(
          postcss.decl({ prop: '-webkit-align-items', value: decl.value })
        );
      }

      // justify-items → justify-content (start/end → flex-start/flex-end).
      if (decl.prop === 'justify-items') {
        const value =
          decl.value === 'start'
            ? 'flex-start'
            : decl.value === 'end'
              ? 'flex-end'
              : decl.value;
        flexDeclarations.push(
          postcss.decl({ prop: '-webkit-justify-content', value })
        );
        flexDeclarations.push(
          postcss.decl({ prop: 'justify-content', value })
        );
      }

      // place-items shorthand → align-items + justify-content.
      if (decl.prop === 'place-items') {
        const [align, justify] = decl.value.split(/\s+/);
        flexDeclarations.push(
          postcss.decl({ prop: '-webkit-align-items', value: align })
        );
        flexDeclarations.push(
          postcss.decl({ prop: 'align-items', value: align })
        );
        if (justify) {
          flexDeclarations.push(
            postcss.decl({ prop: '-webkit-justify-content', value: justify })
          );
          flexDeclarations.push(
            postcss.decl({ prop: 'justify-content', value: justify })
          );
        }
      }
    });

    if (hasGrid) {
      // Bail if grid-template-areas is present anywhere — flexbox has no
      // equivalent and silently translating would mangle layout.
      if (hasNamedAreas) {
        warnUnsupportedShape(rule.selector);
        return;
      }

      // If the container has a grid-template-columns, decide whether we
      // understand its shape. If we don't, BAIL: emit no flex fallbacks at
      // all and warn once. (If there are no grid-template-columns at all,
      // we still inject the basic display:flex fallback — same as before.)
      if (templateColumnsValue !== null) {
        const parsed = parseGridTemplateColumns(templateColumnsValue);
        if (!parsed) {
          warnUnsupportedShape(rule.selector);
          return;
        }
      }

      if (flexDeclarations.length > 0) {
        rule.prepend(
          postcss.comment({ text: ' Revamp: Flexbox fallback for CSS Grid ' })
        );
        flexDeclarations.forEach((decl) => {
          rule.insertAfter(rule.first!, decl);
        });
      }
    }

    // Handle grid item properties (per-rule second walk).
    rule.walkDecls((decl: Declaration) => {
      // Convert `grid-column: span N` to flex width — only when we can prove
      // the parent grid container's column count.
      if (decl.prop === 'grid-column' && decl.value.includes('span')) {
        const match = decl.value.match(/span\s*(\d+)/);
        if (match) {
          const span = parseInt(match[1], 10);
          const parentCols = resolveSpanContext(
            rule.selector,
            containers,
            hasTwelveColumnGrid
          );
          if (parentCols === null) {
            // Parent grid bailed (or no parent). Leave child untouched.
            warnUnsupportedShape(rule.selector);
            return;
          }
          // Clamp span to parent column count.
          const effectiveSpan = Math.min(span, parentCols);
          const width = formatPercent((effectiveSpan / parentCols) * 100);
          rule.insertBefore(
            decl,
            postcss.decl({ prop: '-webkit-flex', value: `0 0 ${width}%` })
          );
          rule.insertBefore(
            decl,
            postcss.decl({ prop: 'flex', value: `0 0 ${width}%` })
          );
        }
      }

      if (decl.prop === 'align-self') {
        rule.insertBefore(
          decl,
          postcss.decl({ prop: '-webkit-align-self', value: decl.value })
        );
      }

      if (decl.prop === 'justify-self') {
        if (decl.value === 'end' || decl.value === 'flex-end') {
          rule.insertBefore(
            decl,
            postcss.decl({ prop: 'margin-left', value: 'auto' })
          );
        } else if (decl.value === 'start' || decl.value === 'flex-start') {
          rule.insertBefore(
            decl,
            postcss.decl({ prop: 'margin-right', value: 'auto' })
          );
        } else if (decl.value === 'center') {
          rule.insertBefore(
            decl,
            postcss.decl({ prop: 'margin-left', value: 'auto' })
          );
          rule.insertBefore(
            decl,
            postcss.decl({ prop: 'margin-right', value: 'auto' })
          );
        }
      }
    });
  });

  return root.toString();
}

/**
 * Check if CSS contains grid properties that need transformation.
 *
 * Only true grid markers count: `display: grid`/`inline-grid` and any of the
 * `grid-*` shorthand/longhand properties. Standalone `gap` is shared with
 * flexbox and is deliberately excluded so flex-with-gap rules aren't
 * misclassified as grid (which previously caused duplicate `display: flex`
 * declarations to be emitted).
 */
export function hasGridProperties(css: string): boolean {
  if (DISPLAY_GRID_PATTERN.test(css)) {
    return true;
  }
  return GRID_ONLY_PROPERTY_PATTERN.test(css);
}
