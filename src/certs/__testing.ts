/**
 * Test-only inspection / mutation hooks for the cert subsystem.
 *
 * IMPORTANT: This module is excluded from `dist/` (see `tsconfig.json`) and is
 * NOT re-exported from `src/certs/index.ts` or any `package.json#exports`
 * subpath. Tests must import it via the relative path.
 *
 * If this file ever ends up in a published tarball that's a regression — see
 * the build verification step in `tasks.md` (T11 review round 1).
 */

import {
  CERT_CACHE_TTL_MS,
  DEFAULT_CERT_CACHE_MAX,
  DEFAULT_MINT_GC_INTERVAL,
  RATE_LIMIT_MAX,
  certCache,
  mintTimestampsByIp,
  state,
} from './internals.js';

export const __testing = {
  certCacheSize: () => certCache.size,
  certCacheKeys: () => Array.from(certCache.keys()),
  rateLimitMax: () => RATE_LIMIT_MAX,
  cacheMax: () => state.certCacheMax,
  defaultCacheMax: () => DEFAULT_CERT_CACHE_MAX,
  cacheTtlMs: () => CERT_CACHE_TTL_MS,
  mintTimestampMapSize: () => mintTimestampsByIp.size,
  /** Snapshot of per-IP rate-limit bucket keys (used by P1-1 isolation tests). */
  mintTimestampKeys: () => Array.from(mintTimestampsByIp.keys()),
  mintCounter: () => state.mintCounter,
  mintGcInterval: () => state.mintGcInterval,
  setCacheMaxForTesting(value: number): void {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error('cache max must be >= 1');
    }
    state.certCacheMax = value;
  },
  resetCacheMaxForTesting(): void {
    state.certCacheMax = DEFAULT_CERT_CACHE_MAX;
  },
  setMintGcIntervalForTesting(value: number): void {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error('mint GC interval must be >= 1');
    }
    state.mintGcInterval = value;
  },
  resetMintGcIntervalForTesting(): void {
    state.mintGcInterval = DEFAULT_MINT_GC_INTERVAL;
  },
};
