import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createTestContext,
  createMockRequest,
  type TestPluginContext,
} from '../../../src/plugins/testing.js';
import type { ApiEndpointHandler } from '../../../src/plugins/context.js';
import {
  getSharedPluginData,
  setSharedPluginData,
  type RequestContext,
  type ResponseContext,
} from '../../../src/plugins/hooks.js';
import type { PluginPermission } from '../../../src/plugins/types.js';

import requestTimerPlugin from './index.js';

const PLUGIN_ID = 'com.revamp.request-timer';

// Load permissions from the actual plugin.json so the "manifest is
// sufficient" doc-test below is locked to the real shipped manifest
// (hello-world pattern).
const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, 'plugin.json'), 'utf-8')
) as { permissions: PluginPermission[] };

interface StatsPayload {
  count: number;
  avgMs: number;
  maxMs: number;
  activePlugins: string[];
  jsonAdFilterActive: boolean;
}

/**
 * The test harness only exposes registered endpoint *names*
 * (`getRegisteredEndpoints()`), not the handlers — capture them by wrapping
 * `registerEndpoint` before the plugin activates.
 */
function captureEndpoints(ctx: TestPluginContext): Map<string, ApiEndpointHandler> {
  const captured = new Map<string, ApiEndpointHandler>();
  const original = ctx.registerEndpoint.bind(ctx);
  ctx.registerEndpoint = (path: string, handler: ApiEndpointHandler): void => {
    captured.set(path.replace(/^\//, ''), handler);
    original(path, handler);
  };
  return captured;
}

async function callStats(endpoints: Map<string, ApiEndpointHandler>): Promise<StatsPayload> {
  const handler = endpoints.get('stats');
  expect(handler).toBeDefined();
  const response = await handler!({
    method: 'GET',
    path: 'stats',
    query: {},
    body: '',
    headers: {},
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers?.['content-type']).toBe('application/json');
  return JSON.parse(response.body) as StatsPayload;
}

/** Build a response context that shares the request's pluginData Map, the
 * way `buildResponseContext` does in production (spread of the request). */
function toResponseContext(request: RequestContext): ResponseContext {
  return {
    ...request,
    statusCode: 200,
    responseHeaders: {},
    body: Buffer.from(''),
    contentType: 'other',
    originalSize: 0,
    duration: 0,
  };
}

describe('request-timer example plugin', () => {
  it('registers both hooks and the stats endpoint on activate', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });

    await requestTimerPlugin.activate(ctx);

    const hooks = ctx.getRegisteredHooks();
    expect(hooks.has('request:pre')).toBe(true);
    expect(hooks.has('response:post')).toBe(true);
    expect(ctx.getRegisteredEndpoints()).toContain('stats');
  });

  it('request:pre stamps a start time using the shared-plugin-data convention', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await requestTimerPlugin.activate(ctx);

    const request = createMockRequest({ url: 'https://example.com/page' });
    await ctx.simulateHook('request:pre', request);

    // Seam check: the plugin writes the key manually; readers must be able
    // to find it through the canonical getSharedPluginData helper.
    const start = getSharedPluginData<number>(request.pluginData, PLUGIN_ID, 'startTime');
    expect(typeof start).toBe('number');
  });

  it('times a request through the request -> response flow and records a metric', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    const endpoints = captureEndpoints(ctx);
    await requestTimerPlugin.activate(ctx);

    const request = createMockRequest({ url: 'https://example.com/page' });
    await ctx.simulateHook('request:pre', request);

    // Back-date the stamp (via the canonical helper) so elapsed time is
    // deterministic instead of depending on test-runner speed.
    setSharedPluginData(request.pluginData, PLUGIN_ID, 'startTime', Date.now() - 50);

    const result = await ctx.simulateHook('response:post', toResponseContext(request));
    expect(result?.continue).toBe(true);

    const stats = await callStats(endpoints);
    expect(stats.count).toBe(1);
    expect(stats.avgMs).toBeGreaterThanOrEqual(50);
    expect(stats.maxMs).toBeGreaterThanOrEqual(50);

    const metric = ctx.getCustomMetrics().get('request_duration_ms');
    expect(metric).toBeDefined();
    expect(metric!.value).toBeGreaterThanOrEqual(50);
    expect(metric!.tags.hostname).toBe('example.com');
  });

  it('accumulates stats across multiple requests', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    const endpoints = captureEndpoints(ctx);
    await requestTimerPlugin.activate(ctx);

    for (const backdateMs of [10, 30, 200]) {
      const request = createMockRequest({ url: 'https://example.com/page' });
      await ctx.simulateHook('request:pre', request);
      setSharedPluginData(request.pluginData, PLUGIN_ID, 'startTime', Date.now() - backdateMs);
      await ctx.simulateHook('response:post', toResponseContext(request));
    }

    const stats = await callStats(endpoints);
    expect(stats.count).toBe(3);
    expect(stats.maxMs).toBeGreaterThanOrEqual(200);
    expect(stats.avgMs).toBeGreaterThanOrEqual(80); // (10+30+200)/3
    expect(stats.avgMs).toBeLessThanOrEqual(stats.maxMs);
  });

  it('skips timing (with a debug log) when no start stamp exists', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    const endpoints = captureEndpoints(ctx);
    await requestTimerPlugin.activate(ctx);

    // response:post without a preceding request:pre — fresh pluginData Map.
    const request = createMockRequest({ url: 'https://example.com/page' });
    const result = await ctx.simulateHook('response:post', toResponseContext(request));

    expect(result?.continue).toBe(true);
    const stats = await callStats(endpoints);
    expect(stats.count).toBe(0);
    expect(
      ctx.getLogsByLevel('debug').some((entry) => entry.message.includes('No start timestamp'))
    ).toBe(true);
  });

  it('reports plugin composition state in the stats payload', async () => {
    const ctx = createTestContext({
      pluginId: PLUGIN_ID,
      activePlugins: [PLUGIN_ID, 'com.revamp.json-ad-filter'],
    });
    const endpoints = captureEndpoints(ctx);
    await requestTimerPlugin.activate(ctx);

    const stats = await callStats(endpoints);
    expect(stats.activePlugins).toContain(PLUGIN_ID);
    expect(stats.activePlugins).toContain('com.revamp.json-ad-filter');
    expect(stats.jsonAdFilterActive).toBe(true);

    // And the negative case via the harness' composition mock.
    ctx.setActivePlugins([PLUGIN_ID]);
    const statsAfter = await callStats(endpoints);
    expect(statsAfter.jsonAdFilterActive).toBe(false);
  });

  it('unregisters hooks and the endpoint on deactivate', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });

    await requestTimerPlugin.activate(ctx);
    await requestTimerPlugin.deactivate(ctx);

    expect(ctx.getRegisteredHooks().size).toBe(0);
    expect(ctx.getRegisteredEndpoints()).toHaveLength(0);
  });

  it('manifest permissions are sufficient for hooks, metric and endpoint', async () => {
    // Context built with ONLY the permissions declared in plugin.json — no
    // implicit ALL_PERMISSIONS escape hatch (hello-world doc-test pattern).
    const ctx = createTestContext({
      pluginId: PLUGIN_ID,
      permissions: manifest.permissions,
    });
    const endpoints = captureEndpoints(ctx);

    await expect(requestTimerPlugin.activate(ctx)).resolves.not.toThrow();
    expect(ctx.getRegisteredHooks().has('request:pre')).toBe(true);
    expect(ctx.getRegisteredHooks().has('response:post')).toBe(true);

    // recordMetric (metrics:write) must succeed inside the hook with only
    // the manifest permissions granted.
    const request = createMockRequest();
    await ctx.simulateHook('request:pre', request);
    const result = await ctx.simulateHook('response:post', toResponseContext(request));
    expect(result?.continue).toBe(true);

    const stats = await callStats(endpoints);
    expect(stats.count).toBe(1);
  });
});
