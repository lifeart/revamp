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
 * @module transformers/esm-bundler
 */

import * as esbuild from 'esbuild';
import { URL } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { getCached, setCache } from '../cache/index.js';

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

/** Module fetch result */
interface FetchResult {
  content: string;
  contentType: string;
  finalUrl: string;
}

/** Cached module content */
interface ModuleCache {
  content: string;
  url: string;
}

/** Import map structure (subset of the full spec) */
export interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache for fetched modules during bundling */
const moduleCache = new Map<string, ModuleCache>();

/** Cache size limit - clear cache when exceeded */
const MAX_CACHE_SIZE = 500;

/** Maximum number of modules to bundle (prevent infinite loops) */
const MAX_MODULES = 100;

/** Maximum redirect hops to follow */
const MAX_REDIRECTS = 5;

/** Request timeout in milliseconds */
const FETCH_TIMEOUT = 30000;

/** Maximum concurrent fetch operations */
const MAX_CONCURRENT_FETCHES = 6;

/** User agent for fetching modules */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =============================================================================
// Concurrent Fetch Queue
// =============================================================================

/** Queue for managing concurrent fetches */
interface FetchQueueItem {
  url: string;
  resolve: (result: FetchResult) => void;
  reject: (error: Error) => void;
  redirectCount: number;
}

const fetchQueue: FetchQueueItem[] = [];
let activeFetches = 0;

/**
 * Process the fetch queue, starting new fetches if under the limit
 */
function processFetchQueue(): void {
  while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
    const item = fetchQueue.shift()!;
    activeFetches++;

    fetchUrlInternal(item.url, item.redirectCount)
      .then((result) => {
        activeFetches--;
        item.resolve(result);
        processFetchQueue();
      })
      .catch((error) => {
        activeFetches--;
        item.reject(error);
        processFetchQueue();
      });
  }
}

/**
 * Fetch multiple URLs concurrently
 */
export async function fetchUrlsConcurrently(urls: string[]): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();
  const uniqueUrls = [...new Set(urls)];

  const fetchPromises = uniqueUrls.map(async (url) => {
    try {
      const result = await fetchUrl(url);
      results.set(url, result);
    } catch (error) {
      console.warn(`[ESM Bundler] Failed to prefetch ${url}: ${error instanceof Error ? error.message : error}`);
    }
  });

  await Promise.all(fetchPromises);
  return results;
}

// =============================================================================
// Module Fetching
// =============================================================================

/**
 * Internal fetch implementation - does the actual HTTP request
 */
function fetchUrlInternal(url: string, redirectCount: number): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'identity', // Don't accept compressed responses
      },
      rejectUnauthorized: false,
      timeout: FETCH_TIMEOUT,
    };

    const req = requestFn(options, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (${MAX_REDIRECTS}) for ${url}`));
          return;
        }
        const redirectUrl = new URL(res.headers.location, url).href;
        fetchUrlInternal(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf-8');
        const contentType = res.headers['content-type'] || 'application/javascript';

        // Cache the result
        moduleCache.set(url, { content, url });

        resolve({
          content,
          contentType,
          finalUrl: url,
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });

    req.end();
  });
}

/**
 * Fetch a URL and return its content (uses queue for concurrency control)
 */
async function fetchUrl(url: string, redirectCount = 0): Promise<FetchResult> {
  // Check cache first
  const cached = moduleCache.get(url);
  if (cached) {
    return {
      content: cached.content,
      contentType: 'application/javascript',
      finalUrl: cached.url,
    };
  }

  // Add to queue for concurrent fetching
  return new Promise((resolve, reject) => {
    fetchQueue.push({ url, resolve, reject, redirectCount });
    processFetchQueue();
  });
}

/**
 * Resolve a specifier using an import map
 */
function resolveWithImportMap(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  if (!importMap) return null;

  // Check scopes first (more specific)
  if (importMap.scopes) {
    for (const [scope, mappings] of Object.entries(importMap.scopes)) {
      if (baseUrl.startsWith(scope)) {
        // Check for exact match
        if (mappings[specifier]) {
          return mappings[specifier];
        }
        // Check for prefix match (e.g., "lodash/" -> "https://cdn/lodash/")
        for (const [prefix, replacement] of Object.entries(mappings)) {
          if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
            return replacement + specifier.slice(prefix.length);
          }
        }
      }
    }
  }

  // Check top-level imports
  if (importMap.imports) {
    // Exact match
    if (importMap.imports[specifier]) {
      return importMap.imports[specifier];
    }
    // Prefix match
    for (const [prefix, replacement] of Object.entries(importMap.imports)) {
      if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
        return replacement + specifier.slice(prefix.length);
      }
    }
  }

  return null;
}

/**
 * Resolve a module specifier to an absolute URL
 */
function resolveModuleUrl(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  // Try import map first for bare specifiers
  const importMapResolved = resolveWithImportMap(specifier, baseUrl, importMap);
  if (importMapResolved) {
    try {
      return new URL(importMapResolved, baseUrl).href;
    } catch {
      // Invalid resolved URL
    }
  }

  // Handle bare specifiers (npm packages) - these can't be resolved without import maps
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('http')) {
    // Check for common CDN patterns that look like bare specifiers but have URLs
    if (specifier.includes('://')) {
      try {
        return new URL(specifier).href;
      } catch {
        // Not a valid URL
      }
    }
    console.warn(`[ESM Bundler] Cannot resolve bare specifier: "${specifier}" - consider using an import map or full URL`);
    return null;
  }

  try {
    return new URL(specifier, baseUrl).href;
  } catch {
    console.warn(`[ESM Bundler] Failed to resolve "${specifier}" from "${baseUrl}"`);
    return null;
  }
}

// =============================================================================
// Top-Level Await Handling
// =============================================================================

// Import Babel for AST-based top-level await detection
import * as babel from '@babel/core';

/**
 * Detect if code contains top-level await using Babel AST parsing
 * This is accurate and handles all edge cases (strings, comments, nested functions)
 */
export function detectTopLevelAwait(code: string): boolean {
  try {
    let hasTopLevelAwait = false;

    babel.transformSync(code, {
      sourceType: 'module',
      plugins: [
        {
          visitor: {
            // Only detect await at the Program level (top-level)
            AwaitExpression(path) {
              // Check if this await is at the top level (not inside a function)
              let parent = path.parentPath;
              while (parent !== null) {
                if (
                  parent.isFunction() ||
                  parent.isArrowFunctionExpression() ||
                  parent.isFunctionDeclaration() ||
                  parent.isFunctionExpression() ||
                  parent.isObjectMethod() ||
                  parent.isClassMethod()
                ) {
                  // await is inside a function, not top-level
                  return;
                }
                parent = parent.parentPath;
              }
              // await is at top level
              hasTopLevelAwait = true;
            },
          },
        },
      ],
      // Don't generate output, just parse and visit
      code: false,
    });

    return hasTopLevelAwait;
  } catch {
    // If parsing fails, fall back to simple check
    // This handles cases where the code might have syntax errors
    return /\bawait\b/.test(code);
  }
}

/**
 * Wrap code with top-level await in an async IIFE
 * This transforms:
 *   const data = await fetch(...);
 *   export { data };
 * Into:
 *   (async function() {
 *     const data = await fetch(...);
 *     window.__moduleExports = { data };
 *   })();
 */
export function wrapTopLevelAwait(code: string): string {
  // Check if there are exports that need to be captured
  const hasExports = /\bexport\s+/.test(code);

  if (hasExports) {
    // Transform exports to window assignments for the async context
    // This is a simplified approach - proper handling would need AST parsing
    let transformedCode = code
      // export const x = ... -> const x = ...; window.__tlaExports.x = x;
      .replace(/export\s+(const|let|var)\s+(\w+)\s*=/g, '$1 $2 =')
      // export { x, y } -> (handled at the end)
      .replace(/export\s*\{([^}]+)\}/g, (_, names) => {
        const exports = names.split(',').map((n: string) => n.trim().split(/\s+as\s+/));
        return exports.map(([local, exported]: string[]) =>
          `window.__tlaExports.${exported || local} = ${local};`
        ).join('\n');
      })
      // export default x -> window.__tlaExports.default = x;
      .replace(/export\s+default\s+/g, 'window.__tlaExports.default = ');

    return `
window.__tlaExports = window.__tlaExports || {};
(async function() {
  'use strict';
  try {
${transformedCode}
  } catch (e) {
    console.error('[Revamp] Top-level await error:', e);
  }
})();
`;
  }

  // No exports, just wrap in async IIFE
  return `
(async function() {
  'use strict';
  try {
${code}
  } catch (e) {
    console.error('[Revamp] Top-level await error:', e);
  }
})();
`;
}

// =============================================================================
// CSS Module Handling
// =============================================================================

/**
 * Check if a URL points to a CSS file
 */
export function isCssUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.css');
  } catch {
    return url.toLowerCase().endsWith('.css');
  }
}

/**
 * Generate code to inject CSS into the page at runtime
 */
export function generateCssInjectionCode(css: string, url: string): string {
  // Escape the CSS content for embedding in JavaScript
  const escapedCss = css
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `
(function() {
  var css = \`${escapedCss}\`;
  var style = document.createElement('style');
  style.setAttribute('data-revamp-css-module', '${url}');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  console.log('[Revamp] Injected CSS module: ${url}');
})();
`;
}

// =============================================================================
// esbuild Plugins
// =============================================================================

/**
 * Create an esbuild plugin that resolves ES module imports via HTTP(S)
 * Also handles CSS module imports by converting them to style injection code
 */
function createHttpResolverPlugin(baseUrl: string, bundledModules: string[], importMap?: ImportMap): esbuild.Plugin {
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
          console.log(`🎨 CSS import detected: ${args.path} -> ${resolvedUrl}`);
          return { path: resolvedUrl, namespace: 'css-http' };
        }

        // Check for circular dependencies or too many modules
        if (loadedModules.size >= MAX_MODULES) {
          console.warn(`[ESM Bundler] Max modules reached (${MAX_MODULES}), marking ${args.path} as external`);
          return { external: true };
        }

        return { path: resolvedUrl, namespace: 'http' };
      });

      // Handle CSS files loaded via HTTP
      build.onLoad({ filter: /.*/, namespace: 'css-http' }, async (args) => {
        const url = args.path;
        bundledModules.push(url);

        try {
          console.log(`🎨 Loading CSS module: ${url}`);
          const result = await fetchUrl(url);
          const jsCode = generateCssInjectionCode(result.content, url);
          return { contents: jsCode, loader: 'js' };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[ESM Bundler] Failed to load CSS ${url}: ${message}`);
          return { contents: `console.warn('[Revamp] Failed to load CSS: ${url}');`, loader: 'js' };
        }
      });

      // Handle dynamic imports - generate runtime loader code
      build.onLoad({ filter: /.*/, namespace: 'dynamic-import' }, async (args) => {
        const url = args.path;
        console.log(`⚡ Dynamic import detected: ${url}`);

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
          console.error(`[ESM Bundler] Failed to fetch ${url}: ${message}`);
          // Return empty content to allow bundling to continue
          return { contents: `console.error('[Revamp] Failed to load module: ${url}');`, loader: 'js' };
        }
      });
    },
  };
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
    const cacheKey = `esm-bundle:${moduleUrl}`;
    const cached = await getCached(moduleUrl, 'esm-bundle');
    if (cached) {
      console.log(`📦 ESM bundle cache hit: ${moduleUrl}`);
      return {
        code: cached.toString('utf-8'),
        success: true,
        bundledModules: [],
      };
    }

    console.log(`📦 Bundling ES module: ${moduleUrl}`);

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
      console.log(`⏳ Top-level await detected in: ${moduleUrl}`);
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
      console.log(`🔧 Transforming bundled module: ${moduleUrl}`);
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
    console.error(`❌ ESM bundling failed: ${message}`);

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
 * Clear the module cache (useful for testing or memory management)
 */
export function clearModuleCache(): void {
  moduleCache.clear();
}

/**
 * Get the current cache size
 */
export function getModuleCacheSize(): number {
  return moduleCache.size;
}

/**
 * Prune the module cache if it exceeds the size limit
 * Uses LRU-like approach by clearing entire cache when limit exceeded
 */
export function pruneModuleCacheIfNeeded(): void {
  if (moduleCache.size > MAX_CACHE_SIZE) {
    console.log(`[ESM Bundler] Cache size exceeded ${MAX_CACHE_SIZE}, clearing cache`);
    moduleCache.clear();
  }
}

/**
 * Check if a script tag represents an ES module
 */
export function isModuleScript(type: string | undefined): boolean {
  return type === 'module';
}

/**
 * Parse an import map from JSON string
 *
 * @param json - Import map JSON string
 * @returns Parsed import map or undefined if invalid
 */
export function parseImportMap(json: string): ImportMap | undefined {
  try {
    const map = JSON.parse(json);

    // Validate basic structure
    if (typeof map !== 'object' || map === null) {
      console.warn('[ESM Bundler] Invalid import map: must be an object');
      return undefined;
    }

    const result: ImportMap = {};

    // Validate imports
    if (map.imports) {
      if (typeof map.imports !== 'object' || map.imports === null) {
        console.warn('[ESM Bundler] Invalid import map: imports must be an object');
        return undefined;
      }
      result.imports = {};
      for (const [key, value] of Object.entries(map.imports)) {
        if (typeof value === 'string') {
          result.imports[key] = value;
        }
      }
    }

    // Validate scopes
    if (map.scopes) {
      if (typeof map.scopes !== 'object' || map.scopes === null) {
        console.warn('[ESM Bundler] Invalid import map: scopes must be an object');
        return undefined;
      }
      result.scopes = {};
      for (const [scope, mappings] of Object.entries(map.scopes)) {
        if (typeof mappings === 'object' && mappings !== null) {
          result.scopes[scope] = {};
          for (const [key, value] of Object.entries(mappings)) {
            if (typeof value === 'string') {
              result.scopes[scope][key] = value;
            }
          }
        }
      }
    }

    console.log(`[ESM Bundler] Parsed import map with ${Object.keys(result.imports || {}).length} imports, ${Object.keys(result.scopes || {}).length} scopes`);
    return result;
  } catch (e) {
    console.warn('[ESM Bundler] Failed to parse import map:', e instanceof Error ? e.message : e);
    return undefined;
  }
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
            // Create a module-like object
            var moduleExports = {};

            // Wrap the code to capture exports
            var wrappedCode = '(function(exports) {' +
              'var module = { exports: exports };' +
              xhr.responseText +
              ';return module.exports;' +
              '})(window.__revampModules["' + url + '"] = {});';

            // Evaluate the module code
            var result = eval(wrappedCode);
            window.__revampModules[url] = result || window.__revampModules[url];
            resolve(window.__revampModules[url]);
          } catch (e) {
            console.error('[Revamp] Dynamic import eval error:', e);
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
