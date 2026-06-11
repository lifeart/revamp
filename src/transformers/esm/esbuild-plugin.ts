/**
 * ES Module Bundler — esbuild plugin
 *
 * The esbuild plugin that resolves ES module imports over HTTP(S), routes CSS
 * imports to style-injection codegen, and converts dynamic imports to runtime
 * loader calls.
 *
 * @module transformers/esm/esbuild-plugin
 */

import * as esbuild from 'esbuild';
import { log } from '../../logger/log.js';
import { fetchUrl } from './fetcher.js';
import { resolveModuleUrl, type ImportMap } from './import-map.js';
import { isCssUrl, generateCssInjectionCode } from './css-module.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of modules to bundle (prevent infinite loops) */
const MAX_MODULES = 100;

// =============================================================================
// esbuild Plugins
// =============================================================================

/**
 * Create an esbuild plugin that resolves ES module imports via HTTP(S)
 * Also handles CSS module imports by converting them to style injection code
 */
export function createHttpResolverPlugin(baseUrl: string, bundledModules: string[], importMap?: ImportMap): esbuild.Plugin {
  return {
    name: 'http-resolver',
    setup(build) {
      // Track loaded modules to prevent infinite loops
      const loadedModules = new Set<string>();

      // Resolve relative and absolute imports
      build.onResolve({ filter: /.*/ }, (args) => {
        // Handle entry point
        if (args.kind === 'entry-point') {
          return { path: baseUrl, namespace: 'http' };
        }

        // Handle dynamic imports - these need special runtime handling
        if (args.kind === 'dynamic-import') {
          const resolveBase = args.namespace === 'http' && args.importer ? args.importer : baseUrl;
          const resolvedUrl = resolveModuleUrl(args.path, resolveBase, importMap);

          if (resolvedUrl) {
            // Store the resolved URL for the dynamic import handler
            return { path: resolvedUrl, namespace: 'dynamic-import' };
          }
          return { external: true };
        }

        // Determine the base for resolution
        // If importer is in http namespace, use it as base URL
        // Otherwise use the original baseUrl
        const resolveBase = args.namespace === 'http' && args.importer
          ? args.importer
          : baseUrl;

        const resolvedUrl = resolveModuleUrl(args.path, resolveBase, importMap);

        if (!resolvedUrl) {
          // Can't resolve - mark as external and let runtime handle it
          return { external: true };
        }

        // Check if this is a CSS file - route to css namespace for special handling
        if (isCssUrl(resolvedUrl)) {
          log.debug(`🎨 CSS import detected: ${args.path} -> ${resolvedUrl}`);
          return { path: resolvedUrl, namespace: 'css-http' };
        }

        // Check for circular dependencies or too many modules
        if (loadedModules.size >= MAX_MODULES) {
          log.warn(`[ESM Bundler] Max modules reached (${MAX_MODULES}), marking ${args.path} as external`);
          return { external: true };
        }

        return { path: resolvedUrl, namespace: 'http' };
      });

      // Handle CSS files loaded via HTTP
      build.onLoad({ filter: /.*/, namespace: 'css-http' }, async (args) => {
        const url = args.path;
        bundledModules.push(url);

        try {
          log.debug(`🎨 Loading CSS module: ${url}`);
          const result = await fetchUrl(url);
          const jsCode = generateCssInjectionCode(result.content, url);
          return { contents: jsCode, loader: 'js' };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(`[ESM Bundler] Failed to load CSS ${url}: ${message}`);
          return { contents: `console.warn('[Revamp] Failed to load CSS: ${url}');`, loader: 'js' };
        }
      });

      // Handle dynamic imports - generate runtime loader code
      build.onLoad({ filter: /.*/, namespace: 'dynamic-import' }, async (args) => {
        const url = args.path;
        log.debug(`⚡ Dynamic import detected: ${url}`);

        // Generate code that uses the runtime dynamic import loader
        const code = `
// Dynamic import placeholder for: ${url}
var __dynamicImportUrl = "${url}";
export default window.__revampDynamicImport ? window.__revampDynamicImport(__dynamicImportUrl) : Promise.reject(new Error('[Revamp] Dynamic import not supported: ' + __dynamicImportUrl));
`;
        return { contents: code, loader: 'js' };
      });

      // Load modules via HTTP(S)
      build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
        const url = args.path;

        // Prevent infinite loops
        if (loadedModules.has(url)) {
          return { contents: '', loader: 'js' };
        }

        loadedModules.add(url);
        bundledModules.push(url);

        try {
          const result = await fetchUrl(url);
          return {
            contents: result.content,
            loader: 'js',
            // Don't set resolveDir - our onResolve handles URL resolution
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`[ESM Bundler] Failed to fetch ${url}: ${message}`);
          // Return empty content to allow bundling to continue
          return { contents: `console.error('[Revamp] Failed to load module: ${url}');`, loader: 'js' };
        }
      });
    },
  };
}
