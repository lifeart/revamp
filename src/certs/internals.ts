/**
 * Internal mutable state for the cert subsystem.
 *
 * This module exists so `index.ts` and the test-only `__testing.ts` can share
 * private references without re-exporting them through the package surface.
 *
 * Treat every export here as PRIVATE: consumers must go through `index.ts`.
 */

import type { CertificatePair } from './types.js';

/**
 * Cache entry: mints to PEM strings and records the absolute expiry epoch.
 */
export interface CacheEntry {
  pair: CertificatePair;
  expiresAt: number;
}

/** Default soft cap on the per-SNI cert cache. */
export const DEFAULT_CERT_CACHE_MAX = 500;

/** TTL applied to each cached cert (refreshed on touch). */
export const CERT_CACHE_TTL_MS = 10 * 60 * 1000;

/** Sliding-window length for per-IP cert mint rate-limiting. */
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Max number of mints allowed within the window per client IP. */
export const RATE_LIMIT_MAX = 30;

/** Restrictive POSIX file mode for private-key writes. */
export const KEY_FILE_MODE = 0o600;

/** POSIX-like platforms where chmod is meaningful. */
export const POSIX_PLATFORMS = new Set([
  'darwin',
  'linux',
  'freebsd',
  'openbsd',
  'netbsd',
  'sunos',
  'aix',
]);

/** LRU cache (insertion-ordered Map) for generated domain certificates. */
export const certCache = new Map<string, CacheEntry>();

/** Per-IP cert mint timestamps for sliding-window rate limiting. */
export const mintTimestampsByIp = new Map<string, number[]>();

/** Periodic GC interval — every Nth successful mint, prune stale IPs. */
export const DEFAULT_MINT_GC_INTERVAL = 100;

/**
 * Mutable runtime knobs. We keep them on a single object so the test hatch
 * can flip them without touching the production export surface.
 */
export const state = {
  /** Effective cap for the cert cache (overridable from tests). */
  certCacheMax: DEFAULT_CERT_CACHE_MAX,
  /** Counter that drives periodic GC of stale IP entries. */
  mintCounter: 0,
  /** Effective GC interval (overridable from tests). */
  mintGcInterval: DEFAULT_MINT_GC_INTERVAL,
};
