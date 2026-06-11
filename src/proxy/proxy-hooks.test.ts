/**
 * Proxy Hook Helper Tests
 *
 * Covers the hook-failure observability seam: when a plugin hook throws or
 * times out, the chain continues (fail-safe) but `applyPreRequestHooks` /
 * `applyPostResponseHooks` must surface a structured warning per failed
 * plugin — and the per-request `pluginData` Map must flow from the
 * `request:pre` chain into the `response:post` chain of the same request.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  buildRequestContext,
  buildResponseContext,
  applyPreRequestHooks,
  applyPostResponseHooks,
  newRequestId,
} from './proxy-hooks.js';
import { pluginRegistry } from '../plugins/registry.js';
import { hookExecutor } from '../plugins/hook-executor.js';
import {
  setSharedPluginData,
  getSharedPluginData,
  type RequestContext,
  type ResponseContext,
} from '../plugins/hooks.js';
import { defaultConfig } from '../config/index.js';

function registerPlugin(id: string): void {
  pluginRegistry.register({
    manifest: {
      id,
      name: `Proxy Hook Test Plugin ${id}`,
      version: '1.0.0',
      description: 'Exercises proxy-hooks failure logging and pluginData flow',
      author: 'Revamp Tests',
      revampVersion: '1.0.0',
      main: 'index.js',
      hooks: ['request:pre', 'response:post'],
      permissions: ['request:read', 'request:modify', 'response:read', 'response:modify'],
    },
  });
  pluginRegistry.updateState(id, 'active');
}

function makeRequestContext(): RequestContext {
  return buildRequestContext({
    url: 'https://example.com/page',
    method: 'GET',
    headers: { host: 'example.com' },
    clientIp: '192.168.1.10',
    hostname: 'example.com',
    config: { ...defaultConfig },
    profile: null,
    isHttps: true,
    requestId: newRequestId(),
    startTime: Date.now(),
  });
}

describe('proxy-hooks plugin failure logging', () => {
  let warnSpy: MockInstance<(...args: unknown[]) => void>;
  let errorSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    pluginRegistry.clear();
    hookExecutor.resetStats();
    hookExecutor.setTimeout(5000);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence in test */ });
    // The executor itself logs the raw error; silence it so test output
    // stays readable.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence in test */ });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  it('logs a structured warning per failed plugin on request:pre without changing flow', async () => {
    const FAILING = 'com.test.proxyhooks-failing';
    const HEALTHY = 'com.test.proxyhooks-healthy';
    registerPlugin(FAILING);
    registerPlugin(HEALTHY);

    pluginRegistry.registerHook(
      FAILING,
      'request:pre',
      () => Promise.reject(new Error('boom in request:pre')),
      100
    );
    pluginRegistry.registerHook(
      HEALTHY,
      'request:pre',
      () =>
        Promise.resolve({
          continue: true,
          value: { headers: { 'x-healthy': '1' } },
        }),
      0
    );

    const context = makeRequestContext();
    const outcome = await applyPreRequestHooks(context);

    // Control flow unchanged: not blocked, healthy plugin's edit applied.
    expect(outcome.blocked).toBe(false);
    expect(outcome.url).toBe('https://example.com/page');
    expect(outcome.headers['x-healthy']).toBe('1');

    // Failure surfaced on the chain result…
    expect(outcome.chainResult?.errors).toHaveLength(1);
    expect(outcome.chainResult?.errors[0].pluginId).toBe(FAILING);
    expect(outcome.chainResult?.errors[0].hookName).toBe('request:pre');
    expect(outcome.chainResult?.errors[0].timedOut).toBe(false);

    // …and as exactly one structured warning naming plugin + hook.
    const failureWarnings = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('plugin hook failed')
    );
    expect(failureWarnings).toHaveLength(1);
    const [format, pluginArg, hookArg] = failureWarnings[0];
    expect(format).toContain('plugin=%s');
    expect(format).toContain('hook=%s');
    expect(pluginArg).toContain(FAILING);
    expect(hookArg).toBe('request:pre');
  });

  it('logs a structured warning on the response:post path', async () => {
    const FAILING = 'com.test.proxyhooks-response-fail';
    registerPlugin(FAILING);

    pluginRegistry.registerHook(
      FAILING,
      'response:post',
      () => Promise.reject(new Error('boom in response:post')),
      0
    );

    const requestContext = makeRequestContext();
    const responseContext: ResponseContext = buildResponseContext({
      requestContext,
      statusCode: 200,
      responseHeaders: { 'content-type': 'text/html' },
      body: Buffer.from('<html></html>'),
      contentType: 'html',
      originalSize: 13,
    });

    const outcome = await applyPostResponseHooks(responseContext);

    // Control flow unchanged: body/status pass through.
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.toString()).toBe('<html></html>');
    expect(outcome.chainResult?.errors).toHaveLength(1);
    expect(outcome.chainResult?.errors[0].hookName).toBe('response:post');

    const failureWarnings = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('plugin hook failed')
    );
    expect(failureWarnings).toHaveLength(1);
    expect(failureWarnings[0][1]).toContain(FAILING);
    expect(failureWarnings[0][2]).toBe('response:post');
  });

  it('logs nothing when every hook succeeds', async () => {
    const HEALTHY = 'com.test.proxyhooks-all-good';
    registerPlugin(HEALTHY);

    pluginRegistry.registerHook(
      HEALTHY,
      'request:pre',
      () => Promise.resolve({ continue: true }),
      0
    );

    const outcome = await applyPreRequestHooks(makeRequestContext());

    expect(outcome.chainResult?.errors).toEqual([]);
    const failureWarnings = warnSpy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('plugin hook failed')
    );
    expect(failureWarnings).toHaveLength(0);
  });
});

describe('proxy-hooks shared per-request pluginData flow', () => {
  beforeEach(() => {
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  afterEach(() => {
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  it('carries data written in request:pre into response:post of the same request', async () => {
    const WRITER = 'com.test.proxyhooks-writer';
    const READER = 'com.test.proxyhooks-reader';
    registerPlugin(WRITER);
    registerPlugin(READER);

    pluginRegistry.registerHook(
      WRITER,
      'request:pre',
      (ctx: RequestContext) => {
        setSharedPluginData(ctx.pluginData, WRITER, 'trace', 'trace-42');
        return Promise.resolve({ continue: true });
      },
      0
    );

    let observedInResponse: string | undefined;
    pluginRegistry.registerHook(
      READER,
      'response:post',
      (ctx: ResponseContext) => {
        observedInResponse = getSharedPluginData<string>(
          ctx.pluginData,
          WRITER,
          'trace'
        );
        return Promise.resolve({ continue: true });
      },
      0
    );

    const requestContext = makeRequestContext();
    await applyPreRequestHooks(requestContext);

    // Same request: buildResponseContext spreads the request context, so the
    // pluginData Map instance carries over.
    const responseContext = buildResponseContext({
      requestContext,
      statusCode: 200,
      responseHeaders: {},
      body: Buffer.from('ok'),
      contentType: 'other',
      originalSize: 2,
    });
    await applyPostResponseHooks(responseContext);

    expect(observedInResponse).toBe('trace-42');

    // A NEW request gets a fresh Map — no cross-request persistence.
    const nextRequest = makeRequestContext();
    expect(
      getSharedPluginData(nextRequest.pluginData, WRITER, 'trace')
    ).toBeUndefined();
  });
});
