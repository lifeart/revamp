import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfig,
  updateConfig,
  resetConfig,
  defaultConfig,
  getClientConfig,
  setClientConfig,
  resetClientConfig,
  getEffectiveConfig,
  type RevampConfig,
  type ClientConfig,
} from './index.js';

describe('defaultConfig', () => {
  it('should have valid server ports', () => {
    expect(defaultConfig.socks5Port).toBe(1080);
    expect(defaultConfig.httpProxyPort).toBe(8080);
    expect(defaultConfig.captivePortalPort).toBe(8888);
  });

  it('should bind to all interfaces by default', () => {
    expect(defaultConfig.bindAddress).toBe('0.0.0.0');
  });

  it('should target Safari 9 and iOS 9', () => {
    expect(defaultConfig.targets).toContain('safari 9');
    expect(defaultConfig.targets).toContain('ios 9');
  });

  it('should have transformations enabled by default', () => {
    expect(defaultConfig.transformJs).toBe(true);
    expect(defaultConfig.transformCss).toBe(true);
    expect(defaultConfig.transformHtml).toBe(true);
  });

  it('should have ad and tracking removal enabled by default', () => {
    expect(defaultConfig.removeAds).toBe(true);
    expect(defaultConfig.removeTracking).toBe(true);
  });

  it('should have polyfill injection enabled by default', () => {
    expect(defaultConfig.injectPolyfills).toBe(true);
  });

  it('should have user agent spoofing enabled by default', () => {
    expect(defaultConfig.spoofUserAgent).toBe(true);
    expect(defaultConfig.spoofUserAgentInJs).toBe(true);
  });

  it('should have sensible compression level', () => {
    expect(defaultConfig.compressionLevel).toBe(4);
    expect(defaultConfig.compressionLevel).toBeGreaterThanOrEqual(1);
    expect(defaultConfig.compressionLevel).toBeLessThanOrEqual(9);
  });

  it('should have cache enabled with 1 hour TTL', () => {
    expect(defaultConfig.cacheEnabled).toBe(true);
    expect(defaultConfig.cacheTTL).toBe(3600);
  });

  it('should have certificate directory configured', () => {
    expect(defaultConfig.certDir).toBe('./.revamp-certs');
    expect(defaultConfig.caKeyFile).toBe('ca.key');
    expect(defaultConfig.caCertFile).toBe('ca.crt');
  });

  it('should have empty whitelist and blacklist', () => {
    expect(defaultConfig.whitelist).toEqual([]);
    expect(defaultConfig.blacklist).toEqual([]);
  });

  it('should have ad domains list', () => {
    expect(defaultConfig.adDomains).toContain('doubleclick.net');
    expect(defaultConfig.adDomains).toContain('googlesyndication.com');
    expect(defaultConfig.adDomains.length).toBeGreaterThan(0);
  });

  it('should have tracking domains list', () => {
    expect(defaultConfig.trackingDomains).toContain('google-analytics.com');
    expect(defaultConfig.trackingDomains).toContain('googletagmanager.com');
    expect(defaultConfig.trackingDomains.length).toBeGreaterThan(0);
  });

  it('should have tracking URL patterns', () => {
    expect(defaultConfig.trackingUrls).toContain('/analytics');
    expect(defaultConfig.trackingUrls).toContain('/metrics');
    expect(defaultConfig.trackingUrls.length).toBeGreaterThan(0);
  });
});

describe('getConfig', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('should return current config', () => {
    const config = getConfig();
    expect(config.socks5Port).toBe(1080);
    expect(config.transformJs).toBe(true);
  });

  it('should return updated config after updateConfig', () => {
    updateConfig({ socks5Port: 9999 });
    const config = getConfig();
    expect(config.socks5Port).toBe(9999);
  });
});

describe('updateConfig', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('should update single property', () => {
    updateConfig({ socks5Port: 2080 });
    expect(getConfig().socks5Port).toBe(2080);
    // Other properties should remain unchanged
    expect(getConfig().httpProxyPort).toBe(8080);
  });

  it('should update multiple properties', () => {
    updateConfig({
      socks5Port: 2080,
      httpProxyPort: 9080,
      transformJs: false,
    });
    const config = getConfig();
    expect(config.socks5Port).toBe(2080);
    expect(config.httpProxyPort).toBe(9080);
    expect(config.transformJs).toBe(false);
  });

  it('should update targets array', () => {
    updateConfig({ targets: ['chrome 90', 'firefox 90'] });
    expect(getConfig().targets).toEqual(['chrome 90', 'firefox 90']);
  });

  it('should update ad domains', () => {
    updateConfig({ adDomains: ['custom-ad.com'] });
    expect(getConfig().adDomains).toEqual(['custom-ad.com']);
  });

  it('should preserve unspecified properties', () => {
    const originalCompressionLevel = getConfig().compressionLevel;
    updateConfig({ transformJs: false });
    expect(getConfig().compressionLevel).toBe(originalCompressionLevel);
  });
});

describe('resetConfig', () => {
  it('should reset to default config', () => {
    updateConfig({
      socks5Port: 9999,
      transformJs: false,
      compressionLevel: 1,
    });

    resetConfig();

    const config = getConfig();
    expect(config.socks5Port).toBe(defaultConfig.socks5Port);
    expect(config.transformJs).toBe(defaultConfig.transformJs);
    expect(config.compressionLevel).toBe(defaultConfig.compressionLevel);
  });
});

describe('getClientConfig', () => {
  beforeEach(() => {
    resetConfig();
    resetClientConfig();
  });

  afterEach(() => {
    resetConfig();
    resetClientConfig();
  });

  it('should return default values when no client config set', () => {
    const clientConfig = getClientConfig();
    expect(clientConfig.transformJs).toBe(true);
    expect(clientConfig.transformCss).toBe(true);
    expect(clientConfig.transformHtml).toBe(true);
    expect(clientConfig.removeAds).toBe(true);
    expect(clientConfig.removeTracking).toBe(true);
    expect(clientConfig.injectPolyfills).toBe(true);
    expect(clientConfig.spoofUserAgent).toBe(true);
    expect(clientConfig.spoofUserAgentInJs).toBe(true);
    expect(clientConfig.cacheEnabled).toBe(true);
  });

  it('should reflect server config changes when no client config', () => {
    updateConfig({ transformJs: false });
    const clientConfig = getClientConfig();
    expect(clientConfig.transformJs).toBe(false);
  });
});

describe('setClientConfig', () => {
  beforeEach(() => {
    resetConfig();
    resetClientConfig();
  });

  afterEach(() => {
    resetConfig();
    resetClientConfig();
  });

  it('should set client config', () => {
    setClientConfig({ transformJs: false });
    const clientConfig = getClientConfig();
    expect(clientConfig.transformJs).toBe(false);
  });

  it('should override all specified values', () => {
    setClientConfig({
      transformJs: false,
      transformCss: false,
      removeAds: false,
    });

    const clientConfig = getClientConfig();
    expect(clientConfig.transformJs).toBe(false);
    expect(clientConfig.transformCss).toBe(false);
    expect(clientConfig.removeAds).toBe(false);
  });
});

describe('resetClientConfig', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
    resetClientConfig();
  });

  it('should reset client config to null', () => {
    setClientConfig({ transformJs: false });
    resetClientConfig();

    // Should return defaults again
    const clientConfig = getClientConfig();
    expect(clientConfig.transformJs).toBe(true);
  });
});

describe('getEffectiveConfig', () => {
  beforeEach(() => {
    resetConfig();
    resetClientConfig();
  });

  afterEach(() => {
    resetConfig();
    resetClientConfig();
  });

  it('should return server config when no client config', () => {
    const effective = getEffectiveConfig();
    expect(effective.transformJs).toBe(true);
    expect(effective.socks5Port).toBe(1080);
  });

  it('should merge client config with server config', () => {
    setClientConfig({ transformJs: false });

    const effective = getEffectiveConfig();
    expect(effective.transformJs).toBe(false);
    // Server-only properties should remain
    expect(effective.socks5Port).toBe(1080);
  });

  it('should allow client to override multiple settings', () => {
    setClientConfig({
      transformJs: false,
      transformCss: false,
      transformHtml: false,
      removeAds: false,
      removeTracking: false,
    });

    const effective = getEffectiveConfig();
    expect(effective.transformJs).toBe(false);
    expect(effective.transformCss).toBe(false);
    expect(effective.transformHtml).toBe(false);
    expect(effective.removeAds).toBe(false);
    expect(effective.removeTracking).toBe(false);
  });

  it('should handle partial client config', () => {
    // Only override transformJs
    setClientConfig({ transformJs: false });

    const effective = getEffectiveConfig();
    expect(effective.transformJs).toBe(false);
    // Others should keep server defaults
    expect(effective.transformCss).toBe(true);
    expect(effective.transformHtml).toBe(true);
  });

  it('should handle undefined values in client config', () => {
    setClientConfig({
      transformJs: undefined,
      transformCss: false,
    } as ClientConfig);

    const effective = getEffectiveConfig();
    // undefined should not override
    expect(effective.transformJs).toBe(true);
    expect(effective.transformCss).toBe(false);
  });

  it('should preserve all server config properties', () => {
    setClientConfig({ transformJs: false });

    const effective = getEffectiveConfig();

    // All server-only properties should exist
    expect(effective.socks5Port).toBeDefined();
    expect(effective.httpProxyPort).toBeDefined();
    expect(effective.captivePortalPort).toBeDefined();
    expect(effective.bindAddress).toBeDefined();
    expect(effective.targets).toBeDefined();
    expect(effective.compressionLevel).toBeDefined();
    expect(effective.cacheTTL).toBeDefined();
    expect(effective.cacheDir).toBeDefined();
    expect(effective.certDir).toBeDefined();
    expect(effective.adDomains).toBeDefined();
    expect(effective.trackingDomains).toBeDefined();
    expect(effective.trackingUrls).toBeDefined();
  });
});
