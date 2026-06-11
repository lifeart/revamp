/**
 * Real-load smoke test for the example plugins.
 *
 * Unlike the per-plugin specs (which use the `createTestContext` harness),
 * this file drives the ACTUAL plugin runtime end-to-end, exactly like the
 * server does on boot:
 *
 *   plugins.json (in the real data dir location) → PluginLoader.loadAllPlugins()
 *   → activateAllPlugins() → real PluginContext / pluginRegistry / global
 *   transformer registry / hookExecutor / plugin endpoint registry.
 *
 * It then exercises real flows through the production dispatch paths:
 * - a JSON response through `dispatchTextTransform` (ads stripped, byte-
 *   identical big-int passthrough when no rule matches),
 * - a request through `hookExecutor.executePreRequest` (tracking params
 *   stripped AND the timer's shared-data stamp written, both via the real
 *   chain-merge semantics),
 * - the same request through `executePostResponse` and the timer's `stats`
 *   endpoint via the production `findPluginEndpoint` lookup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PluginLoader } from '../../src/plugins/loader.js';
import { pluginRegistry } from '../../src/plugins/internal.js';
import { hookExecutor } from '../../src/plugins/hook-executor.js';
import { findPluginEndpoint } from '../../src/plugins/context.js';
import {
  dispatchTextTransform,
  getRegisteredTransformerNames,
} from '../../src/transformers/registry.js';
import { updateConfig, resetConfig, getConfig } from '../../src/config/index.js';
import {
  getSharedPluginData,
  type RequestContext,
  type ResponseContext,
} from '../../src/plugins/hooks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_PLUGINS_DIR = resolve(__dirname); // examples/plugins

const PLUGIN_IDS = [
  'com.revamp.hello-world',
  'com.revamp.json-ad-filter',
  'com.revamp.request-timer',
  'com.revamp.tracking-param-stripper',
] as const;

let tmpRoot: string;
let loader: PluginLoader;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'revamp-examples-smoke-'));

  // The loader reads plugins.json from the data dir, which the server
  // derives as `<dirname(cacheDir)>/.revamp-data` (src/config/storage.ts).
  // Point cacheDir into the temp root so this test never touches the
  // developer's real data dir.
  updateConfig({ cacheDir: join(tmpRoot, '.revamp-cache') });
  const dataDir = join(tmpRoot, '.revamp-data');
  mkdirSync(dataDir, { recursive: true });

  // PluginsConfig shape from src/plugins/types.ts, written where the real
  // server reads it. All four example plugins are enabled — their directory
  // names follow the `<id with dots→dashes>` convention the loader uses to
  // locate plugin dirs.
  writeFileSync(
    join(dataDir, 'plugins.json'),
    JSON.stringify(
      {
        enabled: true,
        hotReload: false,
        pluginsDir: EXAMPLES_PLUGINS_DIR,
        plugins: {
          'com.revamp.hello-world': { enabled: true, config: {} },
          'com.revamp.json-ad-filter': {
            enabled: true,
            config: {
              rules: [
                {
                  urlPattern: 'news.example.com/api/feed',
                  path: 'items[*]',
                  when: { field: 'type', equals: 'ad' },
                  action: 'remove',
                },
              ],
            },
          },
          'com.revamp.request-timer': { enabled: true, config: {} },
          'com.revamp.tracking-param-stripper': { enabled: true, config: {} },
        },
      },
      null,
      2
    )
  );

  // Same call sequence as server boot (src/plugins/index.ts).
  loader = new PluginLoader();
  await loader.loadAllPlugins();
  await loader.activateAllPlugins();
});

afterAll(async () => {
  await loader.shutdownAllPlugins();
  resetConfig();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('example plugins through the real PluginLoader', () => {
  it('loads and activates all four example plugins', () => {
    for (const id of PLUGIN_IDS) {
      const info = pluginRegistry.getPlugin(id);
      expect(info, `plugin ${id} should be registered`).toBeDefined();
      expect(info!.state, `plugin ${id} should be active (got: ${info!.state}, error: ${info!.error ?? 'none'})`).toBe('active');
    }
  });

  it('registers the json-ad-filter transformer in the global registry', () => {
    expect(getRegisteredTransformerNames()).toContain('json-ad-filter');
  });

  it('strips ads from a JSON response via the real transformer dispatch', async () => {
    const feed = JSON.stringify({
      items: [
        { id: 1, type: 'post', title: 'Hello' },
        { id: 2, type: 'ad', title: 'Buy now' },
        { id: 3, type: 'post', title: 'World' },
      ],
    });

    const output = await dispatchTextTransform(feed, {
      url: 'https://news.example.com/api/feed',
      contentType: 'other', // JSON maps to the coarse 'other' type
      rawContentType: 'application/json; charset=utf-8',
      config: getConfig(),
      profile: null,
      clientIp: '127.0.0.1',
    });

    const parsed = JSON.parse(output) as { items: Array<{ id: number; type: string }> };
    expect(parsed.items.map((item) => item.id)).toEqual([1, 3]);
  });

  it('passes non-matching JSON through byte-identical (big-int preserved)', async () => {
    // URL doesn't match the configured rule's urlPattern → original string
    // must come back untouched, preserving the unsafe-integer id.
    const input = '{\n  "id": 9007199254740993,\n  "items": [ { "type": "post" } ]\n}';

    const output = await dispatchTextTransform(input, {
      url: 'https://other.example.com/api/unrelated',
      contentType: 'other',
      rawContentType: 'application/json',
      config: getConfig(),
      profile: null,
    });

    expect(output).toBe(input);
  });

  it('runs the real request:pre chain: tracking params stripped + timer stamp shared', async () => {
    const requestContext: RequestContext = {
      requestId: 'smoke-1',
      url: 'https://example.com/article?id=42&utm_source=mail&fbclid=abc',
      method: 'GET',
      headers: {},
      clientIp: '127.0.0.1',
      hostname: 'example.com',
      config: getConfig(),
      profile: null,
      isHttps: true,
      startTime: Date.now(),
      pluginData: new Map(),
    };

    const preResult = await hookExecutor.executePreRequest(requestContext);

    expect(preResult.errors).toEqual([]);
    expect(preResult.stopped).toBe(false);
    // tracking-param-stripper's rewritten URL survives the chain merge…
    expect(preResult.value.url).toBe('https://example.com/article?id=42');
    // …and is propagated into the request context for downstream consumers.
    expect(requestContext.url).toBe('https://example.com/article?id=42');

    // request-timer's stamp is readable through the canonical shared-data
    // helper (writer/reader naming convention seam).
    const start = getSharedPluginData<number>(
      requestContext.pluginData,
      'com.revamp.request-timer',
      'startTime'
    );
    expect(typeof start).toBe('number');

    // Same request through the response chain (shared pluginData Map, the
    // way buildResponseContext spreads the request context in production).
    const responseContext: ResponseContext = {
      ...requestContext,
      statusCode: 200,
      responseHeaders: { 'content-type': 'text/html' },
      body: Buffer.from('<html></html>'),
      contentType: 'html',
      originalSize: 13,
      duration: 5,
    };

    const postResult = await hookExecutor.executePostResponse(responseContext);
    expect(postResult.errors).toEqual([]);
    expect(postResult.stopped).toBe(false);
    // hello-world's response:post hook stamped its header via the real
    // chain-merge (proves the renamed plugin actually runs, not just loads).
    expect(postResult.value.headers?.['x-revamp-hello']).toBe('world');

    // And the timer's stats endpoint — looked up exactly like the proxy's
    // API router does (findPluginEndpoint in src/plugins/context.ts).
    const endpoint = findPluginEndpoint('/plugins/com.revamp.request-timer/stats');
    expect(endpoint).not.toBeNull();

    const statsResponse = await endpoint!.handler({
      method: 'GET',
      path: 'stats',
      query: {},
      body: '',
      headers: {},
    });
    expect(statsResponse.statusCode).toBe(200);

    const stats = JSON.parse(statsResponse.body) as {
      count: number;
      avgMs: number;
      maxMs: number;
      activePlugins: string[];
      jsonAdFilterActive: boolean;
    };
    expect(stats.count).toBe(1);
    expect(stats.avgMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxMs).toBeGreaterThanOrEqual(stats.avgMs);
    // Composition APIs against the REAL registry.
    for (const id of PLUGIN_IDS) {
      expect(stats.activePlugins).toContain(id);
    }
    expect(stats.jsonAdFilterActive).toBe(true);
  });
});
