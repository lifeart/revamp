/**
 * Cache implementation for transformed content
 * Uses file-based caching with in-memory LRU for hot data
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config/index.js';

interface CacheEntry {
  data: Buffer;
  contentType: string;
  timestamp: number;
  url: string;
}

interface MemoryCacheEntry extends CacheEntry {
  size: number;
}

// In-memory LRU cache for hot data
const memoryCache = new Map<string, MemoryCacheEntry>();
const MAX_MEMORY_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
let currentMemorySize = 0;

// Domains that should never be cached (e.g., iCloud for authentication/sync)
const NO_CACHE_DOMAINS = [
  'icloud.com',
  'apple.com',
  'icloud-content.com',
  'me.com',
];

// URLs that are known to redirect - we shouldn't cache these
const redirectUrls = new Set<string>();

// Redirect status codes
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

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

function getCacheKey(url: string, contentType: string): string {
  const hash = createHash('sha256').update(`${url}:${contentType}`).digest('hex');
  return hash;
}

function getCachePath(key: string): string {
  const config = getConfig();
  const dir = join(config.cacheDir, key.substring(0, 2));
  return join(dir, key);
}

function ensureCacheDir(): void {
  const config = getConfig();
  if (!existsSync(config.cacheDir)) {
    mkdirSync(config.cacheDir, { recursive: true });
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

export async function getCached(url: string, contentType: string): Promise<Buffer | null> {
  const config = getConfig();
  if (!config.cacheEnabled) return null;
  if (shouldSkipCache(url)) return null;
  
  const key = getCacheKey(url, contentType);
  
  // Check memory cache first
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
  
  // Check file cache
  const cachePath = getCachePath(key);
  const metaPath = cachePath + '.meta';
  
  if (existsSync(cachePath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (Date.now() - meta.timestamp < config.cacheTTL * 1000) {
        const data = readFileSync(cachePath);
        
        // Add to memory cache
        const entry: MemoryCacheEntry = {
          data,
          contentType: meta.contentType,
          timestamp: meta.timestamp,
          url: meta.url,
          size: data.length,
        };
        
        while (currentMemorySize + entry.size > MAX_MEMORY_CACHE_SIZE && memoryCache.size > 0) {
          evictOldestFromMemory();
        }
        
        if (currentMemorySize + entry.size <= MAX_MEMORY_CACHE_SIZE) {
          memoryCache.set(key, entry);
          currentMemorySize += entry.size;
        }
        
        return data;
      }
      // Expired, clean up
      unlinkSync(cachePath);
      unlinkSync(metaPath);
    } catch {
      // Corrupted cache, ignore
    }
  }
  
  return null;
}

export async function setCache(url: string, contentType: string, data: Buffer): Promise<void> {
  const config = getConfig();
  if (!config.cacheEnabled) return;
  if (shouldSkipCache(url)) return;
  
  ensureCacheDir();
  
  const key = getCacheKey(url, contentType);
  const timestamp = Date.now();
  
  // Add to memory cache
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
  
  // Write to file cache
  const cachePath = getCachePath(key);
  const cacheDir = join(config.cacheDir, key.substring(0, 2));
  
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  
  writeFileSync(cachePath, data);
  writeFileSync(cachePath + '.meta', JSON.stringify({
    contentType,
    timestamp,
    url,
  }));
}

export function clearCache(): void {
  // Clear memory cache
  memoryCache.clear();
  currentMemorySize = 0;
  
  // Clear file cache
  const config = getConfig();
  if (existsSync(config.cacheDir)) {
    const subdirs = readdirSync(config.cacheDir);
    for (const subdir of subdirs) {
      const subdirPath = join(config.cacheDir, subdir);
      try {
        const stat = statSync(subdirPath);
        if (stat.isDirectory()) {
          const files = readdirSync(subdirPath);
          for (const file of files) {
            unlinkSync(join(subdirPath, file));
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }
}

export function getCacheStats(): { memoryEntries: number; memorySize: number } {
  return {
    memoryEntries: memoryCache.size,
    memorySize: currentMemorySize,
  };
}
