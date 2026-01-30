/**
 * Revamp Plugin System
 *
 * Public API for the plugin system. This module provides:
 * - Plugin types and interfaces
 * - Hook types and helpers
 * - Plugin registry and loader
 * - Hook executor
 * - Plugin API handlers
 */

// Types
export type {
  SemVer,
  PluginPermission,
  PluginState,
  HookName,
  PluginManifest,
  PluginInfo,
  RevampPlugin,
  PluginFactory,
  PluginConfig,
  PluginsConfig,
} from './types.js';

export {
  DEFAULT_PLUGINS_CONFIG,
  isValidSemVer,
  parseSemVer,
  compareSemVer,
} from './types.js';

// Hook types
export type {
  RequestContext,
  ResponseContext,
  TransformContext,
  FilterContext,
  ConfigResolutionContext,
  DomainLifecycleContext,
  CacheContext,
  MetricsContext,
  HookResult,
  PreRequestResult,
  PostResponseResult,
  PreTransformResult,
  PostTransformResult,
  FilterDecisionResult,
  ConfigResolutionResult,
  CacheGetResult,
  PreRequestHook,
  PostResponseHook,
  PreTransformHook,
  PostTransformHook,
  FilterDecisionHook,
  ConfigResolutionHook,
  DomainLifecycleHook,
  CacheGetHook,
  CacheSetHook,
  MetricsHook,
  HookTypes,
  HookType,
  HookRegistration,
} from './hooks.js';

export { continueResult, stopResult, errorResult } from './hooks.js';

// Context
export type { PluginContext, ApiEndpointHandler } from './context.js';

export {
  createPluginContext,
  cleanupPluginResources,
  getAllPluginEndpoints,
  findPluginEndpoint,
  getPluginEndpointPath,
  getAllPluginMetrics,
} from './context.js';

// Registry
export { PluginRegistry, pluginRegistry } from './registry.js';
import { pluginRegistry as _pluginRegistry } from './registry.js';

// Loader
export { PluginLoader, pluginLoader } from './loader.js';
import { pluginLoader as _pluginLoader } from './loader.js';

// Hook executor
export {
  hookExecutor,
  runPreRequestHooks,
  runPostResponseHooks,
  runPreTransformHooks,
  runPostTransformHooks,
  runFilterDecisionHooks,
  runConfigResolutionHooks,
} from './hook-executor.js';

export type {
  ChainExecutionResult,
  ExecutionMode,
  PluginHookStats,
  HookExecutionStats,
} from './hook-executor.js';

// Validation
export {
  validateManifest,
  checkVersionCompatibility,
  getRevampVersion,
  satisfiesVersionRange,
  resolveDependencies,
  validateDependencies,
  validateJsonSchema,
  validatePluginConfig,
} from './validation.js';

export type {
  ValidationError,
  SchemaValidationResult,
  JSONSchema,
} from './validation.js';

// API
export {
  isPluginEndpoint,
  handlePluginRequest,
} from './api.js';

export type { PluginApiResult } from './api.js';

// Testing utilities
export {
  createTestContext,
  createMockRequest,
  createMockResponse,
  createMockTransform,
  createMockFilter,
  createMockConfigResolution,
  createTestPlugin,
  runPluginLifecycle,
  shutdownPlugin,
  assertContinues,
  assertStops,
} from './testing.js';

export type {
  MockRequestOptions,
  MockResponseOptions,
  MockTransformOptions,
  MockFilterOptions,
  TestContextOptions,
  TestPluginContext,
} from './testing.js';

/**
 * Initialize the plugin system
 * Call this on server startup
 */
export async function initializePluginSystem(): Promise<void> {
  console.log('[Plugins] Initializing plugin system...');

  try {
    // Load all plugins from the plugins directory
    await _pluginLoader.loadAllPlugins();

    // Activate all loaded plugins
    await _pluginLoader.activateAllPlugins();

    const stats = _pluginRegistry.getStats();
    console.log(
      `[Plugins] Plugin system ready: ${stats.activePlugins} active plugins, ${stats.totalHooks} hooks registered`
    );
  } catch (err) {
    console.error('[Plugins] Failed to initialize plugin system:', err);
  }
}

/**
 * Shutdown the plugin system
 * Call this on server shutdown
 */
export async function shutdownPluginSystem(): Promise<void> {
  console.log('[Plugins] Shutting down plugin system...');

  try {
    await _pluginLoader.shutdownAllPlugins();
    console.log('[Plugins] Plugin system shutdown complete');
  } catch (err) {
    console.error('[Plugins] Error during plugin system shutdown:', err);
  }
}
