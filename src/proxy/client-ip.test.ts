/**
 * Client-IP Utility Tests
 *
 * `resolveBucketClientIp` is the shared helper both proxy stacks (HTTP +
 * SOCKS5) use to assign cert-mint rate-limit buckets. It originated in
 * `socks5.ts` and moved to its neutral home in `client-ip.ts`.
 *
 * Covers the P1-1 review finding (empty-clientIp DoS bucket): when
 * `socket.remoteAddress` is undefined every unknown client used to collapse
 * into a single shared 30/min cert-mint bucket. The helper now generates a
 * unique synthetic bucket ID per call instead.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetConfig } from '../config/index.js';
import { resetCertRateLimits, clearCertCache } from '../certs/index.js';

describe('resolveBucketClientIp — synthetic rate-limit buckets for unknown clients (P1-1)', () => {
  beforeEach(() => {
    resetConfig();
    resetCertRateLimits();
    clearCertCache();
  });

  it('returns the raw IP unchanged when present', async () => {
    const { resolveBucketClientIp } = await import('./client-ip.js');
    expect(resolveBucketClientIp('192.0.2.1')).toBe('192.0.2.1');
    expect(resolveBucketClientIp('::1')).toBe('::1');
  });

  it('generates a unique synthetic bucket per call when raw IP is empty', async () => {
    const { resolveBucketClientIp } = await import('./client-ip.js');
    const a = resolveBucketClientIp('');
    const b = resolveBucketClientIp('');
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    expect(a).not.toBe(b);
    expect(a.startsWith('__unknown_')).toBe(true);
    expect(b.startsWith('__unknown_')).toBe(true);
  });

  it('logs a warning whenever it falls back to a synthetic bucket', async () => {
    const { resolveBucketClientIp } = await import('./client-ip.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence in test */ });
    try {
      resolveBucketClientIp('');
      const matched = warnSpy.mock.calls.some(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('no client IP — using synthetic bucket')
      );
      expect(matched).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
