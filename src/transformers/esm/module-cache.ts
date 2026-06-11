/**
 * ES Module Bundler — module cache
 *
 * LRU cache for fetched module contents, shared between the fetcher and the
 * bundler orchestrator. Bounded at MAX_CACHE_SIZE: lookups refresh recency,
 * inserts evict only the least-recently-used entries when over the limit.
 *
 * @module transformers/esm/module-cache
 */

import { log } from '../../logger/log.js';

// =============================================================================
// Types
// =============================================================================

/** Cached module content */
export interface ModuleCacheEntry {
  content: string;
  url: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache size limit - evict least-recently-used entries when exceeded */
export const MAX_CACHE_SIZE = 500;

// =============================================================================
// LRU Cache
// =============================================================================

/**
 * Minimal LRU cache built on Map insertion order.
 *
 * A JS Map iterates keys in insertion order, so the first key is always the
 * least-recently-used entry as long as every access re-inserts the key:
 * - get() refreshes recency by deleting and re-setting the entry
 * - set() evicts the oldest entries once the size limit is exceeded
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  /** Look up a key, refreshing its recency on a hit */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    // Refresh recency: re-insert so the key moves to the back of the Map's
    // insertion order (most recently used).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Insert or update a key, evicting least-recently-used entries if over the limit */
  set(key: K, value: V): void {
    // Delete first so an overwrite also refreshes recency
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.evictToLimit();
  }

  /** Check for a key without refreshing recency */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Current number of entries */
  get size(): number {
    return this.map.size;
  }

  /** Remove all entries */
  clear(): void {
    this.map.clear();
  }

  /** Evict the oldest (least-recently-used) entries until within the limit */
  evictToLimit(): void {
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
  }

  /** Keys in least-recently-used → most-recently-used order */
  keys(): K[] {
    return [...this.map.keys()];
  }
}

// =============================================================================
// Shared Module Cache
// =============================================================================

/** Cache for fetched modules during bundling (LRU, bounded at MAX_CACHE_SIZE) */
export const moduleCache = new LruCache<string, ModuleCacheEntry>(MAX_CACHE_SIZE);

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
 * Evicts only the least-recently-used entries. The cache also self-bounds on
 * insert, so this is a safety valve for external callers.
 */
export function pruneModuleCacheIfNeeded(): void {
  if (moduleCache.size > MAX_CACHE_SIZE) {
    log.debug(`[ESM Bundler] Cache size exceeded ${MAX_CACHE_SIZE}, evicting least-recently-used entries`);
    moduleCache.evictToLimit();
  }
}
