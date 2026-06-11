/**
 * Full-stack end-to-end proof for the example plugins through the REAL
 * HTTP proxy (test-what-the-user-sees).
 *
 * Unlike loader-smoke.test.ts (which dispatches through the registry
 * directly), this file boots the production proxy server and a local JSON
 * upstream, then issues real proxied HTTP requests:
 *
 *   plugins.json → PluginLoader → createHttpProxy() →
 *   http.request(proxy, absolute-form URL) → upstream → processProxiedResponse
 *   → transform-pipeline 'other' gate → json-ad-filter transformer → client
 *
 * It proves the seam this suite exists to guard: JSON responses map to the
 * coarse 'other' content type, and the text pipeline must still dispatch
 * them to plugin transformers matching on rawContentType — while JSON that
 * no rule touches passes through BYTE-identical (no parse/stringify
 * round-trip that would corrupt >MAX_SAFE_INTEGER ids).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServer as createUpstreamServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { PluginLoader } from '../../src/plugins/loader.js';
import { pluginRegistry } from '../../src/plugins/internal.js';
import { createHttpProxy } from '../../src/proxy/http-proxy.js';
import { updateConfig, resetConfig } from '../../src/config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_PLUGINS_DIR = resolve(__dirname); // examples/plugins

// Deliberately odd formatting + an id above Number.MAX_SAFE_INTEGER: any
// JSON.parse → JSON.stringify round-trip would corrupt both.
const UNRELATED_BODY =
  '{\n  "id": 9007199254740993,\n  "items": [ { "type": "ad" } ],\n  "note":   "spacing matters"\n}';

let tmpRoot: string;
let loader: PluginLoader;
let upstreamServer: HttpServer;
let upstreamPort: number;
let proxyServer: ReturnType<typeof createHttpProxy>;
let proxyPort: number;

interface ProxiedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** Issue an absolute-form request through the real HTTP proxy. */
function requestViaProxy(targetUrl: string): Promise<ProxiedResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method: 'GET',
        headers: { Host: new URL(targetUrl).host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolvePromise({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'revamp-examples-proxy-e2e-'));

  // Scratch cache dir → the loader derives the data dir (and plugins.json
  // location) from it, so this never touches the developer's real data dir.
  updateConfig({
    cacheDir: join(tmpRoot, '.revamp-cache'),
    cacheEnabled: true,
    cacheTTL: 3600,
  });
  const dataDir = join(tmpRoot, '.revamp-data');
  mkdirSync(dataDir, { recursive: true });

  // Local JSON upstream the proxy will fetch from.
  upstreamServer = createUpstreamServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/api/feed') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          items: [
            { id: 1, type: 'post', title: 'Hello' },
            { id: 2, type: 'ad', title: 'Buy now', sponsor: 'MegaCorp' },
            { id: 3, type: 'post', title: 'World' },
            { id: 4, type: 'ad', title: 'Limited offer' },
          ],
          next: 'cursor-1',
        })
      );
    } else if (req.url === '/api/unrelated') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(UNRELATED_BODY);
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
    }
  });
  await new Promise<void>((resolvePromise) => {
    upstreamServer.listen(0, '127.0.0.1', () => {
      const addr = upstreamServer.address();
      upstreamPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolvePromise();
    });
  });

  // plugins.json written where the real server reads it, with a rule keyed
  // to the upstream's dynamic port.
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
                  urlPattern: `127.0.0.1:${upstreamPort}/api/feed`,
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

  // Same call sequence as server boot (src/plugins/index.ts + src/index.ts).
  loader = new PluginLoader();
  await loader.loadAllPlugins();
  await loader.activateAllPlugins();

  proxyServer = createHttpProxy(0, '127.0.0.1');
  await new Promise<void>((resolvePromise) => {
    proxyServer.once('listening', () => resolvePromise());
  });
  const addr = proxyServer.address();
  proxyPort = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await loader.shutdownAllPlugins();
  await new Promise<void>((resolvePromise) => proxyServer.close(() => resolvePromise()));
  await new Promise<void>((resolvePromise) => upstreamServer.close(() => resolvePromise()));
  resetConfig();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('example plugins through the real HTTP proxy (live e2e)', () => {
  it('boots all four example plugins to active', () => {
    for (const id of [
      'com.revamp.hello-world',
      'com.revamp.json-ad-filter',
      'com.revamp.request-timer',
      'com.revamp.tracking-param-stripper',
    ]) {
      const info = pluginRegistry.getPlugin(id);
      expect(info?.state, `plugin ${id} (error: ${info?.error ?? 'none'})`).toBe('active');
    }
  });

  it('strips ad-flagged items from a proxied JSON response, other fields survive', async () => {
    const response = await requestViaProxy(`http://127.0.0.1:${upstreamPort}/api/feed`);

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body.toString('utf-8')) as {
      items: Array<{ id: number; type: string; title: string }>;
      next: string;
    };
    // Ads (ids 2 and 4) are GONE…
    expect(parsed.items.map((item) => item.id)).toEqual([1, 3]);
    expect(response.body.toString('utf-8')).not.toContain('MegaCorp');
    // …while non-ad items and sibling fields survive.
    expect(parsed.items[0].title).toBe('Hello');
    expect(parsed.next).toBe('cursor-1');

    // The text pipeline was entered: output is UTF-8 and headers say so,
    // and the proxy re-computed Content-Length for the shrunken body.
    expect(response.headers['content-type']).toBe('application/json; charset=UTF-8');
    expect(Number(response.headers['content-length'])).toBe(response.body.length);

    // hello-world's response:post hook ran on the same live response.
    expect(response.headers['x-revamp-hello']).toBe('world');
  });

  it('serves the transformed body from cache on a repeat request', async () => {
    const url = `http://127.0.0.1:${upstreamPort}/api/feed`;
    await requestViaProxy(url);
    const second = await requestViaProxy(url);

    const parsed = JSON.parse(second.body.toString('utf-8')) as {
      items: Array<{ id: number }>;
    };
    expect(parsed.items.map((item) => item.id)).toEqual([1, 3]);
  });

  it('passes JSON that matches no rule through byte-identical (big-int id preserved)', async () => {
    const response = await requestViaProxy(`http://127.0.0.1:${upstreamPort}/api/unrelated`);

    expect(response.statusCode).toBe(200);
    // Byte-identical: unsafe integer id, odd spacing, everything.
    expect(response.body.equals(Buffer.from(UNRELATED_BODY, 'utf-8'))).toBe(true);
    // No charset rewrite for a header that never advertised one.
    expect(response.headers['content-type']).toBe('application/json');
  });
});
