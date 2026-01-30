/**
 * Revamp Plugin System - Plugin Registry
 *
 * Central registry for managing plugins and their hooks.
 * Provides plugin registration, state management, and hook management.
 */

import { EventEmitter } from 'node:events';
import type {
  PluginInfo,
  PluginState,
  RevampPlugin,
  HookName,
} from './types.js';
import type { HookTypes, HookRegistration } from './hooks.js';

/**
 * Events emitted by the plugin registry
 */
export interface PluginRegistryEvents {
  'plugin:registered': (pluginId: string, manifest: PluginInfo['manifest']) => void;
  'plugin:unregistered': (pluginId: string) => void;
  'plugin:stateChange': (pluginId: string, state: PluginState, error?: string) => void;
  'plugin:configChange': (
    pluginId: string,
    newConfig: Record<string, unknown>,
    oldConfig: Record<string, unknown>
  ) => void;
  'hook:registered': (pluginId: string, hookName: HookName) => void;
  'hook:unregistered': (pluginId: string, hookName: HookName) => void;
}

/**
 * Plugin Registry - manages all loaded plugins and their hooks
 */
export class PluginRegistry extends EventEmitter {
  private plugins = new Map<string, PluginInfo>();
  private instances = new Map<string, RevampPlugin>();
  private hooks = new Map<HookName, HookRegistration[]>();

  constructor() {
    super();
  }

  /**
   * Register a plugin
   */
  register(plugin: RevampPlugin, config: Record<string, unknown> = {}): void {
    const { id } = plugin.manifest;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already registered`);
    }

    const info: PluginInfo = {
      manifest: plugin.manifest,
      state: 'loaded',
      loadedAt: Date.now(),
      config,
    };

    this.plugins.set(id, info);
    this.instances.set(id, plugin);

    this.emit('plugin:registered', id, plugin.manifest);
  }

  /**
   * Unregister a plugin
   */
  unregister(pluginId: string): boolean {
    if (!this.plugins.has(pluginId)) {
      return false;
    }

    // Remove all hooks from this plugin
    for (const [hookName, registrations] of this.hooks) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      if (filtered.length !== registrations.length) {
        this.hooks.set(hookName, filtered);
      }
    }

    this.plugins.delete(pluginId);
    this.instances.delete(pluginId);

    this.emit('plugin:unregistered', pluginId);

    return true;
  }

  /**
   * Get plugin info
   */
  getPlugin(pluginId: string): PluginInfo | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get plugin instance
   */
  getInstance(pluginId: string): RevampPlugin | undefined {
    return this.instances.get(pluginId);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all active plugins
   */
  getActivePlugins(): PluginInfo[] {
    return this.getAllPlugins().filter((p) => p.state === 'active');
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Update plugin state
   */
  updateState(pluginId: string, state: PluginState, error?: string): void {
    const info = this.plugins.get(pluginId);
    if (info) {
      info.state = state;
      info.error = error;
      if (state === 'active') {
        info.activatedAt = Date.now();
      }
      this.emit('plugin:stateChange', pluginId, state, error);
    }
  }

  /**
   * Register a hook
   */
  registerHook<T extends HookName>(
    pluginId: string,
    hookName: T,
    hook: HookTypes[T],
    priority: number = 0
  ): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} is not registered`);
    }
    if (plugin.state !== 'active' && plugin.state !== 'activating') {
      throw new Error(`Plugin ${pluginId} is not active (state: ${plugin.state})`);
    }

    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    const registrations = this.hooks.get(hookName)!;

    // Check for duplicate registration
    const existing = registrations.find((r) => r.pluginId === pluginId);
    if (existing) {
      // Update existing registration
      existing.hook = hook as HookTypes[HookName];
      existing.priority = priority;
    } else {
      // Add new registration
      registrations.push({
        pluginId,
        hook: hook as HookTypes[HookName],
        priority,
      });
    }

    // Sort by priority (higher first)
    registrations.sort((a, b) => b.priority - a.priority);

    this.emit('hook:registered', pluginId, hookName);
  }

  /**
   * Unregister a specific hook
   */
  unregisterHook<T extends HookName>(pluginId: string, hookName: T): boolean {
    const registrations = this.hooks.get(hookName);
    if (!registrations) return false;

    const initialLength = registrations.length;
    const filtered = registrations.filter((r) => r.pluginId !== pluginId);

    if (filtered.length < initialLength) {
      this.hooks.set(hookName, filtered);
      this.emit('hook:unregistered', pluginId, hookName);
      return true;
    }

    return false;
  }

  /**
   * Unregister all hooks for a plugin
   */
  unregisterAllHooks(pluginId: string): void {
    for (const [hookName, registrations] of this.hooks) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      if (filtered.length !== registrations.length) {
        this.hooks.set(hookName, filtered);
        this.emit('hook:unregistered', pluginId, hookName);
      }
    }
  }

  /**
   * Get all hooks for a given hook name
   */
  getHooks<T extends HookName>(hookName: T): HookRegistration<T>[] {
    return (this.hooks.get(hookName) || []) as HookRegistration<T>[];
  }

  /**
   * Check if any hooks are registered for a hook name
   */
  hasHooks(hookName: HookName): boolean {
    const hooks = this.hooks.get(hookName);
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Get hook count for a hook name
   */
  getHookCount(hookName: HookName): number {
    return this.hooks.get(hookName)?.length || 0;
  }

  /**
   * Get all hook names with registered hooks
   */
  getRegisteredHookNames(): HookName[] {
    return Array.from(this.hooks.entries())
      .filter(([, registrations]) => registrations.length > 0)
      .map(([name]) => name);
  }

  /**
   * Update plugin configuration
   */
  updateConfig(pluginId: string, config: Record<string, unknown>): void {
    const info = this.plugins.get(pluginId);
    if (info) {
      const oldConfig = info.config;
      info.config = config;
      this.emit('plugin:configChange', pluginId, config, oldConfig);
    }
  }

  /**
   * Get plugin configuration
   */
  getConfig(pluginId: string): Record<string, unknown> | undefined {
    return this.plugins.get(pluginId)?.config;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalPlugins: number;
    activePlugins: number;
    totalHooks: number;
    hooksByName: Record<string, number>;
  } {
    const hooksByName: Record<string, number> = {};
    let totalHooks = 0;

    for (const [name, registrations] of this.hooks) {
      hooksByName[name] = registrations.length;
      totalHooks += registrations.length;
    }

    return {
      totalPlugins: this.plugins.size,
      activePlugins: this.getActivePlugins().length,
      totalHooks,
      hooksByName,
    };
  }

  /**
   * Clear all plugins and hooks
   */
  clear(): void {
    this.plugins.clear();
    this.instances.clear();
    this.hooks.clear();
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();
