/**
 * ES Module Bundler — import maps
 *
 * Import map parsing/validation and module specifier resolution
 * (import-map-aware, with relative/absolute URL fallback).
 *
 * @module transformers/esm/import-map
 */

import { URL } from 'node:url';
import { log } from '../../logger/log.js';

// =============================================================================
// Types
// =============================================================================

/** Import map structure (subset of the full spec) */
export interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

// =============================================================================
// Specifier Resolution
// =============================================================================

/**
 * Resolve a specifier using an import map
 */
function resolveWithImportMap(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  if (!importMap) return null;

  // Check scopes first (more specific)
  if (importMap.scopes) {
    for (const [scope, mappings] of Object.entries(importMap.scopes)) {
      if (baseUrl.startsWith(scope)) {
        // Check for exact match
        if (mappings[specifier]) {
          return mappings[specifier];
        }
        // Check for prefix match (e.g., "lodash/" -> "https://cdn/lodash/")
        for (const [prefix, replacement] of Object.entries(mappings)) {
          if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
            return replacement + specifier.slice(prefix.length);
          }
        }
      }
    }
  }

  // Check top-level imports
  if (importMap.imports) {
    // Exact match
    if (importMap.imports[specifier]) {
      return importMap.imports[specifier];
    }
    // Prefix match
    for (const [prefix, replacement] of Object.entries(importMap.imports)) {
      if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
        return replacement + specifier.slice(prefix.length);
      }
    }
  }

  return null;
}

/**
 * Resolve a module specifier to an absolute URL
 */
export function resolveModuleUrl(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  // Try import map first for bare specifiers
  const importMapResolved = resolveWithImportMap(specifier, baseUrl, importMap);
  if (importMapResolved) {
    try {
      return new URL(importMapResolved, baseUrl).href;
    } catch {
      // Invalid resolved URL
    }
  }

  // Handle bare specifiers (npm packages) - these can't be resolved without import maps
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('http')) {
    // Check for common CDN patterns that look like bare specifiers but have URLs
    if (specifier.includes('://')) {
      try {
        return new URL(specifier).href;
      } catch {
        // Not a valid URL
      }
    }
    log.warn(`[ESM Bundler] Cannot resolve bare specifier: "${specifier}" - consider using an import map or full URL`);
    return null;
  }

  try {
    return new URL(specifier, baseUrl).href;
  } catch {
    log.warn(`[ESM Bundler] Failed to resolve "${specifier}" from "${baseUrl}"`);
    return null;
  }
}

// =============================================================================
// Import Map Parsing
// =============================================================================

/**
 * Parse an import map from JSON string
 *
 * @param json - Import map JSON string
 * @returns Parsed import map or undefined if invalid
 */
export function parseImportMap(json: string): ImportMap | undefined {
  try {
    const map = JSON.parse(json);

    // Validate basic structure
    if (typeof map !== 'object' || map === null) {
      log.warn('[ESM Bundler] Invalid import map: must be an object');
      return undefined;
    }

    const result: ImportMap = {};

    // Validate imports
    if (map.imports) {
      if (typeof map.imports !== 'object' || map.imports === null) {
        log.warn('[ESM Bundler] Invalid import map: imports must be an object');
        return undefined;
      }
      result.imports = {};
      for (const [key, value] of Object.entries(map.imports)) {
        if (typeof value === 'string') {
          result.imports[key] = value;
        }
      }
    }

    // Validate scopes
    if (map.scopes) {
      if (typeof map.scopes !== 'object' || map.scopes === null) {
        log.warn('[ESM Bundler] Invalid import map: scopes must be an object');
        return undefined;
      }
      result.scopes = {};
      for (const [scope, mappings] of Object.entries(map.scopes)) {
        if (typeof mappings === 'object' && mappings !== null) {
          result.scopes[scope] = {};
          for (const [key, value] of Object.entries(mappings)) {
            if (typeof value === 'string') {
              result.scopes[scope][key] = value;
            }
          }
        }
      }
    }

    log.debug(`[ESM Bundler] Parsed import map with ${Object.keys(result.imports || {}).length} imports, ${Object.keys(result.scopes || {}).length} scopes`);
    return result;
  } catch (e) {
    log.warn('[ESM Bundler] Failed to parse import map:', e instanceof Error ? e.message : e);
    return undefined;
  }
}
