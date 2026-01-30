/**
 * Domain Rule Manager
 *
 * Manages domain-specific profiles with:
 * - Pattern matching (exact, suffix/wildcard, regex)
 * - Profile lookup with caching
 * - File-based persistence with in-memory cache
 * - Runtime API for CRUD operations
 */

import { randomUUID } from 'node:crypto';
import type {
  DomainProfile,
  DomainPattern,
  DomainRulesStore,
  GlobalDefaults,
  ProfileMatchResult,
} from './domain-rules.js';
import { DEFAULT_RULES_STORE } from './domain-rules.js';
import { readJson, writeJsonAtomic, onFileChange } from './storage.js';

const RULES_FILENAME = 'domain-rules.json';

// In-memory cache
let rulesStore: DomainRulesStore | null = null;
let profileCache = new Map<string, ProfileMatchResult>();
let initialized = false;

/**
 * Initialize the domain manager
 * Loads rules from disk and sets up file watching
 */
export async function initializeDomainManager(): Promise<void> {
  if (initialized) return;

  await loadRules();

  // Watch for external changes
  onFileChange((filename) => {
    if (filename === RULES_FILENAME) {
      console.log('[DomainManager] Rules file changed, reloading...');
      loadRules().catch((err) => {
        console.warn('[DomainManager] Failed to reload rules:', err);
      });
    }
  });

  initialized = true;
}

/**
 * Load rules from file or return defaults
 */
export async function loadRules(): Promise<DomainRulesStore> {
  try {
    const stored = await readJson<DomainRulesStore>(RULES_FILENAME);

    if (stored && typeof stored.version === 'number') {
      rulesStore = stored;
      compilePatterns();
      profileCache.clear();
      console.log(
        `[DomainManager] Loaded ${rulesStore.profiles.length} profiles`
      );
      return rulesStore;
    }
  } catch (err) {
    console.warn('[DomainManager] Failed to load rules:', err);
  }

  // Use defaults
  rulesStore = structuredClone(DEFAULT_RULES_STORE);
  return rulesStore;
}

/**
 * Save rules to file
 */
export async function saveRules(): Promise<void> {
  if (!rulesStore) {
    rulesStore = structuredClone(DEFAULT_RULES_STORE);
  }

  await writeJsonAtomic(RULES_FILENAME, rulesStore);
  profileCache.clear();
}

/**
 * Get the current rules store (for internal use)
 */
export function getRulesStore(): DomainRulesStore {
  if (!rulesStore) {
    rulesStore = structuredClone(DEFAULT_RULES_STORE);
  }
  return rulesStore;
}

/**
 * Compile regex patterns for performance
 */
function compilePatterns(): void {
  if (!rulesStore) return;

  for (const profile of rulesStore.profiles) {
    for (const pattern of profile.patterns) {
      compilePattern(pattern);
    }
  }
}

/**
 * Compile a single pattern
 */
function compilePattern(pattern: DomainPattern): void {
  try {
    if (pattern.type === 'regex') {
      pattern.compiled = new RegExp(pattern.pattern, 'i');
    } else if (pattern.type === 'suffix') {
      // Convert *.google.com to regex: ^.*\.google\.com$ or ^google\.com$
      const escaped = pattern.pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      pattern.compiled = new RegExp(`^${escaped}$`, 'i');
    }
  } catch (err) {
    console.warn(
      `[DomainManager] Invalid pattern "${pattern.pattern}":`,
      err
    );
    pattern.compiled = undefined;
  }
}

/**
 * Match a domain against a pattern
 */
function matchesPattern(domain: string, pattern: DomainPattern): boolean {
  const domainLower = domain.toLowerCase();

  switch (pattern.type) {
    case 'exact':
      return domainLower === pattern.pattern.toLowerCase();

    case 'suffix':
    case 'regex':
      if (pattern.compiled) {
        return pattern.compiled.test(domainLower);
      }
      // Fallback for suffix without compiled regex
      if (pattern.type === 'suffix') {
        const patternLower = pattern.pattern.toLowerCase();
        if (patternLower.startsWith('*.')) {
          const suffix = patternLower.slice(2);
          return (
            domainLower === suffix || domainLower.endsWith('.' + suffix)
          );
        }
        return domainLower === patternLower;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Find the best matching profile for a domain
 * Uses priority ordering and caches results
 */
export function getProfileForDomain(domain: string): ProfileMatchResult {
  // Check cache first
  const cached = profileCache.get(domain);
  if (cached !== undefined) {
    return cached;
  }

  const store = getRulesStore();
  const result: ProfileMatchResult = { profile: null, matchedPattern: null };

  // Sort by priority (higher first)
  const sorted = [...store.profiles]
    .filter((p) => p.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const profile of sorted) {
    for (const pattern of profile.patterns) {
      if (matchesPattern(domain, pattern)) {
        result.profile = profile;
        result.matchedPattern = pattern;
        profileCache.set(domain, result);
        return result;
      }
    }
  }

  // Cache miss result too
  profileCache.set(domain, result);
  return result;
}

/**
 * Get global default rules
 */
export function getGlobalDefaults(): GlobalDefaults {
  return getRulesStore().globalDefaults;
}

/**
 * Update global default rules
 */
export async function updateGlobalDefaults(
  updates: Partial<GlobalDefaults>
): Promise<GlobalDefaults> {
  const store = getRulesStore();
  store.globalDefaults = {
    ...store.globalDefaults,
    ...updates,
  };
  await saveRules();
  return store.globalDefaults;
}

/**
 * Clear the profile cache
 * Call this when profiles are modified
 */
export function clearProfileCache(): void {
  profileCache.clear();
}

// ============ CRUD Operations ============

/**
 * Create a new profile
 */
export async function createProfile(
  data: Omit<DomainProfile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<DomainProfile> {
  const store = getRulesStore();
  const now = Date.now();

  const newProfile: DomainProfile = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  // Compile patterns
  for (const pattern of newProfile.patterns) {
    compilePattern(pattern);
  }

  store.profiles.push(newProfile);
  await saveRules();

  return newProfile;
}

/**
 * Update an existing profile
 */
export async function updateProfile(
  id: string,
  updates: Partial<Omit<DomainProfile, 'id' | 'createdAt'>>
): Promise<DomainProfile | null> {
  const store = getRulesStore();
  const index = store.profiles.findIndex((p) => p.id === id);

  if (index === -1) {
    return null;
  }

  const updated: DomainProfile = {
    ...store.profiles[index],
    ...updates,
    id: store.profiles[index].id, // Preserve ID
    createdAt: store.profiles[index].createdAt, // Preserve creation time
    updatedAt: Date.now(),
  };

  // Recompile patterns if they changed
  if (updates.patterns) {
    for (const pattern of updated.patterns) {
      compilePattern(pattern);
    }
  }

  store.profiles[index] = updated;
  await saveRules();

  return updated;
}

/**
 * Delete a profile
 */
export async function deleteProfile(id: string): Promise<boolean> {
  const store = getRulesStore();
  const index = store.profiles.findIndex((p) => p.id === id);

  if (index === -1) {
    return false;
  }

  store.profiles.splice(index, 1);
  await saveRules();

  return true;
}

/**
 * Get a profile by ID
 */
export function getProfile(id: string): DomainProfile | null {
  const store = getRulesStore();
  return store.profiles.find((p) => p.id === id) ?? null;
}

/**
 * List all profiles
 */
export function listProfiles(): DomainProfile[] {
  return getRulesStore().profiles;
}

/**
 * Get profiles count
 */
export function getProfilesCount(): number {
  return getRulesStore().profiles.length;
}

/**
 * Check if any profiles exist
 */
export function hasProfiles(): boolean {
  return getRulesStore().profiles.length > 0;
}

/**
 * Find profiles matching a domain (may return multiple for debugging)
 */
export function findMatchingProfiles(domain: string): DomainProfile[] {
  const store = getRulesStore();
  const matches: DomainProfile[] = [];

  for (const profile of store.profiles) {
    if (!profile.enabled) continue;

    for (const pattern of profile.patterns) {
      if (matchesPattern(domain, pattern)) {
        matches.push(profile);
        break; // Only add profile once
      }
    }
  }

  return matches.sort((a, b) => b.priority - a.priority);
}

/**
 * Import profiles from an array (for bulk import)
 */
export async function importProfiles(
  profiles: Array<Omit<DomainProfile, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<DomainProfile[]> {
  const imported: DomainProfile[] = [];

  for (const data of profiles) {
    const profile = await createProfile(data);
    imported.push(profile);
  }

  return imported;
}

/**
 * Export all profiles (for backup)
 */
export function exportProfiles(): DomainRulesStore {
  return structuredClone(getRulesStore());
}

/**
 * Reset all rules to defaults
 */
export async function resetToDefaults(): Promise<void> {
  rulesStore = structuredClone(DEFAULT_RULES_STORE);
  await saveRules();
}
