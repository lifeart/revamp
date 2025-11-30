/**
 * Service Worker Bundler
 *
 * Fetches, bundles, and transforms Service Worker scripts for legacy browser compatibility.
 * Similar to esm-bundler.ts but specialized for Service Worker scripts.
 *
 * The bundled SW script:
 * 1. Has all ES module imports bundled into a single file
 * 2. Is transformed for legacy browser compatibility (Safari 9+)
 * 3. Has fetch event handlers wrapped to work through our proxy
 *
 * @module transformers/sw-bundler
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

/** Result of Service Worker bundling */
export interface SwBundleResult {
  /** Bundled and transformed SW code */
  code: string;
  /** Whether bundling succeeded */
  success: boolean;
  /** Error message if bundling failed */
  error?: string;
  /** Original script URL */
  originalUrl: string;
  /** Scope for the SW */
  scope: string;
}

/** Module fetch result */
interface FetchResult {
  content: string;
  contentType: string;
  finalUrl: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache for fetched modules */
const moduleCache = new Map<string, { content: string; url: string }>();

/** Max redirects to follow */
const MAX_REDIRECTS = 5;

/** Request timeout */
const FETCH_TIMEOUT = 30000;

/** User agent for fetching */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =============================================================================
// Module Fetching
// =============================================================================

/**
 * Fetch a URL and return its content
 */
function fetchUrl(url: string, redirectCount = 0): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    // Check cache first
    const cached = moduleCache.get(url);
    if (cached) {
      resolve({
        content: cached.content,
        contentType: 'application/javascript',
        finalUrl: cached.url,
      });
      return;
    }

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
        'Accept-Encoding': 'identity',
      },
      rejectUnauthorized: false,
      timeout: FETCH_TIMEOUT,
    };

    const req = requestFn(options, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }
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

// =============================================================================
// Service Worker Wrapper
// =============================================================================

/**
 * Generate wrapper code that makes the SW compatible with legacy browsers
 * and routes fetch events through our proxy
 */
function generateSwWrapper(originalUrl: string, scope: string): { prefix: string; suffix: string } {
  const prefix = `
// [Revamp] Service Worker Bridge - Bundled from: ${originalUrl}
// Scope: ${scope}
(function() {
  'use strict';

  // Store original fetch for use in handlers
  var originalFetch = self.fetch;

  // Track event listeners
  var eventListeners = {
    fetch: [],
    install: [],
    activate: [],
    message: [],
    push: [],
    sync: [],
    notificationclick: [],
    notificationclose: []
  };

  // Override addEventListener to capture handlers
  var originalAddEventListener = self.addEventListener;
  self.addEventListener = function(type, listener, options) {
    if (eventListeners[type]) {
      eventListeners[type].push({ listener: listener, options: options });
    }
    return originalAddEventListener.call(self, type, listener, options);
  };

  // Wrap fetch to ensure requests go through proxy
  // This ensures transformed content is returned
  self.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input.url || input);

    // Log fetch requests in SW for debugging
    // console.log('[Revamp SW] Fetch:', url);

    // Use original fetch - the proxy will transform the response
    return originalFetch.call(self, input, init);
  };

  // Helper to skip waiting during install
  self.skipWaiting = self.skipWaiting || function() {
    return Promise.resolve();
  };

  // Ensure clients.claim is available
  if (self.clients && !self.clients.claim) {
    self.clients.claim = function() {
      return Promise.resolve();
    };
  }

  console.log('[Revamp SW] Service Worker bridge initialized for:', '${originalUrl}');

  // === Original Service Worker Code Below ===
`;

  const suffix = `
  // === End Original Service Worker Code ===

  console.log('[Revamp SW] Service Worker code loaded successfully');
})();
`;

  return { prefix, suffix };
}

// =============================================================================
// esbuild Plugin for HTTP Resolution
// =============================================================================

/**
 * Create an esbuild plugin that resolves imports via HTTP(S)
 */
function createHttpResolverPlugin(baseUrl: string): esbuild.Plugin {
  return {
    name: 'sw-http-resolver',
    setup(build) {
      const loadedModules = new Set<string>();
      const MAX_MODULES = 50;

      // Resolve all imports
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return { path: baseUrl, namespace: 'http' };
        }

        // Determine base URL for resolution
        const resolveBase = args.namespace === 'http' && args.importer
          ? args.importer
          : baseUrl;

        // Handle relative and absolute URLs
        let resolvedUrl: string | null = null;
        try {
          if (args.path.startsWith('.') || args.path.startsWith('/') || args.path.startsWith('http')) {
            resolvedUrl = new URL(args.path, resolveBase).href;
          }
        } catch {
          // Can't resolve - mark as external
        }

        if (!resolvedUrl) {
          console.warn(`[SW Bundler] Cannot resolve: ${args.path}`);
          return { external: true };
        }

        if (loadedModules.size >= MAX_MODULES) {
          console.warn(`[SW Bundler] Max modules reached, marking ${args.path} as external`);
          return { external: true };
        }

        return { path: resolvedUrl, namespace: 'http' };
      });

      // Load modules via HTTP
      build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
        const url = args.path;

        if (loadedModules.has(url)) {
          return { contents: '', loader: 'js' };
        }

        loadedModules.add(url);

        try {
          const result = await fetchUrl(url);
          return { contents: result.content, loader: 'js' };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[SW Bundler] Failed to fetch ${url}: ${message}`);
          return {
            contents: `console.error('[Revamp SW] Failed to load module: ${url}');`,
            loader: 'js'
          };
        }
      });
    },
  };
}

// =============================================================================
// Main Bundler Function
// =============================================================================

/**
 * Bundle a Service Worker script for legacy browser compatibility
 *
 * @param scriptUrl - URL of the Service Worker script
 * @param scope - Scope for the Service Worker
 * @returns Bundle result with transformed code
 */
export async function bundleServiceWorker(scriptUrl: string, scope: string = '/'): Promise<SwBundleResult> {
  try {
    const config = getConfig();

    // Check cache first
    const cacheKey = `sw-bundle:${scriptUrl}:${scope}`;
    const cached = await getCached(scriptUrl, 'sw-bundle');
    if (cached) {
      console.log(`📦 SW bundle cache hit: ${scriptUrl}`);
      return {
        code: cached.toString('utf-8'),
        success: true,
        originalUrl: scriptUrl,
        scope,
      };
    }

    console.log(`📦 Bundling Service Worker: ${scriptUrl}`);

    // Fetch the SW script
    const fetchResult = await fetchUrl(scriptUrl);
    let swCode = fetchResult.content;

    // If JS transformation is disabled, just return the original code with wrapper
    if (!config.transformJs) {
      const wrapper = generateSwWrapper(scriptUrl, scope);
      const code = wrapper.prefix + swCode + wrapper.suffix;
      return {
        code,
        success: true,
        originalUrl: scriptUrl,
        scope,
      };
    }

    // Check if the SW uses ES modules (import/export)
    const usesModules = /\b(import|export)\b/.test(swCode);

    if (usesModules) {
      console.log(`📦 SW uses ES modules, bundling with esbuild`);

      // Bundle with esbuild
      const result = await esbuild.build({
        stdin: {
          contents: swCode,
          loader: 'js',
          resolveDir: '.',
          sourcefile: scriptUrl,
        },
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2015',
        platform: 'browser',
        minify: false,
        sourcemap: false,
        plugins: [createHttpResolverPlugin(scriptUrl)],
        logLevel: 'silent',
        define: {
          'import.meta.url': JSON.stringify(scriptUrl),
        },
      });

      if (result.outputFiles && result.outputFiles.length > 0) {
        swCode = result.outputFiles[0].text;
      }
    }

    // Transform the code for legacy browsers using Babel
    console.log(`🔧 Transforming SW code for legacy browsers`);
    swCode = await transformJs(swCode, scriptUrl);

    // Add wrapper code
    const wrapper = generateSwWrapper(scriptUrl, scope);
    const finalCode = wrapper.prefix + swCode + wrapper.suffix;

    // Cache the result
    await setCache(scriptUrl, 'sw-bundle', Buffer.from(finalCode, 'utf-8'));

    return {
      code: finalCode,
      success: true,
      originalUrl: scriptUrl,
      scope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ SW bundling failed: ${message}`);

    // Return a fallback SW that logs the error
    const fallbackCode = `
// [Revamp] Service Worker Bundle Error
// Original URL: ${scriptUrl}
// Error: ${message.replace(/'/g, "\\'")}

self.addEventListener('install', function(event) {
  console.error('[Revamp SW] Failed to bundle Service Worker:', '${message.replace(/'/g, "\\'")}');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  // Pass through all fetch requests to network
  // The original SW could not be loaded
  event.respondWith(fetch(event.request));
});

console.log('[Revamp SW] Fallback Service Worker installed due to bundling error');
`;

    return {
      code: fallbackCode,
      success: false,
      error: message,
      originalUrl: scriptUrl,
      scope,
    };
  }
}

/**
 * Clear the SW module cache
 */
export function clearSwModuleCache(): void {
  moduleCache.clear();
}

/**
 * Get cache size
 */
export function getSwModuleCacheSize(): number {
  return moduleCache.size;
}
