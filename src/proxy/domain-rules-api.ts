/**
 * Domain Rules API Endpoints
 *
 * Provides REST API for managing domain-specific profiles:
 * - GET/POST /__revamp__/domains - List/create profiles
 * - GET/PUT/DELETE /__revamp__/domains/:id - Manage specific profile
 * - GET /__revamp__/domains/match/:domain - Test domain matching
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

// =============================================================================
// Types
// =============================================================================

export interface ApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

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

// =============================================================================
// API Detection
// =============================================================================

/**
 * Check if a path is a domain rules API endpoint
 */
export function isDomainRulesEndpoint(path: string): boolean {
  return path.startsWith(DOMAIN_RULES_BASE);
}

// =============================================================================
// API Handlers
// =============================================================================

/**
 * Handle domain rules API requests
 */
export async function handleDomainRulesRequest(
  path: string,
  method: string,
  body: string = ''
): Promise<ApiResult> {
  // Ensure domain manager is initialized
  await initializeDomainManager();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  // Remove base path to get the rest
  const pathWithoutBase = path.slice(DOMAIN_RULES_BASE.length);

  // Route to appropriate handler
  // GET/POST /__revamp__/domains
  if (pathWithoutBase === '' || pathWithoutBase === '/') {
    if (method === 'GET') {
      return handleListProfiles();
    }
    if (method === 'POST') {
      return handleCreateProfile(body);
    }
    return errorResponse(405, 'Method not allowed');
  }

  // GET /__revamp__/domains/match/:domain
  if (pathWithoutBase.startsWith('/match/')) {
    if (method === 'GET') {
      const domain = decodeURIComponent(pathWithoutBase.slice(7));
      return handleMatchDomain(domain);
    }
    return errorResponse(405, 'Method not allowed');
  }

  // GET/PUT/DELETE /__revamp__/domains/:id
  const profileId = pathWithoutBase.slice(1); // Remove leading /

  if (!profileId) {
    return errorResponse(400, 'Profile ID required');
  }

  switch (method) {
    case 'GET':
      return handleGetProfile(profileId);
    case 'PUT':
      return handleUpdateProfile(profileId, body);
    case 'DELETE':
      return handleDeleteProfile(profileId);
    default:
      return errorResponse(405, 'Method not allowed');
  }
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

  // Validate regex patterns
  if (p.type === 'regex') {
    try {
      new RegExp(p.pattern as string);
    } catch {
      return false;
    }
  }

  return true;
}
