/**
 * Revamp Plugin System - Plugin Loader
 *
 * Handles plugin discovery, loading, lifecycle management,
 * and hot-reload for development.
 */

import { readFile, readdir, stat, watch } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, FSWatcher } from 'node:fs';
import type {
  PluginManifest,
  RevampPlugin,
  PluginFactory,
  PluginsConfig,
  DEFAULT_PLUGINS_CONFIG,
} from './types.js';
import { pluginRegistry } from './registry.js';
import { createPluginContext, cleanupPluginResources } from './context.js';
import {
  validateManifest,
  checkVersionCompatibility,
  resolveDependencies,
  validateDependencies,
} from './validation.js';
import { readJson, writeJsonAtomic, ensureDataDir } from '../config/storage.js';

const MANIFEST_FILENAME = 'plugin.json';
const PLUGINS_CONFIG_FILE = 'plugins.json';
const DEFAULT_PLUGINS_DIR = '.revamp-plugins';

/**
 * Plugin Loader - discovers, loads, and manages plugin lifecycle
 */
export class PluginLoader {
  private pluginsDir: string;
  private baseDir: string;
  private hotReloadEnabled = false;
  private watchers = new Map<string, FSWatcher>();
  private reloadTimers = new Map<string, NodeJS.Timeout>();
  private pluginsConfig: PluginsConfig | null = null;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.pluginsDir = join(baseDir, DEFAULT_PLUGINS_DIR);
  }

  /**
   * Set the plugins directory
   */
  setPluginsDir(dir: string): void {
    this.pluginsDir = resolve(this.baseDir, dir);
  }

  /**
   * Get the plugins directory
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Load plugins configuration
   */
  async loadPluginsConfig(): Promise<PluginsConfig> {
    if (this.pluginsConfig) {
      return this.pluginsConfig;
    }

    await ensureDataDir();
    const config = await readJson<PluginsConfig>(PLUGINS_CONFIG_FILE);

    if (config) {
      this.pluginsConfig = config;
      if (config.pluginsDir) {
        this.setPluginsDir(config.pluginsDir);
      }
    } else {
      this.pluginsConfig = {
        enabled: true,
        hotReload: false,
        pluginsDir: DEFAULT_PLUGINS_DIR,
        plugins: {},
      };
    }

    return this.pluginsConfig;
  }

  /**
   * Save plugins configuration
   */
  async savePluginsConfig(): Promise<void> {
    if (this.pluginsConfig) {
      await writeJsonAtomic(PLUGINS_CONFIG_FILE, this.pluginsConfig);
    }
  }

  /**
   * Get plugin configuration from plugins.json
   */
  getPluginConfig(pluginId: string): Record<string, unknown> {
    const pluginConfig = this.pluginsConfig?.plugins[pluginId];
    return pluginConfig?.config || {};
  }

  /**
   * Check if a plugin is enabled in configuration
   */
  isPluginEnabled(pluginId: string): boolean {
    const pluginConfig = this.pluginsConfig?.plugins[pluginId];
    return pluginConfig?.enabled !== false;
  }

  /**
   * Discover all plugins in the plugins directory
   */
  async discoverPlugins(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    if (!existsSync(this.pluginsDir)) {
      console.log(`[PluginLoader] Plugins directory not found: ${this.pluginsDir}`);
      return manifests;
    }

    let entries;
    try {
      entries = await readdir(this.pluginsDir, { withFileTypes: true });
    } catch (err) {
      console.error(`[PluginLoader] Failed to read plugins directory:`, err);
      return manifests;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = join(this.pluginsDir, entry.name);
      const manifestPath = join(pluginDir, MANIFEST_FILENAME);

      if (!existsSync(manifestPath)) {
        console.debug(`[PluginLoader] No manifest in ${entry.name}, skipping`);
        continue;
      }

      try {
        const content = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content) as PluginManifest;

        // Validate manifest
        const errors = validateManifest(manifest);
        if (errors.length > 0) {
          console.warn(
            `[PluginLoader] Invalid manifest for ${entry.name}:`,
            errors.map((e) => `${e.field}: ${e.message}`).join(', ')
          );
          continue;
        }

        manifests.push(manifest);
      } catch (err) {
        console.warn(
          `[PluginLoader] Failed to read manifest for ${entry.name}:`,
          err
        );
      }
    }

    return manifests;
  }

  /**
   * Get the directory path for a plugin
   */
  getPluginDir(pluginId: string): string {
    // Convert plugin ID to directory name (dots to dashes)
    const dirName = pluginId.replace(/\./g, '-');
    return join(this.pluginsDir, dirName);
  }

  /**
   * Load a plugin from a directory
   */
  async loadPlugin(pluginDir: string): Promise<RevampPlugin | null> {
    const manifestPath = join(pluginDir, MANIFEST_FILENAME);

    try {
      // Read and validate manifest
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;

      const errors = validateManifest(manifest);
      if (errors.length > 0) {
        throw new Error(`Invalid manifest: ${errors.map((e) => e.message).join(', ')}`);
      }

      // Check version compatibility
      if (!checkVersionCompatibility(manifest.revampVersion)) {
        throw new Error(
          `Plugin requires Revamp ${manifest.revampVersion}, but current version is incompatible`
        );
      }

      // Load plugin module
      const entryPath = resolve(pluginDir, manifest.main);

      if (!existsSync(entryPath)) {
        throw new Error(`Entry point not found: ${manifest.main}`);
      }

      const moduleUrl = pathToFileURL(entryPath).href;

      // Dynamic import with cache busting for hot reload
      const cacheKey = this.hotReloadEnabled ? `?t=${Date.now()}` : '';
      const module = await import(moduleUrl + cacheKey);

      // Get plugin instance
      let plugin: RevampPlugin;

      if (typeof module.default === 'function') {
        // Factory function
        plugin = await (module.default as PluginFactory)();
      } else if (module.default && typeof module.default === 'object') {
        // Direct export
        plugin = module.default as RevampPlugin;
      } else if (typeof module.createPlugin === 'function') {
        // Named factory
        plugin = await module.createPlugin();
      } else {
        throw new Error(
          'Plugin must export a default plugin object or factory function'
        );
      }

      // Ensure manifest is set (use manifest from file if not set on plugin)
      if (!plugin.manifest) {
        (plugin as { manifest: PluginManifest }).manifest = manifest;
      }

      return plugin;
    } catch (err) {
      console.error(`[PluginLoader] Failed to load plugin from ${pluginDir}:`, err);
      return null;
    }
  }

  /**
   * Load and register a plugin
   */
  async loadAndRegister(
    pluginDir: string,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    const plugin = await this.loadPlugin(pluginDir);

    if (!plugin) {
      return false;
    }

    try {
      // Get config from plugins.json if not provided
      const finalConfig = config || this.getPluginConfig(plugin.manifest.id);

      // Register with the registry
      pluginRegistry.register(plugin, finalConfig);

      console.log(`[PluginLoader] Registered plugin: ${plugin.manifest.id}`);
      return true;
    } catch (err) {
      console.error(`[PluginLoader] Failed to register plugin:`, err);
      return false;
    }
  }

  /**
   * Initialize a registered plugin
   */
  async initializePlugin(pluginId: string): Promise<boolean> {
    const info = pluginRegistry.getPlugin(pluginId);
    const instance = pluginRegistry.getInstance(pluginId);

    if (!info || !instance) {
      console.warn(`[PluginLoader] Plugin ${pluginId} not found`);
      return false;
    }

    if (info.state !== 'loaded') {
      console.warn(
        `[PluginLoader] Plugin ${pluginId} is not in loaded state (${info.state})`
      );
      return false;
    }

    try {
      pluginRegistry.updateState(pluginId, 'initializing');

      const context = createPluginContext(
        pluginId,
        info.manifest.permissions || []
      );

      if (instance.initialize) {
        await instance.initialize(context);
      }

      pluginRegistry.updateState(pluginId, 'initialized');
      console.log(`[PluginLoader] Initialized plugin: ${pluginId}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pluginRegistry.updateState(pluginId, 'error', message);
      console.error(`[PluginLoader] Failed to initialize plugin ${pluginId}:`, err);
      return false;
    }
  }

  /**
   * Activate a plugin (start it)
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const info = pluginRegistry.getPlugin(pluginId);
    const instance = pluginRegistry.getInstance(pluginId);

    if (!info || !instance) {
      console.warn(`[PluginLoader] Plugin ${pluginId} not found`);
      return false;
    }

    if (info.state !== 'initialized' && info.state !== 'deactivated') {
      console.warn(
        `[PluginLoader] Plugin ${pluginId} cannot be activated from state ${info.state}`
      );
      return false;
    }

    try {
      // Check dependencies are active
      const deps = info.manifest.dependencies || {};
      for (const depId of Object.keys(deps)) {
        const depInfo = pluginRegistry.getPlugin(depId);
        if (!depInfo || depInfo.state !== 'active') {
          throw new Error(`Dependency ${depId} is not active`);
        }
      }

      pluginRegistry.updateState(pluginId, 'activating');

      const context = createPluginContext(
        pluginId,
        info.manifest.permissions || []
      );

      if (instance.activate) {
        await instance.activate(context);
      }

      pluginRegistry.updateState(pluginId, 'active');
      console.log(`[PluginLoader] Activated plugin: ${pluginId}`);

      // Update plugins.json
      if (this.pluginsConfig) {
        if (!this.pluginsConfig.plugins[pluginId]) {
          this.pluginsConfig.plugins[pluginId] = {
            enabled: true,
            config: info.config,
          };
        } else {
          this.pluginsConfig.plugins[pluginId].enabled = true;
        }
        await this.savePluginsConfig();
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pluginRegistry.updateState(pluginId, 'error', message);
      console.error(`[PluginLoader] Failed to activate plugin ${pluginId}:`, err);
      return false;
    }
  }

  /**
   * Deactivate a plugin (stop it)
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const info = pluginRegistry.getPlugin(pluginId);
    const instance = pluginRegistry.getInstance(pluginId);

    if (!info || !instance) {
      return false;
    }

    if (info.state !== 'active') {
      return false;
    }

    try {
      pluginRegistry.updateState(pluginId, 'deactivating');

      // Unregister all hooks first
      pluginRegistry.unregisterAllHooks(pluginId);

      const context = createPluginContext(
        pluginId,
        info.manifest.permissions || []
      );

      if (instance.deactivate) {
        await instance.deactivate(context);
      }

      pluginRegistry.updateState(pluginId, 'deactivated');
      console.log(`[PluginLoader] Deactivated plugin: ${pluginId}`);

      // Update plugins.json
      if (this.pluginsConfig && this.pluginsConfig.plugins[pluginId]) {
        this.pluginsConfig.plugins[pluginId].enabled = false;
        await this.savePluginsConfig();
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pluginRegistry.updateState(pluginId, 'error', message);
      console.error(`[PluginLoader] Failed to deactivate plugin ${pluginId}:`, err);
      return false;
    }
  }

  /**
   * Shutdown and unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const info = pluginRegistry.getPlugin(pluginId);
    const instance = pluginRegistry.getInstance(pluginId);

    if (!info || !instance) {
      return false;
    }

    try {
      // Deactivate first if active
      if (info.state === 'active') {
        await this.deactivatePlugin(pluginId);
      }

      const context = createPluginContext(
        pluginId,
        info.manifest.permissions || []
      );

      if (instance.shutdown) {
        await instance.shutdown(context);
      }

      // Stop watching for hot reload
      this.stopWatching(pluginId);

      // Clean up plugin resources
      cleanupPluginResources(pluginId);

      pluginRegistry.unregister(pluginId);
      console.log(`[PluginLoader] Unloaded plugin: ${pluginId}`);
      return true;
    } catch (err) {
      console.error(`[PluginLoader] Failed to unload plugin ${pluginId}:`, err);
      return false;
    }
  }

  /**
   * Load all plugins from the plugins directory
   */
  async loadAllPlugins(): Promise<void> {
    await this.loadPluginsConfig();

    if (!this.pluginsConfig?.enabled) {
      console.log('[PluginLoader] Plugin system is disabled');
      return;
    }

    const manifests = await this.discoverPlugins();

    if (manifests.length === 0) {
      console.log('[PluginLoader] No plugins found');
      return;
    }

    // Build manifest map for dependency validation
    const manifestMap = new Map<string, PluginManifest>();
    for (const m of manifests) {
      manifestMap.set(m.id, m);
    }

    // Validate dependencies
    for (const manifest of manifests) {
      const depErrors = validateDependencies(manifest, manifestMap);
      if (depErrors.length > 0) {
        console.warn(
          `[PluginLoader] Plugin ${manifest.id} has dependency issues:`,
          depErrors.map((e) => e.message).join(', ')
        );
      }
    }

    // Sort by dependencies
    const sorted = resolveDependencies(manifests);

    console.log(
      `[PluginLoader] Loading ${sorted.length} plugins in order:`,
      sorted.map((m) => m.id).join(', ')
    );

    for (const manifest of sorted) {
      // Check if plugin is enabled
      if (!this.isPluginEnabled(manifest.id)) {
        console.log(`[PluginLoader] Plugin ${manifest.id} is disabled, skipping`);
        continue;
      }

      const pluginDir = this.getPluginDir(manifest.id);
      await this.loadAndRegister(pluginDir);
    }
  }

  /**
   * Initialize and activate all loaded plugins
   */
  async activateAllPlugins(): Promise<void> {
    const plugins = pluginRegistry.getAllPlugins();

    // Initialize all
    for (const plugin of plugins) {
      if (plugin.state === 'loaded') {
        await this.initializePlugin(plugin.manifest.id);
      }
    }

    // Activate all (respecting dependency order)
    const sorted = resolveDependencies(plugins.map((p) => p.manifest));

    for (const manifest of sorted) {
      const info = pluginRegistry.getPlugin(manifest.id);
      if (info && info.state === 'initialized') {
        await this.activatePlugin(manifest.id);
      }
    }
  }

  /**
   * Shutdown all plugins
   */
  async shutdownAllPlugins(): Promise<void> {
    const plugins = pluginRegistry.getAllPlugins();

    // Shutdown in reverse dependency order
    const sorted = resolveDependencies(plugins.map((p) => p.manifest)).reverse();

    for (const manifest of sorted) {
      await this.unloadPlugin(manifest.id);
    }
  }

  /**
   * Enable hot reload for development
   */
  enableHotReload(): void {
    this.hotReloadEnabled = true;
    console.log('[PluginLoader] Hot reload enabled');

    // Start watching all active plugins
    for (const plugin of pluginRegistry.getActivePlugins()) {
      this.watchPlugin(plugin.manifest.id);
    }
  }

  /**
   * Disable hot reload
   */
  disableHotReload(): void {
    this.hotReloadEnabled = false;

    // Stop all watchers
    for (const pluginId of this.watchers.keys()) {
      this.stopWatching(pluginId);
    }

    console.log('[PluginLoader] Hot reload disabled');
  }

  /**
   * Watch a plugin directory for changes
   */
  watchPlugin(pluginId: string): void {
    if (!this.hotReloadEnabled) return;

    const pluginDir = this.getPluginDir(pluginId);

    if (this.watchers.has(pluginId)) {
      return; // Already watching
    }

    try {
      // Note: Using fs.watch which is available in Node.js
      // For production, consider using chokidar for better cross-platform support
      import('node:fs').then(({ watch: fsWatch }) => {
        const watcher = fsWatch(pluginDir, { recursive: true }, (event, filename) => {
          if (filename && (filename.endsWith('.js') || filename.endsWith('.json'))) {
            this.scheduleReload(pluginId);
          }
        });

        this.watchers.set(pluginId, watcher as unknown as FSWatcher);
        console.log(`[PluginLoader] Watching plugin: ${pluginId}`);
      });
    } catch (err) {
      console.error(`[PluginLoader] Failed to watch plugin ${pluginId}:`, err);
    }
  }

  /**
   * Schedule a debounced reload for a plugin
   */
  private scheduleReload(pluginId: string): void {
    // Clear existing timer
    const existingTimer = this.reloadTimers.get(pluginId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new reload (debounce 500ms)
    const timer = setTimeout(async () => {
      console.log(`[PluginLoader] Hot reloading plugin: ${pluginId}`);
      const config = pluginRegistry.getConfig(pluginId);
      await this.unloadPlugin(pluginId);

      const pluginDir = this.getPluginDir(pluginId);
      if (await this.loadAndRegister(pluginDir, config)) {
        await this.initializePlugin(pluginId);
        await this.activatePlugin(pluginId);
        this.watchPlugin(pluginId);
      }

      this.reloadTimers.delete(pluginId);
    }, 500);

    this.reloadTimers.set(pluginId, timer);
  }

  /**
   * Stop watching a plugin
   */
  stopWatching(pluginId: string): void {
    const watcher = this.watchers.get(pluginId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(pluginId);
    }

    const timer = this.reloadTimers.get(pluginId);
    if (timer) {
      clearTimeout(timer);
      this.reloadTimers.delete(pluginId);
    }
  }

  /**
   * Reload a specific plugin
   */
  async reloadPlugin(pluginId: string): Promise<boolean> {
    const config = pluginRegistry.getConfig(pluginId);
    const wasActive = pluginRegistry.getPlugin(pluginId)?.state === 'active';

    await this.unloadPlugin(pluginId);

    const pluginDir = this.getPluginDir(pluginId);
    if (!(await this.loadAndRegister(pluginDir, config))) {
      return false;
    }

    if (!(await this.initializePlugin(pluginId))) {
      return false;
    }

    if (wasActive) {
      return this.activatePlugin(pluginId);
    }

    return true;
  }
}

// Singleton instance
export const pluginLoader = new PluginLoader();
