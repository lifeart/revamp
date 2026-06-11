/**
 * Domain Rules API Endpoints
 *
 * Provides REST API for managing domain-specific profiles:
 * - GET/POST /__revamp__/domains - List/create profiles
 * - GET/PUT/DELETE /__revamp__/domains/:id - Manage specific profile
 * - GET /__revamp__/domains/match/:domain - Test domain matching
 *
 * Routes are registered on the shared API router via
 * {@link registerDomainRulesRoutes}; this module owns only its handlers.
 *
 * @module proxy/domain-rules-api
 */

import type { DomainProfile, DomainPattern } from '../config/domain-rules.js';
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileForDomain,
  initializeDomainManager,
} from '../config/domain-manager.js';
import { isSafeRegexSource } from '../util/safe-regex.js';
import type { ApiRouter, ApiHandler, ApiResponse } from './api-router.js';

// =============================================================================
// Types
// =============================================================================

export type ApiResult = ApiResponse;

// =============================================================================
// Constants
// =============================================================================

export const DOMAIN_RULES_BASE = '/__revamp__/domains';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// =============================================================================
// API Helpers
// =============================================================================

function jsonResponse(
  statusCode: number,
  data: unknown
): ApiResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function errorResponse(
  statusCode: number,
  error: string
): ApiResult {
  return jsonResponse(statusCode, { success: false, error });
}

function successResponse(data: Record<string, unknown>): ApiResult {
  return jsonResponse(200, { success: true, ...data });
}

/**
 * Wrap a handler so the domain manager is initialized (rules loaded from
 * disk, file watcher attached) before any domain route runs — same lazy
 * init-on-first-request behavior the old dispatcher had.
 */
function withDomainManager(handler: ApiHandler): ApiHandler {
  return async (req) => {
    await initializeDomainManager();
    return handler(req);
  };
}

/** Historical 405 shape for the domains API. */
function methodNotAllowed(): ApiResult {
  return errorResponse(405, 'Method not allowed');
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register the domain rules routes on the shared API router.
 * Adding a future domains route means adding exactly one line here.
 */
export function registerDomainRulesRoutes(router: ApiRouter): void {
  // GET/POST /__revamp__/domains - List/create profiles
  router.register('GET', DOMAIN_RULES_BASE, withDomainManager(handleListProfiles));
  router.register('GET', `${DOMAIN_RULES_BASE}/`, withDomainManager(handleListProfiles));
  router.register('POST', DOMAIN_RULES_BASE, withDomainManager((req) => handleCreateProfile(req.body)));
  router.register('POST', `${DOMAIN_RULES_BASE}/`, withDomainManager((req) => handleCreateProfile(req.body)));
  router.register('*', DOMAIN_RULES_BASE, withDomainManager(methodNotAllowed));
  router.register('*', `${DOMAIN_RULES_BASE}/`, withDomainManager(methodNotAllowed));

  // GET /__revamp__/domains/match/:domain - Test domain matching
  // (wildcard, not :param, so URL-encoded domains and the historical
  // empty-domain 400 behave exactly as before)
  router.register('GET', `${DOMAIN_RULES_BASE}/match/*`, withDomainManager((req) => handleMatchDomain(decodeURIComponent(req.params['*']))));
  router.register('GET', `${DOMAIN_RULES_BASE}/match/`, withDomainManager(() => handleMatchDomain('')));
  router.register('*', `${DOMAIN_RULES_BASE}/match/*`, withDomainManager(methodNotAllowed));
  router.register('*', `${DOMAIN_RULES_BASE}/match/`, withDomainManager(methodNotAllowed));

  // GET/PUT/DELETE /__revamp__/domains/:id - Manage specific profile
  // (wildcard keeps the historical raw-id semantics, including ids that
  // contain encoded separators)
  router.register('GET', `${DOMAIN_RULES_BASE}/*`, withDomainManager((req) => handleGetProfile(req.params['*'])));
  router.register('PUT', `${DOMAIN_RULES_BASE}/*`, withDomainManager((req) => handleUpdateProfile(req.params['*'], req.body)));
  router.register('DELETE', `${DOMAIN_RULES_BASE}/*`, withDomainManager((req) => handleDeleteProfile(req.params['*'])));
  router.register('*', `${DOMAIN_RULES_BASE}/*`, withDomainManager(methodNotAllowed));
}

// =============================================================================
// Individual Handlers
// =============================================================================

/**
 * GET /__revamp__/domains - List all profiles
 */
function handleListProfiles(): ApiResult {
  const profiles = listProfiles();
  return successResponse({ profiles });
}

/**
 * POST /__revamp__/domains - Create a new profile
 */
async function handleCreateProfile(body: string): Promise<ApiResult> {
  if (!body) {
    return errorResponse(400, 'Request body required');
  }

  try {
    const data = JSON.parse(body) as Partial<DomainProfile>;

    // Validate required fields
    if (!data.name) {
      return errorResponse(400, 'Profile name is required');
    }
    if (!data.patterns || !Array.isArray(data.patterns) || data.patterns.length === 0) {
      return errorResponse(400, 'At least one pattern is required');
    }

    // Validate patterns
    for (const pattern of data.patterns) {
      if (!isValidPattern(pattern)) {
        return errorResponse(400, `Invalid pattern: ${JSON.stringify(pattern)}`);
      }
    }

    const profile = await createProfile({
      name: data.name,
      patterns: data.patterns,
      priority: data.priority ?? 0,
      transforms: data.transforms,
      adRules: data.adRules,
      trackingRules: data.trackingRules,
      contentRules: data.contentRules,
      removeAds: data.removeAds,
      removeTracking: data.removeTracking,
      cacheEnabled: data.cacheEnabled,
      customAdPatterns: data.customAdPatterns,
      customTrackingPatterns: data.customTrackingPatterns,
      customAdSelectors: data.customAdSelectors,
      customTrackingSelectors: data.customTrackingSelectors,
      enabled: data.enabled ?? true,
    });

    return jsonResponse(201, { success: true, profile });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return errorResponse(400, 'Invalid JSON');
    }
    return errorResponse(500, `Failed to create profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * GET /__revamp__/domains/:id - Get a specific profile
 */
function handleGetProfile(id: string): ApiResult {
  const profile = getProfile(id);

  if (!profile) {
    return errorResponse(404, 'Profile not found');
  }

  return successResponse({ profile });
}

/**
 * PUT /__revamp__/domains/:id - Update a profile
 */
async function handleUpdateProfile(id: string, body: string): Promise<ApiResult> {
  if (!body) {
    return errorResponse(400, 'Request body required');
  }

  try {
    const updates = JSON.parse(body) as Partial<DomainProfile>;

    // Validate patterns if provided
    if (updates.patterns) {
      if (!Array.isArray(updates.patterns) || updates.patterns.length === 0) {
        return errorResponse(400, 'At least one pattern is required');
      }
      for (const pattern of updates.patterns) {
        if (!isValidPattern(pattern)) {
          return errorResponse(400, `Invalid pattern: ${JSON.stringify(pattern)}`);
        }
      }
    }

    const profile = await updateProfile(id, updates);

    if (!profile) {
      return errorResponse(404, 'Profile not found');
    }

    return successResponse({ profile });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return errorResponse(400, 'Invalid JSON');
    }
    return errorResponse(500, `Failed to update profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * DELETE /__revamp__/domains/:id - Delete a profile
 */
async function handleDeleteProfile(id: string): Promise<ApiResult> {
  const deleted = await deleteProfile(id);

  if (!deleted) {
    return errorResponse(404, 'Profile not found');
  }

  return successResponse({ deleted: true });
}

/**
 * GET /__revamp__/domains/match/:domain - Test which profile matches a domain
 */
function handleMatchDomain(domain: string): ApiResult {
  if (!domain) {
    return errorResponse(400, 'Domain is required');
  }

  const { profile, matchedPattern } = getProfileForDomain(domain);

  return successResponse({
    domain,
    profile,
    matchedPattern,
  });
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a domain pattern
 */
function isValidPattern(pattern: unknown): pattern is DomainPattern {
  if (!pattern || typeof pattern !== 'object') {
    return false;
  }

  const p = pattern as Record<string, unknown>;

  if (!p.type || !['exact', 'suffix', 'regex'].includes(p.type as string)) {
    return false;
  }

  if (!p.pattern || typeof p.pattern !== 'string') {
    return false;
  }

  // Validate regex patterns — `safeRegex` enforces a length cap +
  // star-height bound, satisfying `js/regex-injection` and rejecting
  // patterns that would cause catastrophic backtracking at match time.
  if (p.type === 'regex') {
    if (!isSafeRegexSource(p.pattern as string)) {
      return false;
    }
  }

  return true;
}
