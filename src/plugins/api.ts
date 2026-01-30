/**
 * Revamp Plugin System - REST API
 *
 * API endpoints for plugin management, accessible at /__revamp__/plugins/*
 */

import { pluginLoader } from './loader.js';
import { pluginRegistry } from './registry.js';
import { findPluginEndpoint, getAllPluginMetrics } from './context.js';
import { hookExecutor } from './hook-executor.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * API Result type
 */
export interface PluginApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

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
 * Check if path is a plugin API endpoint
 */
export function isPluginEndpoint(path: string): boolean {
  return path.startsWith('/plugins');
}

/**
 * Handle plugin API requests
 *
 * Endpoints:
 * - GET /plugins - List all plugins
 * - GET /plugins/discover - Discover available plugins
 * - POST /plugins/load-all - Load and activate all plugins
 * - GET /plugins/:id - Get plugin info
 * - POST /plugins/:id/activate - Activate plugin
 * - POST /plugins/:id/deactivate - Deactivate plugin
 * - POST /plugins/:id/reload - Reload plugin
 * - PUT /plugins/:id/config - Update plugin config
 * - DELETE /plugins/:id - Unload plugin
 * - GET/POST /plugins/:id/* - Plugin-registered custom endpoints
 */
export async function handlePluginRequest(
  path: string,
  method: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<PluginApiResult> {
  // Remove leading slash if present
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // OPTIONS for CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    // List all plugins
    if (normalizedPath === '/plugins' || normalizedPath === '/plugins/') {
      if (method === 'GET') {
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
    }

    // Discover available plugins
    if (normalizedPath === '/plugins/discover') {
      if (method === 'GET') {
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
    }

    // Load all plugins
    if (normalizedPath === '/plugins/load-all') {
      if (method === 'POST') {
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
    }

    // Shutdown all plugins
    if (normalizedPath === '/plugins/shutdown-all') {
      if (method === 'POST') {
        await pluginLoader.shutdownAllPlugins();
        return jsonResponse({ success: true });
      }
    }

    // Hot reload toggle
    if (normalizedPath === '/plugins/hot-reload') {
      if (method === 'POST') {
        let data: { enabled?: boolean } = {};
        try {
          data = body ? JSON.parse(body) : {};
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
    }

    // All plugins metrics
    if (normalizedPath === '/plugins/metrics' || normalizedPath === '/plugins/metrics/') {
      if (method === 'GET') {
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

      // Reset metrics
      if (method === 'DELETE') {
        hookExecutor.resetStats();
        return jsonResponse({ success: true, message: 'All metrics reset' });
      }
    }

    // Individual plugin operations
    const pluginMatch = normalizedPath.match(/^\/plugins\/([^/]+)(?:\/(.*))?$/);
    if (pluginMatch) {
      const pluginId = decodeURIComponent(pluginMatch[1]);
      const action = pluginMatch[2] || '';

      // Plugin metrics endpoint
      if (action === 'metrics' && method === 'GET') {
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

      // Reset plugin metrics
      if (action === 'metrics' && method === 'DELETE') {
        hookExecutor.resetStats(pluginId);
        return jsonResponse({ success: true, message: `Metrics reset for ${pluginId}` });
      }

      // Check for plugin-registered custom endpoints first
      if (action && !['activate', 'deactivate', 'reload', 'config', 'metrics'].includes(action)) {
        const endpoint = findPluginEndpoint(normalizedPath);
        if (endpoint) {
          // Parse query string from path (if any)
          const queryMatch = normalizedPath.match(/\?(.*)$/);
          const query: Record<string, string> = {};
          if (queryMatch) {
            const params = new URLSearchParams(queryMatch[1]);
            params.forEach((value, key) => {
              query[key] = value;
            });
          }

          try {
            const result = await endpoint.handler({
              method,
              path: action,
              query,
              body,
              headers,
            });
            return {
              statusCode: result.statusCode,
              headers: { ...CORS_HEADERS, ...result.headers },
              body: result.body,
            };
          } catch (err) {
            console.error(
              `[PluginAPI] Custom endpoint error for ${pluginId}:`,
              err
            );
            return errorResponse(
              err instanceof Error ? err.message : 'Internal error',
              500
            );
          }
        }
      }

      // Get plugin info
      if (!action && method === 'GET') {
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

      // Activate plugin
      if (action === 'activate' && method === 'POST') {
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

      // Deactivate plugin
      if (action === 'deactivate' && method === 'POST') {
        const success = await pluginLoader.deactivatePlugin(pluginId);
        if (!success) {
          return errorResponse('Failed to deactivate plugin', 500);
        }
        return jsonResponse({ success: true });
      }

      // Reload plugin
      if (action === 'reload' && method === 'POST') {
        const success = await pluginLoader.reloadPlugin(pluginId);
        if (!success) {
          return errorResponse('Failed to reload plugin', 500);
        }
        return jsonResponse({ success: true });
      }

      // Update plugin config
      if (action === 'config' && method === 'PUT') {
        const plugin = pluginRegistry.getPlugin(pluginId);
        if (!plugin) {
          return errorResponse('Plugin not found', 404);
        }

        try {
          const config = body ? JSON.parse(body) : {};
          pluginRegistry.updateConfig(pluginId, config);
          return jsonResponse({ success: true, config });
        } catch (err) {
          return errorResponse('Invalid JSON body', 400);
        }
      }

      // Unload plugin
      if (!action && method === 'DELETE') {
        const success = await pluginLoader.unloadPlugin(pluginId);
        if (!success) {
          return errorResponse('Plugin not found or failed to unload', 404);
        }
        return jsonResponse({ success: true });
      }
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    console.error('[PluginAPI] Error:', err);
    return errorResponse(
      err instanceof Error ? err.message : 'Internal server error',
      500
    );
  }
}
