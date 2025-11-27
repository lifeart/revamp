/**
 * CSS Transformer using PostCSS
 * Transforms modern CSS to be compatible with iOS 9+ Safari (iPad 2+)
 */

import postcss from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import { getConfig } from '../config/index.js';

// PostCSS processor instance (cached)
let processor: ReturnType<typeof postcss> | null = null;

function getProcessor(): ReturnType<typeof postcss> {
  if (processor) {
    return processor;
  }
  
  const config = getConfig();
  
  processor = postcss([
    postcssPresetEnv({
      // iOS 11 compatible features
      browsers: config.targets.join(', '),
      // Stage 2 features are reasonably stable
      stage: 2,
      features: {
        // Enable specific features for iOS 11 compatibility
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
        flexbox: 'no-2009', // Don't add old flexbox syntax
        grid: 'autoplace',  // Add IE grid support (useful for older browsers)
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
    const proc = getProcessor();
    const result = await proc.process(code, {
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
  // Check for modern CSS features that iOS 11 doesn't support
  const modernPatterns = [
    /:is\(/,                  // :is() selector
    /:where\(/,               // :where() selector
    /:has\(/,                 // :has() selector
    /gap:/,                   // gap property (non-grid)
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
    /backdrop-filter:/,       // backdrop-filter (partial iOS 11 support)
    /clamp\(/,                // clamp() function
    /min\(/,                  // min() function
    /max\(/,                  // max() function
  ];
  
  return modernPatterns.some(pattern => pattern.test(code));
}

/**
 * Reset the processor (useful if config changes)
 */
export function resetCssProcessor(): void {
  processor = null;
}
