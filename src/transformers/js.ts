/**
 * JavaScript Transformer using Babel
 * Transforms modern JavaScript to be compatible with iOS 11 Safari
 */

import { transformAsync, type TransformOptions } from '@babel/core';
import { getConfig } from '../config/index.js';

// Babel configuration for iOS 11 compatibility
function getBabelConfig(): TransformOptions {
  const config = getConfig();
  
  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: config.targets.join(', '),
          useBuiltIns: false, // We'll handle polyfills separately
          modules: false, // Preserve ES modules
          bugfixes: true,
        },
      ],
    ],
    // Parser options to handle edge cases in minified/concatenated files
    parserOpts: {
      // Allow duplicate declarations (common in concatenated minified files)
      allowReturnOutsideFunction: true,
      // More lenient parsing for real-world JS
      errorRecovery: true,
    },
    // Don't include source maps for transformed content
    sourceMaps: false,
    // Compact output for smaller payload
    compact: true,
    // Comments can be stripped for smaller output
    comments: false,
  };
}

/**
 * Transform JavaScript code for legacy browser compatibility
 */
export async function transformJs(code: string, filename?: string): Promise<string> {
  const config = getConfig();
  
  if (!config.transformJs) {
    return code;
  }
  
  try {
    const babelConfig = getBabelConfig();
    
    if (filename) {
      babelConfig.filename = filename;
    }
    
    const result = await transformAsync(code, babelConfig);
    
    if (result?.code) {
      return result.code;
    }
    
    return code;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Known non-critical errors that we can safely ignore
    // These usually occur in minified/concatenated files that still work in browsers
    const ignorableErrors = [
      'has already been declared',  // Duplicate declarations in concatenated files
      'Identifier .* has already been declared',
      'Unexpected token',           // Sometimes minified code has edge cases
    ];
    
    const isIgnorable = ignorableErrors.some(pattern => 
      new RegExp(pattern).test(errorMessage)
    );
    
    if (isIgnorable) {
      console.warn(`⚠️ Skipping JS transform (non-critical parse issue): ${filename || 'unknown'}`);
      return code;
    }
    
    console.error('❌ Babel transform error:', errorMessage);
    // Return original code on error to not break the page
    return code;
  }
}

/**
 * Check if the code likely needs transformation
 * Quick heuristic to avoid unnecessary processing
 */
export function needsJsTransform(code: string): boolean {
  // Check for modern JS features that iOS 11 doesn't support
  const modernPatterns = [
    /\?\./,              // Optional chaining
    /\?\?/,              // Nullish coalescing
    /\.\.\.(?=\w)/,      // Spread in object literals (rough check)
    /async\s+function\*/, // Async generators
    /for\s+await/,       // For-await-of
    /\#\w+/,             // Private class fields
    /static\s+\{/,       // Static blocks
    /(?<!\w)import\s*\(/,// Dynamic import
    /BigInt|(?<!\w)\d+n(?!\w)/, // BigInt
    /Array\.prototype\.flat/, // Array.flat
    /Object\.fromEntries/,    // Object.fromEntries
    /String\.prototype\.matchAll/, // String.matchAll
    /Promise\.allSettled/,    // Promise.allSettled
    /globalThis/,             // globalThis
  ];
  
  return modernPatterns.some(pattern => pattern.test(code));
}
