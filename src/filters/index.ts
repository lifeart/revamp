/**
 * Modular Filter System
 *
 * Separates ad blocking, tracking removal, and content transformation
 * into independent, configurable modules that support per-domain customization.
 *
 * @module filters
 */

import type { DomainProfile, FilterContext } from '../config/domain-rules.js';
import { getProfileForDomain, getGlobalDefaults } from '../config/domain-manager.js';

// =============================================================================
// Types
// =============================================================================

export type { FilterContext } from '../config/domain-rules.js';

/** Ad patterns for a specific context */
export interface AdPatterns {
  /** Regex patterns for matching ad scripts */
  scriptPatterns: RegExp[];
  /** CSS selectors for ad containers */
  containerSelectors: string[];
}

/** Tracking patterns for a specific context */
export interface TrackingPatterns {
  /** Regex patterns for matching tracking scripts */
  scriptPatterns: RegExp[];
  /** CSS selectors for tracking pixels */
  pixelSelectors: string[];
}

// =============================================================================
// Default Ad Patterns (moved from html.ts)
// =============================================================================

/**
 * Default ad script patterns.
 * Matches against both script src URLs and inline content.
 */
export const DEFAULT_AD_SCRIPT_PATTERNS: readonly RegExp[] = [
  /atob/i,
  /ads\//i,
  /googletag/i,
  /doubleclick/i,
  /googleadservices/i,
  /googlesyndication/i,
  /adsbygoogle/i,
  /google_ad/i,
  /adsense/i,
  /adnxs\.com/i,
  /amazon-adsystem/i,
  /facebook\.net.*fbevents/i,
  /connect\.facebook\.net/i,
  /platform\.twitter\.com/i,
  /ads\.twitter\.com/i,
];

/**
 * Default CSS selectors for ad container elements.
 * Uses boundary-aware selectors to avoid false positives.
 */
export const DEFAULT_AD_CONTAINER_SELECTORS: readonly string[] = [
  // Class-based selectors with word boundaries
  '[class^="ad-"]',
  '[class$="-ad"]',
  '[class~="ad"]',
  '[class^="ads-"]',
  '[class$="-ads"]',
  '[class~="ads"]',

  // Specific ad-related class names
  '.advertisement',
  '.ad-container',
  '.ad-wrapper',
  '.ad-banner',
  '.ad-unit',
  '.advert',

  // ID-based selectors
  '[id*="google_ads"]',
  '[id*="ad-container"]',
  '[id*="ad_container"]',
  '[id^="ad-"]',
  '[id$="-ad"]',

  // Ad network specific
  'ins.adsbygoogle',

  // Data attribute selectors
  '[data-ad]',
  '[data-ad-slot]',
  '[data-ad-client]',
];

// =============================================================================
// Default Tracking Patterns (moved from html.ts)
// =============================================================================

/**
 * Default tracking/analytics script patterns.
 * Matches against both script src URLs and inline content.
 */
export const DEFAULT_TRACKING_SCRIPT_PATTERNS: readonly RegExp[] = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /metrika\/tag\.js/i,
  /watch_serp\.js/i,
  /gtag\(/i,
  /gtm\.js/i,
  /analytics\.js/i,
  /hotjar\.com/i,
  /segment\.io/i,
  /segment\.com/i,
  /mixpanel/i,
  /fullstory/i,
  /mouseflow/i,
  /crazyegg/i,
  /clarity\.ms/i,
  /newrelic/i,
  /nr-data\.net/i,
  /sentry\.io/i,
  /bugsnag/i,
  /logrocket/i,
];

/**
 * Default CSS selectors for tracking pixel elements.
 */
export const DEFAULT_TRACKING_PIXEL_SELECTORS: readonly string[] = [
  'img[width="1"][height="1"]',
  'img[src*="pixel"]',
  'img[src*="beacon"]',
  'iframe[width="0"]',
  'iframe[height="0"]',
  'iframe[style*="display:none"]',
  'iframe[style*="display: none"]',
  'noscript img',
];

// =============================================================================
// Pattern Compilation Cache
// =============================================================================

const compiledPatternCache = new Map<string, RegExp>();

/**
 * Compile a pattern string to RegExp with caching
 */
function compilePattern(pattern: string): RegExp | null {
  const cached = compiledPatternCache.get(pattern);
  if (cached) return cached;

  try {
    const regex = new RegExp(pattern, 'i');
    compiledPatternCache.set(pattern, regex);
    return regex;
  } catch (err) {
    console.warn(`[Filters] Invalid pattern "${pattern}":`, err);
    return null;
  }
}

// =============================================================================
// Filter Context Creation
// =============================================================================

/**
 * Create a filter context for a request URL
 */
export function createFilterContext(url: string): FilterContext {
  let domain = 'unknown';
  try {
    domain = new URL(url).hostname;
  } catch {
    // Invalid URL, use default
  }

  const { profile } = getProfileForDomain(domain);

  return { domain, url, profile };
}

/**
 * Create a filter context for a known domain
 */
export function createFilterContextForDomain(
  domain: string,
  url: string = `https://${domain}/`
): FilterContext {
  const { profile } = getProfileForDomain(domain);
  return { domain, url, profile };
}

// =============================================================================
// Ad Pattern Resolution
// =============================================================================

/**
 * Get ad patterns for a specific context.
 * Merges global defaults with domain-specific patterns.
 */
export function getAdPatterns(context: FilterContext): AdPatterns {
  const scriptPatterns: RegExp[] = [...DEFAULT_AD_SCRIPT_PATTERNS];
  const containerSelectors: string[] = [...DEFAULT_AD_CONTAINER_SELECTORS];

  // Add domain-specific patterns
  if (context.profile?.customAdPatterns) {
    for (const pattern of context.profile.customAdPatterns) {
      const compiled = compilePattern(pattern);
      if (compiled) {
        scriptPatterns.push(compiled);
      }
    }
  }

  if (context.profile?.customAdSelectors) {
    containerSelectors.push(...context.profile.customAdSelectors);
  }

  // Add patterns from ad rules
  if (context.profile?.adRules) {
    for (const rule of context.profile.adRules) {
      if (!rule.enabled || rule.action !== 'block') continue;

      if (rule.type === 'script-pattern') {
        const compiled = compilePattern(rule.value);
        if (compiled) {
          scriptPatterns.push(compiled);
        }
      } else if (rule.type === 'css-selector') {
        containerSelectors.push(rule.value);
      }
    }
  }

  return { scriptPatterns, containerSelectors };
}

// =============================================================================
// Tracking Pattern Resolution
// =============================================================================

/**
 * Get tracking patterns for a specific context.
 * Merges global defaults with domain-specific patterns.
 */
export function getTrackingPatterns(context: FilterContext): TrackingPatterns {
  const scriptPatterns: RegExp[] = [...DEFAULT_TRACKING_SCRIPT_PATTERNS];
  const pixelSelectors: string[] = [...DEFAULT_TRACKING_PIXEL_SELECTORS];

  // Add domain-specific patterns
  if (context.profile?.customTrackingPatterns) {
    for (const pattern of context.profile.customTrackingPatterns) {
      const compiled = compilePattern(pattern);
      if (compiled) {
        scriptPatterns.push(compiled);
      }
    }
  }

  if (context.profile?.customTrackingSelectors) {
    pixelSelectors.push(...context.profile.customTrackingSelectors);
  }

  // Add patterns from tracking rules
  if (context.profile?.trackingRules) {
    for (const rule of context.profile.trackingRules) {
      if (!rule.enabled || rule.action !== 'block') continue;

      if (rule.type === 'script-pattern') {
        const compiled = compilePattern(rule.value);
        if (compiled) {
          scriptPatterns.push(compiled);
        }
      } else if (rule.type === 'css-selector') {
        pixelSelectors.push(rule.value);
      }
    }
  }

  return { scriptPatterns, pixelSelectors };
}

// =============================================================================
// Domain Blocking
// =============================================================================

/**
 * Check if a domain should be blocked.
 * Considers both global config and domain-specific rules.
 */
export function shouldBlockDomainWithProfile(
  hostname: string,
  context: FilterContext,
  removeAds: boolean,
  removeTracking: boolean,
  adDomains: string[],
  trackingDomains: string[]
): boolean {
  const hostnameLower = hostname.toLowerCase();

  // Check global ad domains
  if (removeAds) {
    for (const domain of adDomains) {
      if (hostnameLower.includes(domain.toLowerCase())) {
        return true;
      }
    }
  }

  // Check global tracking domains
  if (removeTracking) {
    for (const domain of trackingDomains) {
      if (hostnameLower.includes(domain.toLowerCase())) {
        return true;
      }
    }
  }

  // Check domain-specific ad rules
  if (context.profile?.adRules) {
    for (const rule of context.profile.adRules) {
      if (!rule.enabled) continue;
      if (rule.type === 'domain') {
        if (hostnameLower.includes(rule.value.toLowerCase())) {
          return rule.action === 'block';
        }
      }
    }
  }

  // Check domain-specific tracking rules
  if (context.profile?.trackingRules) {
    for (const rule of context.profile.trackingRules) {
      if (!rule.enabled) continue;
      if (rule.type === 'domain') {
        if (hostnameLower.includes(rule.value.toLowerCase())) {
          return rule.action === 'block';
        }
      }
    }
  }

  return false;
}

/**
 * Check if a URL should be blocked.
 * Considers both global config and domain-specific rules.
 */
export function shouldBlockUrlWithProfile(
  url: string,
  context: FilterContext,
  removeTracking: boolean,
  trackingUrls: string[]
): boolean {
  // Never block Revamp API endpoints
  if (url.includes('/__revamp__/')) {
    return false;
  }

  const urlLower = url.toLowerCase();

  // Check global tracking URL patterns
  if (removeTracking) {
    for (const pattern of trackingUrls) {
      if (urlLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  // Check domain-specific URL pattern rules
  if (context.profile?.trackingRules) {
    for (const rule of context.profile.trackingRules) {
      if (!rule.enabled) continue;
      if (rule.type === 'url-pattern') {
        try {
          const regex = new RegExp(rule.value, 'i');
          if (regex.test(url)) {
            return rule.action === 'block';
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }
  }

  // Check domain-specific ad URL rules
  if (context.profile?.adRules) {
    for (const rule of context.profile.adRules) {
      if (!rule.enabled) continue;
      if (rule.type === 'url-pattern') {
        try {
          const regex = new RegExp(rule.value, 'i');
          if (regex.test(url)) {
            return rule.action === 'block';
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }
  }

  return false;
}

// =============================================================================
// Script Detection Helpers
// =============================================================================

/**
 * Check if a script matches any ad patterns
 */
export function isAdScript(
  scriptSrc: string | undefined,
  scriptContent: string | undefined,
  patterns: RegExp[]
): boolean {
  for (const pattern of patterns) {
    if (scriptSrc && pattern.test(scriptSrc)) {
      return true;
    }
    if (scriptContent && pattern.test(scriptContent)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a script matches any tracking patterns
 */
export function isTrackingScript(
  scriptSrc: string | undefined,
  scriptContent: string | undefined,
  patterns: RegExp[]
): boolean {
  for (const pattern of patterns) {
    if (scriptSrc && pattern.test(scriptSrc)) {
      return true;
    }
    if (scriptContent && pattern.test(scriptContent)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Exports for Re-use
// =============================================================================

export {
  getProfileForDomain,
  getGlobalDefaults,
} from '../config/domain-manager.js';

export type { DomainProfile } from '../config/domain-rules.js';
