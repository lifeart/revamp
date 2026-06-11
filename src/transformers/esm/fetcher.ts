/**
 * ES Module Bundler — module fetching
 *
 * HTTP(S) fetching of remote modules with redirect handling, a bounded
 * concurrent fetch queue, and LRU caching of fetched contents.
 *
 * @module transformers/esm/fetcher
 */

import { URL } from 'node:url';
import { log } from '../../logger/log.js';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getConfig } from '../../config/index.js';
import { moduleCache } from './module-cache.js';

// =============================================================================
// Types
// =============================================================================

/** Module fetch result */
export interface FetchResult {
  content: string;
  contentType: string;
  finalUrl: string;
}

// =============================================================================
// Constants
// =============================================================================

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
      log.warn(`[ESM Bundler] Failed to prefetch ${url}: ${error instanceof Error ? error.message : error}`);
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
      rejectUnauthorized: getConfig().allowInsecureUpstream !== true,
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
export async function fetchUrl(url: string, redirectCount = 0): Promise<FetchResult> {
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
