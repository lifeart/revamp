/**
 * Revamp Plugin System - Hook Executor
 *
 * Executes hooks in an interceptor chain pattern with priority ordering.
 * Supports both chain-style hooks (can modify/stop) and async notification hooks.
 *
 * Features:
 * - Sequential execution for modifying hooks (respects priority)
 * - Parallel execution for read-only/notification hooks
 * - Per-plugin execution metrics and timing
 * - Timeout protection with configurable limits
 */

import { pluginRegistry } from './registry.js';
import type { HookName } from './types.js';
import type {
  HookTypes,
  HookResult,
  PreRequestResult,
  PostResponseResult,
  PreTransformResult,
  PostTransformResult,
  FilterDecisionResult,
  ConfigResolutionResult,
  CacheGetResult,
  RequestContext,
  ResponseContext,
  TransformContext,
  FilterContext,
  ConfigResolutionContext,
  DomainLifecycleContext,
  CacheContext,
  MetricsContext,
} from './hooks.js';

/** Default timeout for hook execution (5 seconds) */
const DEFAULT_HOOK_TIMEOUT = 5000;

/**
 * Execution mode for hook chains
 */
export type ExecutionMode = 'sequential' | 'parallel' | 'auto';

/**
 * Per-plugin hook execution statistics
 */
export interface PluginHookStats {
  /** Plugin ID */
  pluginId: string;
  /** Total number of hook executions */
  totalExecutions: number;
  /** Number of successful executions */
  successfulExecutions: number;
  /** Number of failed executions */
  failedExecutions: number;
  /** Number of timeouts */
  timeouts: number;
  /** Total execution time in ms */
  totalExecutionTime: number;
  /** Average execution time in ms */
  averageExecutionTime: number;
  /** Last execution timestamp */
  lastExecutionAt: number;
  /** Stats per hook name */
  byHook: Map<HookName, HookExecutionStats>;
}

/**
 * Statistics for a specific hook
 */
export interface HookExecutionStats {
  executions: number;
  successes: number;
  failures: number;
  timeouts: number;
  totalTime: number;
  averageTime: number;
  lastExecutionAt: number;
}

/**
 * Result of executing a hook chain
 */
export interface ChainExecutionResult<T> {
  /** Final value after all hooks */
  value: T;
  /** Whether a hook stopped the chain */
  stopped: boolean;
  /** Plugin that stopped the chain (if any) */
  stoppedBy?: string;
  /** Error if chain was stopped due to error */
  error?: Error;
  /** Execution time in ms */
  executionTime?: number;
  /** Number of hooks executed */
  hooksExecuted?: number;
}

/**
 * Hook Executor - manages hook execution with error handling and timeouts
 */
class HookExecutor {
  private hookTimeout = DEFAULT_HOOK_TIMEOUT;
  private pluginStats = new Map<string, PluginHookStats>();
  private executionMode: ExecutionMode = 'sequential';

  /**
   * Set the timeout for hook execution
   */
  setTimeout(ms: number): void {
    this.hookTimeout = ms;
  }

  /**
   * Get the current timeout value
   */
  getTimeout(): number {
    return this.hookTimeout;
  }

  /**
   * Set the default execution mode
   */
  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode = mode;
  }

  /**
   * Get the current execution mode
   */
  getExecutionMode(): ExecutionMode {
    return this.executionMode;
  }

  /**
   * Get execution statistics for a specific plugin
   */
  getPluginStats(pluginId: string): PluginHookStats | undefined {
    return this.pluginStats.get(pluginId);
  }

  /**
   * Get execution statistics for all plugins
   */
  getAllPluginStats(): PluginHookStats[] {
    return Array.from(this.pluginStats.values());
  }

  /**
   * Get aggregated statistics
   */
  getAggregateStats(): {
    totalExecutions: number;
    totalSuccesses: number;
    totalFailures: number;
    totalTimeouts: number;
    averageExecutionTime: number;
    pluginCount: number;
  } {
    let totalExecutions = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;
    let totalTimeouts = 0;
    let totalTime = 0;

    for (const stats of this.pluginStats.values()) {
      totalExecutions += stats.totalExecutions;
      totalSuccesses += stats.successfulExecutions;
      totalFailures += stats.failedExecutions;
      totalTimeouts += stats.timeouts;
      totalTime += stats.totalExecutionTime;
    }

    return {
      totalExecutions,
      totalSuccesses,
      totalFailures,
      totalTimeouts,
      averageExecutionTime: totalExecutions > 0 ? totalTime / totalExecutions : 0,
      pluginCount: this.pluginStats.size,
    };
  }

  /**
   * Reset statistics for a plugin or all plugins
   */
  resetStats(pluginId?: string): void {
    if (pluginId) {
      this.pluginStats.delete(pluginId);
    } else {
      this.pluginStats.clear();
    }
  }

  /**
   * Record execution statistics
   */
  private recordExecution(
    pluginId: string,
    hookName: HookName,
    success: boolean,
    executionTime: number,
    isTimeout: boolean = false
  ): void {
    let stats = this.pluginStats.get(pluginId);
    if (!stats) {
      stats = {
        pluginId,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        timeouts: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        lastExecutionAt: 0,
        byHook: new Map(),
      };
      this.pluginStats.set(pluginId, stats);
    }

    // Update overall stats
    stats.totalExecutions++;
    if (success) {
      stats.successfulExecutions++;
    } else {
      stats.failedExecutions++;
    }
    if (isTimeout) {
      stats.timeouts++;
    }
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions;
    stats.lastExecutionAt = Date.now();

    // Update per-hook stats
    let hookStats = stats.byHook.get(hookName);
    if (!hookStats) {
      hookStats = {
        executions: 0,
        successes: 0,
        failures: 0,
        timeouts: 0,
        totalTime: 0,
        averageTime: 0,
        lastExecutionAt: 0,
      };
      stats.byHook.set(hookName, hookStats);
    }

    hookStats.executions++;
    if (success) {
      hookStats.successes++;
    } else {
      hookStats.failures++;
    }
    if (isTimeout) {
      hookStats.timeouts++;
    }
    hookStats.totalTime += executionTime;
    hookStats.averageTime = hookStats.totalTime / hookStats.executions;
    hookStats.lastExecutionAt = Date.now();
  }

  /**
   * Execute a pre-request hook chain
   */
  async executePreRequest(
    context: RequestContext
  ): Promise<ChainExecutionResult<PreRequestResult>> {
    return this.executeChain<'request:pre', PreRequestResult>(
      'request:pre',
      context,
      {}
    );
  }

  /**
   * Execute a post-response hook chain
   */
  async executePostResponse(
    context: ResponseContext
  ): Promise<ChainExecutionResult<PostResponseResult>> {
    return this.executeChain<'response:post', PostResponseResult>(
      'response:post',
      context,
      {}
    );
  }

  /**
   * Execute a pre-transform hook chain
   */
  async executePreTransform(
    context: TransformContext
  ): Promise<ChainExecutionResult<PreTransformResult>> {
    return this.executeChain<'transform:pre', PreTransformResult>(
      'transform:pre',
      context,
      {}
    );
  }

  /**
   * Execute a post-transform hook chain
   */
  async executePostTransform(
    context: TransformContext & { transformed: string }
  ): Promise<ChainExecutionResult<PostTransformResult>> {
    return this.executeChain<'transform:post', PostTransformResult>(
      'transform:post',
      context,
      {}
    );
  }

  /**
   * Execute a filter decision hook chain
   */
  async executeFilterDecision(
    context: FilterContext
  ): Promise<ChainExecutionResult<FilterDecisionResult>> {
    return this.executeChain<'filter:decision', FilterDecisionResult>(
      'filter:decision',
      context,
      {}
    );
  }

  /**
   * Execute a config resolution hook chain
   */
  async executeConfigResolution(
    context: ConfigResolutionContext
  ): Promise<ChainExecutionResult<ConfigResolutionResult>> {
    return this.executeChain<'config:resolution', ConfigResolutionResult>(
      'config:resolution',
      context,
      {}
    );
  }

  /**
   * Execute a cache get hook chain
   */
  async executeCacheGet(
    context: CacheContext
  ): Promise<ChainExecutionResult<CacheGetResult>> {
    return this.executeChain<'cache:get', CacheGetResult>(
      'cache:get',
      context,
      {}
    );
  }

  /**
   * Execute domain lifecycle hooks (notification only)
   */
  async executeDomainLifecycle(context: DomainLifecycleContext): Promise<void> {
    await this.executeNotification('domain:lifecycle', context);
  }

  /**
   * Execute cache set hooks (notification only)
   */
  async executeCacheSet(context: CacheContext & { data: Buffer }): Promise<void> {
    await this.executeNotification('cache:set', context);
  }

  /**
   * Execute metrics recording hooks (notification only)
   */
  async executeMetricsRecord(context: MetricsContext): Promise<void> {
    await this.executeNotification('metrics:record', context);
  }

  /**
   * Check if any hooks are registered for a hook name
   */
  hasHooks(hookName: HookName): boolean {
    return pluginRegistry.hasHooks(hookName);
  }

  /**
   * Execute a chain of hooks that can modify values or stop the chain
   */
  private async executeChain<T extends HookName, R>(
    hookName: T,
    context: Parameters<HookTypes[T]>[0],
    defaultValue: R
  ): Promise<ChainExecutionResult<R>> {
    const hooks = pluginRegistry.getHooks(hookName);
    const chainStartTime = Date.now();
    let hooksExecuted = 0;

    if (hooks.length === 0) {
      return { value: defaultValue, stopped: false, executionTime: 0, hooksExecuted: 0 };
    }

    let currentValue = defaultValue;

    for (const { pluginId, hook } of hooks) {
      const hookStartTime = Date.now();
      try {
        const result = await this.executeWithTimeout(
          () => (hook as (ctx: unknown) => Promise<HookResult<R>>)(context),
          pluginId,
          hookName
        );

        const executionTime = Date.now() - hookStartTime;
        hooksExecuted++;
        this.recordExecution(pluginId, hookName, true, executionTime);

        if (!result.continue) {
          if ('error' in result) {
            return {
              value: currentValue,
              stopped: true,
              stoppedBy: pluginId,
              error: result.error,
              executionTime: Date.now() - chainStartTime,
              hooksExecuted,
            };
          }
          return {
            value: result.value,
            stopped: true,
            stoppedBy: pluginId,
            executionTime: Date.now() - chainStartTime,
            hooksExecuted,
          };
        }

        if (result.value !== undefined) {
          // Merge the result into current value
          currentValue = { ...currentValue, ...result.value };
        }
      } catch (err) {
        const executionTime = Date.now() - hookStartTime;
        const isTimeout = err instanceof Error && err.message.includes('timed out');
        hooksExecuted++;
        this.recordExecution(pluginId, hookName, false, executionTime, isTimeout);
        console.error(
          `[HookExecutor] Hook ${hookName} from ${pluginId} failed:`,
          err
        );
        // Continue to next hook on error (fail-safe)
      }
    }

    return {
      value: currentValue,
      stopped: false,
      executionTime: Date.now() - chainStartTime,
      hooksExecuted,
    };
  }

  /**
   * Execute notification hooks in parallel (fire-and-forget, no return values)
   * This is the optimized parallel execution for read-only/notification hooks.
   */
  private async executeNotification<T extends HookName>(
    hookName: T,
    context: Parameters<HookTypes[T]>[0]
  ): Promise<void> {
    const hooks = pluginRegistry.getHooks(hookName);

    if (hooks.length === 0) {
      return;
    }

    // Execute all hooks in parallel (non-blocking) with stats tracking
    await Promise.allSettled(
      hooks.map(async ({ pluginId, hook }) => {
        const startTime = Date.now();
        try {
          await this.executeWithTimeout(
            () => (hook as (ctx: unknown) => Promise<void>)(context),
            pluginId,
            hookName
          );
          const executionTime = Date.now() - startTime;
          this.recordExecution(pluginId, hookName, true, executionTime);
        } catch (err) {
          const executionTime = Date.now() - startTime;
          const isTimeout = err instanceof Error && err.message.includes('timed out');
          this.recordExecution(pluginId, hookName, false, executionTime, isTimeout);
          console.error(
            `[HookExecutor] Hook ${hookName} from ${pluginId} failed:`,
            err
          );
        }
      })
    );
  }

  /**
   * Execute hooks in parallel and collect all results (for read-only operations)
   * Unlike executeChain, this doesn't stop on first result and collects all values.
   */
  async executeParallel<T extends HookName, R>(
    hookName: T,
    context: Parameters<HookTypes[T]>[0],
    defaultValue: R
  ): Promise<{
    results: Array<{ pluginId: string; value: R; error?: Error }>;
    executionTime: number;
  }> {
    const hooks = pluginRegistry.getHooks(hookName);
    const startTime = Date.now();

    if (hooks.length === 0) {
      return { results: [], executionTime: 0 };
    }

    const results = await Promise.allSettled(
      hooks.map(async ({ pluginId, hook }) => {
        const hookStartTime = Date.now();
        try {
          const result = await this.executeWithTimeout(
            () => (hook as (ctx: unknown) => Promise<HookResult<R>>)(context),
            pluginId,
            hookName
          );
          const executionTime = Date.now() - hookStartTime;
          this.recordExecution(pluginId, hookName, true, executionTime);

          // Handle different result types
          if ('error' in result) {
            return {
              pluginId,
              value: defaultValue,
              error: result.error,
            };
          }

          return {
            pluginId,
            value: result.value ?? defaultValue,
          };
        } catch (err) {
          const executionTime = Date.now() - hookStartTime;
          const isTimeout = err instanceof Error && err.message.includes('timed out');
          this.recordExecution(pluginId, hookName, false, executionTime, isTimeout);

          return {
            pluginId,
            value: defaultValue,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      })
    );

    return {
      results: results
        .filter((r): r is PromiseFulfilledResult<{ pluginId: string; value: R; error?: Error }> =>
          r.status === 'fulfilled'
        )
        .map((r) => r.value),
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Execute a hook with timeout protection
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    pluginId: string,
    hookName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Hook ${hookName} from ${pluginId} timed out after ${this.hookTimeout}ms`
          )
        );
      }, this.hookTimeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// Singleton instance
export const hookExecutor = new HookExecutor();

/**
 * Helper function to check if hooks exist and execute pre-request hooks
 */
export async function runPreRequestHooks(
  context: RequestContext
): Promise<ChainExecutionResult<PreRequestResult> | null> {
  if (!hookExecutor.hasHooks('request:pre')) {
    return null;
  }
  return hookExecutor.executePreRequest(context);
}

/**
 * Helper function to check if hooks exist and execute post-response hooks
 */
export async function runPostResponseHooks(
  context: ResponseContext
): Promise<ChainExecutionResult<PostResponseResult> | null> {
  if (!hookExecutor.hasHooks('response:post')) {
    return null;
  }
  return hookExecutor.executePostResponse(context);
}

/**
 * Helper function to check if hooks exist and execute pre-transform hooks
 */
export async function runPreTransformHooks(
  context: TransformContext
): Promise<ChainExecutionResult<PreTransformResult> | null> {
  if (!hookExecutor.hasHooks('transform:pre')) {
    return null;
  }
  return hookExecutor.executePreTransform(context);
}

/**
 * Helper function to check if hooks exist and execute post-transform hooks
 */
export async function runPostTransformHooks(
  context: TransformContext & { transformed: string }
): Promise<ChainExecutionResult<PostTransformResult> | null> {
  if (!hookExecutor.hasHooks('transform:post')) {
    return null;
  }
  return hookExecutor.executePostTransform(context);
}

/**
 * Helper function to check if hooks exist and execute filter decision hooks
 */
export async function runFilterDecisionHooks(
  context: FilterContext
): Promise<ChainExecutionResult<FilterDecisionResult> | null> {
  if (!hookExecutor.hasHooks('filter:decision')) {
    return null;
  }
  return hookExecutor.executeFilterDecision(context);
}

/**
 * Helper function to check if hooks exist and execute config resolution hooks
 */
export async function runConfigResolutionHooks(
  context: ConfigResolutionContext
): Promise<ChainExecutionResult<ConfigResolutionResult> | null> {
  if (!hookExecutor.hasHooks('config:resolution')) {
    return null;
  }
  return hookExecutor.executeConfigResolution(context);
}
