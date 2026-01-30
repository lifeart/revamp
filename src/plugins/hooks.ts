/**
 * Revamp Plugin System - Hook Types
 *
 * Type definitions for all available hooks in the plugin system.
 * Hooks use an interceptor chain pattern where each hook can:
 * - Continue processing (pass to next hook)
 * - Stop processing and return a value
 * - Stop processing with an error
 */

import type { RevampConfig } from '../config/index.js';
import type { DomainProfile } from '../config/domain-rules.js';
import type { ContentType } from '../proxy/types.js';
import type { HookName } from './types.js';

/**
 * Request context passed to request hooks
 */
export interface RequestContext {
  /** Unique request ID */
  requestId: string;
  /** Target URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Request headers */
  headers: Record<string, string | string[] | undefined>;
  /** Client IP address */
  clientIp: string;
  /** Parsed hostname */
  hostname: string;
  /** Effective configuration for this request */
  config: RevampConfig;
  /** Matched domain profile (if any) */
  profile: DomainProfile | null;
  /** Whether this is HTTPS */
  isHttps: boolean;
  /** Request start timestamp */
  startTime: number;
  /** Custom data attached by plugins */
  pluginData: Map<string, unknown>;
}

/**
 * Response context passed to response hooks
 */
export interface ResponseContext extends RequestContext {
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  responseHeaders: Record<string, string | string[] | undefined>;
  /** Response body (may be modified) */
  body: Buffer;
  /** Detected content type */
  contentType: ContentType;
  /** Original body size (before transformation) */
  originalSize: number;
  /** Request duration in ms */
  duration: number;
}

/**
 * Transform context for content transformation hooks
 */
export interface TransformContext {
  /** Content to transform */
  content: string;
  /** Source URL */
  url: string;
  /** Content type being transformed */
  type: 'js' | 'css' | 'html';
  /** Effective configuration */
  config: RevampConfig;
  /** Client IP for per-client handling */
  clientIp?: string;
  /** Matched domain profile */
  profile: DomainProfile | null;
}

/**
 * Filter context for filter decision hooks
 */
export interface FilterContext {
  /** URL being filtered */
  url: string;
  /** Hostname being filtered */
  hostname: string;
  /** Effective configuration */
  config: RevampConfig;
  /** Matched domain profile */
  profile: DomainProfile | null;
}

/**
 * Config resolution context
 */
export interface ConfigResolutionContext {
  /** Base configuration */
  baseConfig: RevampConfig;
  /** Client IP (if available) */
  clientIp?: string;
  /** Domain being accessed (if available) */
  domain?: string;
}

/**
 * Domain lifecycle event context
 */
export interface DomainLifecycleContext {
  /** Event type */
  event: 'create' | 'update' | 'delete';
  /** The profile being changed */
  profile: DomainProfile;
  /** Previous profile state (for update/delete) */
  previousProfile?: DomainProfile;
}

/**
 * Cache operation context
 */
export interface CacheContext {
  /** Cache key */
  key: string;
  /** Original URL */
  url: string;
  /** Content type */
  contentType: string;
  /** Client IP */
  clientIp?: string;
}

/**
 * Metrics event context
 */
export interface MetricsContext {
  /** Event name */
  event: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Hook result types - determines how the hook chain proceeds
 */
export type HookResult<T> =
  | { continue: true; value?: T } // Continue processing, optionally with modified value
  | { continue: false; value: T } // Stop processing, use this value
  | { continue: false; error: Error }; // Stop processing with error

/**
 * Pre-request hook result
 */
export interface PreRequestResult {
  /** Modified URL (optional) */
  url?: string;
  /** Modified headers (optional) */
  headers?: Record<string, string>;
  /** Block the request */
  blocked?: boolean;
  /** Custom response if blocked */
  blockedResponse?: {
    statusCode: number;
    body: string;
    headers?: Record<string, string>;
  };
}

/**
 * Post-response hook result
 */
export interface PostResponseResult {
  /** Modified body */
  body?: Buffer;
  /** Modified headers */
  headers?: Record<string, string | string[] | undefined>;
  /** Modified status code */
  statusCode?: number;
}

/**
 * Pre-transform hook result
 */
export interface PreTransformResult {
  /** Modified content */
  content?: string;
  /** Skip transformation */
  skipTransform?: boolean;
}

/**
 * Post-transform hook result
 */
export interface PostTransformResult {
  /** Modified transformed content */
  content?: string;
}

/**
 * Filter decision hook result
 */
export interface FilterDecisionResult {
  /** Should block */
  block?: boolean;
  /** Reason for blocking */
  reason?: string;
}

/**
 * Config resolution hook result
 */
export interface ConfigResolutionResult {
  /** Config overrides to apply */
  overrides?: Partial<RevampConfig>;
}

/**
 * Cache get hook result
 */
export interface CacheGetResult {
  /** Cached data from custom backend */
  data?: Buffer;
  /** Cache hit */
  hit?: boolean;
}

/**
 * Pre-request hook - can modify or block requests
 */
export type PreRequestHook = (
  context: RequestContext
) => Promise<HookResult<PreRequestResult>>;

/**
 * Post-response hook - can modify responses
 */
export type PostResponseHook = (
  context: ResponseContext
) => Promise<HookResult<PostResponseResult>>;

/**
 * Pre-transform hook - runs before content transformation
 */
export type PreTransformHook = (
  context: TransformContext
) => Promise<HookResult<PreTransformResult>>;

/**
 * Post-transform hook - runs after content transformation
 */
export type PostTransformHook = (
  context: TransformContext & { transformed: string }
) => Promise<HookResult<PostTransformResult>>;

/**
 * Filter decision hook - for custom blocking logic
 */
export type FilterDecisionHook = (
  context: FilterContext
) => Promise<HookResult<FilterDecisionResult>>;

/**
 * Config resolution hook - inject plugin config into cascade
 */
export type ConfigResolutionHook = (
  context: ConfigResolutionContext
) => Promise<HookResult<ConfigResolutionResult>>;

/**
 * Domain profile lifecycle hook (notification only)
 */
export type DomainLifecycleHook = (
  context: DomainLifecycleContext
) => Promise<void>;

/**
 * Cache get hook - custom cache backend
 */
export type CacheGetHook = (
  context: CacheContext
) => Promise<HookResult<CacheGetResult>>;

/**
 * Cache set hook (notification only)
 */
export type CacheSetHook = (
  context: CacheContext & { data: Buffer }
) => Promise<void>;

/**
 * Metrics recording hook (notification only)
 */
export type MetricsHook = (context: MetricsContext) => Promise<void>;

/**
 * All hook types mapped by name
 */
export interface HookTypes {
  'request:pre': PreRequestHook;
  'response:post': PostResponseHook;
  'transform:pre': PreTransformHook;
  'transform:post': PostTransformHook;
  'filter:decision': FilterDecisionHook;
  'config:resolution': ConfigResolutionHook;
  'domain:lifecycle': DomainLifecycleHook;
  'cache:get': CacheGetHook;
  'cache:set': CacheSetHook;
  'metrics:record': MetricsHook;
}

/**
 * Get the hook type for a given hook name
 */
export type HookType<T extends HookName> = HookTypes[T];

/**
 * Hook registration with priority and plugin reference
 */
export interface HookRegistration<T extends HookName = HookName> {
  /** Plugin that registered this hook */
  pluginId: string;
  /** The hook function */
  hook: HookTypes[T];
  /** Execution priority (higher = earlier) */
  priority: number;
}

/**
 * Helper to create a continue result
 */
export function continueResult<T>(value?: T): HookResult<T> {
  return { continue: true, value };
}

/**
 * Helper to create a stop result with value
 */
export function stopResult<T>(value: T): HookResult<T> {
  return { continue: false, value };
}

/**
 * Helper to create a stop result with error
 */
export function errorResult<T>(error: Error): HookResult<T> {
  return { continue: false, error };
}
