/**
 * SOCKS5 Plugin Hook Integration Tests (T12)
 *
 * Verifies that `request:pre` and `response:post` plugin hooks fire on the
 * SOCKS5 path the same way they do on the direct HTTP-proxy path. Prior to
 * T12 the SOCKS5 stack (`makeHttpsRequest` / `makeHttpRequest`) silently
 * bypassed both hooks; this test guards against the bug returning by
 * registering a real plugin and asserting body / header mutations are
 * observed end-to-end through the SOCKS5 helper.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { makeHttpRequest } from './http-client.js';
import { pluginRegistry } from '../plugins/registry.js';
import { hookExecutor } from '../plugins/hook-executor.js';
import type { RevampPlugin } from '../plugins/types.js';
import { resetConfig } from '../config/index.js';

const PLUGIN_ID = 'com.test.socks5-hook-plugin';

function buildTestPlugin(): RevampPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'SOCKS5 Hook Test Plugin',
      version: '1.0.0',
      description: 'Mutates request and response so SOCKS5 hook wiring is testable',
      author: 'Revamp Tests',
      revampVersion: '1.0.0',
      main: 'index.js',
      hooks: ['request:pre', 'response:post'],
      permissions: ['request:read', 'request:modify', 'response:read', 'response:modify'],
    },
  };
}

describe('SOCKS5 plugin hook integration (T12)', () => {
  let server: HttpServer;
  let port: number;

  beforeAll(async () => {
    server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      // Echo the marker request header back so request:pre mutations are
      // observable on the upstream side.
      const marker = req.headers['x-revamp-test-marker'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        path: req.url,
        marker: marker ?? null,
      }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetConfig();
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  afterEach(() => {
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  it('fires request:pre and response:post when SOCKS5 path makes an HTTP request', async () => {
    const observedRequest: { url: string; method: string; clientIp: string }[] = [];
    const observedResponse: { statusCode: number; bodyContains: string }[] = [];

    pluginRegistry.register(buildTestPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(PLUGIN_ID, 'request:pre', (ctx) => {
      observedRequest.push({ url: ctx.url, method: ctx.method, clientIp: ctx.clientIp });
      return Promise.resolve({
        continue: true as const,
        value: {
          headers: { 'x-revamp-test-marker': 'pre-hook-was-here' },
        },
      });
    });

    pluginRegistry.registerHook(PLUGIN_ID, 'response:post', (ctx) => {
      observedResponse.push({
        statusCode: ctx.statusCode,
        bodyContains: ctx.body.toString('utf-8'),
      });
      // Mutate response body — proves the SOCKS5 path observes post hook
      // output and propagates it back to its caller.
      const tagged = Buffer.from(ctx.body.toString('utf-8') + '<!--mutated-->');
      return Promise.resolve({
        continue: true as const,
        value: {
          body: tagged,
          headers: { 'x-revamp-mutated': 'yes' },
        },
      });
    });

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/hooks-fire',
      {},
      Buffer.alloc(0),
      '203.0.113.7'
    );

    expect(response.statusCode).toBe(200);

    // request:pre saw the SOCKS5 request
    expect(observedRequest).toHaveLength(1);
    expect(observedRequest[0].method).toBe('GET');
    expect(observedRequest[0].url).toBe(`http://127.0.0.1/hooks-fire`);
    expect(observedRequest[0].clientIp).toBe('203.0.113.7');

    // request:pre header mutation reached the upstream server
    const upstreamPayload = JSON.parse(
      response.body.toString('utf-8').replace('<!--mutated-->', '')
    ) as { marker: string | null };
    expect(upstreamPayload.marker).toBe('pre-hook-was-here');

    // response:post saw the upstream response and mutated it
    expect(observedResponse).toHaveLength(1);
    expect(observedResponse[0].statusCode).toBe(200);
    expect(response.body.toString('utf-8')).toContain('<!--mutated-->');
    expect(response.headers['x-revamp-mutated']).toBe('yes');
  });

  it('honours request:pre block decisions on the SOCKS5 path', async () => {
    let upstreamHits = 0;
    const blockingServer = createHttpServer((_req, res) => {
      upstreamHits++;
      res.writeHead(200);
      res.end('upstream-was-hit');
    });
    let blockingPort = 0;
    await new Promise<void>((resolve) => {
      blockingServer.listen(0, '127.0.0.1', () => {
        const addr = blockingServer.address();
        blockingPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    pluginRegistry.register(buildTestPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(PLUGIN_ID, 'request:pre', () => Promise.resolve({
      continue: true as const,
      value: {
        blocked: true,
        blockedResponse: {
          statusCode: 451,
          body: 'blocked-by-plugin',
          headers: { 'content-type': 'text/plain' },
        },
      },
    }));

    try {
      const response = await makeHttpRequest(
        'GET',
        '127.0.0.1',
        blockingPort,
        '/should-be-blocked',
        {},
        Buffer.alloc(0),
        '203.0.113.8'
      );

      expect(response.statusCode).toBe(451);
      expect(response.body.toString('utf-8')).toBe('blocked-by-plugin');
      expect(upstreamHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => blockingServer.close(() => resolve()));
    }
  });

  it('runs response:post hooks in priority order (highest first)', async () => {
    // Two plugins both register response:post; the higher-priority one
    // must observe the upstream body first, the lower-priority one then
    // observes the higher-priority one's mutation. This guards the
    // documented priority semantics — a regression here would silently
    // re-order multi-plugin pipelines without surfacing as a test failure
    // anywhere else (the existing single-plugin test can't catch it).
    //
    // P1-4 (T14, Batch D's territory) covers a related-but-different bug:
    // body chaining across hooks. We deliberately do NOT try to fix that
    // here — see the it.todo below.
    const HIGH_ID = 'com.test.priority-high';
    const LOW_ID = 'com.test.priority-low';

    pluginRegistry.register({
      manifest: {
        id: HIGH_ID,
        name: 'Priority High',
        version: '1.0.0',
        description: 'Higher priority response:post — runs first',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['response:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.register({
      manifest: {
        id: LOW_ID,
        name: 'Priority Low',
        version: '1.0.0',
        description: 'Lower priority response:post — runs second',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['response:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.updateState(HIGH_ID, 'active');
    pluginRegistry.updateState(LOW_ID, 'active');

    const callOrder: string[] = [];

    pluginRegistry.registerHook(
      HIGH_ID,
      'response:post',
      (ctx) => {
        callOrder.push(`${HIGH_ID}@${ctx.statusCode}`);
        return Promise.resolve({ continue: true as const });
      },
      100 // high priority
    );

    pluginRegistry.registerHook(
      LOW_ID,
      'response:post',
      (ctx) => {
        callOrder.push(`${LOW_ID}@${ctx.statusCode}`);
        return Promise.resolve({ continue: true as const });
      },
      1 // low priority
    );

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/priority',
      {},
      Buffer.alloc(0),
      '203.0.113.9'
    );

    expect(response.statusCode).toBe(200);
    expect(callOrder).toHaveLength(2);
    // Higher-priority plugin observed the response first.
    expect(callOrder[0]).toBe(`${HIGH_ID}@200`);
    expect(callOrder[1]).toBe(`${LOW_ID}@200`);
  });

  // T14 (Batch D): the hook executor now propagates response body edits
  // across chained `response:post` hooks so plugin B observes the body
  // plugin A produced. Without the fix, plugin B would silently see the
  // upstream body and any wrapping/decoration plugins would no-op when
  // composed.
  it('propagates response body edits across chained response:post hooks (T14, Batch D)', async () => {
    const PLUGIN_A = 'com.test.t14-plugin-a';
    const PLUGIN_B = 'com.test.t14-plugin-b';

    pluginRegistry.register({
      manifest: {
        id: PLUGIN_A,
        name: 'T14 Plugin A',
        version: '1.0.0',
        description: 'Higher priority — wraps body with <a> tag',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['response:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.register({
      manifest: {
        id: PLUGIN_B,
        name: 'T14 Plugin B',
        version: '1.0.0',
        description: 'Lower priority — observes plugin A\'s body, wraps with <b>',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['response:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.updateState(PLUGIN_A, 'active');
    pluginRegistry.updateState(PLUGIN_B, 'active');

    let pluginBObservedBody: string | null = null;

    pluginRegistry.registerHook(
      PLUGIN_A,
      'response:post',
      (ctx) => {
        const wrapped = Buffer.from(`A(${ctx.body.toString('utf-8')})`);
        return Promise.resolve({
          continue: true as const,
          value: { body: wrapped },
        });
      },
      100
    );

    pluginRegistry.registerHook(
      PLUGIN_B,
      'response:post',
      (ctx) => {
        pluginBObservedBody = ctx.body.toString('utf-8');
        const wrapped = Buffer.from(`B(${ctx.body.toString('utf-8')})`);
        return Promise.resolve({
          continue: true as const,
          value: { body: wrapped },
        });
      },
      1
    );

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/t14-chain',
      {},
      Buffer.alloc(0),
      '203.0.113.14'
    );

    expect(response.statusCode).toBe(200);
    // Plugin B must have seen plugin A's mutation (not the upstream body).
    expect(pluginBObservedBody).not.toBeNull();
    expect(pluginBObservedBody).toMatch(/^A\(/);
    // Final body reflects both plugins applied in order: B wraps A's wrap.
    expect(response.body.toString('utf-8')).toMatch(/^B\(A\(/);
  });

  // Round 1 review fix: T14's body propagation was only wired for
  // `response:post`. transform:pre and transform:post are documented chain
  // hooks too — without per-hook propagation, plugin B in a 2-plugin
  // transform pipeline silently sees the upstream content rather than
  // plugin A's edit. We exercise the executor directly here (rather than
  // routing through the SOCKS5 stack) because transform hooks fire from
  // `transformContent` inside `shared.ts`, and a unit-level chain test is
  // the cleanest seam for the propagation invariant. The integration is
  // already covered by transformer tests + the hook executor tests.
  it('propagates transform:pre content edits across chained hooks (Round 1 fix)', async () => {
    const PLUGIN_A = 'com.test.transform-pre-a';
    const PLUGIN_B = 'com.test.transform-pre-b';

    pluginRegistry.register({
      manifest: {
        id: PLUGIN_A,
        name: 'Transform Pre Plugin A',
        version: '1.0.0',
        description: 'Higher priority — wraps content with A()',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['transform:pre'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.register({
      manifest: {
        id: PLUGIN_B,
        name: 'Transform Pre Plugin B',
        version: '1.0.0',
        description: 'Lower priority — observes plugin A\'s content',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['transform:pre'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.updateState(PLUGIN_A, 'active');
    pluginRegistry.updateState(PLUGIN_B, 'active');

    let pluginBObservedContent: string | null = null;

    pluginRegistry.registerHook(
      PLUGIN_A,
      'transform:pre',
      (ctx) => {
        return Promise.resolve({
          continue: true as const,
          value: { content: `A(${ctx.content})` },
        });
      },
      100
    );

    pluginRegistry.registerHook(
      PLUGIN_B,
      'transform:pre',
      (ctx) => {
        pluginBObservedContent = ctx.content;
        return Promise.resolve({
          continue: true as const,
          value: { content: `B(${ctx.content})` },
        });
      },
      1
    );

    const { defaultConfig } = await import('../config/index.js');
    const result = await hookExecutor.executePreTransform({
      content: 'upstream',
      url: 'https://example.com/script.js',
      type: 'js',
      config: defaultConfig,
      profile: null,
    });

    // Plugin B must have seen plugin A's edit, not the upstream content.
    expect(pluginBObservedContent).toBe('A(upstream)');
    // The merged result reflects both plugins applied in order.
    expect(result.value.content).toBe('B(A(upstream))');
  });

  it('propagates transform:post content edits across chained hooks (Round 1 fix)', async () => {
    const PLUGIN_A = 'com.test.transform-post-a';
    const PLUGIN_B = 'com.test.transform-post-b';

    pluginRegistry.register({
      manifest: {
        id: PLUGIN_A,
        name: 'Transform Post Plugin A',
        version: '1.0.0',
        description: 'Higher priority — wraps with A()',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['transform:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.register({
      manifest: {
        id: PLUGIN_B,
        name: 'Transform Post Plugin B',
        version: '1.0.0',
        description: 'Lower priority — observes plugin A\'s content',
        author: 'Revamp Tests',
        revampVersion: '1.0.0',
        main: 'index.js',
        hooks: ['transform:post'],
        permissions: ['response:read', 'response:modify'],
      },
    });
    pluginRegistry.updateState(PLUGIN_A, 'active');
    pluginRegistry.updateState(PLUGIN_B, 'active');

    let pluginBObservedContent: string | null = null;

    pluginRegistry.registerHook(
      PLUGIN_A,
      'transform:post',
      (ctx) => {
        return Promise.resolve({
          continue: true as const,
          value: { content: `A(${ctx.content})` },
        });
      },
      100
    );

    pluginRegistry.registerHook(
      PLUGIN_B,
      'transform:post',
      (ctx) => {
        pluginBObservedContent = ctx.content;
        return Promise.resolve({
          continue: true as const,
          value: { content: `B(${ctx.content})` },
        });
      },
      1
    );

    const { defaultConfig } = await import('../config/index.js');
    const result = await hookExecutor.executePostTransform({
      content: 'transformed-output',
      url: 'https://example.com/script.js',
      type: 'js',
      config: defaultConfig,
      profile: null,
      transformed: 'transformed-output',
    });

    expect(pluginBObservedContent).toBe('A(transformed-output)');
    expect(result.value.content).toBe('B(A(transformed-output))');
  });

  it('skips hook invocation when no clientIp is supplied (back-compat)', async () => {
    let invocations = 0;
    pluginRegistry.register(buildTestPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(PLUGIN_ID, 'request:pre', () => {
      invocations++;
      return Promise.resolve({ continue: true as const });
    });

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/no-client-ip',
      {},
      Buffer.alloc(0)
      // intentionally no clientIp — direct unit-test callers shouldn't
      // suddenly start triggering plugin hooks they didn't ask for.
    );

    expect(response.statusCode).toBe(200);
    expect(invocations).toBe(0);
  });
});
