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

  it('should have JSON logging disabled by default', () => {
    expect(defaultConfig.logJsonRequests).toBe(false);
  });

  it('should have JSON log directory configured', () => {
    expect(defaultConfig.jsonLogDir).toBe('./.revamp-json-logs');
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

describe('per-client config isolation', () => {
  beforeEach(() => {
    resetConfig();
    resetClientConfig();
  });

  afterEach(() => {
    resetConfig();
    resetClientConfig();
  });

  it('should isolate config by client IP', () => {
    // Client 1 sets config
    setClientConfig({ transformJs: false }, '192.168.1.100');

    // Client 2 sets different config
    setClientConfig({ transformJs: true, removeAds: false }, '192.168.1.200');

    // Each client should get their own config
    const config1 = getClientConfig('192.168.1.100');
    const config2 = getClientConfig('192.168.1.200');

    expect(config1.transformJs).toBe(false);
    expect(config1.removeAds).toBeUndefined(); // Not set by client 1

    expect(config2.transformJs).toBe(true);
    expect(config2.removeAds).toBe(false);
  });

  it('should return defaults for unknown client IP', () => {
    setClientConfig({ transformJs: false }, '192.168.1.100');

    // Different client should get defaults
    const config = getClientConfig('10.0.0.1');
    expect(config.transformJs).toBe(true);
  });

  it('should keep global config separate from per-client config', () => {
    // Set global config (no IP)
    setClientConfig({ transformJs: false });

    // Set per-client config
    setClientConfig({ transformJs: true }, '192.168.1.100');

    // Global and per-client should be separate
    const globalConfig = getClientConfig();
    const clientConfig = getClientConfig('192.168.1.100');

    expect(globalConfig.transformJs).toBe(false);
    expect(clientConfig.transformJs).toBe(true);
  });

  it('should reset only specific client config when IP provided', () => {
    setClientConfig({ transformJs: false }, '192.168.1.100');
    setClientConfig({ transformJs: false }, '192.168.1.200');

    // Reset only client 100
    resetClientConfig('192.168.1.100');

    // Client 100 should get defaults
    const config100 = getClientConfig('192.168.1.100');
    expect(config100.transformJs).toBe(true);

    // Client 200 should keep its config
    const config200 = getClientConfig('192.168.1.200');
    expect(config200.transformJs).toBe(false);
  });

  it('should reset all client configs when no IP provided', () => {
    setClientConfig({ transformJs: false }, '192.168.1.100');
    setClientConfig({ transformJs: false }, '192.168.1.200');
    setClientConfig({ transformJs: false }); // Global

    // Reset all
    resetClientConfig();

    // All clients should get defaults
    expect(getClientConfig('192.168.1.100').transformJs).toBe(true);
    expect(getClientConfig('192.168.1.200').transformJs).toBe(true);
    expect(getClientConfig().transformJs).toBe(true);
  });

  it('should return per-client effective config', () => {
    setClientConfig({ transformJs: false, removeAds: false }, '192.168.1.100');
    setClientConfig({ transformCss: false }, '192.168.1.200');

    const effective1 = getEffectiveConfig('192.168.1.100');
    const effective2 = getEffectiveConfig('192.168.1.200');

    // Client 1 overrides
    expect(effective1.transformJs).toBe(false);
    expect(effective1.removeAds).toBe(false);
    expect(effective1.transformCss).toBe(true); // Not overridden

    // Client 2 overrides
    expect(effective2.transformJs).toBe(true); // Not overridden
    expect(effective2.transformCss).toBe(false);
    expect(effective2.removeAds).toBe(true); // Not overridden
  });

  it('should handle IPv6 addresses as client IP', () => {
    const ipv6Address = '2001:db8::1';
    setClientConfig({ transformJs: false }, ipv6Address);

    const config = getClientConfig(ipv6Address);
    expect(config.transformJs).toBe(false);

    const effective = getEffectiveConfig(ipv6Address);
    expect(effective.transformJs).toBe(false);
  });

  it('should handle multiple clients with different settings', () => {
    const clients = [
      { ip: '10.0.0.1', config: { transformJs: false, cacheEnabled: true } },
      { ip: '10.0.0.2', config: { transformCss: false, removeAds: false } },
      { ip: '10.0.0.3', config: { injectPolyfills: false, spoofUserAgent: false } },
    ];

    // Set configs for all clients
    clients.forEach(({ ip, config }) => setClientConfig(config, ip));

    // Verify each client has correct config
    expect(getClientConfig('10.0.0.1').transformJs).toBe(false);
    expect(getClientConfig('10.0.0.2').transformCss).toBe(false);
    expect(getClientConfig('10.0.0.3').injectPolyfills).toBe(false);

    // Verify configs don't interfere with each other
    expect(getClientConfig('10.0.0.1').transformCss).toBeUndefined();
    expect(getClientConfig('10.0.0.2').transformJs).toBeUndefined();
  });
});
