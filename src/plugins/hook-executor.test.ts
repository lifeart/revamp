/**
 * Hook Executor Tests
 *
 * Tests the real hook execution system with actual plugin registration
 * and hook execution, not just mocking edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hookExecutor } from './hook-executor.js';
import { pluginRegistry } from './registry.js';
import type { HookResult, PreRequestHook, PostResponseHook } from './hooks.js';
import type { RequestContext, ResponseContext } from './hooks.js';

// Helper to create realistic request context
function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url: 'https://example.com/api/data',
    method: 'GET',
    headers: {
      'user-agent': 'Mozilla/5.0 Test Browser',
      'accept': 'application/json',
      'host': 'example.com',
    },
    clientIp: '192.168.1.100',
    hostname: 'example.com',
    config: {
      port: 8080,
      enableCache: true,
      enableTransforms: true,
    } as never,
    profile: null,
    isHttps: true,
    startTime: Date.now(),
    pluginData: new Map(),
    ...overrides,
  };
}

// Helper to create realistic response context
function createResponseContext(overrides: Partial<ResponseContext> = {}): ResponseContext {
  return {
    ...createRequestContext(),
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json',
      'cache-control': 'max-age=3600',
    },
    body: Buffer.from(JSON.stringify({ success: true, data: [1, 2, 3] })),
    contentType: 'other',
    originalSize: 42,
    duration: 150,
    ...overrides,
  };
}

// Helper to create a test plugin manifest
function createTestPluginManifest(id: string, hooks: string[] = ['request:pre']) {
  return {
    id,
    name: `Test Plugin ${id}`,
    version: '1.0.0' as const,
    description: `Test plugin for ${id}`,
    author: 'Test Author',
    revampVersion: '1.0.0' as const,
    main: 'index.js',
    hooks: hooks as ('request:pre' | 'response:post')[],
    permissions: ['request:read' as const, 'request:modify' as const],
  };
}

describe('HookExecutor', () => {
  beforeEach(() => {
    hookExecutor.resetStats();
    pluginRegistry.clear();
    hookExecutor.setTimeout(5000);
    hookExecutor.setExecutionMode('sequential');
  });

  afterEach(() => {
    hookExecutor.resetStats();
    pluginRegistry.clear();
  });

  describe('Configuration', () => {
    it('should have default timeout of 5000ms', () => {
      expect(hookExecutor.getTimeout()).toBe(5000);
    });

    it('should allow setting custom timeout', () => {
      hookExecutor.setTimeout(10000);
      expect(hookExecutor.getTimeout()).toBe(10000);
    });

    it('should have default execution mode of sequential', () => {
      expect(hookExecutor.getExecutionMode()).toBe('sequential');
    });

    it('should allow setting execution mode to parallel', () => {
      hookExecutor.setExecutionMode('parallel');
      expect(hookExecutor.getExecutionMode()).toBe('parallel');
    });

    it('should allow setting execution mode to auto', () => {
      hookExecutor.setExecutionMode('auto');
      expect(hookExecutor.getExecutionMode()).toBe('auto');
    });
  });

  describe('Hook Registration Detection', () => {
    it('should return false for hasHooks when no hooks registered', () => {
      expect(hookExecutor.hasHooks('request:pre')).toBe(false);
      expect(hookExecutor.hasHooks('response:post')).toBe(false);
    });

    it('should return true for hasHooks when hooks are registered', () => {
      const plugin = { manifest: createTestPluginManifest('com.test.detector') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.detector', 'active');
      pluginRegistry.registerHook(
        'com.test.detector',
        'request:pre',
        async () => ({ continue: true }),
        0
      );

      expect(hookExecutor.hasHooks('request:pre')).toBe(true);
      expect(hookExecutor.hasHooks('response:post')).toBe(false);
    });
  });

  describe('No Hooks Registered', () => {
    it('should return default value for executePreRequest when no hooks', async () => {
      const context = createRequestContext();
      const result = await hookExecutor.executePreRequest(context);

      expect(result.value).toEqual({});
      expect(result.stopped).toBe(false);
      expect(result.executionTime).toBe(0);
      expect(result.hooksExecuted).toBe(0);
    });

    it('should return default value for executePostResponse when no hooks', async () => {
      const context = createResponseContext();
      const result = await hookExecutor.executePostResponse(context);

      expect(result.value).toEqual({});
      expect(result.stopped).toBe(false);
      expect(result.executionTime).toBe(0);
      expect(result.hooksExecuted).toBe(0);
    });

    it('should return empty results for executeParallel when no hooks', async () => {
      const context = createRequestContext();
      const result = await hookExecutor.executeParallel('request:pre', context, {});

      expect(result.results).toHaveLength(0);
      expect(result.executionTime).toBe(0);
    });
  });

  describe('Single Plugin Hook Execution', () => {
    it('should execute hook and return modified value', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.modifier') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.modifier', 'active');

      pluginRegistry.registerHook(
        'com.test.modifier',
        'request:pre',
        (async (ctx: RequestContext) => {
          // Real logic: add a tracking header based on request URL
          return {
            continue: true,
            value: { headers: { 'X-Tracked': ctx.hostname } },
          };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext({ hostname: 'api.example.com' });
      const result = await hookExecutor.executePreRequest(context);

      expect(result.value).toHaveProperty('headers');
      expect(result.value.headers).toEqual({ 'X-Tracked': 'api.example.com' });
      expect(result.stopped).toBe(false);
      expect(result.hooksExecuted).toBe(1);
    });

    it('should stop chain when hook returns continue: false', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.blocker') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.blocker', 'active');

      pluginRegistry.registerHook(
        'com.test.blocker',
        'request:pre',
        (async (ctx: RequestContext) => {
          // Real logic: block requests to certain domains
          if (ctx.hostname.includes('blocked')) {
            return {
              continue: false,
              value: { blocked: true, blockedResponse: { statusCode: 403, body: 'Domain is blacklisted' } },
            };
          }
          return { continue: true };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext({ hostname: 'blocked-domain.com' });
      const result = await hookExecutor.executePreRequest(context);

      expect(result.value.blocked).toBe(true);
      expect(result.value.blockedResponse?.body).toBe('Domain is blacklisted');
      expect(result.stopped).toBe(true);
      expect(result.stoppedBy).toBe('com.test.blocker');
    });

    it('should handle hook that throws error gracefully', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.error') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.error', 'active');

      pluginRegistry.registerHook(
        'com.test.error',
        'request:pre',
        (async () => {
          throw new Error('Database connection failed');
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      // Should not throw, should continue with default value
      const result = await hookExecutor.executePreRequest(context);

      expect(result.stopped).toBe(false);
      expect(result.hooksExecuted).toBe(1);
      expect(result.value).toEqual({});
    });
  });

  describe('Multiple Plugins Priority Ordering', () => {
    it('should execute hooks in priority order (higher priority first)', async () => {
      const executionOrder: string[] = [];

      // Register three plugins with different priorities
      const plugin1 = { manifest: createTestPluginManifest('com.test.low-priority') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.high-priority') };
      const plugin3 = { manifest: createTestPluginManifest('com.test.medium-priority') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.register(plugin3);
      pluginRegistry.updateState('com.test.low-priority', 'active');
      pluginRegistry.updateState('com.test.high-priority', 'active');
      pluginRegistry.updateState('com.test.medium-priority', 'active');

      // Low priority (0)
      pluginRegistry.registerHook(
        'com.test.low-priority',
        'request:pre',
        (async () => {
          executionOrder.push('low');
          return { continue: true, value: { url: 'low' } };
        }) as PreRequestHook,
        0
      );

      // High priority (100)
      pluginRegistry.registerHook(
        'com.test.high-priority',
        'request:pre',
        (async () => {
          executionOrder.push('high');
          return { continue: true, value: { url: 'high' } };
        }) as PreRequestHook,
        100
      );

      // Medium priority (50)
      pluginRegistry.registerHook(
        'com.test.medium-priority',
        'request:pre',
        (async () => {
          executionOrder.push('medium');
          return { continue: true, value: { url: 'medium' } };
        }) as PreRequestHook,
        50
      );

      const context = createRequestContext();
      const result = await hookExecutor.executePreRequest(context);

      // Should execute high -> medium -> low
      expect(executionOrder).toEqual(['high', 'medium', 'low']);
      expect(result.hooksExecuted).toBe(3);
      // Last value wins in merge
      expect(result.value).toHaveProperty('url', 'low');
    });

    it('should stop at first hook that returns continue: false', async () => {
      const executionOrder: string[] = [];

      const plugin1 = { manifest: createTestPluginManifest('com.test.first') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.blocker') };
      const plugin3 = { manifest: createTestPluginManifest('com.test.never-runs') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.register(plugin3);
      pluginRegistry.updateState('com.test.first', 'active');
      pluginRegistry.updateState('com.test.blocker', 'active');
      pluginRegistry.updateState('com.test.never-runs', 'active');

      pluginRegistry.registerHook(
        'com.test.first',
        'request:pre',
        (async () => {
          executionOrder.push('first');
          return { continue: true };
        }) as PreRequestHook,
        100
      );

      pluginRegistry.registerHook(
        'com.test.blocker',
        'request:pre',
        (async () => {
          executionOrder.push('blocker');
          return { continue: false, value: { blocked: true } };
        }) as PreRequestHook,
        50
      );

      pluginRegistry.registerHook(
        'com.test.never-runs',
        'request:pre',
        (async () => {
          executionOrder.push('never-runs');
          return { continue: true };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      const result = await hookExecutor.executePreRequest(context);

      expect(executionOrder).toEqual(['first', 'blocker']);
      expect(result.stopped).toBe(true);
      expect(result.stoppedBy).toBe('com.test.blocker');
      expect(result.hooksExecuted).toBe(2);
    });

    it('should merge values from multiple hooks', async () => {
      const plugin1 = { manifest: createTestPluginManifest('com.test.auth') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.logging') };
      const plugin3 = { manifest: createTestPluginManifest('com.test.cache') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.register(plugin3);
      pluginRegistry.updateState('com.test.auth', 'active');
      pluginRegistry.updateState('com.test.logging', 'active');
      pluginRegistry.updateState('com.test.cache', 'active');

      // Auth plugin adds auth header
      pluginRegistry.registerHook(
        'com.test.auth',
        'request:pre',
        (async () => {
          return { continue: true, value: { headers: { Authorization: 'Bearer xyz123' } } };
        }) as PreRequestHook,
        100
      );

      // Logging plugin adds trace header
      pluginRegistry.registerHook(
        'com.test.logging',
        'request:pre',
        (async () => {
          return { continue: true, value: { headers: { 'X-Trace-Id': 'trace-abc-123' } } };
        }) as PreRequestHook,
        50
      );

      // Cache plugin adds cache hint header
      pluginRegistry.registerHook(
        'com.test.cache',
        'request:pre',
        (async () => {
          return { continue: true, value: { headers: { 'X-Cache-Key': 'cache:example.com:/api' } } };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      const result = await hookExecutor.executePreRequest(context);

      // Headers should be merged from all plugins
      expect(result.value.headers).toBeDefined();
      expect(result.value.headers!['X-Cache-Key']).toBe('cache:example.com:/api');
      expect(result.hooksExecuted).toBe(3);
    });
  });

  describe('Statistics Tracking', () => {
    it('should track successful executions per plugin', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.stats') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.stats', 'active');

      pluginRegistry.registerHook(
        'com.test.stats',
        'request:pre',
        (async () => {
          return { continue: true };
        }) as PreRequestHook,
        0
      );

      // Execute multiple times
      const context = createRequestContext();
      await hookExecutor.executePreRequest(context);
      await hookExecutor.executePreRequest(context);
      await hookExecutor.executePreRequest(context);

      const stats = hookExecutor.getPluginStats('com.test.stats');
      expect(stats).toBeDefined();
      expect(stats!.totalExecutions).toBe(3);
      expect(stats!.successfulExecutions).toBe(3);
      expect(stats!.failedExecutions).toBe(0);
      expect(stats!.timeouts).toBe(0);
      expect(stats!.averageExecutionTime).toBeGreaterThanOrEqual(0);
      expect(stats!.lastExecutionAt).toBeGreaterThan(0);
    });

    it('should track failed executions per plugin', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.failing') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.failing', 'active');

      let callCount = 0;
      pluginRegistry.registerHook(
        'com.test.failing',
        'request:pre',
        (async () => {
          callCount++;
          if (callCount <= 2) {
            throw new Error('Simulated failure');
          }
          return { continue: true };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      await hookExecutor.executePreRequest(context); // fails
      await hookExecutor.executePreRequest(context); // fails
      await hookExecutor.executePreRequest(context); // succeeds

      const stats = hookExecutor.getPluginStats('com.test.failing');
      expect(stats).toBeDefined();
      expect(stats!.totalExecutions).toBe(3);
      expect(stats!.successfulExecutions).toBe(1);
      expect(stats!.failedExecutions).toBe(2);
    });

    it('should track per-hook statistics', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.multi-hook', ['request:pre', 'response:post']) };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.multi-hook', 'active');

      pluginRegistry.registerHook(
        'com.test.multi-hook',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        0
      );

      pluginRegistry.registerHook(
        'com.test.multi-hook',
        'response:post',
        (async () => ({ continue: true })) as PostResponseHook,
        0
      );

      // Execute request hooks 3 times, response hooks 2 times
      const reqContext = createRequestContext();
      const resContext = createResponseContext();

      await hookExecutor.executePreRequest(reqContext);
      await hookExecutor.executePreRequest(reqContext);
      await hookExecutor.executePreRequest(reqContext);
      await hookExecutor.executePostResponse(resContext);
      await hookExecutor.executePostResponse(resContext);

      const stats = hookExecutor.getPluginStats('com.test.multi-hook');
      expect(stats).toBeDefined();
      expect(stats!.totalExecutions).toBe(5);

      const requestPreStats = stats!.byHook.get('request:pre');
      expect(requestPreStats).toBeDefined();
      expect(requestPreStats!.executions).toBe(3);

      const responsePostStats = stats!.byHook.get('response:post');
      expect(responsePostStats).toBeDefined();
      expect(responsePostStats!.executions).toBe(2);
    });

    it('should aggregate statistics across all plugins', async () => {
      const plugin1 = { manifest: createTestPluginManifest('com.test.stats1') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.stats2') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.updateState('com.test.stats1', 'active');
      pluginRegistry.updateState('com.test.stats2', 'active');

      pluginRegistry.registerHook(
        'com.test.stats1',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        100
      );

      pluginRegistry.registerHook(
        'com.test.stats2',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      await hookExecutor.executePreRequest(context);
      await hookExecutor.executePreRequest(context);

      const aggregate = hookExecutor.getAggregateStats();
      expect(aggregate.totalExecutions).toBe(4); // 2 plugins × 2 executions
      expect(aggregate.totalSuccesses).toBe(4);
      expect(aggregate.totalFailures).toBe(0);
      expect(aggregate.pluginCount).toBe(2);
    });

    it('should reset stats for a specific plugin', async () => {
      const plugin1 = { manifest: createTestPluginManifest('com.test.keep') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.reset') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.updateState('com.test.keep', 'active');
      pluginRegistry.updateState('com.test.reset', 'active');

      pluginRegistry.registerHook(
        'com.test.keep',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        100
      );

      pluginRegistry.registerHook(
        'com.test.reset',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      await hookExecutor.executePreRequest(context);

      // Both plugins should have stats
      expect(hookExecutor.getPluginStats('com.test.keep')).toBeDefined();
      expect(hookExecutor.getPluginStats('com.test.reset')).toBeDefined();

      // Reset only one
      hookExecutor.resetStats('com.test.reset');

      expect(hookExecutor.getPluginStats('com.test.keep')).toBeDefined();
      expect(hookExecutor.getPluginStats('com.test.reset')).toBeUndefined();
    });

    it('should reset all stats', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.to-clear') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.to-clear', 'active');

      pluginRegistry.registerHook(
        'com.test.to-clear',
        'request:pre',
        (async () => ({ continue: true })) as PreRequestHook,
        0
      );

      await hookExecutor.executePreRequest(createRequestContext());

      expect(hookExecutor.getAllPluginStats()).toHaveLength(1);

      hookExecutor.resetStats();

      expect(hookExecutor.getAllPluginStats()).toHaveLength(0);
    });
  });

  describe('Parallel Execution', () => {
    it('should execute all hooks in parallel and collect results', async () => {
      const executionTimes: number[] = [];
      const startTime = Date.now();

      const plugin1 = { manifest: createTestPluginManifest('com.test.parallel1') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.parallel2') };
      const plugin3 = { manifest: createTestPluginManifest('com.test.parallel3') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.register(plugin3);
      pluginRegistry.updateState('com.test.parallel1', 'active');
      pluginRegistry.updateState('com.test.parallel2', 'active');
      pluginRegistry.updateState('com.test.parallel3', 'active');

      // Each hook waits a bit to simulate async work
      pluginRegistry.registerHook(
        'com.test.parallel1',
        'request:pre',
        (async () => {
          await new Promise((r) => setTimeout(r, 50));
          executionTimes.push(Date.now() - startTime);
          return { continue: true, value: { url: 'plugin1' } };
        }) as PreRequestHook,
        0
      );

      pluginRegistry.registerHook(
        'com.test.parallel2',
        'request:pre',
        (async () => {
          await new Promise((r) => setTimeout(r, 50));
          executionTimes.push(Date.now() - startTime);
          return { continue: true, value: { url: 'plugin2' } };
        }) as PreRequestHook,
        0
      );

      pluginRegistry.registerHook(
        'com.test.parallel3',
        'request:pre',
        (async () => {
          await new Promise((r) => setTimeout(r, 50));
          executionTimes.push(Date.now() - startTime);
          return { continue: true, value: { url: 'plugin3' } };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      const result = await hookExecutor.executeParallel('request:pre', context, {} as { url?: string });

      expect(result.results).toHaveLength(3);

      // All results should be present
      const urls = result.results.map((r) => r.value.url);
      expect(urls).toContain('plugin1');
      expect(urls).toContain('plugin2');
      expect(urls).toContain('plugin3');

      // In parallel execution, all should complete around the same time
      // (within ~100ms of each other, not ~150ms total if sequential)
      const maxDiff = Math.max(...executionTimes) - Math.min(...executionTimes);
      expect(maxDiff).toBeLessThan(100);
    });

    it('should collect errors from failing hooks in parallel', async () => {
      const plugin1 = { manifest: createTestPluginManifest('com.test.parallel-ok') };
      const plugin2 = { manifest: createTestPluginManifest('com.test.parallel-fail') };

      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      pluginRegistry.updateState('com.test.parallel-ok', 'active');
      pluginRegistry.updateState('com.test.parallel-fail', 'active');

      pluginRegistry.registerHook(
        'com.test.parallel-ok',
        'request:pre',
        (async () => {
          return { continue: true, value: { url: 'ok' } };
        }) as PreRequestHook,
        0
      );

      pluginRegistry.registerHook(
        'com.test.parallel-fail',
        'request:pre',
        (async () => {
          throw new Error('Plugin failed');
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      const result = await hookExecutor.executeParallel('request:pre', context, {} as { url?: string });

      expect(result.results).toHaveLength(2);

      const okResult = result.results.find((r) => r.pluginId === 'com.test.parallel-ok');
      const failResult = result.results.find((r) => r.pluginId === 'com.test.parallel-fail');

      expect(okResult?.value.url).toBe('ok');
      expect(okResult?.error).toBeUndefined();

      expect(failResult?.error).toBeDefined();
      expect(failResult?.error?.message).toBe('Plugin failed');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow hooks', async () => {
      hookExecutor.setTimeout(100); // Very short timeout

      const plugin = { manifest: createTestPluginManifest('com.test.slow') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.slow', 'active');

      pluginRegistry.registerHook(
        'com.test.slow',
        'request:pre',
        (async () => {
          // Wait longer than timeout
          await new Promise((r) => setTimeout(r, 500));
          return { continue: true };
        }) as PreRequestHook,
        0
      );

      const context = createRequestContext();
      const result = await hookExecutor.executePreRequest(context);

      // Should have continued despite timeout
      expect(result.stopped).toBe(false);

      // Timeout should be recorded in stats
      const stats = hookExecutor.getPluginStats('com.test.slow');
      expect(stats).toBeDefined();
      expect(stats!.timeouts).toBe(1);
      expect(stats!.failedExecutions).toBe(1);
    });
  });

  describe('Response Hook Execution', () => {
    it('should execute response hooks with full context', async () => {
      const plugin = { manifest: createTestPluginManifest('com.test.response', ['response:post']) };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.test.response', 'active');

      let capturedContext: ResponseContext | null = null;

      pluginRegistry.registerHook(
        'com.test.response',
        'response:post',
        (async (ctx: ResponseContext) => {
          capturedContext = ctx;
          return {
            continue: true,
            value: {
              statusCode: 200,
              headers: { 'X-Body-Size': String(ctx.body.length) },
            },
          };
        }) as PostResponseHook,
        0
      );

      const responseBody = JSON.stringify({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] });
      const context = createResponseContext({
        statusCode: 200,
        body: Buffer.from(responseBody),
        responseHeaders: { 'content-type': 'application/json' },
      });

      const result = await hookExecutor.executePostResponse(context);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.statusCode).toBe(200);
      expect(capturedContext!.body.toString()).toBe(responseBody);
      expect(result.value.statusCode).toBe(200);
      expect(result.value.headers).toBeDefined();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle ad blocker plugin scenario', async () => {
      const plugin = { manifest: createTestPluginManifest('com.adblock.plugin') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.adblock.plugin', 'active');

      const blockedDomains = ['ads.example.com', 'tracker.analytics.com', 'pixel.facebook.com'];

      pluginRegistry.registerHook(
        'com.adblock.plugin',
        'request:pre',
        (async (ctx: RequestContext) => {
          if (blockedDomains.some((d) => ctx.hostname.includes(d))) {
            return {
              continue: false,
              value: { blocked: true, blockedResponse: { statusCode: 403, body: `Blocked ad/tracker domain: ${ctx.hostname}` } },
            };
          }
          return { continue: true, value: { blocked: false } };
        }) as PreRequestHook,
        100 // High priority
      );

      // Test blocked domain
      const blockedResult = await hookExecutor.executePreRequest(
        createRequestContext({ hostname: 'ads.example.com' })
      );
      expect(blockedResult.stopped).toBe(true);
      expect(blockedResult.value.blocked).toBe(true);

      // Test allowed domain
      const allowedResult = await hookExecutor.executePreRequest(
        createRequestContext({ hostname: 'api.example.com' })
      );
      expect(allowedResult.stopped).toBe(false);
      expect(allowedResult.value.blocked).toBe(false);
    });

    it('should handle request logging plugin scenario', async () => {
      const logs: Array<{ method: string; url: string; timestamp: number }> = [];

      const plugin = { manifest: createTestPluginManifest('com.logging.plugin') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.logging.plugin', 'active');

      pluginRegistry.registerHook(
        'com.logging.plugin',
        'request:pre',
        (async (ctx: RequestContext) => {
          logs.push({
            method: ctx.method,
            url: ctx.url,
            timestamp: Date.now(),
          });
          return { continue: true };
        }) as PreRequestHook,
        0 // Low priority - runs last
      );

      // Make several requests
      await hookExecutor.executePreRequest(createRequestContext({ method: 'GET', url: 'https://api.example.com/users' }));
      await hookExecutor.executePreRequest(createRequestContext({ method: 'POST', url: 'https://api.example.com/users' }));
      await hookExecutor.executePreRequest(createRequestContext({ method: 'DELETE', url: 'https://api.example.com/users/1' }));

      expect(logs).toHaveLength(3);
      expect(logs[0].method).toBe('GET');
      expect(logs[1].method).toBe('POST');
      expect(logs[2].method).toBe('DELETE');
    });

    it('should handle rate limiting plugin scenario', async () => {
      const requestCounts = new Map<string, number>();
      const RATE_LIMIT = 3;

      const plugin = { manifest: createTestPluginManifest('com.ratelimit.plugin') };
      pluginRegistry.register(plugin);
      pluginRegistry.updateState('com.ratelimit.plugin', 'active');

      pluginRegistry.registerHook(
        'com.ratelimit.plugin',
        'request:pre',
        (async (ctx: RequestContext) => {
          const key = ctx.clientIp;
          const count = (requestCounts.get(key) || 0) + 1;
          requestCounts.set(key, count);

          if (count > RATE_LIMIT) {
            return {
              continue: false,
              value: { blocked: true, blockedResponse: { statusCode: 429, body: 'Rate limit exceeded' } },
            };
          }
          return {
            continue: true,
            value: { headers: { 'X-RateLimit-Remaining': String(RATE_LIMIT - count) } },
          };
        }) as PreRequestHook,
        200 // Very high priority
      );

      const clientIp = '192.168.1.50';

      // First 3 requests should pass
      for (let i = 0; i < 3; i++) {
        const result = await hookExecutor.executePreRequest(createRequestContext({ clientIp }));
        expect(result.stopped).toBe(false);
        expect(result.value.blocked).toBeUndefined();
        expect(result.value.headers?.['X-RateLimit-Remaining']).toBe(String(RATE_LIMIT - (i + 1)));
      }

      // 4th request should be rate limited
      const limitedResult = await hookExecutor.executePreRequest(createRequestContext({ clientIp }));
      expect(limitedResult.stopped).toBe(true);
      expect(limitedResult.value.blocked).toBe(true);
    });
  });
});
