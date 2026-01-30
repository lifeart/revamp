/**
 * Revamp Plugin System - Plugin Context
 *
 * Sandboxed API provided to plugins with permission-based access control.
 * Plugins interact with Revamp through this context rather than direct imports.
 */

import type { PluginPermission, HookName } from './types.js';
import type { HookTypes } from './hooks.js';
import { pluginRegistry } from './registry.js';
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
 * Check if a URL is safe to fetch (not internal/private)
 */
function isUrlSafeToFetch(urlString: string): { safe: boolean; reason?: string } {
  try {
    const url = new URL(urlString);

    // Block non-http(s) protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { safe: false, reason: `Protocol '${url.protocol}' not allowed` };
    }

    const hostname = url.hostname.toLowerCase();

    // Block localhost variations
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    ) {
      return { safe: false, reason: 'Localhost URLs are not allowed' };
    }

    // Block common cloud metadata endpoints (check before generic IP ranges)
    if (
      hostname === '169.254.169.254' || // AWS/GCP metadata
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata.goog'
    ) {
      return { safe: false, reason: 'Cloud metadata endpoints not allowed' };
    }

    // Block private IP ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);

      // 10.0.0.0/8
      if (a === 10) {
        return { safe: false, reason: 'Private IP range (10.x.x.x) not allowed' };
      }
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) {
        return { safe: false, reason: 'Private IP range (172.16-31.x.x) not allowed' };
      }
      // 192.168.0.0/16
      if (a === 192 && b === 168) {
        return { safe: false, reason: 'Private IP range (192.168.x.x) not allowed' };
      }
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) {
        return { safe: false, reason: 'Link-local IP range not allowed' };
      }
    }

    // Block internal domain patterns
    if (
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.corp') ||
      hostname.endsWith('.lan')
    ) {
      return { safe: false, reason: 'Internal domain names not allowed' };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }
}

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
   */
  getCached(
    url: string,
    contentType: string,
    clientIp?: string
  ): Promise<Buffer | null>;

  /**
   * Set cached data
   * Requires: cache:write
   */
  setCache(
    url: string,
    contentType: string,
    data: Buffer,
    clientIp?: string
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
      clientIp?: string
    ): Promise<Buffer | null> {
      requirePermission('cache:read', 'getCached');
      return getCached(url, contentType, clientIp);
    },

    async setCache(
      url: string,
      contentType: string,
      data: Buffer,
      clientIp?: string
    ): Promise<void> {
      requirePermission('cache:write', 'setCache');
      return setCache(url, contentType, data, clientIp);
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

      // Validate URL to prevent SSRF attacks
      const urlCheck = isUrlSafeToFetch(url);
      if (!urlCheck.safe) {
        throw new Error(`Fetch blocked: ${urlCheck.reason}`);
      }

      return globalThis.fetch(url, options);
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
