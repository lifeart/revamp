/**
 * Revamp Plugin System - REST API
 *
 * API endpoints for plugin management, accessible at /__revamp__/plugins/*.
 * Routes are registered on the shared API router via
 * {@link registerPluginRoutes}; this module owns only its handlers.
 *
 * Plugin-registered custom endpoints (context.registerEndpoint) are served
 * through the same router via a wildcard route that looks the handler up at
 * request time, so register/unregister keeps working without re-routing.
 */

import { pluginLoader } from './loader.js';
import { log } from '../logger/log.js';
import { pluginRegistry } from './internal.js';
import { findPluginEndpoint, getAllPluginMetrics } from './context.js';
import { hookExecutor } from './hook-executor.js';
import type { ApiRouter, ApiRequest, ApiResponse, ApiHandler } from '../proxy/api-router.js';

const PLUGINS_BASE = '/__revamp__/plugins';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * API Result type
 */
export type PluginApiResult = ApiResponse;

/**
 * Actions reserved for plugin management; plugin-registered custom endpoints
 * can never shadow these.
 */
const RESERVED_ACTIONS = ['activate', 'deactivate', 'reload', 'config', 'metrics'];

/**
 * JSON response helper
 */
function jsonResponse(
  data: unknown,
  statusCode: number = 200
): PluginApiResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/**
 * Error response helper
 */
function errorResponse(
  message: string,
  statusCode: number = 400
): PluginApiResult {
  return jsonResponse({ error: message }, statusCode);
}

/**
 * Wrap a handler with the plugin API error boundary: unexpected errors are
 * logged and mapped to a 500 (never swallowed silently, never propagated as
 * a connection-killing exception).
 */
function guard(handler: ApiHandler): ApiHandler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      log.error('[PluginAPI] Error:', err);
      return errorResponse(
        err instanceof Error ? err.message : 'Internal server error',
        500
      );
    }
  };
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register the plugin API routes on the shared API router.
 * Adding a future plugin management route means adding exactly one line here.
 *
 * Endpoints:
 * - GET /plugins - List all plugins
 * - GET /plugins/discover - Discover available plugins
 * - POST /plugins/load-all - Load and activate all plugins
 * - POST /plugins/shutdown-all - Shutdown all plugins
 * - POST /plugins/hot-reload - Toggle hot reload
 * - GET/DELETE /plugins/metrics - All plugin metrics / reset
 * - GET/DELETE /plugins/:id/metrics - Plugin metrics / reset
 * - POST /plugins/:id/activate - Activate plugin
 * - POST /plugins/:id/deactivate - Deactivate plugin
 * - POST /plugins/:id/reload - Reload plugin
 * - PUT /plugins/:id/config - Update plugin config
 * - GET /plugins/:id - Get plugin info
 * - DELETE /plugins/:id - Unload plugin
 * - ANY /plugins/:id/* - Plugin-registered custom endpoints (dynamic lookup)
 */
export function registerPluginRoutes(router: ApiRouter): void {
  router.register('GET', PLUGINS_BASE, guard(handleListPlugins));
  router.register('GET', `${PLUGINS_BASE}/`, guard(handleListPlugins));
  router.register('GET', `${PLUGINS_BASE}/discover`, guard(handleDiscoverPlugins));
  router.register('POST', `${PLUGINS_BASE}/load-all`, guard(handleLoadAllPlugins));
  router.register('POST', `${PLUGINS_BASE}/shutdown-all`, guard(handleShutdownAllPlugins));
  router.register('POST', `${PLUGINS_BASE}/hot-reload`, guard(handleHotReloadToggle));
  router.register('GET', `${PLUGINS_BASE}/metrics`, guard(handleAllPluginMetrics));
  router.register('GET', `${PLUGINS_BASE}/metrics/`, guard(handleAllPluginMetrics));
  router.register('DELETE', `${PLUGINS_BASE}/metrics`, guard(handleResetAllMetrics));
  router.register('DELETE', `${PLUGINS_BASE}/metrics/`, guard(handleResetAllMetrics));
  router.register('GET', `${PLUGINS_BASE}/:id/metrics`, guard(handlePluginMetrics));
  router.register('DELETE', `${PLUGINS_BASE}/:id/metrics`, guard(handleResetPluginMetrics));
  router.register('POST', `${PLUGINS_BASE}/:id/activate`, guard(handleActivatePlugin));
  router.register('POST', `${PLUGINS_BASE}/:id/deactivate`, guard(handleDeactivatePlugin));
  router.register('POST', `${PLUGINS_BASE}/:id/reload`, guard(handleReloadPlugin));
  router.register('PUT', `${PLUGINS_BASE}/:id/config`, guard(handleUpdatePluginConfig));
  router.register('GET', `${PLUGINS_BASE}/:id`, guard(handleGetPlugin));
  router.register('GET', `${PLUGINS_BASE}/:id/`, guard(handleGetPlugin));
  router.register('DELETE', `${PLUGINS_BASE}/:id`, guard(handleUnloadPlugin));
  router.register('DELETE', `${PLUGINS_BASE}/:id/`, guard(handleUnloadPlugin));

  // Plugin-registered custom endpoints — looked up dynamically at request
  // time so context.registerEndpoint/unregisterEndpoint keep working.
  router.register('*', `${PLUGINS_BASE}/:id/*`, guard(handleCustomEndpoint));

  // Anything else under /plugins is a 404, exactly as before.
  router.register('*', PLUGINS_BASE, guard(handleNotFound));
  router.register('*', `${PLUGINS_BASE}/`, guard(handleNotFound));
  router.register('*', `${PLUGINS_BASE}/*`, guard(handleNotFound));
}

// =============================================================================
// Handlers
// =============================================================================

/** GET /plugins - List all plugins */
function handleListPlugins(): PluginApiResult {
  const plugins = pluginRegistry.getAllPlugins().map((p) => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    author: p.manifest.author,
    state: p.state,
    loadedAt: p.loadedAt,
    activatedAt: p.activatedAt,
    error: p.error,
    hooks: p.manifest.hooks || [],
    permissions: p.manifest.permissions || [],
  }));

  return jsonResponse({
    success: true,
    plugins,
    stats: pluginRegistry.getStats(),
  });
}

/** GET /plugins/discover - Discover available plugins */
async function handleDiscoverPlugins(): Promise<PluginApiResult> {
  const manifests = await pluginLoader.discoverPlugins();
  const registered = new Set(
    pluginRegistry.getAllPlugins().map((p) => p.manifest.id)
  );

  const available = manifests.map((m) => ({
    ...m,
    installed: registered.has(m.id),
  }));

  return jsonResponse({
    success: true,
    available,
  });
}

/** POST /plugins/load-all - Load and activate all plugins */
async function handleLoadAllPlugins(): Promise<PluginApiResult> {
  await pluginLoader.loadAllPlugins();
  await pluginLoader.activateAllPlugins();

  return jsonResponse({
    success: true,
    plugins: pluginRegistry.getAllPlugins().map((p) => ({
      id: p.manifest.id,
      state: p.state,
    })),
  });
}

/** POST /plugins/shutdown-all - Shutdown all plugins */
async function handleShutdownAllPlugins(): Promise<PluginApiResult> {
  await pluginLoader.shutdownAllPlugins();
  return jsonResponse({ success: true });
}

/** POST /plugins/hot-reload - Toggle hot reload */
function handleHotReloadToggle(req: ApiRequest): PluginApiResult {
  let data: { enabled?: boolean } = {};
  try {
    data = req.body ? JSON.parse(req.body) : {};
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (data.enabled) {
    pluginLoader.enableHotReload();
  } else {
    pluginLoader.disableHotReload();
  }
  return jsonResponse({ success: true, hotReload: data.enabled });
}

/** GET /plugins/metrics - All plugins metrics */
function handleAllPluginMetrics(): PluginApiResult {
  const hookStats = hookExecutor.getAllPluginStats();
  const aggregateStats = hookExecutor.getAggregateStats();
  const customMetrics = getAllPluginMetrics();

  // Convert custom metrics map to serializable object
  const customMetricsObj: Record<string, Record<string, unknown>> = {};
  for (const [pluginId, metrics] of customMetrics) {
    customMetricsObj[pluginId] = {};
    for (const [name, metric] of metrics) {
      customMetricsObj[pluginId][name] = metric;
    }
  }

  // Convert hook stats to serializable format
  const pluginStats = hookStats.map((stats) => ({
    pluginId: stats.pluginId,
    totalExecutions: stats.totalExecutions,
    successfulExecutions: stats.successfulExecutions,
    failedExecutions: stats.failedExecutions,
    timeouts: stats.timeouts,
    totalExecutionTime: stats.totalExecutionTime,
    averageExecutionTime: stats.averageExecutionTime,
    lastExecutionAt: stats.lastExecutionAt,
    byHook: Object.fromEntries(stats.byHook),
  }));

  return jsonResponse({
    success: true,
    aggregate: aggregateStats,
    plugins: pluginStats,
    customMetrics: customMetricsObj,
  });
}

/** DELETE /plugins/metrics - Reset all metrics */
function handleResetAllMetrics(): PluginApiResult {
  hookExecutor.resetStats();
  return jsonResponse({ success: true, message: 'All metrics reset' });
}

/** GET /plugins/:id/metrics - Plugin metrics */
function handlePluginMetrics(req: ApiRequest): PluginApiResult {
  const pluginId = decodeURIComponent(req.params.id);
  const plugin = pluginRegistry.getPlugin(pluginId);
  if (!plugin) {
    return errorResponse('Plugin not found', 404);
  }

  const hookStats = hookExecutor.getPluginStats(pluginId);
  const customMetrics = getAllPluginMetrics().get(pluginId);

  // Convert custom metrics to serializable format
  const customMetricsObj: Record<string, unknown> = {};
  if (customMetrics) {
    for (const [name, metric] of customMetrics) {
      customMetricsObj[name] = metric;
    }
  }

  // Convert hook stats to serializable format
  const hookStatsObj = hookStats
    ? {
        totalExecutions: hookStats.totalExecutions,
        successfulExecutions: hookStats.successfulExecutions,
        failedExecutions: hookStats.failedExecutions,
        timeouts: hookStats.timeouts,
        totalExecutionTime: hookStats.totalExecutionTime,
        averageExecutionTime: hookStats.averageExecutionTime,
        lastExecutionAt: hookStats.lastExecutionAt,
        byHook: Object.fromEntries(hookStats.byHook),
      }
    : null;

  return jsonResponse({
    success: true,
    pluginId,
    hookStats: hookStatsObj,
    customMetrics: customMetricsObj,
  });
}

/** DELETE /plugins/:id/metrics - Reset plugin metrics */
function handleResetPluginMetrics(req: ApiRequest): PluginApiResult {
  const pluginId = decodeURIComponent(req.params.id);
  hookExecutor.resetStats(pluginId);
  return jsonResponse({ success: true, message: `Metrics reset for ${pluginId}` });
}

/** GET /plugins/:id - Get plugin info */
function handleGetPlugin(req: ApiRequest): PluginApiResult {
  const pluginId = decodeURIComponent(req.params.id);
  const plugin = pluginRegistry.getPlugin(pluginId);
  if (!plugin) {
    return errorResponse('Plugin not found', 404);
  }
  return jsonResponse({
    success: true,
    plugin: {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      homepage: plugin.manifest.homepage,
      revampVersion: plugin.manifest.revampVersion,
      state: plugin.state,
      loadedAt: plugin.loadedAt,
      activatedAt: plugin.activatedAt,
      error: plugin.error,
      hooks: plugin.manifest.hooks || [],
      permissions: plugin.manifest.permissions || [],
      dependencies: plugin.manifest.dependencies || {},
      config: plugin.config,
      configSchema: plugin.manifest.configSchema,
    },
  });
}

/** POST /plugins/:id/activate - Activate plugin */
async function handleActivatePlugin(req: ApiRequest): Promise<PluginApiResult> {
  const pluginId = decodeURIComponent(req.params.id);
  const plugin = pluginRegistry.getPlugin(pluginId);
  if (!plugin) {
    return errorResponse('Plugin not found', 404);
  }

  // Initialize first if needed
  if (plugin.state === 'loaded') {
    const initSuccess = await pluginLoader.initializePlugin(pluginId);
    if (!initSuccess) {
      return errorResponse('Failed to initialize plugin', 500);
    }
  }

  const success = await pluginLoader.activatePlugin(pluginId);
  if (!success) {
    const info = pluginRegistry.getPlugin(pluginId);
    return errorResponse(
      info?.error || 'Failed to activate plugin',
      500
    );
  }
  return jsonResponse({ success: true });
}

/** POST /plugins/:id/deactivate - Deactivate plugin */
async function handleDeactivatePlugin(req: ApiRequest): Promise<PluginApiResult> {
  const pluginId = decodeURIComponent(req.params.id);
  const success = await pluginLoader.deactivatePlugin(pluginId);
  if (!success) {
    return errorResponse('Failed to deactivate plugin', 500);
  }
  return jsonResponse({ success: true });
}

/** POST /plugins/:id/reload - Reload plugin */
async function handleReloadPlugin(req: ApiRequest): Promise<PluginApiResult> {
  const pluginId = decodeURIComponent(req.params.id);
  const success = await pluginLoader.reloadPlugin(pluginId);
  if (!success) {
    return errorResponse('Failed to reload plugin', 500);
  }
  return jsonResponse({ success: true });
}

/** PUT /plugins/:id/config - Update plugin config */
function handleUpdatePluginConfig(req: ApiRequest): PluginApiResult {
  const pluginId = decodeURIComponent(req.params.id);
  const plugin = pluginRegistry.getPlugin(pluginId);
  if (!plugin) {
    return errorResponse('Plugin not found', 404);
  }

  try {
    const config = req.body ? JSON.parse(req.body) : {};
    pluginRegistry.updateConfig(pluginId, config);
    return jsonResponse({ success: true, config });
  } catch (err) {
    // Surface the parse failure rather than swallowing it (CLAUDE.md:
    // no silent error swallowing). The 400 response still tells the
    // client what happened.
    log.warn('[plugins:api] Invalid JSON body for config update:', err);
    return errorResponse('Invalid JSON body', 400);
  }
}

/** DELETE /plugins/:id - Unload plugin */
async function handleUnloadPlugin(req: ApiRequest): Promise<PluginApiResult> {
  const pluginId = decodeURIComponent(req.params.id);
  const success = await pluginLoader.unloadPlugin(pluginId);
  if (!success) {
    return errorResponse('Plugin not found or failed to unload', 404);
  }
  return jsonResponse({ success: true });
}

/**
 * ANY /plugins/:id/* - Plugin-registered custom endpoints.
 *
 * The handler is looked up at request time (not registration time) so
 * `context.registerEndpoint` / `unregisterEndpoint` keep working while the
 * server runs. The lookup uses the raw (non-decoded) path, matching how
 * endpoints are keyed in the registry.
 */
async function handleCustomEndpoint(req: ApiRequest): Promise<PluginApiResult> {
  const rawPluginId = req.params.id;
  const action = req.params['*'];

  // Reserved management actions can never be shadowed by custom endpoints.
  if (RESERVED_ACTIONS.includes(action)) {
    return errorResponse('Not found', 404);
  }

  const endpoint = findPluginEndpoint(`/plugins/${rawPluginId}/${action}`);
  if (!endpoint) {
    return errorResponse('Not found', 404);
  }

  try {
    const result = await endpoint.handler({
      method: req.method,
      path: action,
      query: req.query,
      body: req.body,
      headers: req.headers,
    });
    return {
      statusCode: result.statusCode,
      headers: { ...CORS_HEADERS, ...result.headers },
      body: result.body,
    };
  } catch (err) {
    log.error(
      `[PluginAPI] Custom endpoint error for ${decodeURIComponent(rawPluginId)}:`,
      err
    );
    return errorResponse(
      err instanceof Error ? err.message : 'Internal error',
      500
    );
  }
}

/** Fallback for everything else under /plugins */
function handleNotFound(): PluginApiResult {
  return errorResponse('Not found', 404);
}
