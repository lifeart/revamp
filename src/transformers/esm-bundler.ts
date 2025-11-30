/**
 * ES Module Bundler
 *
 * Bundles ES modules using esbuild for legacy browser compatibility.
 * When a <script type="module"> is detected in HTML, this module:
 * 1. Fetches the module and all its dependencies
 * 2. Bundles them into a single IIFE using esbuild
 * 3. Transforms the bundled code for legacy browsers
 *
 * For dynamic imports and complex module graphs that can't be statically
 * resolved, falls back to runtime resolution.
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

// =============================================================================
// Constants
// =============================================================================

/** Cache for fetched modules during bundling */
const moduleCache = new Map<string, ModuleCache>();

/** Maximum number of modules to bundle (prevent infinite loops) */
const MAX_MODULES = 100;

/** Maximum redirect hops to follow */
const MAX_REDIRECTS = 5;

/** Request timeout in milliseconds */
const FETCH_TIMEOUT = 30000;

/** User agent for fetching modules */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =============================================================================
// Module Fetching
// =============================================================================

/**
 * Fetch a URL and return its content
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

  // Check for max redirects
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error(`Too many redirects (${MAX_REDIRECTS}) for ${url}`);
  }

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
        const redirectUrl = new URL(res.headers.location, url).href;
        fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
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
 * Resolve a module specifier to an absolute URL
 */
function resolveModuleUrl(specifier: string, baseUrl: string): string | null {
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
// esbuild Plugin
// =============================================================================

/**
 * Create an esbuild plugin that resolves ES module imports via HTTP(S)
 */
function createHttpResolverPlugin(baseUrl: string, bundledModules: string[]): esbuild.Plugin {
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

        // Determine the base for resolution
        // If importer is in http namespace, use it as base URL
        // Otherwise use the original baseUrl
        const resolveBase = args.namespace === 'http' && args.importer
          ? args.importer
          : baseUrl;

        const resolvedUrl = resolveModuleUrl(args.path, resolveBase);

        if (!resolvedUrl) {
          // Can't resolve - mark as external and let runtime handle it
          return { external: true };
        }

        // Check for circular dependencies or too many modules
        if (loadedModules.size >= MAX_MODULES) {
          console.warn(`[ESM Bundler] Max modules reached (${MAX_MODULES}), marking ${args.path} as external`);
          return { external: true };
        }

        return { path: resolvedUrl, namespace: 'http' };
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
 * @returns Bundle result with code and metadata
 */
export async function bundleEsModule(moduleUrl: string, inlineCode?: string): Promise<BundleResult> {
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
      plugins: [createHttpResolverPlugin(moduleUrl, bundledModules)],
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
 * @returns Bundle result
 */
export async function bundleInlineModule(code: string, baseUrl: string): Promise<BundleResult> {
  return bundleEsModule(baseUrl, code);
}

/**
 * Clear the module cache (useful for testing or memory management)
 */
export function clearModuleCache(): void {
  moduleCache.clear();
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

  // Provide a fake import.meta for modules that need it
  window.__importMeta = window.__importMeta || { url: location.href };

  console.log('[Revamp] ES Module runtime initialized');
})();
</script>
`;
}
