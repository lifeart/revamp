/**
 * Plugin `config:resolution` Hook Integration Tests (T13)
 *
 * Verifies that the proxy hot path (HTTP and SOCKS5) actually invokes the
 * `config:resolution` hook chain so plugin-supplied overrides reach the
 * effective configuration the request ultimately runs against.
 *
 * Prior to T13 the hot path read the synchronous `getEffectiveConfig`, which
 * never triggered `config:resolution`; the documented hook was dead. These
 * tests register a real plugin that flips a config flag via the hook and
 * asserts the request observes the flip — without reaching back into private
 * helpers.
 *
 * Round 1 review fix: in addition to asserting the hook saw the override,
 * we now also assert the OUTGOING upstream request actually reflects the
 * override (the spoofed User-Agent header). The previous test let a
 * regression slip through where `makeHttpsRequest` / `makeHttpRequest`
 * read `spoofUserAgent` from the global config BEFORE running hooks, so
 * the per-domain / plugin override never reached the wire.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { makeHttpRequest } from './http-client.js';
import { createHttpProxy } from './http-proxy.js';
import { pluginRegistry } from '../plugins/registry.js';
import { hookExecutor } from '../plugins/hook-executor.js';
import type { RevampPlugin } from '../plugins/types.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { SPOOFED_USER_AGENT } from './shared.js';

const PLUGIN_ID = 'com.test.config-resolution-plugin';
const ORIGINAL_UA = 'OriginalClientUA/1.0';

function buildPlugin(): RevampPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'config:resolution Test Plugin',
      version: '1.0.0',
      description: 'Mutates effective config via config:resolution',
      author: 'Revamp Tests',
      revampVersion: '1.0.0',
      main: 'index.js',
      hooks: ['config:resolution', 'request:pre'],
      permissions: ['config:read', 'request:read', 'request:modify'],
    },
  };
}

describe('config:resolution hook wiring (T13)', () => {
  let server: HttpServer;
  let port: number;
  // Capture the user-agent the upstream actually saw on the most recent
  // request. The test asserts against this so we observe the wire, not the
  // hook context (which is the bug the original T13 test missed).
  let upstreamSawUserAgent: string | undefined;

  beforeAll(async () => {
    server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      const ua = req.headers['user-agent'] as string | string[] | undefined;
      upstreamSawUserAgent = Array.isArray(ua) ? ua[0] : ua;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('upstream');
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
    upstreamSawUserAgent = undefined;
  });

  afterEach(() => {
    pluginRegistry.clear();
    hookExecutor.resetStats();
  });

  it('plugin override via config:resolution reaches the hot path on SOCKS5', async () => {
    // Baseline: spoofUserAgent=true. We flip it to false via the hook and
    // confirm the request:pre context carries the override; this is the
    // observable effect of the hook actually running on the hot path.
    updateConfig({ spoofUserAgent: true });

    pluginRegistry.register(buildPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(
      PLUGIN_ID,
      'config:resolution',
      () => Promise.resolve({
        continue: true as const,
        value: {
          overrides: { spoofUserAgent: false },
        },
      })
    );

    let observedSpoof: boolean | undefined;
    pluginRegistry.registerHook(
      PLUGIN_ID,
      'request:pre',
      (ctx) => {
        observedSpoof = ctx.config.spoofUserAgent;
        return Promise.resolve({ continue: true as const });
      }
    );

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/t13',
      { 'user-agent': ORIGINAL_UA },
      Buffer.alloc(0),
      '203.0.113.13'
    );

    expect(response.statusCode).toBe(200);
    // request:pre observed the plugin-overridden config — proves the hook
    // ran and its overrides cascaded into the effective config.
    expect(observedSpoof).toBe(false);
    // Round 1 review fix: assert the wire reflects the override. Plugin
    // disabled spoofUserAgent → upstream must see the original UA, not the
    // spoofed one.
    expect(upstreamSawUserAgent).toBe(ORIGINAL_UA);
  });

  it('plugin override via config:resolution causes the spoofed UA to reach the wire on SOCKS5', async () => {
    // Inverted variant: baseline spoofUserAgent=false (so without the hook
    // the upstream sees the original UA), the plugin flips it to true via
    // config:resolution, and we assert the upstream now sees the spoofed UA.
    // This catches the specific regression where `makeHttpRequest` read the
    // global config BEFORE hooks fired.
    updateConfig({ spoofUserAgent: false });

    pluginRegistry.register(buildPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(
      PLUGIN_ID,
      'config:resolution',
      () => Promise.resolve({
        continue: true as const,
        value: {
          overrides: { spoofUserAgent: true },
        },
      })
    );

    const response = await makeHttpRequest(
      'GET',
      '127.0.0.1',
      port,
      '/t13-spoof',
      { 'user-agent': ORIGINAL_UA },
      Buffer.alloc(0),
      '203.0.113.14'
    );

    expect(response.statusCode).toBe(200);
    expect(upstreamSawUserAgent).toBe(SPOOFED_USER_AGENT);
  });

  // Round 1 review fix: HTTP-proxy variant. The SOCKS5 path goes through
  // `makeHttp(s)Request`, while the direct HTTP-proxy path goes through
  // `proxyRequest` → `prepareRequest` (which builds its own request context
  // via `getEffectiveConfigForRequestAsync`). The same plugin must observe
  // overrides on both code paths so a fix in one doesn't silently miss the
  // other.
  it('plugin override via config:resolution reaches the hot path on the HTTP proxy', async () => {
    updateConfig({ spoofUserAgent: false });

    pluginRegistry.register(buildPlugin());
    pluginRegistry.updateState(PLUGIN_ID, 'active');

    pluginRegistry.registerHook(
      PLUGIN_ID,
      'config:resolution',
      () => Promise.resolve({
        continue: true as const,
        value: {
          overrides: { spoofUserAgent: true },
        },
      })
    );

    let observedSpoof: boolean | undefined;
    pluginRegistry.registerHook(
      PLUGIN_ID,
      'request:pre',
      (ctx) => {
        observedSpoof = ctx.config.spoofUserAgent;
        return Promise.resolve({ continue: true as const });
      }
    );

    const proxyServer = createHttpProxy(0, '127.0.0.1');
    // createHttpProxy logs synchronously inside listen() — wait briefly so
    // listen() actually fires before we make a request.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const addr = proxyServer.address();
    const proxyPort = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const response = await new Promise<{
        statusCode: number;
      }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: proxyPort,
            path: `http://127.0.0.1:${port}/t13-http-proxy`,
            method: 'GET',
            headers: {
              host: `127.0.0.1:${port}`,
              'user-agent': ORIGINAL_UA,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode || 0 })
            );
            res.on('error', reject);
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(200);
      // request:pre on the HTTP proxy observed the plugin-overridden config.
      expect(observedSpoof).toBe(true);
      // Outgoing UA actually reflects the override on the wire — this is
      // the assertion the original T13 test missed.
      expect(upstreamSawUserAgent).toBe(SPOOFED_USER_AGENT);
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });
});
