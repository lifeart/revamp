import { describe, it, expect } from 'vitest';
import { shouldBlockDomain, shouldBlockUrl } from './blocking.js';
import { type RevampConfig } from '../config/index.js';

describe('shouldBlockDomain', () => {
  const mockConfig = {
    transformJs: true,
    transformCss: true,
    transformHtml: true,
    removeAds: true,
    removeTracking: true,
    spoofUserAgent: false,
    cacheEnabled: true,
    cacheTTL: 3600000,
    adDomains: ['doubleclick.net', 'googlesyndication.com', 'ads.example.com'],
    trackingDomains: ['google-analytics.com', 'facebook.com/tr'],
    trackingUrls: [],
  } as unknown as RevampConfig;

  it('should block ad domains when removeAds is enabled', () => {
    expect(shouldBlockDomain('ad.doubleclick.net', mockConfig)).toBe(true);
    expect(shouldBlockDomain('pagead2.googlesyndication.com', mockConfig)).toBe(true);
    expect(shouldBlockDomain('ads.example.com', mockConfig)).toBe(true);
  });

  it('should block tracking domains when removeTracking is enabled', () => {
    expect(shouldBlockDomain('www.google-analytics.com', mockConfig)).toBe(true);
  });

  it('should not block regular domains', () => {
    expect(shouldBlockDomain('example.com', mockConfig)).toBe(false);
    expect(shouldBlockDomain('google.com', mockConfig)).toBe(false);
  });

  it('should not block when removeAds is disabled', () => {
    const configNoAds = { ...mockConfig, removeAds: false };
    expect(shouldBlockDomain('ad.doubleclick.net', configNoAds)).toBe(false);
  });

  it('should not block tracking when removeTracking is disabled', () => {
    const configNoTracking = { ...mockConfig, removeTracking: false };
    expect(shouldBlockDomain('www.google-analytics.com', configNoTracking)).toBe(false);
  });
});

describe('shouldBlockUrl', () => {
  const mockConfig = {
    removeTracking: true,
    trackingUrls: ['/analytics.js', '/gtag/js', '/metrics', '/stat', '/hit'],
  } as unknown as RevampConfig;

  it('should block URLs matching tracking patterns by exact path', () => {
    expect(shouldBlockUrl('https://example.com/analytics.js', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/metrics', mockConfig)).toBe(true);
  });

  it('should block URLs where pattern is a prefix path segment', () => {
    expect(shouldBlockUrl('https://example.com/gtag/js?id=123', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/stat/click?id=1', mockConfig)).toBe(true);
  });

  it('should not block regular URLs', () => {
    expect(shouldBlockUrl('https://example.com/app.js', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/page', mockConfig)).toBe(false);
  });

  it('should not produce false positives via substring overlap (T19)', () => {
    // /stat must NOT match /architect/...
    expect(shouldBlockUrl('https://example.com/architect/page', mockConfig)).toBe(false);
    // /hit must NOT match /health-status/...
    expect(shouldBlockUrl('https://example.com/health-status/check', mockConfig)).toBe(false);
    // /metrics must NOT match /metricstore/...
    expect(shouldBlockUrl('https://example.com/metricstore/x', mockConfig)).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(shouldBlockUrl('https://example.com/ANALYTICS.JS', mockConfig)).toBe(true);
    expect(shouldBlockUrl('https://example.com/Analytics.js', mockConfig)).toBe(true);
  });

  it('should not block when removeTracking is disabled', () => {
    const configNoTracking = { ...mockConfig, removeTracking: false };
    expect(shouldBlockUrl('https://example.com/analytics.js', configNoTracking)).toBe(false);
  });

  it('should never block internal Revamp API endpoints', () => {
    // Even though /metrics is in the block list, /__revamp__/metrics should NOT be blocked
    expect(shouldBlockUrl('https://example.com/__revamp__/metrics', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://2ip.ru/__revamp__/metrics', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/metrics/json', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/config', mockConfig)).toBe(false);
    expect(shouldBlockUrl('https://example.com/__revamp__/pac/socks5', mockConfig)).toBe(false);
  });
});
