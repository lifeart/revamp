/**
 * PostCSS Worker for CSS Transformation
 *
 * This worker runs PostCSS transformations in a separate thread to avoid
 * blocking the main event loop during CPU-intensive CSS processing.
 *
 * The full per-file CSS pipeline runs here as a unit (all of it is pure
 * string-in/string-out CPU work with structured-cloneable inputs):
 *   1. dark-mode stripping (dark-mode-strip.ts)
 *   2. CSS Grid -> Flexbox fallback (css-grid-fallback.ts)
 *   3. PostCSS (webkit flex/grid prefixes + postcss-preset-env)
 */

import postcss, { type Plugin } from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import { hasGridProperties, transformGridToFlexbox } from './css-grid-fallback.js';
import { hasDarkModeQueries, stripAllDarkModeCSS } from './dark-mode-strip.js';

export interface CssWorkerInput {
  code: string;
  filename?: string;
  targets: string[];
}

export interface CssWorkerOutput {
  css: string;
  error?: string;
}

// PostCSS processor instance (cached per worker thread)
let processor: ReturnType<typeof postcss> | null = null;
// Targets used to build the cached processor; used to invalidate when targets change
let processorTargets: string | null = null;

/**
 * Custom PostCSS plugin to add webkit prefixes for flexbox and grid
 * Safari 9/iOS 9 needs -webkit- prefixes for many flex/grid properties
 */
const webkitFlexGridPlugin: Plugin = {
  postcssPlugin: 'webkit-flex-grid',
  Declaration(decl) {
    const prop = decl.prop;
    const value = decl.value;

    // Flexbox properties that need -webkit- prefix for Safari 9
    const flexboxProps: Record<string, string | undefined> = {
      'flex': '-webkit-flex',
      'flex-grow': '-webkit-flex-grow',
      'flex-shrink': '-webkit-flex-shrink',
      'flex-basis': '-webkit-flex-basis',
      'flex-direction': '-webkit-flex-direction',
      'flex-wrap': '-webkit-flex-wrap',
      'flex-flow': '-webkit-flex-flow',
      'justify-content': '-webkit-justify-content',
      'align-items': '-webkit-align-items',
      'align-self': '-webkit-align-self',
      'align-content': '-webkit-align-content',
      'order': '-webkit-order',
    };

    // Add -webkit- prefix for flexbox properties
    if (flexboxProps[prop] && !decl.parent?.some(node =>
      node.type === 'decl' && (node as typeof decl).prop === flexboxProps[prop]
    )) {
      decl.cloneBefore({ prop: flexboxProps[prop]!, value });
    }

    // Handle display: flex and display: grid
    if (prop === 'display') {
      if (value === 'flex' && !decl.parent?.some(node =>
        node.type === 'decl' && (node as typeof decl).prop === 'display' && (node as typeof decl).value === '-webkit-flex'
      )) {
        decl.cloneBefore({ prop: 'display', value: '-webkit-flex' });
      }
      if (value === 'inline-flex' && !decl.parent?.some(node =>
        node.type === 'decl' && (node as typeof decl).prop === 'display' && (node as typeof decl).value === '-webkit-inline-flex'
      )) {
        decl.cloneBefore({ prop: 'display', value: '-webkit-inline-flex' });
      }
    }
  }
};

webkitFlexGridPlugin.postcssPlugin = 'webkit-flex-grid';

function getProcessor(targets: string[]): ReturnType<typeof postcss> {
  const targetsKey = targets.join(', ');

  if (processor && processorTargets === targetsKey) {
    return processor;
  }

  // Targets changed (or first run) — rebuild the processor so new browser
  // compatibility settings actually take effect.
  processorTargets = targetsKey;

  processor = postcss([
    // First apply our webkit flexbox/grid prefixes
    webkitFlexGridPlugin,
    // Then apply postcss-preset-env for other transformations
    postcssPresetEnv({
      // iOS 9 compatible features
      browsers: targetsKey,
      // Stage 2 features are reasonably stable
      stage: 2,
      features: {
        // Enable specific features for iOS 9 compatibility
        'nesting-rules': true,
        'custom-properties': true, // CSS variables fallbacks
        'color-function': true,
        'oklab-function': true,
        'color-mix': true,
        'custom-media-queries': true,
        'media-query-ranges': true,
        'gap-properties': true,
        'overflow-wrap-property': true,
        'font-variant-property': true,
        'all-property': true,
        'any-link-pseudo-class': true,
        'matches-pseudo-class': true, // :is() selector
        'not-pseudo-class': true,     // :not() with complex selectors
        'logical-properties-and-values': true,
        'place-properties': true,
        'system-ui-font-family': true,
      },
      // Add vendor prefixes
      autoprefixer: {
        flexbox: true,       // Enable full flexbox prefixing for Safari 9
        grid: 'autoplace',   // Add IE grid support (useful for older browsers)
      },
    }),
  ]);

  return processor;
}

/**
 * Worker entry point - transforms CSS code using PostCSS
 *
 * Never throws: on error it returns the ORIGINAL input code plus the error
 * message so the caller can preserve the "fall back to original CSS with a
 * logged warning" semantics.
 */
export default async function transformCssWorker(input: CssWorkerInput): Promise<CssWorkerOutput> {
  const { code, filename, targets } = input;

  try {
    let transformedCode = code;

    // Strip dark mode CSS if configured
    if (hasDarkModeQueries(transformedCode)) {
      transformedCode = stripAllDarkModeCSS(transformedCode, {
        keepScheme: 'light',
        extractPreferredStyles: true
      });
    }

    // Add flexbox fallbacks for CSS Grid
    if (hasGridProperties(transformedCode)) {
      transformedCode = transformGridToFlexbox(transformedCode);
    }

    const proc = getProcessor(targets);
    const result = await proc.process(transformedCode, {
      from: filename || 'input.css',
      to: filename || 'output.css',
      // Don't generate source maps for transformed content
      map: false,
    });

    return { css: result.css };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      css: code,
      error: errorMessage,
    };
  }
}
