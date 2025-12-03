/**
 * Cache implementation for transformed content
 * Uses file-based caching with in-memory LRU for hot data
 * All file operations are async for non-blocking I/O
 *
 * @module cache
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile, stat, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, getClientConfig, type ClientConfig } from '../config/index.js';

// =============================================================================
// Types
// =============================================================================

/** Base cache entry structure */
interface CacheEntry {
  data: Buffer;
  contentType: string;
  timestamp: number;
  url: string;
}

/** Memory cache entry with size tracking for LRU eviction */
interface MemoryCacheEntry extends CacheEntry {
  size: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum memory cache size (100MB) */
const MAX_MEMORY_CACHE_SIZE = 100 * 1024 * 1024;

/** Redirect status codes that should not be cached */
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

/** Domains that should never be cached (authentication/sync) */
const NO_CACHE_DOMAINS = [
  'icloud.com',
  'apple.com',
  'icloud-content.com',
  'me.com',
];

// =============================================================================
// State
// =============================================================================

/** In-memory LRU cache for hot data */
const memoryCache = new Map<string, MemoryCacheEntry>();

/** Current memory usage in bytes */
let currentMemorySize = 0;

/** URLs that are known to redirect - we shouldn't cache these */
const redirectUrls = new Set<string>();

/** Track if cache dir has been created */
let cacheDirInitialized = false;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if file exists (async)
 *
 * @param path - File path to check
 * @returns true if file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a status code is a redirect
 */
export function isRedirectStatus(statusCode: number): boolean {
  return REDIRECT_STATUS_CODES.includes(statusCode);
}

/**
 * Mark a URL as redirecting (so we don't cache it in the future)
 */
export function markAsRedirect(url: string): void {
  try {
    // Normalize URL by removing hash
    const normalized = new URL(url);
    normalized.hash = '';
    redirectUrls.add(normalized.href);
  } catch {
    redirectUrls.add(url);
  }
}

/**
 * Check if a URL is known to redirect
 */
function isKnownRedirect(url: string): boolean {
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    return redirectUrls.has(normalized.href);
  } catch {
    return redirectUrls.has(url);
  }
}

function shouldSkipCache(url: string): boolean {
  // Skip if this URL is known to redirect
  if (isKnownRedirect(url)) {
    return true;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return NO_CACHE_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function getCacheKey(url: string, contentType: string, clientIp?: string): string {
  // Include client IP and config hash in cache key
  // Config hash ensures cache is invalidated when client config changes
  const clientConfig = getClientConfig(clientIp);
  const configHash = createHash('md5')
    .update(JSON.stringify(clientConfig))
    .digest('hex')
    .substring(0, 8);

  const keySource = clientIp
    ? `${clientIp}:${configHash}:${url}:${contentType}`
    : `${configHash}:${url}:${contentType}`;
  const hash = createHash('sha256').update(keySource).digest('hex');
  return hash;
}

function getCachePath(key: string): string {
  const config = getConfig();
  const dir = join(config.cacheDir, key.substring(0, 2));
  return join(dir, key);
}

async function ensureCacheDir(): Promise<void> {
  if (cacheDirInitialized) return;

  const config = getConfig();
  try {
    await mkdir(config.cacheDir, { recursive: true });
    cacheDirInitialized = true;
  } catch {
    // Directory might already exist
    cacheDirInitialized = true;
  }
}

function evictOldestFromMemory(): void {
  // Simple LRU: remove first entry (oldest)
  const firstKey = memoryCache.keys().next().value;
  if (firstKey) {
    const entry = memoryCache.get(firstKey);
    if (entry) {
      currentMemorySize -= entry.size;
    }
    memoryCache.delete(firstKey);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get cached content for a URL.
 *
 * @param url - URL to look up
 * @param contentType - Content type for cache key
 * @param clientIp - Optional client IP for per-client cache separation
 * @returns Cached buffer or null if not found
 */
export async function getCached(url: string, contentType: string, clientIp?: string): Promise<Buffer | null> {
  const config = getConfig();
  if (!config.cacheEnabled) return null;
  if (shouldSkipCache(url)) return null;

  const key = getCacheKey(url, contentType, clientIp);

  // Check memory cache first (fast path)
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    if (Date.now() - memEntry.timestamp < config.cacheTTL * 1000) {
      // Move to end for LRU
      memoryCache.delete(key);
      memoryCache.set(key, memEntry);
      return memEntry.data;
    }
    // Expired, remove from memory
    currentMemorySize -= memEntry.size;
    memoryCache.delete(key);
  }

  // Check file cache (async)
  const cachePath = getCachePath(key);
  const metaPath = cachePath + '.meta';

  try {
    if (await fileExists(cachePath) && await fileExists(metaPath)) {
      const [dataBuffer, metaBuffer] = await Promise.all([
        readFile(cachePath),
        readFile(metaPath, 'utf-8'),
      ]);

      const meta = JSON.parse(metaBuffer);
      if (Date.now() - meta.timestamp < config.cacheTTL * 1000) {
        // Add to memory cache
        const entry: MemoryCacheEntry = {
          data: dataBuffer,
          contentType: meta.contentType,
          timestamp: meta.timestamp,
          url: meta.url,
          size: dataBuffer.length,
        };

        while (currentMemorySize + entry.size > MAX_MEMORY_CACHE_SIZE && memoryCache.size > 0) {
          evictOldestFromMemory();
        }

        if (currentMemorySize + entry.size <= MAX_MEMORY_CACHE_SIZE) {
          memoryCache.set(key, entry);
          currentMemorySize += entry.size;
        }

        return dataBuffer;
      }
      // Expired, clean up async (don't wait)
      Promise.all([unlink(cachePath), unlink(metaPath)]).catch(() => {});
    }
  } catch {
    // Cache miss or corrupted, ignore
  }

  return null;
}

export async function setCache(url: string, contentType: string, data: Buffer, clientIp?: string): Promise<void> {
  const config = getConfig();
  if (!config.cacheEnabled) return;
  if (shouldSkipCache(url)) return;

  await ensureCacheDir();

  const key = getCacheKey(url, contentType, clientIp);
  const timestamp = Date.now();

  // Add to memory cache (sync, fast)
  const entry: MemoryCacheEntry = {
    data,
    contentType,
    timestamp,
    url,
    size: data.length,
  };

  while (currentMemorySize + entry.size > MAX_MEMORY_CACHE_SIZE && memoryCache.size > 0) {
    evictOldestFromMemory();
  }

  if (currentMemorySize + entry.size <= MAX_MEMORY_CACHE_SIZE) {
    memoryCache.set(key, entry);
    currentMemorySize += entry.size;
  }

  // Write to file cache async (fire and forget for performance)
  const cachePath = getCachePath(key);
  const cacheDir = join(config.cacheDir, key.substring(0, 2));

  // Don't await - let file writes happen in background
  (async () => {
    try {
      await mkdir(cacheDir, { recursive: true });
      await Promise.all([
        writeFile(cachePath, data),
        writeFile(cachePath + '.meta', JSON.stringify({
          contentType,
          timestamp,
          url,
        })),
      ]);
    } catch {
      // Ignore write errors - memory cache is primary
    }
  })();
}

/**
 * Clear only the in-memory cache, preserving file cache
 * Useful for testing file cache persistence
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
  currentMemorySize = 0;
}

export function clearCache(): void {
  // Clear memory cache (sync)
  clearMemoryCache();
  cacheDirInitialized = false;

  // Clear file cache async (fire and forget)
  const config = getConfig();
  (async () => {
    try {
      const subdirs = await readdir(config.cacheDir);
      for (const subdir of subdirs) {
        const subdirPath = join(config.cacheDir, subdir);
        try {
          const stats = await stat(subdirPath);
          if (stats.isDirectory()) {
            const files = await readdir(subdirPath);
            await Promise.all(files.map(file => unlink(join(subdirPath, file)).catch(() => {})));
          }
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Cache dir doesn't exist, ignore
    }
  })();
}

export function getCacheStats(): { memoryEntries: number; memorySize: number } {
  return {
    memoryEntries: memoryCache.size,
    memorySize: currentMemorySize,
  };
}
