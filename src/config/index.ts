/**
 * Revamp Configuration
 * Central configuration for the proxy server
 */

export interface RevampConfig {
  // Server settings
  socks5Port: number;
  httpProxyPort: number;
  
  // Target browser compatibility
  targets: string[];
  
  // Feature flags
  transformJs: boolean;
  transformCss: boolean;
  transformHtml: boolean;
  removeAds: boolean;
  removeTracking: boolean;
  injectPolyfills: boolean;
  
  // Cache settings
  cacheEnabled: boolean;
  cacheTTL: number; // in seconds
  cacheDir: string;
  
  // Certificate settings
  certDir: string;
  caKeyFile: string;
  caCertFile: string;
  
  // Domain filtering (for future extensibility)
  whitelist: string[];
  blacklist: string[];
  
  // Ad/tracking domains to block
  adDomains: string[];
  trackingDomains: string[];
}

// Default configuration targeting iOS 9+ (iPad 2) and iOS 11+
export const defaultConfig: RevampConfig = {
  socks5Port: 1080,
  httpProxyPort: 8080,
  
  // iOS 9.3.5 Safari = Safari 9 (iPad 2), iOS 11 Safari = Safari 11
  targets: ['safari 9', 'ios 9'],
  
  transformJs: true,
  transformCss: true,
  transformHtml: true,
  removeAds: true,
  removeTracking: true,
  injectPolyfills: true,
  
  cacheEnabled: true,
  cacheTTL: 3600, // 1 hour
  cacheDir: './.revamp-cache',
  
  certDir: './.revamp-certs',
  caKeyFile: 'ca.key',
  caCertFile: 'ca.crt',
  
  whitelist: [], // empty = allow all
  blacklist: [],
  
  // Common ad domains
  adDomains: [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adnxs.com',
    'advertising.com',
    'facebook.com/tr',
    'ads.twitter.com',
    'amazon-adsystem.com',
  ],
  
  // Common tracking domains
  trackingDomains: [
    'google-analytics.com',
    'googletagmanager.com',
    'hotjar.com',
    'segment.io',
    'mixpanel.com',
    'fullstory.com',
    'mouseflow.com',
    'crazyegg.com',
  ],
};

// Current active configuration (mutable for runtime changes)
let currentConfig: RevampConfig = { ...defaultConfig };

export function getConfig(): RevampConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<RevampConfig>): void {
  currentConfig = { ...currentConfig, ...partial };
}

export function resetConfig(): void {
  currentConfig = { ...defaultConfig };
}
