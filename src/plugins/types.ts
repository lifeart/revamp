/**
 * Revamp Plugin System - Core Types
 *
 * Type definitions for the plugin system including manifests,
 * plugin interfaces, permissions, and state management.
 */

import type { PluginContext } from './context.js';

/**
 * Semantic version string (e.g., "1.0.0")
 */
export type SemVer = `${number}.${number}.${number}`;

/**
 * Plugin permissions for security
 * Plugins must declare required permissions in their manifest
 */
export type PluginPermission =
  | 'request:read' // Read request data
  | 'request:modify' // Modify requests
  | 'response:read' // Read response data
  | 'response:modify' // Modify responses
  | 'config:read' // Read configuration
  | 'config:write' // Modify configuration
  | 'cache:read' // Read from cache
  | 'cache:write' // Write to cache
  | 'metrics:read' // Read metrics
  | 'metrics:write' // Record custom metrics
  | 'network:fetch' // Make outbound requests
  | 'storage:read' // Read plugin storage
  | 'storage:write' // Write plugin storage
  | 'api:register'; // Register API endpoints

/**
 * Plugin lifecycle states
 */
export type PluginState =
  | 'unloaded'
  | 'loaded'
  | 'initializing'
  | 'initialized'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'deactivated'
  | 'error';

/**
 * Hook names that plugins can register
 */
export type HookName =
  | 'request:pre'
  | 'response:post'
  | 'transform:pre'
  | 'transform:post'
  | 'filter:decision'
  | 'config:resolution'
  | 'domain:lifecycle'
  | 'cache:get'
  | 'cache:set'
  | 'metrics:record';

/**
 * Plugin metadata from manifest (plugin.json)
 */
export interface PluginManifest {
  /** Unique plugin identifier (e.g., "com.example.my-plugin") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Plugin version */
  version: SemVer;
  /** Plugin description */
  description: string;
  /** Author information */
  author: string;
  /** Plugin homepage/repository URL */
  homepage?: string;
  /** Minimum Revamp version required */
  revampVersion: SemVer;
  /** Plugin dependencies (plugin-id -> version range) */
  dependencies?: Record<string, string>;
  /** Hooks this plugin uses (for validation and documentation) */
  hooks?: HookName[];
  /** Permissions required by this plugin */
  permissions?: PluginPermission[];
  /** Plugin entry point (relative path) */
  main: string;
  /** Plugin configuration schema (JSON Schema) */
  configSchema?: Record<string, unknown>;
}

/**
 * Plugin instance information stored in registry
 */
export interface PluginInfo {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Current lifecycle state */
  state: PluginState;
  /** Timestamp when plugin was loaded */
  loadedAt?: number;
  /** Timestamp when plugin was activated */
  activatedAt?: number;
  /** Error message if state is 'error' */
  error?: string;
  /** Plugin configuration */
  config: Record<string, unknown>;
}

/**
 * Main plugin interface that all plugins must implement
 */
export interface RevampPlugin {
  /**
   * Plugin manifest (can be loaded from plugin.json)
   */
  readonly manifest: PluginManifest;

  /**
   * Called when plugin is first loaded
   * Use for one-time setup, validation, etc.
   * @param context - Plugin context API
   */
  initialize?(context: PluginContext): Promise<void>;

  /**
   * Called when plugin is activated (enabled)
   * Register hooks, start services, etc.
   * @param context - Plugin context API
   */
  activate?(context: PluginContext): Promise<void>;

  /**
   * Called when plugin is deactivated (disabled)
   * Unregister hooks, stop services, cleanup temp resources
   * @param context - Plugin context API
   */
  deactivate?(context: PluginContext): Promise<void>;

  /**
   * Called when plugin is being unloaded/shutdown
   * Final cleanup, save state, release all resources
   * @param context - Plugin context API
   */
  shutdown?(context: PluginContext): Promise<void>;

  /**
   * Called when plugin configuration changes
   * @param newConfig - New configuration values
   * @param oldConfig - Previous configuration values
   * @param context - Plugin context API
   */
  onConfigChange?(
    newConfig: Record<string, unknown>,
    oldConfig: Record<string, unknown>,
    context: PluginContext
  ): Promise<void>;
}

/**
 * Factory function type for creating plugins
 */
export type PluginFactory = () => RevampPlugin | Promise<RevampPlugin>;

/**
 * Plugin configuration stored in plugins.json
 */
export interface PluginConfig {
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** Plugin-specific configuration */
  config: Record<string, unknown>;
}

/**
 * Global plugin system configuration (plugins.json)
 */
export interface PluginsConfig {
  /** Whether the plugin system is enabled */
  enabled: boolean;
  /** Enable hot-reload for development */
  hotReload: boolean;
  /** Directory containing plugins */
  pluginsDir: string;
  /** Per-plugin configuration */
  plugins: Record<string, PluginConfig>;
}

/**
 * Default plugins configuration
 */
export const DEFAULT_PLUGINS_CONFIG: PluginsConfig = {
  enabled: true,
  hotReload: false,
  pluginsDir: '.revamp-plugins',
  plugins: {},
};

/**
 * Check if a value is a valid SemVer string
 */
export function isValidSemVer(value: string): value is SemVer {
  return /^\d+\.\d+\.\d+$/.test(value);
}

/**
 * Parse a SemVer string into components
 */
export function parseSemVer(
  version: SemVer
): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

/**
 * Compare two SemVer versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  const aParsed = parseSemVer(a);
  const bParsed = parseSemVer(b);

  if (aParsed.major !== bParsed.major) {
    return aParsed.major < bParsed.major ? -1 : 1;
  }
  if (aParsed.minor !== bParsed.minor) {
    return aParsed.minor < bParsed.minor ? -1 : 1;
  }
  if (aParsed.patch !== bParsed.patch) {
    return aParsed.patch < bParsed.patch ? -1 : 1;
  }
  return 0;
}
