/**
 * Revamp Configuration
 * Central configuration for the proxy server
 */

import { CLIENT_CONFIG_OPTIONS, getClientConfigKeys } from './client-options.js';
import type { DomainProfile } from './domain-rules.js';
import { getProfileForDomain } from './domain-manager.js';
import { runConfigResolutionHooks } from '../plugins/hook-executor.js';
import type { ConfigResolutionContext } from '../plugins/hooks.js';

export interface RevampConfig {
  // Server settings
  socks5Port: number;
  httpProxyPort: number;
  captivePortalPort: number; // Port for captive portal (certificate download page)
  bindAddress: string; // '0.0.0.0' for LAN access, '127.0.0.1' for localhost only

  // Target browser compatibility
  targets: string[];

  // Feature flags
  transformJs: boolean;
  transformCss: boolean;
  transformHtml: boolean;
  bundleEsModules: boolean; // Bundle ES modules for legacy browsers using esbuild
  emulateServiceWorkers: boolean; // Transform and bridge Service Workers (true) or block them (false)
  remoteServiceWorkers: boolean; // Execute Service Workers remotely in Playwright and bridge requests back
  removeAds: boolean;
  removeTracking: boolean;
  injectPolyfills: boolean;
  spoofUserAgent: boolean; // Simulate a modern browser User-Agent in HTTP headers
  spoofUserAgentInJs: boolean; // Override navigator.userAgent in JavaScript

  // Performance settings
  compressionLevel: number; // gzip level 1-9 (1=fastest, 9=smallest, default 6)

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
  trackingUrls: string[]; // Specific URL patterns to block (supports wildcards)

  // JSON request logging
  logJsonRequests: boolean; // Log application/json requests (disabled by default)
  jsonLogDir: string; // Directory for JSON request logs
}

// Default configuration targeting iOS 9+ (iPad 2) and iOS 11+
export const defaultConfig: RevampConfig = {
  socks5Port: 1080,
  httpProxyPort: 8080,
  captivePortalPort: 8888, // Captive portal for certificate download
  bindAddress: '0.0.0.0', // Bind to all interfaces for LAN access

  // iOS 9.3.5 Safari = Safari 9 (iPad 2), iOS 11 Safari = Safari 11
  targets: ['safari 9', 'ios 9'],

  transformJs: true,
  transformCss: true,
  transformHtml: true,
  bundleEsModules: true, // Bundle ES modules by default for legacy browser support
  emulateServiceWorkers: false, // Enable SW bridge by default to transform and run SWs
  remoteServiceWorkers: true, // Remote SW execution disabled by default (requires Playwright)
  removeAds: true,
  removeTracking: true,
  injectPolyfills: true,
  spoofUserAgent: true, // Enabled by default to get better content from servers
  spoofUserAgentInJs: true, // Enabled by default to fool JS-based browser detection

  // Performance: level 4 is a good balance of speed vs compression
  compressionLevel: 4,

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
    'ads.adfox.ru',
    'banners.adfox.ru',
    'advertising.com',
    'ads.betweendigital.com',
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
    'mindbox.ru',
    'top-fwz1.mail.ru',
    'mc.yandex.ru',
    'counter.yadro.ru',
  ],

  // Specific tracking URL patterns to block
  trackingUrls: [
    '/tracker.js',
    '/pixel.gif',
    '/beacon',
    '/collect',
    '/analytics',
    '/metrics',
    '/stat/',
    '/counter/',
    '/tracking/',
    '/telemetry/',
    'js/code.js',
    '/watch/',
    '/hit/',
    '/event/',
  ],

  // JSON request logging (disabled by default)
  logJsonRequests: false, // Log application/json requests
  jsonLogDir: './.revamp-json-logs', // Directory for JSON request logs
};

// Current active configuration (mutable for runtime changes)
let currentConfig: RevampConfig = { ...defaultConfig };

// Per-client config storage - Map of clientIp -> ClientConfig
const clientConfigs = new Map<string, ClientConfig>();

// Default key for non-IP-specific config (backward compatibility)
const DEFAULT_CLIENT_KEY = '__default__';

export function getConfig(): RevampConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<RevampConfig>): void {
  currentConfig = { ...currentConfig, ...partial };
}

export function resetConfig(): void {
  currentConfig = { ...defaultConfig };
}

/**
 * Client-side config options that can be overridden via API
 * Keys are derived from CLIENT_CONFIG_OPTIONS for consistency
 */
export interface ClientConfig {
  transformJs?: boolean;
  transformCss?: boolean;
  transformHtml?: boolean;
  bundleEsModules?: boolean;
  emulateServiceWorkers?: boolean;
  remoteServiceWorkers?: boolean;
  removeAds?: boolean;
  removeTracking?: boolean;
  injectPolyfills?: boolean;
  spoofUserAgent?: boolean;
  spoofUserAgentInJs?: boolean;
  cacheEnabled?: boolean;
}

// Re-export client options for easy access
export { CLIENT_CONFIG_OPTIONS, getClientConfigKeys } from './client-options.js';

/**
 * Get the current client config for a specific client IP
 * Returns only the explicitly set client overrides, or defaults from server config if none set
 * @param clientIp - Optional client IP for per-client config lookup
 */
export function getClientConfig(clientIp?: string): ClientConfig {
  const key = clientIp || DEFAULT_CLIENT_KEY;
  const clientConfig = clientConfigs.get(key);

  if (!clientConfig) {
    // Return defaults from server config when no client-specific config is set
    // Use CLIENT_CONFIG_OPTIONS to ensure all keys are included
    const serverConfig = getConfig();
    const result: ClientConfig = {};
    for (const opt of CLIENT_CONFIG_OPTIONS) {
      result[opt.key as keyof ClientConfig] = serverConfig[opt.key as keyof RevampConfig] as boolean;
    }
    return result;
  }
  return clientConfig;
}

/**
 * Update client config from API request
 * @param config - New client configuration
 * @param clientIp - Optional client IP for per-client config storage
 */
export function setClientConfig(config: ClientConfig, clientIp?: string): void {
  const key = clientIp || DEFAULT_CLIENT_KEY;
  clientConfigs.set(key, config);
  console.log(`[Revamp] Client config updated for ${clientIp || 'default'}:`, config);
}

/**
 * Reset client config to defaults
 * @param clientIp - Optional client IP to reset specific client's config. If not provided, resets all clients.
 */
export function resetClientConfig(clientIp?: string): void {
  if (clientIp) {
    clientConfigs.delete(clientIp);
    console.log(`[Revamp] Client config reset for ${clientIp}`);
  } else {
    clientConfigs.clear();
    console.log('[Revamp] All client configs reset to defaults');
  }
}

/**
 * Get effective config for a request, merging server config with client overrides
 * Server config provides global settings (targets, ports, cert paths, domain lists)
 * Client config provides per-client feature flag overrides
 * @param clientIp - Optional client IP for per-client config lookup
 */
export function getEffectiveConfig(clientIp?: string): RevampConfig {
  const key = clientIp || DEFAULT_CLIENT_KEY;
  const clientConfig = clientConfigs.get(key);

  // Start with server config (includes targets, ports, cert paths, domain lists)
  const serverConfig = getConfig();

  if (!clientConfig) {
    return serverConfig;
  }

  // Merge client config overrides with server config
  // Use CLIENT_CONFIG_OPTIONS to dynamically apply overrides
  const result = { ...serverConfig };
  for (const opt of CLIENT_CONFIG_OPTIONS) {
    const key = opt.key as keyof ClientConfig;
    if (clientConfig[key] !== undefined) {
      (result as Record<string, unknown>)[key] = clientConfig[key];
    }
  }
  return result;
}

/** Result of domain-aware config resolution */
export interface EffectiveConfigResult {
  /** The fully resolved configuration */
  config: RevampConfig;
  /** The matched domain profile (if any) */
  profile: DomainProfile | null;
}

/**
 * Get fully resolved config for a specific request.
 * Merges configuration with priority: Domain Profile > Client Config > Global Config
 *
 * @param domain - The domain being accessed
 * @param clientIp - Optional client IP for per-client config lookup
 * @returns The effective config and matched domain profile
 */
export function getEffectiveConfigForRequest(
  domain: string,
  clientIp?: string
): EffectiveConfigResult {
  // Start with client+global config merge
  const baseConfig = getEffectiveConfig(clientIp);

  // Get domain profile
  const { profile } = getProfileForDomain(domain);

  // If no profile, return base config
  if (!profile) {
    return { config: baseConfig, profile: null };
  }

  // Clone base config and apply profile overrides
  const result = { ...baseConfig };

  // Apply transformation overrides from domain profile
  if (profile.transforms) {
    for (const [key, value] of Object.entries(profile.transforms)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Apply domain-level ad/tracking toggles
  if (profile.removeAds !== undefined) {
    result.removeAds = profile.removeAds;
  }
  if (profile.removeTracking !== undefined) {
    result.removeTracking = profile.removeTracking;
  }
  if (profile.cacheEnabled !== undefined) {
    result.cacheEnabled = profile.cacheEnabled;
  }

  return { config: result, profile };
}

/**
 * Get fully resolved config for a specific request with plugin hook support.
 * Merges configuration with priority: Plugin Hooks > Domain Profile > Client Config > Global Config
 *
 * @param domain - The domain being accessed
 * @param clientIp - Optional client IP for per-client config lookup
 * @returns The effective config and matched domain profile
 */
export async function getEffectiveConfigForRequestAsync(
  domain: string,
  clientIp?: string
): Promise<EffectiveConfigResult> {
  // Get base config from synchronous resolution
  const { config: baseConfig, profile } = getEffectiveConfigForRequest(domain, clientIp);

  // Execute config:resolution hooks for plugin overrides
  const hookContext: ConfigResolutionContext = {
    baseConfig,
    clientIp,
    domain,
  };

  const hookResult = await runConfigResolutionHooks(hookContext);

  // If no plugin overrides, return base result
  if (!hookResult || !hookResult.value.overrides) {
    return { config: baseConfig, profile };
  }

  // Apply plugin config overrides (highest priority)
  const finalConfig = { ...baseConfig, ...hookResult.value.overrides };

  return { config: finalConfig, profile };
}

// Re-export domain manager functions for convenience
export { getProfileForDomain } from './domain-manager.js';
export type { DomainProfile } from './domain-rules.js';
