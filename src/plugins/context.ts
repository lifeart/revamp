/**
 * Revamp Plugin System - Plugin Context
 *
 * Sandboxed API provided to plugins with permission-based access control.
 * Plugins interact with Revamp through this context rather than direct imports.
 */

import type { PluginPermission, HookName } from './types.js';
import { type HookTypes, HOOK_PERMISSION_REQUIREMENTS } from './hooks.js';
import { pluginRegistry } from './internal.js';
import type { RevampConfig } from '../config/index.js';
import {
  getConfig,
  getEffectiveConfig,
  getEffectiveConfigForRequest,
} from '../config/index.js';
import { getCached, setCache, getCacheStats } from '../cache/index.js';
import { getMetrics, type ProxyMetrics } from '../metrics/index.js';
import {
  readJson,
  writeJsonAtomic,
  deleteDataFile,
} from '../config/storage.js';
import { validatePluginConfig, type JSONSchema } from './validation.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import { sanitizeForLog } from '../logger/sanitize.js';

/**
 * Storage limits per plugin
 */
const STORAGE_LIMITS = {
  /** Maximum number of storage keys per plugin */
  maxKeys: 100,
  /** Maximum size per storage value in bytes */
  maxValueSize: 1024 * 1024, // 1MB
};

/** Track storage key counts per plugin */
const pluginStorageKeys = new Map<string, Set<string>>();

/**
 * T39: classify a literal IPv4 address against the SSRF deny list.
 *
 * Covers: 127.0.0.0/8 loopback, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16 link-local (which transitively blocks the AWS/GCP
 * metadata endpoint at 169.254.169.254), 0.0.0.0/8 "this host", and
 * 100.64.0.0/10 carrier-grade NAT.
 */
function classifyIPv4(addr: string): { unsafe: true; reason: string } | { unsafe: false } {
  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return { unsafe: false };
  const [, aStr, bStr] = m;
  const a = Number(aStr);
  const b = Number(bStr);
  if (a === 0) return { unsafe: true, reason: '0.0.0.0/8 not allowed' };
  if (a === 10) return { unsafe: true, reason: 'Private IP range (10.x.x.x) not allowed' };
  if (a === 127) return { unsafe: true, reason: 'Loopback IP range (127.x.x.x) not allowed' };
  if (a === 169 && b === 254) {
    return { unsafe: true, reason: 'Link-local IP range (169.254.x.x) not allowed' };
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return { unsafe: true, reason: 'Private IP range (172.16-31.x.x) not allowed' };
  }
  if (a === 192 && b === 168) {
    return { unsafe: true, reason: 'Private IP range (192.168.x.x) not allowed' };
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return { unsafe: true, reason: 'CGNAT range (100.64.0.0/10) not allowed' };
  }
  return { unsafe: false };
}

/**
 * T39: classify a literal IPv6 address against the SSRF deny list.
 *
 * Covers: `::1` loopback, `::ffff:0:0/96` IPv4-mapped (so `::ffff:127.0.0.1`
 * and `::ffff:169.254.169.254` cannot be smuggled past the IPv4 gate),
 * `fc00::/7` Unique Local Addresses, `fe80::/10` link-local. Anything not
 * matched returns "safe", but the caller still falls through to the literal
 * IPv4 / hostname checks; this function is the IPv6 layer.
 */
function classifyIPv6(addr: string): { unsafe: true; reason: string } | { unsafe: false } {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback ::1 — also matches "0:0:0:0:0:0:0:1" expanded form.
  if (lower === '::1' || /^(?:0+:){7}0*1$/.test(lower)) {
    return { unsafe: true, reason: 'IPv6 loopback (::1) not allowed' };
  }

  // ::ffff:0:0/96 IPv4-mapped — extract the embedded IPv4 and re-classify.
  const mappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) {
    const inner = classifyIPv4(mappedMatch[1]);
    if (inner.unsafe) {
      return { unsafe: true, reason: `IPv4-mapped IPv6 -> ${inner.reason}` };
    }
    // A public IPv4 wrapped in ::ffff: is still public; allow.
    return { unsafe: false };
  }
  // Hex-form mapped (`::ffff:7f00:1` == `::ffff:127.0.0.1`).
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) {
    return { unsafe: true, reason: 'IPv4-mapped IPv6 (hex form) not allowed' };
  }

  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) {
    return { unsafe: true, reason: 'IPv6 link-local (fe80::/10) not allowed' };
  }

  // fc00::/7 Unique Local Addresses (fc00::/8 + fd00::/8)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) {
    return { unsafe: true, reason: 'IPv6 ULA (fc00::/7) not allowed' };
  }

  return { unsafe: false };
}

/**
 * T39: hostname-string-only sanity check. This is the FIRST gate; it doesn't
 * resolve DNS and doesn't catch DNS rebinding. The async `assertResolvedHost`
 * below performs the second gate and re-checks every resolved address.
 *
 * Decimal/octal/hex IPv4 forms (`0x7f000001`, `0177.0.0.1`, `2130706433`):
 * Node's `URL` parser normalises these — `new URL('http://0x7f000001/').hostname`
 * yields `127.0.0.1`. We trust that normalisation but additionally re-classify
 * the hostname through `net.isIP` here so any oddly-formatted-but-still-IP
 * literal still hits `classifyIPv4` / `classifyIPv6`.
 */
function isUrlSafeToFetch(urlString: string): { safe: boolean; reason?: string } {
  try {
    const url = new URL(urlString);

    // Block non-http(s) protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { safe: false, reason: `Protocol '${url.protocol}' not allowed` };
    }

    const hostname = url.hostname.toLowerCase();
    // node URL parser strips wrapping brackets from IPv6 hosts but not always;
    // strip defensively.
    const stripped = hostname.replace(/^\[|\]$/g, '');

    // Block localhost variations
    if (
      stripped === 'localhost' ||
      stripped === '0.0.0.0' ||
      stripped.endsWith('.localhost')
    ) {
      return { safe: false, reason: 'Localhost URLs are not allowed' };
    }

    // Block common cloud metadata endpoints (check before generic IP ranges)
    if (
      stripped === 'metadata.google.internal' ||
      stripped === 'metadata.goog'
    ) {
      return { safe: false, reason: 'Cloud metadata endpoints not allowed' };
    }

    // Block internal domain patterns
    if (
      stripped.endsWith('.internal') ||
      stripped.endsWith('.local') ||
      stripped.endsWith('.corp') ||
      stripped.endsWith('.lan')
    ) {
      return { safe: false, reason: 'Internal domain names not allowed' };
    }

    // T39: when the URL parser hands us a literal IP (possibly normalised
    // from `0x7f000001` / `0177.0.0.1` / `2130706433`), re-classify it now.
    const ipKind = isIP(stripped);
    if (ipKind === 4) {
      const v4 = classifyIPv4(stripped);
      if (v4.unsafe) return { safe: false, reason: v4.reason };
    } else if (ipKind === 6) {
      const v6 = classifyIPv6(stripped);
      if (v6.unsafe) return { safe: false, reason: v6.reason };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }
}

/**
 * T39: every resolved address must clear the deny list. Closes DNS rebinding,
 * IPv4-mapped-IPv6 smuggling, and any IPv6 link-local / ULA escape vector.
 *
 * Returns the list of safe addresses for the caller to pin into the actual
 * fetch via Undici's `Agent.connect.lookup` override. Without that pinning,
 * Undici performs its own DNS lookup AFTER this validation — opening a TOCTOU
 * window where the second resolution can come back with a private IP (DNS
 * rebinding). Returning the validated addresses lets `fetch` short-circuit
 * Undici's resolver entirely.
 *
 * For literal IPs (no DNS work needed), returns null — the caller skips the
 * lookup override and lets Undici dial the literal directly.
 */
/**
 * T39: pluggable resolver. Production code uses `dnsLookup` from
 * `node:dns/promises`. Tests swap this via `__ssrfTesting.setResolver` so
 * they can simulate DNS rebinding without touching the real DNS stack.
 */
type DnsLookupFn = (
  hostname: string,
  opts: { all: true; verbatim: true }
) => Promise<LookupAddress[]>;

let activeResolver: DnsLookupFn = dnsLookup;

async function assertResolvedHostSafe(
  hostname: string
): Promise<LookupAddress[] | null> {
  const stripped = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // If the host is already a literal IP, we've classified it via the URL
  // parser path; nothing more to resolve. Returning null tells the caller
  // to skip the lookup override entirely.
  if (isIP(stripped)) {
    return null;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await activeResolver(stripped, { all: true, verbatim: true });
  } catch (err) {
    // Resolver failure: refuse to fetch. We can't tell whether this is a
    // typo or an attempted localhost-only name we'd rather block, so play
    // safe.
    throw new Error(
      `Fetch blocked: DNS lookup for ${stripped} failed (${(err as Error).message})`
    );
  }

  if (addresses.length === 0) {
    throw new Error(`Fetch blocked: DNS lookup for ${stripped} returned no addresses`);
  }

  for (const { address, family } of addresses) {
    if (family === 4) {
      const v4 = classifyIPv4(address);
      if (v4.unsafe) {
        throw new Error(
          `Fetch blocked: ${stripped} resolves to ${address} — ${v4.reason}`
        );
      }
    } else if (family === 6) {
      const v6 = classifyIPv6(address);
      if (v6.unsafe) {
        throw new Error(
          `Fetch blocked: ${stripped} resolves to ${address} — ${v6.reason}`
        );
      }
    }
  }

  return addresses;
}

/**
 * Internal: exported only for tests so they can swap the resolver. Production
 * code uses `dnsLookup` directly. Keeping this off the public type avoids it
 * leaking into `revamp/plugin`.
 */
export const __ssrfTesting = {
  isUrlSafeToFetch,
  assertResolvedHostSafe,
  classifyIPv4,
  classifyIPv6,
  /**
   * Swap the DNS resolver used by `assertResolvedHostSafe`. Tests call this
   * with a stub returning rebinding-style address arrays; production code
   * never invokes it.
   */
  setResolver(fn: DnsLookupFn | null): void {
    activeResolver = fn ?? dnsLookup;
  },
};

/**
 * Custom metric entry
 */
interface CustomMetric {
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

/**
 * Registered API endpoint handler
 */
export interface ApiEndpointHandler {
  (req: {
    method: string;
    path: string;
    query: Record<string, string>;
    body: string;
    headers: Record<string, string>;
  }): Promise<{
    statusCode: number;
    body: string;
    headers?: Record<string, string>;
  }>;
}

/**
 * Plugin Context - sandboxed API for plugins
 */
export interface PluginContext {
  /** Plugin ID */
  readonly pluginId: string;

  /** Plugin's granted permissions */
  readonly permissions: readonly PluginPermission[];

  // ==========================================
  // Hook Registration
  // ==========================================

  /**
   * Register a hook handler
   * @param hookName - Name of the hook
   * @param handler - Hook handler function
   * @param priority - Execution priority (higher = earlier, default 0)
   */
  registerHook<T extends HookName>(
    hookName: T,
    handler: HookTypes[T],
    priority?: number
  ): void;

  /**
   * Unregister a previously registered hook
   */
  unregisterHook(hookName: HookName): void;

  // ==========================================
  // Configuration
  // ==========================================

  /**
   * Get current global configuration (read-only)
   * Requires: config:read
   */
  getConfig(): Readonly<RevampConfig>;

  /**
   * Get effective config for a client/domain
   * Requires: config:read
   */
  getEffectiveConfig(clientIp?: string, domain?: string): Readonly<RevampConfig>;

  /**
   * Get plugin's own configuration
   */
  getPluginConfig<T extends Record<string, unknown>>(): T;

  /**
   * Update plugin's own configuration
   */
  updatePluginConfig(updates: Record<string, unknown>): Promise<void>;

  // ==========================================
  // Storage
  // ==========================================

  /**
   * Read data from plugin's storage
   * Requires: storage:read
   */
  readStorage<T>(key: string): Promise<T | null>;

  /**
   * Write data to plugin's storage
   * Requires: storage:write
   */
  writeStorage<T extends object>(key: string, data: T): Promise<void>;

  /**
   * Delete data from plugin's storage
   * Requires: storage:write
   */
  deleteStorage(key: string): Promise<boolean>;

  // ==========================================
  // Cache
  // ==========================================

  /**
   * Get cached data
   * Requires: cache:read
   *
   * @param method Optional HTTP method (default GET); folded into the cache
   *   key so plugins that care about non-GET responses get the right bucket.
   * @param requestHeaders Optional request headers; Cookie/Authorization names
   *   are folded into the key so authenticated users don't share entries.
   */
  getCached(
    url: string,
    contentType: string,
    clientIp?: string,
    method?: string,
    requestHeaders?: Record<string, string | string[] | undefined>
  ): Promise<Buffer | null>;

  /**
   * Set cached data
   * Requires: cache:write
   *
   * @param method Optional HTTP method (default GET).
   * @param requestHeaders Optional request headers; Cookie/Authorization names
   *   are folded into the cache key.
   * @param responseHeaders Optional upstream response headers; respected so
   *   the cache layer can skip Set-Cookie / Cache-Control: no-store|private.
   */
  setCache(
    url: string,
    contentType: string,
    data: Buffer,
    clientIp?: string,
    method?: string,
    requestHeaders?: Record<string, string | string[] | undefined>,
    responseHeaders?: Record<string, string | string[] | undefined>
  ): Promise<void>;

  /**
   * Get cache statistics
   * Requires: cache:read
   */
  getCacheStats(): { memoryEntries: number; memorySize: number };

  // ==========================================
  // Metrics
  // ==========================================

  /**
   * Get current metrics
   * Requires: metrics:read
   */
  getMetrics(): ProxyMetrics;

  /**
   * Record a custom metric
   * Requires: metrics:write
   */
  recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): void;

  /**
   * Get all custom metrics recorded by this plugin
   * Requires: metrics:read
   */
  getCustomMetrics(): Map<string, CustomMetric>;

  // ==========================================
  // Network
  // ==========================================

  /**
   * Make an HTTP request
   * Requires: network:fetch
   */
  fetch(url: string, options?: RequestInit): Promise<Response>;

  // ==========================================
  // API Registration
  // ==========================================

  /**
   * Register a custom API endpoint
   * Requires: api:register
   * Endpoint will be available at /__revamp__/plugins/{pluginId}/{path}
   */
  registerEndpoint(path: string, handler: ApiEndpointHandler): void;

  /**
   * Unregister a custom API endpoint
   */
  unregisterEndpoint(path: string): void;

  /**
   * Get all registered endpoints for this plugin
   */
  getRegisteredEndpoints(): string[];

  // ==========================================
  // Logging
  // ==========================================

  /**
   * Log a message (prefixed with plugin ID)
   */
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    ...args: unknown[]
  ): void;
}

// Global registry for plugin endpoints
const pluginEndpoints = new Map<string, Map<string, ApiEndpointHandler>>();

// Global registry for custom metrics
const pluginMetrics = new Map<string, Map<string, CustomMetric>>();

/**
 * Get the full path for a plugin endpoint
 */
export function getPluginEndpointPath(pluginId: string, path: string): string {
  return `/plugins/${pluginId}/${path.replace(/^\//, '')}`;
}

/**
 * Get all plugin endpoints
 */
export function getAllPluginEndpoints(): Map<
  string,
  Map<string, ApiEndpointHandler>
> {
  return pluginEndpoints;
}

/**
 * Find a plugin endpoint handler
 */
export function findPluginEndpoint(
  path: string
): { pluginId: string; handler: ApiEndpointHandler } | null {
  // Path format: /plugins/{pluginId}/{endpoint}
  const match = path.match(/^\/plugins\/([^/]+)\/(.+)$/);
  if (!match) return null;

  const [, pluginId, endpoint] = match;
  const endpoints = pluginEndpoints.get(pluginId);
  if (!endpoints) return null;

  const handler = endpoints.get(endpoint);
  if (!handler) return null;

  return { pluginId, handler };
}

/**
 * Create a sandboxed plugin context
 */
export function createPluginContext(
  pluginId: string,
  permissions: PluginPermission[]
): PluginContext {
  const permissionSet = new Set(permissions);

  function requirePermission(
    permission: PluginPermission,
    action: string
  ): void {
    if (!permissionSet.has(permission)) {
      throw new Error(
        `Plugin ${pluginId} does not have permission '${permission}' required for ${action}`
      );
    }
  }

  // Initialize plugin-specific storage
  if (!pluginEndpoints.has(pluginId)) {
    pluginEndpoints.set(pluginId, new Map());
  }
  if (!pluginMetrics.has(pluginId)) {
    pluginMetrics.set(pluginId, new Map());
  }

  const context: PluginContext = {
    pluginId,
    permissions: Object.freeze([...permissions]),

    // Hook registration
    registerHook<T extends HookName>(
      hookName: T,
      handler: HookTypes[T],
      priority: number = 0
    ): void {
      const required = HOOK_PERMISSION_REQUIREMENTS[hookName];
      if (!permissionSet.has(required)) {
        throw new Error(
          `Plugin ${pluginId} lacks permission ${required} required for hook ${hookName}`
        );
      }
      pluginRegistry.registerHook(pluginId, hookName, handler, priority);
    },

    unregisterHook(hookName: HookName): void {
      pluginRegistry.unregisterHook(pluginId, hookName);
    },

    // Configuration
    getConfig(): Readonly<RevampConfig> {
      requirePermission('config:read', 'getConfig');
      return Object.freeze({ ...getConfig() });
    },

    getEffectiveConfig(
      clientIp?: string,
      domain?: string
    ): Readonly<RevampConfig> {
      requirePermission('config:read', 'getEffectiveConfig');
      if (domain) {
        const result = getEffectiveConfigForRequest(domain, clientIp);
        return Object.freeze({ ...result.config });
      }
      return Object.freeze({ ...getEffectiveConfig(clientIp) });
    },

    getPluginConfig<T extends Record<string, unknown>>(): T {
      const info = pluginRegistry.getPlugin(pluginId);
      return (info?.config || {}) as T;
    },

    async updatePluginConfig(updates: Record<string, unknown>): Promise<void> {
      const info = pluginRegistry.getPlugin(pluginId);
      if (info) {
        const oldConfig = info.config;
        const newConfig = { ...info.config, ...updates };

        // Validate against schema if defined
        if (info.manifest.configSchema) {
          const result = validatePluginConfig(newConfig, info.manifest.configSchema as JSONSchema);
          if (!result.valid) {
            const errorMessages = result.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Config validation failed: ${errorMessages}`);
          }
        }

        pluginRegistry.updateConfig(pluginId, newConfig);

        // Notify plugin of config change
        const instance = pluginRegistry.getInstance(pluginId);
        if (instance?.onConfigChange) {
          await instance.onConfigChange(newConfig, oldConfig, context);
        }
      }
    },

    // Storage (sandboxed per-plugin)
    async readStorage<T>(key: string): Promise<T | null> {
      requirePermission('storage:read', 'readStorage');
      // Sanitize key to prevent path traversal
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (sanitizedKey !== key) {
        console.warn(`[Plugin:${pluginId}] Storage key sanitized: "${key}" -> "${sanitizedKey}"`);
      }
      const filename = `plugin-${pluginId.replace(/\./g, '-')}-${sanitizedKey}.json`;
      return readJson<T>(filename);
    },

    async writeStorage<T extends object>(key: string, data: T): Promise<void> {
      requirePermission('storage:write', 'writeStorage');
      // Sanitize key to prevent path traversal
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (sanitizedKey !== key) {
        console.warn(`[Plugin:${pluginId}] Storage key sanitized: "${key}" -> "${sanitizedKey}"`);
      }

      // Check value size limit
      const serialized = JSON.stringify(data);
      if (serialized.length > STORAGE_LIMITS.maxValueSize) {
        throw new Error(
          `Storage value exceeds maximum size of ${STORAGE_LIMITS.maxValueSize} bytes (got ${serialized.length})`
        );
      }

      // Track and check key count limit
      let keys = pluginStorageKeys.get(pluginId);
      if (!keys) {
        keys = new Set();
        pluginStorageKeys.set(pluginId, keys);
      }

      if (!keys.has(sanitizedKey) && keys.size >= STORAGE_LIMITS.maxKeys) {
        throw new Error(
          `Storage key limit reached (max ${STORAGE_LIMITS.maxKeys} keys per plugin)`
        );
      }

      const filename = `plugin-${pluginId.replace(/\./g, '-')}-${sanitizedKey}.json`;
      await writeJsonAtomic(filename, data);
      keys.add(sanitizedKey);
    },

    async deleteStorage(key: string): Promise<boolean> {
      requirePermission('storage:write', 'deleteStorage');
      // Sanitize key to prevent path traversal
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `plugin-${pluginId.replace(/\./g, '-')}-${sanitizedKey}.json`;
      const deleted = await deleteDataFile(filename);

      // Remove from tracked keys
      if (deleted) {
        const keys = pluginStorageKeys.get(pluginId);
        if (keys) {
          keys.delete(sanitizedKey);
        }
      }

      return deleted;
    },

    // Cache
    async getCached(
      url: string,
      contentType: string,
      clientIp?: string,
      method?: string,
      requestHeaders?: Record<string, string | string[] | undefined>
    ): Promise<Buffer | null> {
      requirePermission('cache:read', 'getCached');
      return getCached(url, contentType, clientIp, method, requestHeaders);
    },

    async setCache(
      url: string,
      contentType: string,
      data: Buffer,
      clientIp?: string,
      method?: string,
      requestHeaders?: Record<string, string | string[] | undefined>,
      responseHeaders?: Record<string, string | string[] | undefined>
    ): Promise<void> {
      requirePermission('cache:write', 'setCache');
      return setCache(url, contentType, data, clientIp, method, requestHeaders, responseHeaders);
    },

    getCacheStats(): { memoryEntries: number; memorySize: number } {
      requirePermission('cache:read', 'getCacheStats');
      return getCacheStats();
    },

    // Metrics
    getMetrics(): ProxyMetrics {
      requirePermission('metrics:read', 'getMetrics');
      return getMetrics();
    },

    recordMetric(
      name: string,
      value: number,
      tags: Record<string, string> = {}
    ): void {
      requirePermission('metrics:write', 'recordMetric');
      let metrics = pluginMetrics.get(pluginId);
      if (!metrics) {
        metrics = new Map();
        pluginMetrics.set(pluginId, metrics);
      }
      metrics.set(name, {
        value,
        tags,
        timestamp: Date.now(),
      });
    },

    getCustomMetrics(): Map<string, CustomMetric> {
      requirePermission('metrics:read', 'getCustomMetrics');
      return new Map(pluginMetrics.get(pluginId) || []);
    },

    // Network
    async fetch(url: string, options?: RequestInit): Promise<Response> {
      requirePermission('network:fetch', 'fetch');

      // T39 first gate: parse + literal-IP / hostname-suffix checks. Catches
      // localhost, metadata endpoints, internal-domain TLDs, and any IP
      // literal (including IPv4-mapped IPv6 forms and decimal/octal/hex IPv4
      // forms that `new URL()` normalises).
      const urlCheck = isUrlSafeToFetch(url);
      if (!urlCheck.safe) {
        throw new Error(`Fetch blocked: ${urlCheck.reason}`);
      }

      // T39 second gate: resolve the hostname through `node:dns/promises`
      // and re-check every returned address. Catches DNS rebinding (host
      // resolves to a private address even though the literal didn't look
      // private), IPv6 link-local, IPv6 ULA, and IPv4-mapped IPv6 returned
      // by the resolver. The returned `safeAddresses` are pinned into the
      // Undici dispatcher below so the actual TCP connect cannot race a
      // second DNS lookup that returns a private IP.
      const parsedUrl = new URL(url);
      const safeAddresses = await assertResolvedHostSafe(parsedUrl.hostname);

      // T39 close DNS-rebinding TOCTOU: build an Undici dispatcher whose
      // `connect.lookup` returns one of the addresses we already validated,
      // bypassing Undici's own resolver. For literal IPs (`safeAddresses`
      // is null) we don't override — Undici dials the literal directly.
      let dispatcher: UndiciAgent | undefined;
      if (safeAddresses && safeAddresses.length > 0) {
        const pinned = safeAddresses[0];
        // Node's `net.LookupFunction` callback signature: the address
        // parameter is typed `string | dns.LookupAddress[]`, family is
        // optional. Returning a literal string + family pins to a single
        // resolved address — exactly what we need to short-circuit Undici's
        // resolver and close the rebinding TOCTOU.
        const pinnedLookup: import('node:net').LookupFunction = (
          _hostname,
          _opts,
          cb
        ) => {
          cb(null, pinned.address, pinned.family);
        };
        dispatcher = new UndiciAgent({
          connect: { lookup: pinnedLookup },
        });
      }

      try {
        // Undici's fetch / Response and the global fetch / Response are
        // structurally compatible; cast through `unknown` because Undici's
        // `RequestInit` has a `dispatcher` field that the lib types don't.
        const init = dispatcher
          ? { ...(options ?? {}), dispatcher }
          : options;
        return await undiciFetch(
          url,
          init as Parameters<typeof undiciFetch>[1]
        );
      } finally {
        // Avoid leaking dispatcher sockets for one-shot fetches.
        if (dispatcher) {
          void dispatcher.close().catch((err: unknown) => {
            // Constant format string + tainted value as a separate argument:
            // closes CodeQL js/tainted-format-string without losing context.
            console.warn(
              '[Plugin] failed to close fetch dispatcher (plugin=%s)',
              sanitizeForLog(pluginId),
              err
            );
          });
        }
      }
    },

    // API Registration
    registerEndpoint(path: string, handler: ApiEndpointHandler): void {
      requirePermission('api:register', 'registerEndpoint');
      const normalizedPath = path.replace(/^\//, '');
      const endpoints = pluginEndpoints.get(pluginId)!;
      endpoints.set(normalizedPath, handler);
    },

    unregisterEndpoint(path: string): void {
      const normalizedPath = path.replace(/^\//, '');
      const endpoints = pluginEndpoints.get(pluginId);
      if (endpoints) {
        endpoints.delete(normalizedPath);
      }
    },

    getRegisteredEndpoints(): string[] {
      const endpoints = pluginEndpoints.get(pluginId);
      return endpoints ? Array.from(endpoints.keys()) : [];
    },

    // Logging
    log(
      level: 'debug' | 'info' | 'warn' | 'error',
      message: string,
      ...args: unknown[]
    ): void {
      const prefix = `[Plugin:${pluginId}]`;
      switch (level) {
        case 'debug':
          console.debug(prefix, message, ...args);
          break;
        case 'info':
          console.log(prefix, message, ...args);
          break;
        case 'warn':
          console.warn(prefix, message, ...args);
          break;
        case 'error':
          console.error(prefix, message, ...args);
          break;
      }
    },
  };

  return context;
}

/**
 * Clean up all resources for a plugin
 */
export function cleanupPluginResources(pluginId: string): void {
  pluginEndpoints.delete(pluginId);
  pluginStorageKeys.delete(pluginId);
  pluginMetrics.delete(pluginId);
}

/**
 * Get all custom metrics from all plugins
 */
export function getAllPluginMetrics(): Map<string, Map<string, CustomMetric>> {
  return new Map(pluginMetrics);
}
