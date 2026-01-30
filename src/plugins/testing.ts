/**
 * Revamp Plugin System - Testing Utilities
 *
 * Test harness and mocks for plugin developers to test their plugins in isolation.
 * Provides utilities to create mock contexts, requests, responses, and test plugins.
 */

import type {
  PluginManifest,
  PluginPermission,
  RevampPlugin,
  HookName,
} from './types.js';
import type { PluginContext, ApiEndpointHandler } from './context.js';
import type { HookTypes } from './hooks.js';
import type {
  RequestContext,
  ResponseContext,
  TransformContext,
  FilterContext,
  ConfigResolutionContext,
} from './hooks.js';
import type { RevampConfig } from '../config/index.js';
import type { ContentType } from '../proxy/types.js';
import { defaultConfig } from '../config/index.js';

/**
 * Options for creating a mock request context
 */
export interface MockRequestOptions {
  /** Target URL (default: 'https://example.com/test') */
  url?: string;
  /** HTTP method (default: 'GET') */
  method?: string;
  /** Request headers */
  headers?: Record<string, string | string[] | undefined>;
  /** Client IP address (default: '127.0.0.1') */
  clientIp?: string;
  /** Whether this is HTTPS (default: true) */
  isHttps?: boolean;
  /** Effective configuration */
  config?: Partial<RevampConfig>;
}

/**
 * Options for creating a mock response context
 */
export interface MockResponseOptions extends MockRequestOptions {
  /** HTTP status code (default: 200) */
  statusCode?: number;
  /** Response headers */
  responseHeaders?: Record<string, string | string[] | undefined>;
  /** Response body (default: empty buffer) */
  body?: Buffer;
  /** Content type (default: 'other') */
  contentType?: ContentType;
}

/**
 * Options for creating a mock transform context
 */
export interface MockTransformOptions {
  /** Content to transform */
  content?: string;
  /** Content type */
  type?: 'js' | 'css' | 'html';
  /** Source URL */
  url?: string;
  /** Effective configuration */
  config?: Partial<RevampConfig>;
  /** Client IP */
  clientIp?: string;
}

/**
 * Options for creating a mock filter context
 */
export interface MockFilterOptions {
  /** URL being filtered */
  url?: string;
  /** Hostname being filtered */
  hostname?: string;
  /** Effective configuration */
  config?: Partial<RevampConfig>;
}

/**
 * Log entry captured during test execution
 */
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args: unknown[];
  timestamp: number;
}

/**
 * Mock fetch response options
 */
export interface MockFetchResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | object;
}

/**
 * Mock fetch handler type
 */
export type MockFetchHandler = (
  url: string,
  options?: RequestInit
) => Promise<MockFetchResponse> | MockFetchResponse;

/**
 * Options for creating a test plugin context
 */
export interface TestContextOptions {
  /** Plugin ID (default: 'com.test.plugin') */
  pluginId?: string;
  /** Permissions (default: all permissions) */
  permissions?: PluginPermission[];
  /** Initial plugin config */
  pluginConfig?: Record<string, unknown>;
  /** Global config overrides */
  globalConfig?: Partial<RevampConfig>;
  /** Mock fetch handler (default: throws error to prevent real network calls) */
  mockFetch?: MockFetchHandler;
  /** Whether to capture logs instead of writing to console (default: true) */
  captureLog?: boolean;
}

/**
 * Test plugin context with additional test utilities
 */
export interface TestPluginContext extends PluginContext {
  /** Get all registered hooks */
  getRegisteredHooks(): Map<HookName, { handler: unknown; priority: number }>;
  /** Simulate a hook call and get the result */
  simulateHook<T extends HookName>(
    hookName: T,
    context: Parameters<HookTypes[T]>[0]
  ): Promise<ReturnType<HookTypes[T]> | null>;
  /** Get the current plugin config */
  getCurrentConfig(): Record<string, unknown>;
  /** Reset the context to initial state */
  reset(): void;
  /** Get all captured log entries (if captureLog is true) */
  getLogs(): LogEntry[];
  /** Clear captured logs */
  clearLogs(): void;
  /** Get logs filtered by level */
  getLogsByLevel(level: 'debug' | 'info' | 'warn' | 'error'): LogEntry[];
  /** Set the mock fetch handler */
  setMockFetch(handler: MockFetchHandler): void;
}

// All available permissions
const ALL_PERMISSIONS: PluginPermission[] = [
  'request:read',
  'request:modify',
  'response:read',
  'response:modify',
  'config:read',
  'config:write',
  'cache:read',
  'cache:write',
  'metrics:read',
  'metrics:write',
  'network:fetch',
  'storage:read',
  'storage:write',
  'api:register',
];

/**
 * Create a mock request context for testing request:pre hooks
 */
export function createMockRequest(options: MockRequestOptions = {}): RequestContext {
  const url = options.url || 'https://example.com/test';
  const parsedUrl = new URL(url);

  return {
    requestId: `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    clientIp: options.clientIp || '127.0.0.1',
    hostname: parsedUrl.hostname,
    config: { ...defaultConfig, ...options.config } as RevampConfig,
    profile: null,
    isHttps: options.isHttps ?? true,
    startTime: Date.now(),
    pluginData: new Map(),
  };
}

/**
 * Create a mock response context for testing response:post hooks
 */
export function createMockResponse(options: MockResponseOptions = {}): ResponseContext {
  const requestContext = createMockRequest(options);

  return {
    ...requestContext,
    statusCode: options.statusCode || 200,
    responseHeaders: options.responseHeaders || {},
    body: options.body || Buffer.from(''),
    contentType: options.contentType || 'other',
    originalSize: options.body?.length || 0,
    duration: 100,
  };
}

/**
 * Create a mock transform context for testing transform:pre/post hooks
 */
export function createMockTransform(options: MockTransformOptions = {}): TransformContext {
  return {
    content: options.content || '',
    url: options.url || 'https://example.com/script.js',
    type: options.type || 'js',
    config: { ...defaultConfig, ...options.config } as RevampConfig,
    clientIp: options.clientIp,
    profile: null,
  };
}

/**
 * Create a mock filter context for testing filter:decision hooks
 */
export function createMockFilter(options: MockFilterOptions = {}): FilterContext {
  const url = options.url || 'https://example.com/test';
  const parsedUrl = new URL(url);

  return {
    url,
    hostname: options.hostname || parsedUrl.hostname,
    config: { ...defaultConfig, ...options.config } as RevampConfig,
    profile: null,
  };
}

/**
 * Create a mock config resolution context for testing config:resolution hooks
 */
export function createMockConfigResolution(
  options: {
    baseConfig?: Partial<RevampConfig>;
    clientIp?: string;
    domain?: string;
  } = {}
): ConfigResolutionContext {
  return {
    baseConfig: { ...defaultConfig, ...options.baseConfig } as RevampConfig,
    clientIp: options.clientIp,
    domain: options.domain,
  };
}

/**
 * Default mock fetch handler that prevents accidental network calls
 */
const defaultMockFetch: MockFetchHandler = (url: string) => {
  throw new Error(
    `Network call to '${url}' blocked in test context. ` +
    `Use mockFetch option or setMockFetch() to provide a mock handler.`
  );
};

/**
 * Create a test plugin context with full or partial permissions
 */
export function createTestContext(options: TestContextOptions = {}): TestPluginContext {
  const pluginId = options.pluginId || 'com.test.plugin';
  const permissions = options.permissions || ALL_PERMISSIONS;
  const permissionSet = new Set(permissions);
  const captureLog = options.captureLog !== false; // Default to true

  let pluginConfig = { ...options.pluginConfig };
  const globalConfig = { ...defaultConfig, ...options.globalConfig };

  // Storage for hooks registered by the plugin
  const registeredHooks = new Map<HookName, { handler: unknown; priority: number }>();

  // Storage for registered endpoints
  const registeredEndpoints = new Map<string, ApiEndpointHandler>();

  // Storage for custom metrics
  const customMetrics = new Map<string, { value: number; tags: Record<string, string>; timestamp: number }>();

  // In-memory storage
  const storage = new Map<string, unknown>();

  // Mock cache
  const cache = new Map<string, Buffer>();

  // Captured logs
  const capturedLogs: LogEntry[] = [];

  // Mock fetch handler
  let mockFetchHandler: MockFetchHandler = options.mockFetch || defaultMockFetch;

  function requirePermission(permission: PluginPermission, action: string): void {
    if (!permissionSet.has(permission)) {
      throw new Error(
        `Plugin ${pluginId} does not have permission '${permission}' required for ${action}`
      );
    }
  }

  const context: TestPluginContext = {
    pluginId,
    permissions: Object.freeze([...permissions]),

    // Hook registration
    registerHook<T extends HookName>(
      hookName: T,
      handler: HookTypes[T],
      priority: number = 0
    ): void {
      registeredHooks.set(hookName, { handler, priority });
    },

    unregisterHook(hookName: HookName): void {
      registeredHooks.delete(hookName);
    },

    // Configuration
    getConfig(): Readonly<RevampConfig> {
      requirePermission('config:read', 'getConfig');
      return Object.freeze({ ...globalConfig });
    },

    getEffectiveConfig(clientIp?: string, domain?: string): Readonly<RevampConfig> {
      requirePermission('config:read', 'getEffectiveConfig');
      // In test context, just return global config
      return Object.freeze({ ...globalConfig });
    },

    getPluginConfig<T extends Record<string, unknown>>(): T {
      return { ...pluginConfig } as T;
    },

    async updatePluginConfig(updates: Record<string, unknown>): Promise<void> {
      pluginConfig = { ...pluginConfig, ...updates };
    },

    // Storage
    async readStorage<T>(key: string): Promise<T | null> {
      requirePermission('storage:read', 'readStorage');
      const value = storage.get(key);
      return value !== undefined ? (value as T) : null;
    },

    async writeStorage<T extends object>(key: string, data: T): Promise<void> {
      requirePermission('storage:write', 'writeStorage');
      storage.set(key, data);
    },

    async deleteStorage(key: string): Promise<boolean> {
      requirePermission('storage:write', 'deleteStorage');
      return storage.delete(key);
    },

    // Cache
    async getCached(
      url: string,
      contentType: string,
      clientIp?: string
    ): Promise<Buffer | null> {
      requirePermission('cache:read', 'getCached');
      const key = `${url}:${contentType}:${clientIp || ''}`;
      return cache.get(key) || null;
    },

    async setCache(
      url: string,
      contentType: string,
      data: Buffer,
      clientIp?: string
    ): Promise<void> {
      requirePermission('cache:write', 'setCache');
      const key = `${url}:${contentType}:${clientIp || ''}`;
      cache.set(key, data);
    },

    getCacheStats(): { memoryEntries: number; memorySize: number } {
      requirePermission('cache:read', 'getCacheStats');
      let totalSize = 0;
      for (const buffer of cache.values()) {
        totalSize += buffer.length;
      }
      return { memoryEntries: cache.size, memorySize: totalSize };
    },

    // Metrics
    getMetrics() {
      requirePermission('metrics:read', 'getMetrics');
      // Return mock metrics matching ProxyMetrics interface
      return {
        startTime: Date.now(),
        uptime: 0,
        requests: {
          total: 0,
          blocked: 0,
          cached: 0,
          transformed: 0,
        },
        transforms: { js: 0, css: 0, html: 0, images: 0 },
        bandwidth: {
          totalBytesIn: 0,
          totalBytesOut: 0,
          savedBytes: 0,
        },
        cacheHitRate: 0,
        transformRate: 0,
        errors: 0,
        activeConnections: 0,
        peakConnections: 0,
      };
    },

    recordMetric(
      name: string,
      value: number,
      tags: Record<string, string> = {}
    ): void {
      requirePermission('metrics:write', 'recordMetric');
      customMetrics.set(name, { value, tags, timestamp: Date.now() });
    },

    getCustomMetrics() {
      requirePermission('metrics:read', 'getCustomMetrics');
      return new Map(customMetrics);
    },

    // Network
    async fetch(url: string, options?: RequestInit): Promise<Response> {
      requirePermission('network:fetch', 'fetch');
      // Use mock fetch handler instead of real network
      const mockResponse = await mockFetchHandler(url, options);
      const body = typeof mockResponse.body === 'object' && !(mockResponse.body instanceof Buffer)
        ? JSON.stringify(mockResponse.body)
        : mockResponse.body;

      return new Response(body as string | Buffer | undefined, {
        status: mockResponse.status ?? 200,
        statusText: mockResponse.statusText ?? 'OK',
        headers: mockResponse.headers,
      });
    },

    // API Registration
    registerEndpoint(path: string, handler: ApiEndpointHandler): void {
      requirePermission('api:register', 'registerEndpoint');
      const normalizedPath = path.replace(/^\//, '');
      registeredEndpoints.set(normalizedPath, handler);
    },

    unregisterEndpoint(path: string): void {
      const normalizedPath = path.replace(/^\//, '');
      registeredEndpoints.delete(normalizedPath);
    },

    getRegisteredEndpoints(): string[] {
      return Array.from(registeredEndpoints.keys());
    },

    // Logging
    log(
      level: 'debug' | 'info' | 'warn' | 'error',
      message: string,
      ...args: unknown[]
    ): void {
      if (captureLog) {
        // Capture log instead of writing to console
        capturedLogs.push({
          level,
          message,
          args,
          timestamp: Date.now(),
        });
      } else {
        // Write to console
        const prefix = `[TestPlugin:${pluginId}]`;
        console[level === 'debug' ? 'debug' : level === 'info' ? 'log' : level](prefix, message, ...args);
      }
    },

    // Test utilities
    getRegisteredHooks() {
      return new Map(registeredHooks);
    },

    async simulateHook<T extends HookName>(
      hookName: T,
      hookContext: Parameters<HookTypes[T]>[0]
    ): Promise<ReturnType<HookTypes[T]> | null> {
      const hookEntry = registeredHooks.get(hookName);
      if (!hookEntry) {
        return null;
      }
      const handler = hookEntry.handler as HookTypes[T];
      return handler(hookContext as never) as ReturnType<HookTypes[T]>;
    },

    getCurrentConfig() {
      return { ...pluginConfig };
    },

    reset(): void {
      pluginConfig = { ...options.pluginConfig };
      registeredHooks.clear();
      registeredEndpoints.clear();
      customMetrics.clear();
      storage.clear();
      cache.clear();
      capturedLogs.length = 0;
      mockFetchHandler = options.mockFetch || defaultMockFetch;
    },

    // Log utilities
    getLogs(): LogEntry[] {
      return [...capturedLogs];
    },

    clearLogs(): void {
      capturedLogs.length = 0;
    },

    getLogsByLevel(level: 'debug' | 'info' | 'warn' | 'error'): LogEntry[] {
      return capturedLogs.filter((log) => log.level === level);
    },

    // Mock fetch utilities
    setMockFetch(handler: MockFetchHandler): void {
      mockFetchHandler = handler;
    },
  };

  return context;
}

/**
 * Create a test plugin with a partial manifest
 */
export function createTestPlugin(
  manifestOverrides: Partial<PluginManifest> = {},
  implementation: Partial<Omit<RevampPlugin, 'manifest'>> = {}
): RevampPlugin {
  const manifest: PluginManifest = {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin for unit testing',
    author: 'Test',
    revampVersion: '1.0.0',
    main: 'index.js',
    permissions: ALL_PERMISSIONS,
    hooks: [],
    ...manifestOverrides,
  };

  return {
    manifest,
    async initialize(context) {
      if (implementation.initialize) {
        await implementation.initialize(context);
      }
    },
    async activate(context) {
      if (implementation.activate) {
        await implementation.activate(context);
      }
    },
    async deactivate(context) {
      if (implementation.deactivate) {
        await implementation.deactivate(context);
      }
    },
    async shutdown(context) {
      if (implementation.shutdown) {
        await implementation.shutdown(context);
      }
    },
    async onConfigChange(newConfig, oldConfig, context) {
      if (implementation.onConfigChange) {
        await implementation.onConfigChange(newConfig, oldConfig, context);
      }
    },
  };
}

/**
 * Helper to run a plugin through its complete lifecycle
 */
export async function runPluginLifecycle(
  plugin: RevampPlugin,
  context: PluginContext
): Promise<void> {
  if (plugin.initialize) {
    await plugin.initialize(context);
  }
  if (plugin.activate) {
    await plugin.activate(context);
  }
}

/**
 * Helper to deactivate and shutdown a plugin
 */
export async function shutdownPlugin(
  plugin: RevampPlugin,
  context: PluginContext
): Promise<void> {
  if (plugin.deactivate) {
    await plugin.deactivate(context);
  }
  if (plugin.shutdown) {
    await plugin.shutdown(context);
  }
}

/**
 * Assert that a hook result continues the chain
 */
export function assertContinues<T>(
  result: { continue: boolean; value?: T } | { continue: false; error: Error }
): asserts result is { continue: true; value?: T } {
  if (!result.continue) {
    if ('error' in result) {
      throw new Error(`Hook stopped with error: ${result.error.message}`);
    }
    throw new Error('Hook stopped the chain unexpectedly');
  }
}

/**
 * Assert that a hook result stops the chain
 */
export function assertStops<T>(
  result: { continue: boolean; value?: T } | { continue: false; error: Error }
): asserts result is { continue: false; value: T } | { continue: false; error: Error } {
  if (result.continue) {
    throw new Error('Hook continued unexpectedly');
  }
}
