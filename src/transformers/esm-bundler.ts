/**
 * ES Module Bundler
 *
 * Bundles ES modules using esbuild for legacy browser compatibility.
 * When a <script type="module"> is detected in HTML, this module:
 * 1. Fetches the module and all its dependencies (concurrently when possible)
 * 2. Bundles them into a single IIFE using esbuild
 * 3. Transforms the bundled code for legacy browsers
 * 4. Handles dynamic imports with runtime loader
 * 5. Transforms top-level await for legacy browser support
 * 6. Processes CSS module imports by injecting styles
 *
 * This file is the orchestrator; the focused pieces live under
 * `src/transformers/esm/` (fetcher, import-map, top-level-await, css-module,
 * esbuild-plugin, module-cache) and are re-exported here so the public API
 * surface is unchanged.
 *
 * @module transformers/esm-bundler
 */

import * as esbuild from 'esbuild';
import { log } from '../logger/log.js';
import { getConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { getCached, setCache } from '../cache/index.js';
import { fetchUrl } from './esm/fetcher.js';
import type { ImportMap } from './esm/import-map.js';
import { detectTopLevelAwait, wrapTopLevelAwait } from './esm/top-level-await.js';
import { createHttpResolverPlugin } from './esm/esbuild-plugin.js';

// =============================================================================
// Re-exports (public API surface)
// =============================================================================

export { fetchUrlsConcurrently } from './esm/fetcher.js';
export { parseImportMap } from './esm/import-map.js';
export type { ImportMap } from './esm/import-map.js';
export { detectTopLevelAwait, wrapTopLevelAwait } from './esm/top-level-await.js';
export { isCssUrl, generateCssInjectionCode } from './esm/css-module.js';
export {
  clearModuleCache,
  getModuleCacheSize,
  pruneModuleCacheIfNeeded,
} from './esm/module-cache.js';

// =============================================================================
// Types
// =============================================================================

/** Result of module bundling */
export interface BundleResult {
  /** Bundled and transformed code */
  code: string;
  /** Whether bundling succeeded (false means fallback was used) */
  success: boolean;
  /** Error message if bundling failed */
  error?: string;
  /** List of URLs that were bundled */
  bundledModules: string[];
}

// =============================================================================
// Main Bundler Function
// =============================================================================

/**
 * Bundle an ES module and its dependencies into a single IIFE
 *
 * @param moduleUrl - URL of the entry module
 * @param inlineCode - Optional inline code to bundle (if module is inline)
 * @param importMap - Optional import map for resolving bare specifiers
 * @returns Bundle result with code and metadata
 */
export async function bundleEsModule(moduleUrl: string, inlineCode?: string, importMap?: ImportMap): Promise<BundleResult> {
  const bundledModules: string[] = [];

  try {
    // Check if bundling is enabled
    const config = getConfig();
    if (!config.transformJs) {
      // Just return the original code without bundling
      if (inlineCode) {
        return {
          code: inlineCode,
          success: true,
          bundledModules: [],
        };
      }

      const result = await fetchUrl(moduleUrl);
      return {
        code: result.content,
        success: true,
        bundledModules: [moduleUrl],
      };
    }

    // Check cache first
    const cached = await getCached(moduleUrl, 'esm-bundle');
    if (cached) {
      log.debug(`📦 ESM bundle cache hit: ${moduleUrl}`);
      return {
        code: cached.toString('utf-8'),
        success: true,
        bundledModules: [],
      };
    }

    log.info(`📦 Bundling ES module: ${moduleUrl}`);

    // Prepare entry point
    let entryContent: string;
    if (inlineCode) {
      entryContent = inlineCode;
      bundledModules.push(moduleUrl + '#inline');
    } else {
      const fetchResult = await fetchUrl(moduleUrl);
      entryContent = fetchResult.content;
    }

    // Check for top-level await and wrap if needed
    const hasTopLevelAwait = detectTopLevelAwait(entryContent);
    if (hasTopLevelAwait) {
      log.debug(`⏳ Top-level await detected in: ${moduleUrl}`);
      entryContent = wrapTopLevelAwait(entryContent);
    }

    // Bundle with esbuild
    const result = await esbuild.build({
      stdin: {
        contents: entryContent,
        loader: 'js',
        // Use empty resolveDir - our plugin handles all resolution
        resolveDir: '.',
        sourcefile: moduleUrl,
      },
      bundle: true,
      write: false,
      format: 'iife',
      // Use es2015 for bundling structure - Babel will transform to ES5
      target: 'es2015',
      platform: 'browser',
      minify: false, // Don't minify - we want readable code for further transform
      sourcemap: false,
      keepNames: true,
      treeShaking: false,
      plugins: [
        createHttpResolverPlugin(moduleUrl, bundledModules, importMap),
      ],
      logLevel: 'silent',
      // Handle dynamic imports by converting to require
      splitting: false,
      // Define import.meta.url for modules that need it
      define: {
        'import.meta.url': JSON.stringify(moduleUrl),
        'import.meta': JSON.stringify({ url: moduleUrl }),
      },
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
      let bundledCode = result.outputFiles[0].text;

      // Transform the bundled code for legacy browsers using Babel
      log.debug(`🔧 Transforming bundled module: ${moduleUrl}`);
      bundledCode = await transformJs(bundledCode, moduleUrl);

      // Cache the result
      await setCache(moduleUrl, 'esm-bundle', Buffer.from(bundledCode, 'utf-8'));

      return {
        code: bundledCode,
        success: true,
        bundledModules,
      };
    }

    throw new Error('esbuild produced no output');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`❌ ESM bundling failed: ${message}`);

    // Fallback: return a script that logs the error
    const fallbackCode = `
(function() {
  console.error('[Revamp] Failed to bundle ES module: ${moduleUrl}');
  console.error('[Revamp] Error: ${message.replace(/'/g, "\\'")}');
  console.error('[Revamp] The module may not work correctly on this browser.');
})();
`;

    return {
      code: fallbackCode,
      success: false,
      error: message,
      bundledModules,
    };
  }
}

/**
 * Bundle inline module code
 *
 * @param code - Inline module code
 * @param baseUrl - Base URL for resolving relative imports
 * @param importMap - Optional import map for resolving bare specifiers
 * @returns Bundle result
 */
export async function bundleInlineModule(code: string, baseUrl: string, importMap?: ImportMap): Promise<BundleResult> {
  return bundleEsModule(baseUrl, code, importMap);
}

/**
 * Check if a script tag represents an ES module
 */
export function isModuleScript(type: string | undefined): boolean {
  return type === 'module';
}

/**
 * Generate a shim script that provides basic import/export support
 * This is injected before any bundled modules to provide runtime support
 */
export function getModuleShimScript(): string {
  return `
<!-- Revamp ES Module Shim -->
<script>
(function() {
  'use strict';
  // ES Module shim for legacy browsers
  // Bundled modules are converted to IIFE format by esbuild
  // This shim provides any additional runtime support needed

  // Track loaded modules for debugging
  window.__revampModules = window.__revampModules || {};

  // Top-level await exports storage
  window.__tlaExports = window.__tlaExports || {};

  // Provide a fake import.meta for modules that need it
  window.__importMeta = window.__importMeta || { url: location.href };

  // Dynamic import runtime loader
  // This fetches and evaluates modules at runtime for dynamic import() calls
  window.__revampDynamicImport = function(url) {
    console.log('[Revamp] Dynamic import:', url);

    // Check if module is already loaded
    if (window.__revampModules[url]) {
      return Promise.resolve(window.__revampModules[url]);
    }

    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            // T10: prepare a CommonJS-like environment for the upstream
            // module. Variables in this shim's enclosing scope are NOT
            // visible to the wrapped code below — \`new Function\` only
            // closes over its formal parameters and globals, which keeps
            // resolver-internal state (import map, sentinels) invisible
            // to potentially-hostile module bodies.
            var exportsObj = {};
            window.__revampModules[url] = exportsObj;
            var moduleObj = { exports: exportsObj };

            // T10: \`new Function\` instead of \`eval\` — the wrapped code
            // executes in its own function scope with only the named
            // parameters available, so we never lend the surrounding shim
            // closure to remote JS.
            var moduleFactory = new Function(
              'module',
              'exports',
              'require',
              xhr.responseText
            );
            moduleFactory.call(undefined, moduleObj, moduleObj.exports, undefined);

            var result = moduleObj.exports;
            window.__revampModules[url] = result || exportsObj;
            resolve(window.__revampModules[url]);
          } catch (e) {
            console.error('[Revamp] Dynamic import module error:', e);
            reject(e);
          }
        } else {
          reject(new Error('Failed to load module: ' + url + ' (HTTP ' + xhr.status + ')'));
        }
      };
      xhr.onerror = function() {
        reject(new Error('Network error loading module: ' + url));
      };
      xhr.send();
    });
  };

  console.log('[Revamp] ES Module runtime initialized');
})();
</script>
`;
}
