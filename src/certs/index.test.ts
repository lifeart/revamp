import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateCA,
  generateDomainCert,
  getCACert,
  clearCertCache,
  resetCertRateLimits,
  CertRateLimitError,
} from './index.js';
import { __testing } from './__testing.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Certificate Generation', () => {
  // mkdtempSync creates a uniquely-named directory with restrictive perms (0700)
  // — avoids the symlink/predictable-name races that `join(tmpdir(), ...)` has.
  const testCertDir = mkdtempSync(join(tmpdir(), 'revamp-test-certs-'));

  beforeEach(() => {
    resetConfig();
    updateConfig({
      certDir: testCertDir,
      caKeyFile: 'test-ca.key',
      caCertFile: 'test-ca.crt',
    });
    clearCertCache();
    resetCertRateLimits();

    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearCertCache();
    resetCertRateLimits();
    resetConfig();

    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true });
    }
  });

  describe('generateCA', () => {
    it('should generate a new CA certificate', () => {
      const { key, cert } = generateCA();

      expect(key).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(key).toContain('-----END RSA PRIVATE KEY-----');
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(cert).toContain('-----END CERTIFICATE-----');
    });

    it('should create certificate files', () => {
      generateCA();

      const keyPath = join(testCertDir, 'test-ca.key');
      const certPath = join(testCertDir, 'test-ca.crt');

      expect(existsSync(keyPath)).toBe(true);
      expect(existsSync(certPath)).toBe(true);
    });

    it('should reuse existing CA if files exist', () => {
      // Generate first CA
      const first = generateCA();

      // Generate again - should return same
      const second = generateCA();

      expect(first.cert).toBe(second.cert);
      expect(first.key).toBe(second.key);
    });

    it('should create cert directory if not exists', () => {
      expect(existsSync(testCertDir)).toBe(false);

      generateCA();

      expect(existsSync(testCertDir)).toBe(true);
    });
  });

  describe('generateDomainCert', () => {
    it('should generate domain certificate signed by CA', () => {
      const { key, cert } = generateDomainCert('example.com');

      expect(key).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    });

    it('should include domain in certificate', () => {
      const { cert } = generateDomainCert('example.com');

      // Certificate should be valid PEM format
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(cert).toContain('-----END CERTIFICATE-----');
    });

    it('should cache domain certificates', () => {
      const first = generateDomainCert('example.com');
      const second = generateDomainCert('example.com');

      // Should return same cached cert
      expect(first.cert).toBe(second.cert);
      expect(first.key).toBe(second.key);
    });

    it('should generate different certs for different domains', () => {
      const cert1 = generateDomainCert('example.com');
      const cert2 = generateDomainCert('test.org');

      expect(cert1.cert).not.toBe(cert2.cert);
      expect(cert1.key).not.toBe(cert2.key);
    });

    it('should auto-initialize CA if not done', () => {
      // Don't call generateCA first
      const { cert } = generateDomainCert('example.com');

      expect(cert).toContain('-----BEGIN CERTIFICATE-----');

      // CA should now be initialized (getCACert will work)
      const caCert = getCACert();
      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
    });
  });

  describe('getCACert', () => {
    it('should return CA certificate in PEM format', () => {
      generateCA();
      const caCert = getCACert();

      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
      expect(caCert).toContain('-----END CERTIFICATE-----');
    });

    it('should auto-generate CA if not exists', () => {
      const caCert = getCACert();

      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
    });

    it('should return same cert as generateCA', () => {
      const { cert } = generateCA();
      const caCert = getCACert();

      expect(caCert).toBe(cert);
    });
  });

  describe('clearCertCache', () => {
    it('should clear the certificate cache', () => {
      // Generate some domain certs to populate cache
      const first = generateDomainCert('example.com');

      clearCertCache();

      // Next call should generate new cert
      const second = generateDomainCert('example.com');

      // Keys should be different (new keypair generated)
      expect(first.key).not.toBe(second.key);
    });

    it('should not affect CA certificate', () => {
      const { cert: caCert } = generateCA();

      clearCertCache();

      // Domain cert cache cleared, but CA still on disk
      const caCert2 = getCACert();
      expect(caCert2).toBe(caCert);
    });
  });

  // T7: CA + per-domain key files must be 0600 on POSIX
  describe('private key file permissions (T7)', () => {
    const isPosix = process.platform !== 'win32';

    it.runIf(isPosix)('writes the CA key with mode 0600', () => {
      generateCA();
      const keyPath = join(testCertDir, 'test-ca.key');
      const mode = statSync(keyPath).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it.runIf(isPosix)('rewrites overly-permissive CA key to 0600 on next load', () => {
      generateCA();
      const keyPath = join(testCertDir, 'test-ca.key');
      // Simulate a key file that was created with default umask
      chmodSync(keyPath, 0o644);
      expect(statSync(keyPath).mode & 0o777).toBe(0o644);

      // Re-loading should re-tighten the mode
      generateCA();
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    });

    it('does not persist per-domain key files to disk', () => {
      // Per-domain certificates are ephemeral (in-memory cache only).
      // We pre-touch the path; generateDomainCert must NOT overwrite it.
      generateCA();
      const domain = 'no-persist.example';
      const keyPath = join(testCertDir, `${domain}.key`);
      const certPath = join(testCertDir, `${domain}.crt`);

      const sentinel = '__SENTINEL__';
      writeFileSync(keyPath, sentinel);
      writeFileSync(certPath, sentinel);

      generateDomainCert(domain);

      // Sentinel file content must be untouched: the function never writes.
      expect(readFileSync(keyPath, 'utf-8')).toBe(sentinel);
      expect(readFileSync(certPath, 'utf-8')).toBe(sentinel);
    });
  });

  // T11: bounded LRU cache + per-IP rate limit on cert minting
  describe('cert cache LRU + rate limiting (T11)', () => {
    it('default LRU cap is the documented 500 entries', () => {
      expect(__testing.defaultCacheMax()).toBe(500);
    });

    it('evicts the oldest entry when the cap is exceeded', () => {
      // Keep the cap small so we don't generate 500+ RSA keypairs in CI.
      // Logic under test (LRU eviction) is identical regardless of cap.
      try {
        __testing.setCacheMaxForTesting(8);
        const cap = __testing.cacheMax();

        const firstSni = 'lru-first.example';
        generateDomainCert(firstSni);
        expect(__testing.certCacheKeys()).toContain(firstSni);

        for (let i = 1; i < cap; i++) {
          generateDomainCert(`lru-fill-${i}.example`);
        }
        expect(__testing.certCacheSize()).toBe(cap);
        expect(__testing.certCacheKeys()).toContain(firstSni);

        // (cap+1)-th unique SNI must evict the oldest (firstSni)
        const overflowSni = 'lru-overflow.example';
        generateDomainCert(overflowSni);
        expect(__testing.certCacheSize()).toBe(cap);
        expect(__testing.certCacheKeys()).not.toContain(firstSni);
        expect(__testing.certCacheKeys()).toContain(overflowSni);
      } finally {
        __testing.resetCacheMaxForTesting();
      }
    }, 60_000);

    it('rate-limits the 31st mint within a minute for the same client IP', () => {
      const ip = '198.51.100.42';
      const limit = __testing.rateLimitMax();
      // 30 unique SNIs -> 30 mints -> all succeed
      for (let i = 0; i < limit; i++) {
        expect(() => generateDomainCert(`rl-${i}.example`, ip)).not.toThrow();
      }
      // 31st mint within the same minute must be rejected
      expect(() => generateDomainCert('rl-overflow.example', ip)).toThrowError(
        CertRateLimitError
      );
    }, 120_000);

    it('does not rate-limit cache hits', () => {
      const ip = '198.51.100.43';
      const limit = __testing.rateLimitMax();
      // First mint counts; subsequent calls hit the cache and bypass rate-limiting
      generateDomainCert('rl-cached.example', ip);
      for (let i = 0; i < limit + 5; i++) {
        expect(() => generateDomainCert('rl-cached.example', ip)).not.toThrow();
      }
    });

    it('tracks rate limits per client IP independently', () => {
      const limit = __testing.rateLimitMax();
      for (let i = 0; i < limit; i++) {
        generateDomainCert(`tenant-a-${i}.example`, '203.0.113.1');
      }
      // Different IP retains a fresh budget
      expect(() => generateDomainCert('tenant-b.example', '203.0.113.2')).not.toThrow();
    }, 120_000);
  });

  // Round 1 P1 #3: mintTimestampsByIp Map must self-prune.
  describe('mintTimestampsByIp self-pruning (round 1 P1 #3)', () => {
    afterEach(() => {
      vi.useRealTimers();
      __testing.resetMintGcIntervalForTesting();
    });

    it('drops stale IPs on the periodic GC sweep', () => {
      // Each `generateDomainCert` mints a 2048-bit RSA key — slow. We trim
      // the GC interval to 5 so we only need to mint ~10 certs total.
      __testing.setMintGcIntervalForTesting(5);

      const startTime = 1_700_000_000_000;
      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.setSystemTime(startTime);

      // Phase 1: 5 distinct IPs, each mint exactly once, then go quiet.
      const burstIps = 5;
      for (let i = 0; i < burstIps; i++) {
        generateDomainCert(`burst-${i}.example`, `10.0.0.${i}`);
      }
      // No GC has fired yet that drops anything (everyone is fresh).
      expect(__testing.mintTimestampMapSize()).toBe(burstIps);

      // Phase 2: slide the rate-limit window past every recorded timestamp.
      vi.setSystemTime(startTime + 61_000);

      // Phase 3: 5 new mints from a single fresh IP. The 5th mint trips the
      // GC interval (mintCounter % 5 === 0) and must drop every quiet IP.
      for (let i = 0; i < 5; i++) {
        generateDomainCert(`fresh-${i}.example`, '192.0.2.99');
      }

      // After GC: only the active fresh IP remains.
      expect(__testing.mintTimestampMapSize()).toBe(1);
    }, 120_000);

    it('does not retain empty arrays for stale IPs across resets', () => {
      generateDomainCert('reset-rl.example', '203.0.113.99');
      expect(__testing.mintTimestampMapSize()).toBeGreaterThan(0);
      resetCertRateLimits();
      expect(__testing.mintTimestampMapSize()).toBe(0);
      expect(__testing.mintCounter()).toBe(0);
    });
  });

  // Round 1 P1 #5: getCachedCert must extend TTL on touch.
  describe('cert cache TTL refresh on touch (round 1 P1 #5)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('a re-touched entry survives past its original expiresAt', () => {
      const startTime = 1_700_000_000_000;
      const ttl = __testing.cacheTtlMs();

      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.setSystemTime(startTime);

      // Insert at t=0
      generateDomainCert('ttl-touch.example');
      expect(__testing.certCacheKeys()).toContain('ttl-touch.example');

      // Advance to 0.6× TTL — entry still valid.
      vi.setSystemTime(startTime + Math.floor(ttl * 0.6));
      const touched = generateDomainCert('ttl-touch.example');
      expect(touched.cert).toContain('-----BEGIN CERTIFICATE-----');

      // Advance another 0.6× TTL (total 1.2× TTL since insert).
      // If TTL refresh on touch is broken, this fails — the entry would be
      // evicted by `pruneExpiredCacheEntries` since its `expiresAt` was set
      // at t=0 and we're now past t=TTL.
      vi.setSystemTime(startTime + Math.floor(ttl * 1.2));
      const stillValid = generateDomainCert('ttl-touch.example');
      // Touch at 0.6× TTL extended life by another full TTL, so we should
      // still get the same cached cert (same key bytes).
      expect(stillValid.key).toBe(touched.key);
      expect(stillValid.cert).toBe(touched.cert);
    });
  });
});
