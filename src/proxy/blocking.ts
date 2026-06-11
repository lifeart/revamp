/**
 * Domain/URL Blocking
 *
 * Ad/tracking blocking decisions for both proxy stacks: the synchronous
 * built-in list checks (optionally domain-profile-aware via FilterContext)
 * and the async variants that additionally run `filter:decision` plugin
 * hooks.
 *
 * @module proxy/blocking
 */

import { URL } from 'node:url';
import { getConfig, type RevampConfig } from '../config/index.js';
import {
  shouldBlockDomainWithProfile,
  shouldBlockUrlWithProfile,
  pathMatchesBlocklistPattern,
  type FilterContext,
} from '../filters/index.js';
import { runFilterDecisionHooks } from '../plugins/hook-executor.js';
import type { FilterContext as PluginFilterContext } from '../plugins/hooks.js';
import { getProfileForDomain } from '../config/domain-manager.js';

/**
 * Check if a domain should be blocked (ads/tracking).
 * Supports domain-specific profiles when filterContext is provided.
 * Also executes filter:decision plugin hooks.
 *
 * @param hostname - The hostname to check
 * @param config - Optional config override
 * @param filterContext - Optional filter context for domain-specific rules
 */
export function shouldBlockDomain(
  hostname: string,
  config?: RevampConfig,
  filterContext?: FilterContext
): boolean {
  const effectiveConfig = config || getConfig();

  // If we have a filter context, use domain-aware blocking
  if (filterContext) {
    return shouldBlockDomainWithProfile(
      hostname,
      filterContext,
      effectiveConfig.removeAds,
      effectiveConfig.removeTracking,
      effectiveConfig.adDomains,
      effectiveConfig.trackingDomains
    );
  }

  // Fallback to simple domain list checking (backward compatibility)
  // Check ad domains
  if (effectiveConfig.removeAds) {
    for (const domain of effectiveConfig.adDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }

  // Check tracking domains
  if (effectiveConfig.removeTracking) {
    for (const domain of effectiveConfig.trackingDomains) {
      if (hostname.includes(domain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a domain should be blocked, with plugin hook support.
 * This async version executes filter:decision hooks for plugin-based blocking.
 *
 * @param hostname - The hostname to check
 * @param url - The full URL being accessed
 * @param config - Optional config override
 * @param filterContext - Optional filter context for domain-specific rules
 */
export async function shouldBlockDomainAsync(
  hostname: string,
  url: string,
  config?: RevampConfig,
  filterContext?: FilterContext
): Promise<{ blocked: boolean; reason?: string }> {
  const effectiveConfig = config || getConfig();

  // First check built-in blocking
  const builtInBlocked = shouldBlockDomain(hostname, effectiveConfig, filterContext);
  if (builtInBlocked) {
    return { blocked: true, reason: 'Built-in domain filter' };
  }

  // Get domain profile for hook context
  const { profile } = getProfileForDomain(hostname);

  // Execute filter:decision hooks
  const pluginFilterContext: PluginFilterContext = {
    url,
    hostname,
    config: effectiveConfig,
    profile,
  };

  const filterResult = await runFilterDecisionHooks(pluginFilterContext);
  if (filterResult && filterResult.value.block) {
    return { blocked: true, reason: filterResult.value.reason || `Blocked by plugin: ${filterResult.stoppedBy || 'unknown'}` };
  }

  return { blocked: false };
}

/**
 * Check if a URL should be blocked by pattern.
 * Supports domain-specific profiles when filterContext is provided.
 *
 * @param url - The URL to check
 * @param config - Optional config override
 * @param filterContext - Optional filter context for domain-specific rules
 */
export function shouldBlockUrl(
  url: string,
  config?: RevampConfig,
  filterContext?: FilterContext
): boolean {
  const effectiveConfig = config || getConfig();

  // Never block internal Revamp API endpoints
  if (url.includes('/__revamp__/')) {
    return false;
  }

  // If we have a filter context, use domain-aware blocking
  if (filterContext) {
    return shouldBlockUrlWithProfile(
      url,
      filterContext,
      effectiveConfig.removeTracking,
      effectiveConfig.trackingUrls
    );
  }

  // Fallback to simple URL pattern checking (backward compatibility).
  // Match by path boundary to avoid false positives like "/stat" inside
  // "/architect/" or "/hit" inside "/health-status/". Patterns may include
  // a leading slash (e.g. "/metrics"); the matcher strips it so the same
  // pattern still aligns with paths like "/api/v1/metrics".
  if (effectiveConfig.removeTracking) {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      // Malformed URL — treat as non-match. Pattern matching needs a parsed
      // path; logging every malformed URL here would be too noisy.
      return false;
    }
    for (const rawPattern of effectiveConfig.trackingUrls) {
      if (pathMatchesBlocklistPattern(path, rawPattern)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a URL should be blocked, with plugin hook support.
 * This async version executes filter:decision hooks for plugin-based blocking.
 *
 * @param url - The URL to check
 * @param config - Optional config override
 * @param filterContext - Optional filter context for domain-specific rules
 */
export async function shouldBlockUrlAsync(
  url: string,
  config?: RevampConfig,
  filterContext?: FilterContext
): Promise<{ blocked: boolean; reason?: string }> {
  const effectiveConfig = config || getConfig();

  // First check built-in URL blocking
  const builtInBlocked = shouldBlockUrl(url, effectiveConfig, filterContext);
  if (builtInBlocked) {
    return { blocked: true, reason: 'Built-in URL filter' };
  }

  // Parse hostname for hook context
  let hostname = '';
  try {
    const parsedUrl = new URL(url);
    hostname = parsedUrl.hostname;
  } catch {
    // Invalid URL: cannot resolve hostname, so plugins can't make a decision.
    // Log-spam guard: this is the same per-request URL the caller already saw.
    return { blocked: false };
  }

  // Get domain profile for hook context
  const { profile } = getProfileForDomain(hostname);

  // Execute filter:decision hooks
  const pluginFilterContext: PluginFilterContext = {
    url,
    hostname,
    config: effectiveConfig,
    profile,
  };

  const filterResult = await runFilterDecisionHooks(pluginFilterContext);
  if (filterResult && filterResult.value.block) {
    return { blocked: true, reason: filterResult.value.reason || `Blocked by plugin: ${filterResult.stoppedBy || 'unknown'}` };
  }

  return { blocked: false };
}
