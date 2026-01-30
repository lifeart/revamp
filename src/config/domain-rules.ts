/**
 * Domain-specific configuration types
 *
 * Enables granular control over transformations and filtering per domain
 * with pattern matching support (exact, suffix/wildcard, regex).
 */

/** Pattern matching for domain rules */
export interface DomainPattern {
  /** Pattern type: exact match, suffix (*.google.com), or regex */
  type: 'exact' | 'suffix' | 'regex';
  /** The pattern string */
  pattern: string;
  /** Compiled regex for performance (cached at runtime) */
  compiled?: RegExp;
}

/** Filter rule for blocking content */
export interface FilterRule {
  /** Unique ID for the rule */
  id: string;
  /** Human-readable name */
  name: string;
  /** Rule type */
  type: 'domain' | 'url-pattern' | 'css-selector' | 'script-pattern';
  /** The actual pattern/selector */
  value: string;
  /** Whether to block (true) or allow (false) */
  action: 'block' | 'allow';
  /** Whether this rule is active */
  enabled: boolean;
}

/** Transformation settings that can be overridden per domain */
export interface TransformConfig {
  transformJs?: boolean;
  transformCss?: boolean;
  transformHtml?: boolean;
  bundleEsModules?: boolean;
  emulateServiceWorkers?: boolean;
  remoteServiceWorkers?: boolean;
  injectPolyfills?: boolean;
  spoofUserAgent?: boolean;
  spoofUserAgentInJs?: boolean;
}

/** Complete domain profile */
export interface DomainProfile {
  /** Profile ID (used in API) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Domain patterns this profile applies to */
  patterns: DomainPattern[];
  /** Priority (higher = checked first, default 0) */
  priority: number;
  /** Transformation overrides (undefined = inherit from client/global) */
  transforms?: Partial<TransformConfig>;
  /** Ad blocking rules specific to this domain */
  adRules?: FilterRule[];
  /** Tracking blocking rules specific to this domain */
  trackingRules?: FilterRule[];
  /** Content improvement rules */
  contentRules?: FilterRule[];
  /** Whether ad blocking is enabled for this domain (undefined = inherit) */
  removeAds?: boolean;
  /** Whether tracking removal is enabled for this domain (undefined = inherit) */
  removeTracking?: boolean;
  /** Whether caching is enabled for this domain (undefined = inherit) */
  cacheEnabled?: boolean;
  /** Custom ad script patterns (regex strings) */
  customAdPatterns?: string[];
  /** Custom tracking script patterns (regex strings) */
  customTrackingPatterns?: string[];
  /** Custom ad container CSS selectors */
  customAdSelectors?: string[];
  /** Custom tracking pixel CSS selectors */
  customTrackingSelectors?: string[];
  /** Whether this profile is enabled */
  enabled: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

/** Global default rules applied when no domain profile matches */
export interface GlobalDefaults {
  /** Default ad blocking rules */
  adRules: FilterRule[];
  /** Default tracking blocking rules */
  trackingRules: FilterRule[];
  /** Default content rules */
  contentRules: FilterRule[];
}

/** Storage format for domain profiles */
export interface DomainRulesStore {
  /** Schema version for migrations */
  version: number;
  /** All domain profiles */
  profiles: DomainProfile[];
  /** Global defaults applied when no profile matches */
  globalDefaults: GlobalDefaults;
}

/** Filter context for a request - passed to filter functions */
export interface FilterContext {
  /** The domain being accessed */
  domain: string;
  /** The full URL being accessed */
  url: string;
  /** The matched domain profile (if any) */
  profile: DomainProfile | null;
}

/** Result of profile matching */
export interface ProfileMatchResult {
  /** The matched profile */
  profile: DomainProfile | null;
  /** The pattern that matched */
  matchedPattern: DomainPattern | null;
}

/** API response types */
export interface DomainRulesApiResponse {
  success: boolean;
  error?: string;
}

export interface ProfileListResponse extends DomainRulesApiResponse {
  profiles: DomainProfile[];
}

export interface ProfileResponse extends DomainRulesApiResponse {
  profile: DomainProfile;
}

export interface ProfileMatchResponse extends DomainRulesApiResponse {
  domain: string;
  profile: DomainProfile | null;
  matchedPattern: DomainPattern | null;
}

/** Create a new profile with defaults */
export function createDefaultProfile(
  name: string,
  patterns: DomainPattern[]
): Omit<DomainProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name,
    patterns,
    priority: 0,
    enabled: true,
  };
}

/** Default store structure */
export const DEFAULT_RULES_STORE: DomainRulesStore = {
  version: 1,
  profiles: [],
  globalDefaults: {
    adRules: [],
    trackingRules: [],
    contentRules: [],
  },
};
