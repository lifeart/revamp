import { describe, it, expect } from 'vitest';
import {
  shouldBlockUrlWithProfile,
  pathMatchesBlocklistPattern,
  type FilterContext,
} from './index.js';
import { shouldBlockUrl } from '../proxy/shared.js';
import { resetConfig, updateConfig, type RevampConfig } from '../config/index.js';

// A filter context with no profile — exercises the global-tracking-URLs path
// (the runtime-hot path where the previous substring bug lived).
const profilelessContext: FilterContext = {
  domain: 'example.com',
  url: 'https://example.com/',
  profile: null,
};

describe('pathMatchesBlocklistPattern (T19 helper)', () => {
  it('matches exact path equal to pattern', () => {
    expect(pathMatchesBlocklistPattern('/metrics', '/metrics')).toBe(true);
    expect(pathMatchesBlocklistPattern('/metrics', 'metrics')).toBe(true);
  });

  it('matches when pattern is a leading path segment', () => {
    expect(pathMatchesBlocklistPattern('/stat/click', '/stat')).toBe(true);
    expect(pathMatchesBlocklistPattern('/gtag/js', 'gtag/js')).toBe(true);
  });

  it('matches when pattern is a trailing path segment', () => {
    // The bug from #3: a leading-slash pattern must still match deeper paths.
    expect(pathMatchesBlocklistPattern('/api/v1/metrics', '/metrics')).toBe(true);
    expect(pathMatchesBlocklistPattern('/api/v1/metrics', 'metrics')).toBe(true);
  });

  it('does NOT match when pattern is a substring inside an unrelated path segment', () => {
    // The original substring-includes flaw: must NOT match these.
    expect(pathMatchesBlocklistPattern('/architect/page', '/stat')).toBe(false);
    expect(pathMatchesBlocklistPattern('/health-status/check', '/hit')).toBe(false);
    expect(pathMatchesBlocklistPattern('/metricstore/x', '/metrics')).toBe(false);
    expect(pathMatchesBlocklistPattern('/architectural', 'stat')).toBe(false);
  });

  it('returns false for an empty / slash-only pattern (defensive)', () => {
    expect(pathMatchesBlocklistPattern('/anything', '')).toBe(false);
    expect(pathMatchesBlocklistPattern('/anything', '/')).toBe(false);
    expect(pathMatchesBlocklistPattern('/anything', '////')).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(pathMatchesBlocklistPattern('/METRICS', '/metrics')).toBe(true);
    expect(pathMatchesBlocklistPattern('/api/v1/Metrics', 'METRICS')).toBe(true);
  });

  it('matches multi-segment patterns sitting in the interior of the path (P1-A)', () => {
    // Pattern is a multi-segment chunk that appears between two other segments.
    expect(pathMatchesBlocklistPattern('/foo/gtag/js/x.js', 'gtag/js')).toBe(true);
    expect(pathMatchesBlocklistPattern('/foo/gtag/js', 'gtag/js')).toBe(true);
    expect(pathMatchesBlocklistPattern('/api/metrics/v1/foo', 'metrics/v1')).toBe(true);
  });

  it('matches when pattern has both leading AND trailing slashes (P1-B)', () => {
    // Trailing-slash patterns previously normalized to `foo/` and never matched.
    expect(pathMatchesBlocklistPattern('/foo/bar', '/foo/')).toBe(true);
    expect(pathMatchesBlocklistPattern('/foo', '/foo/')).toBe(true);
    expect(pathMatchesBlocklistPattern('/api/v1/foo/bar', '/foo/')).toBe(true);
  });
});

describe('shouldBlockUrlWithProfile (T19 follow-up — primary runtime path)', () => {
  it('blocks tracking URL when path equals pattern (with leading-slash pattern)', () => {
    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/metrics',
        profilelessContext,
        true,
        ['/metrics'],
      ),
    ).toBe(true);
  });

  it('blocks tracking URL when pattern matches a deeper path segment (T19 #3)', () => {
    // Pattern starts with '/', target path nests deeper. Without leading-slash
    // normalization this would silently fail to match.
    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/api/v1/metrics',
        profilelessContext,
        true,
        ['/metrics'],
      ),
    ).toBe(true);
  });

  it('does NOT false-positive on substring overlap (T19 #2 regression)', () => {
    // Pre-fix: pattern '/stat' would match '/architect/' because the matcher
    // used `urlLower.includes(pattern)`. That was the production bug — this
    // test pins the fix.
    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/architect/page',
        profilelessContext,
        true,
        ['/stat'],
      ),
    ).toBe(false);

    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/health-status/check',
        profilelessContext,
        true,
        ['/hit'],
      ),
    ).toBe(false);

    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/metricstore/x',
        profilelessContext,
        true,
        ['/metrics'],
      ),
    ).toBe(false);
  });

  it('returns false for Revamp internal endpoints regardless of patterns', () => {
    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/__revamp__/metrics',
        profilelessContext,
        true,
        ['/metrics'],
      ),
    ).toBe(false);
  });

  it('returns false when removeTracking is disabled', () => {
    expect(
      shouldBlockUrlWithProfile(
        'https://example.com/metrics',
        profilelessContext,
        false,
        ['/metrics'],
      ),
    ).toBe(false);
  });
});

describe('pattern /metrics matches /api/v1/metrics through both runtime paths (T19 #3)', () => {
  // Sibling regression coverage: both the fallback path in shared.ts and the
  // primary path in filters/index.ts must agree on this case after the fix.
  const trackingPatterns = ['/metrics'];
  const url = 'https://example.com/api/v1/metrics';

  it('blocks via shouldBlockUrlWithProfile (with FilterContext)', () => {
    expect(
      shouldBlockUrlWithProfile(url, profilelessContext, true, trackingPatterns),
    ).toBe(true);
  });

  it('blocks via shouldBlockUrl (no FilterContext fallback path)', () => {
    resetConfig();
    updateConfig({
      removeTracking: true,
      trackingUrls: trackingPatterns,
    } as Partial<RevampConfig>);

    try {
      expect(shouldBlockUrl(url)).toBe(true);
    } finally {
      resetConfig();
    }
  });
});
