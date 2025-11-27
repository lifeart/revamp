/**
 * CSS Transformer using PostCSS
 * Transforms modern CSS to be compatible with iOS 9+ Safari (iPad 2+)
 */

import postcss, { type Plugin } from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import { getConfig } from '../config/index.js';
import { hasGridProperties, transformGridToFlexbox } from './css-grid-fallback.js';
import { hasDarkModeQueries, stripAllDarkModeCSS } from './dark-mode-strip.js';

// PostCSS processor instance (cached)
let processor: ReturnType<typeof postcss> | null = null;

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

    // Gap property fallback for flexbox (Safari 9 doesn't support gap in flexbox)
    // We can't perfectly polyfill this, but we can add margin-based fallback hint
    if (prop === 'gap' || prop === 'row-gap' || prop === 'column-gap') {
      // Check if parent uses flexbox
      const parentRule = decl.parent;
      if (parentRule) {
        const isFlexbox = parentRule.some(node =>
          node.type === 'decl' &&
          (node as typeof decl).prop === 'display' &&
          ((node as typeof decl).value === 'flex' || (node as typeof decl).value === '-webkit-flex')
        );

        // For grid, autoprefixer handles it. For flexbox, gap isn't supported in Safari 9
        // Just ensure the property exists (PostCSS preset-env should handle this)
      }
    }
  }
};

webkitFlexGridPlugin.postcssPlugin = 'webkit-flex-grid';

function getProcessor(): ReturnType<typeof postcss> {
  if (processor) {
    return processor;
  }

  const config = getConfig();

  processor = postcss([
    // First apply our webkit flexbox/grid prefixes
    webkitFlexGridPlugin,
    // Then apply postcss-preset-env for other transformations
    postcssPresetEnv({
      // iOS 9 compatible features
      browsers: config.targets.join(', '),
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
 * Transform CSS code for legacy browser compatibility
 */
export async function transformCss(code: string, filename?: string): Promise<string> {
  const config = getConfig();

  if (!config.transformCss) {
    return code;
  }

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

    const proc = getProcessor();
    const result = await proc.process(transformedCode, {
      from: filename || 'input.css',
      to: filename || 'output.css',
      // Don't generate source maps for transformed content
      map: false,
    });

    return result.css;
  } catch (error) {
    console.error('❌ PostCSS transform error:', error instanceof Error ? error.message : error);
    // Return original code on error to not break the page
    return code;
  }
}

/**
 * Check if the CSS likely needs transformation
 * Quick heuristic to avoid unnecessary processing
 */
export function needsCssTransform(code: string): boolean {
  // Check for modern CSS features that iOS 9 doesn't support well
  const modernPatterns = [
    /:is\(/,                  // :is() selector
    /:where\(/,               // :where() selector
    /:has\(/,                 // :has() selector
    /gap:/,                   // gap property (needs prefixes in older Safari)
    /row-gap:/,               // row-gap property
    /column-gap:/,            // column-gap property
    /aspect-ratio:/,          // aspect-ratio
    /color-mix\(/,            // color-mix()
    /oklch\(/,                // oklch color
    /oklab\(/,                // oklab color
    /container-type:/,        // container queries
    /@container/,             // container queries
    /@layer/,                 // cascade layers
    /inset:/,                 // logical property
    /inline-size:/,           // logical property
    /block-size:/,            // logical property
    /margin-inline:/,         // logical property
    /padding-block:/,         // logical property
    /scroll-behavior:/,       // scroll-behavior
    /overscroll-behavior:/,   // overscroll-behavior
    /backdrop-filter:/,       // backdrop-filter (partial iOS support)
    /clamp\(/,                // clamp() function
    /min\(/,                  // min() function
    /max\(/,                  // max() function
    /display:\s*flex/,        // flexbox - needs -webkit- for Safari 9
    /display:\s*inline-flex/, // inline-flex - needs -webkit- for Safari 9
    /display:\s*grid/,        // grid - needs prefixes
    /flex-direction:/,        // flexbox property
    /flex-wrap:/,             // flexbox property
    /justify-content:/,       // flexbox property
    /align-items:/,           // flexbox property
    /align-self:/,            // flexbox property
    /align-content:/,         // flexbox property
    /flex-grow:/,             // flexbox property
    /flex-shrink:/,           // flexbox property
    /flex-basis:/,            // flexbox property
    /grid-template/,          // grid property
    /grid-area:/,             // grid property
    /grid-column:/,           // grid property
    /grid-row:/,              // grid property
    /place-items:/,           // shorthand for align-items + justify-items
    /place-content:/,         // shorthand for align-content + justify-content
    /place-self:/,            // shorthand for align-self + justify-self
  ];

  return modernPatterns.some(pattern => pattern.test(code));
}

/**
 * Reset the processor (useful if config changes)
 */
export function resetCssProcessor(): void {
  processor = null;
}
