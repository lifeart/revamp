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
import { getProfileForDomain } from '../config/domain-manager.js';
import { recordError } from '../metrics/index.js';

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
    // Not a real error: ENOENT is the negative answer we are asking about.
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
    // Malformed URL: store as-is rather than dropping the redirect mark.
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
    // Mirrors markAsRedirect's fallback path for malformed URLs.
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
    // Malformed URL: don't skip — getCacheKey handles the same case.
    return false;
  }
}

/**
 * Compute a stable fingerprint of authenticated request identity, derived from
 * Cookie / Authorization header *names* (not values). Two clients sharing one
 * NAT'd IP but holding different session cookies must end up with different
 * cache keys; this prevents cross-user data leaks via the shared on-disk cache.
 *
 * We only hash the *names* (e.g. "session", "csrftoken") so users with the
 * same logged-in shape share entries. To be ultra-safe, anonymous requests
 * (no Cookie/Authorization) keep their own bucket separate from authenticated
 * ones via the literal "anon" sentinel.
 */
function getAuthFingerprint(requestHeaders?: Record<string, string | string[] | undefined>): string {
  if (!requestHeaders) return 'anon';

  const cookieHeader = getHeader(requestHeaders, 'cookie');
  const authHeader = getHeader(requestHeaders, 'authorization');

  if (!cookieHeader && !authHeader) return 'anon';

  const cookieNames: string[] = [];
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase();
      if (name) cookieNames.push(name);
    }
    cookieNames.sort();
  }

  const authPresent = authHeader ? '1' : '0';
  return createHash('sha256')
    .update(`${authPresent}:${cookieNames.join(',')}`)
    .digest('hex')
    .substring(0, 16);
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  // Headers may arrive with mixed case from different stacks; normalize lookup.
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (Array.isArray(v)) return v.join('; ');
      return v;
    }
  }
  return undefined;
}

/**
 * T41: parse a `Vary` header into a deduplicated, lower-cased list of
 * request-header names. Returns the literal `['*']` for `Vary: *` so the
 * caller can refuse to cache. Multi-valued / array `Vary` values are joined.
 */
function parseVaryHeader(
  responseHeaders?: Record<string, string | string[] | undefined>
): string[] | null {
  if (!responseHeaders) return null;
  const raw = getHeader(responseHeaders, 'vary');
  if (!raw) return null;
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.includes('*')) return ['*'];
  // De-duplicate, sort for stable hashing.
  return Array.from(new Set(tokens)).sort();
}

/**
 * T41: derive the per-request Vary fingerprint. For each header NAME in the
 * varied list, fold the request's value (or empty string when absent) into
 * a single sha256. The result is sliced to 16 hex chars to match the rest
 * of the cache-key fragments.
 */
function getVaryFingerprint(
  varyNames: string[],
  requestHeaders?: Record<string, string | string[] | undefined>
): string {
  const parts: string[] = [];
  for (const name of varyNames) {
    const value = requestHeaders ? getHeader(requestHeaders, name) ?? '' : '';
    parts.push(`${name}=${value}`);
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex').substring(0, 16);
}

function getCacheKey(
  url: string,
  contentType: string,
  clientIp?: string,
  method: string = 'GET',
  requestHeaders?: Record<string, string | string[] | undefined>,
  varyNames?: string[]
): string {
  // Include client IP, config hash, and domain profile hash in cache key
  // This ensures cache is invalidated when client config or domain profile changes

  // Extract domain from URL for profile lookup
  let domain = 'unknown';
  try {
    domain = new URL(url).hostname;
  } catch {
    // Invalid URL: fall through to the 'unknown' default profile.
  }

  // Get domain profile hash
  const { profile } = getProfileForDomain(domain);
  const profileHash = profile
    ? createHash('md5')
        .update(JSON.stringify({
          id: profile.id,
          updatedAt: profile.updatedAt,
          transforms: profile.transforms,
          removeAds: profile.removeAds,
          removeTracking: profile.removeTracking,
        }))
        .digest('hex')
        .substring(0, 8)
    : 'none';

  // Get client config hash
  const clientConfig = getClientConfig(clientIp);
  const configHash = createHash('md5')
    .update(JSON.stringify(clientConfig))
    .digest('hex')
    .substring(0, 8);

  const upperMethod = method.toUpperCase();
  const authFingerprint = getAuthFingerprint(requestHeaders);

  // T41: include the Vary fingerprint in the key when we know the upstream
  // varied this response on request headers. The base key (without Vary
  // suffix) is what we use for the .vary sidecar lookup at read time.
  const varySuffix =
    varyNames && varyNames.length > 0 && varyNames[0] !== '*'
      ? `:vary=${getVaryFingerprint(varyNames, requestHeaders)}`
      : '';

  // Build cache key with all components
  const keySource = clientIp
    ? `${clientIp}:${profileHash}:${configHash}:${upperMethod}:${authFingerprint}:${url}:${contentType}${varySuffix}`
    : `${profileHash}:${configHash}:${upperMethod}:${authFingerprint}:${url}:${contentType}${varySuffix}`;
  const hash = createHash('sha256').update(keySource).digest('hex');
  return hash;
}

/**
 * Returns true when the response carries headers that forbid shared caching.
 * Set-Cookie tags the response as user-specific; Cache-Control: no-store
 * forbids any persistence; Cache-Control: private forbids shared caches
 * (and Revamp is a shared cache by design).
 *
 * Cache-Control directives are tokenized (split on commas / whitespace and
 * stripped of any `=value` argument) so that a substring like `private` does
 * not falsely trigger on a vendor token such as `x-private-cdn`.
 */
function isResponseUncacheable(
  responseHeaders?: Record<string, string | string[] | undefined>
): boolean {
  if (!responseHeaders) return false;

  if (getHeader(responseHeaders, 'set-cookie')) {
    return true;
  }

  const cacheControl = getHeader(responseHeaders, 'cache-control');
  if (cacheControl) {
    const tokens = cacheControl
      .split(/[,\s]+/)
      .map(part => part.trim().toLowerCase().split('=')[0])
      .filter(Boolean);
    if (tokens.includes('no-store') || tokens.includes('private')) {
      return true;
    }
  }

  return false;
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
  } catch (err) {
    // mkdir with recursive:true should not fail unless the path is unwritable.
    // Surface so we don't silently degrade to a non-functional cache.
    console.warn('[cache] failed to ensure cache dir', err);
    recordError();
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
 * @param method - Optional HTTP method (default GET); part of cache key so
 *   non-GET requests do not share cache buckets with GETs
 * @param requestHeaders - Optional request headers; Cookie/Authorization names
 *   are folded into the key so authenticated users never share cache entries
 * @returns Cached buffer or null if not found
 */
/**
 * T41: in-memory mirror of every `<key>.vary` sidecar we've written. We need
 * the names at READ time (before we've ever seen a response), and pulling
 * them off disk on every get would cost an extra `readFile`. The map is
 * keyed by the BASE (no-Vary) cache key and holds the sorted, lower-cased
 * list of varied request-header names that were active when the entry was
 * written.
 */
const varyMemo = new Map<string, string[]>();

/**
 * T41: read a Vary sidecar from disk if memory missed it. Returns `null` for
 * "no sidecar" (the entry wasn't written with Vary, or was never cached).
 */
async function loadVaryNames(baseKey: string): Promise<string[] | null> {
  const cached = varyMemo.get(baseKey);
  if (cached) return cached;
  const sidecarPath = getCachePath(baseKey) + '.vary';
  try {
    const raw = await readFile(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw) as { names: string[] };
    if (Array.isArray(parsed?.names)) {
      varyMemo.set(baseKey, parsed.names);
      return parsed.names;
    }
    return null;
  } catch {
    // ENOENT is the common case (no sidecar). Treat any error as "no Vary".
    return null;
  }
}

export async function getCached(
  url: string,
  contentType: string,
  clientIp?: string,
  method: string = 'GET',
  requestHeaders?: Record<string, string | string[] | undefined>
): Promise<Buffer | null> {
  const config = getConfig();
  if (!config.cacheEnabled) return null;
  if (shouldSkipCache(url)) return null;

  // T41: derive the BASE key (no Vary suffix). If a previous setCache wrote
  // a `<key>.vary` sidecar for this URL, we need to know the varied header
  // names so the actual key we look up folds in those request-header values.
  // Otherwise the BASE key IS the lookup key.
  const baseKey = getCacheKey(url, contentType, clientIp, method, requestHeaders);
  const varyNames = await loadVaryNames(baseKey);
  const key = varyNames
    ? getCacheKey(url, contentType, clientIp, method, requestHeaders, varyNames)
    : baseKey;

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
      Promise.all([unlink(cachePath), unlink(metaPath)]).catch((err: unknown) => {
        console.warn('[cache] failed to unlink expired entry', err);
        recordError();
      });
    }
  } catch (err) {
    // File-cache miss path: any error here means we treat as a miss and
    // re-fetch upstream. Log so corruption is investigatable.
    console.warn('[cache] file-cache read failed', err);
    recordError();
  }

  return null;
}

export async function setCache(
  url: string,
  contentType: string,
  data: Buffer,
  clientIp?: string,
  method: string = 'GET',
  requestHeaders?: Record<string, string | string[] | undefined>,
  responseHeaders?: Record<string, string | string[] | undefined>
): Promise<void> {
  const config = getConfig();
  if (!config.cacheEnabled) return;
  if (shouldSkipCache(url)) return;
  // Never cache responses that the origin marked as user-specific or non-storable.
  if (isResponseUncacheable(responseHeaders)) return;

  // T41: parse the response Vary header and refuse to cache `Vary: *` (RFC 7234
  // marks any response with `Vary: *` as uncacheable since literally any header
  // could vary it). For other Vary values we use a TWO-LEVEL key:
  //   - `baseKey`  — never folds Vary header values into the hash. Used as the
  //                  on-disk anchor for the `.vary` sidecar so future reads can
  //                  discover which request headers to fold in.
  //   - `key`      — the actual storage key, includes the per-request Vary
  //                  fingerprint, so two requests that differ only in
  //                  `Accept-Language` end up in DIFFERENT cache buckets.
  const varyNames = parseVaryHeader(responseHeaders);
  if (varyNames && varyNames.length === 1 && varyNames[0] === '*') {
    // RFC 7234 §4.1: Vary: * means the response is uncacheable.
    return;
  }

  await ensureCacheDir();

  const baseKey = getCacheKey(url, contentType, clientIp, method, requestHeaders);
  const key = varyNames
    ? getCacheKey(url, contentType, clientIp, method, requestHeaders, varyNames)
    : baseKey;
  const timestamp = Date.now();

  // T41: remember the Vary names in-memory so getCached can discover them
  // synchronously on the hot path. The disk sidecar below mirrors this for
  // restart durability.
  if (varyNames) {
    varyMemo.set(baseKey, varyNames);
  }

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
  // T41: sidecar lives next to the BASE key (no Vary suffix). On read we look
  // up the sidecar by baseKey to learn which headers to fold in for the real
  // lookup key. The sidecar dir is the same as the base entry's two-char dir.
  const sidecarPath = varyNames ? getCachePath(baseKey) + '.vary' : null;
  const sidecarDir = varyNames ? join(config.cacheDir, baseKey.substring(0, 2)) : null;

  // Don't await - let file writes happen in background
  void (async () => {
    try {
      await mkdir(cacheDir, { recursive: true });
      const writes: Promise<void>[] = [
        writeFile(cachePath, data),
        writeFile(cachePath + '.meta', JSON.stringify({
          contentType,
          timestamp,
          url,
        })),
      ];
      // T41: sidecar must NOT silently fail — if it's missing on a future
      // read, getCached will compute the wrong (Vary-less) key and serve the
      // wrong variant. Surface failures via recordError so they're visible.
      if (sidecarPath && sidecarDir && varyNames) {
        if (sidecarDir !== cacheDir) {
          await mkdir(sidecarDir, { recursive: true });
        }
        writes.push(
          writeFile(sidecarPath, JSON.stringify({ names: varyNames }))
        );
      }
      await Promise.all(writes);
    } catch (err) {
      console.warn('[cache] file-cache write failed', err);
      recordError();
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
  void (async () => {
    try {
      const subdirs = await readdir(config.cacheDir);
      for (const subdir of subdirs) {
        const subdirPath = join(config.cacheDir, subdir);
        try {
          const stats = await stat(subdirPath);
          if (stats.isDirectory()) {
            const files = await readdir(subdirPath);
            await Promise.all(files.map(file => unlink(join(subdirPath, file)).catch((err: unknown) => {
              console.warn('[cache] failed to unlink', join(subdirPath, file), err);
              recordError();
            })));
          }
        } catch (err) {
          console.warn('[cache] failed to clear subdir', subdirPath, err);
          recordError();
        }
      }
    } catch {
      // Best-effort cleanup; missing cache dir is normal in fresh installs.
    }
  })();
}

export function getCacheStats(): { memoryEntries: number; memorySize: number } {
  return {
    memoryEntries: memoryCache.size,
    memorySize: currentMemorySize,
  };
}
