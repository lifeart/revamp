/**
 * HTTP Proxy Integration Tests
 *
 * Tests createHttpProxy with real proxy connections.
 * NO MOCKING - uses actual HTTP proxy server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  createServer as createHttpServer,
  request as httpRequest,
  IncomingMessage as HttpIncomingMessage,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Socket } from 'node:net';
import { createHttpProxy, proxyRequest } from './http-proxy.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { resetMetrics, getMetrics } from '../metrics/index.js';
import {
  resetCertRateLimits,
  clearCertCache,
  CertRateLimitError,
} from '../certs/index.js';
import { __testing as certTesting } from '../certs/__testing.js';

let targetServer: HttpServer;
let proxyServer: HttpServer;
let targetPort: number;
let proxyPort: number;

// Test target server handler
function createTargetHandler() {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Target Server Root');
      } else if (url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Test HTML</h1></body></html>');
      } else if (url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'JSON response' }));
      } else if (url === '/js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('const test = () => { return 42; };');
      } else if (url === '/css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body { display: flex; }');
      } else if (url === '/echo') {
        res.writeHead(200, {
          'Content-Type': req.headers['content-type'] || 'text/plain',
        });
        res.end(body);
      } else if (url === '/redirect') {
        res.writeHead(302, { Location: '/' });
        res.end();
      } else if (url === '/headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.headers));
      } else if (url === '/slow') {
        // Slow response
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Slow response');
        }, 100);
      } else if (url === '/large') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        // Large response for compression testing
        res.end('X'.repeat(10000));
      } else if (url === '/__revamp__/api/config') {
        // This should be handled by proxy, but included for completeness
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxied: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  };
}

// Helper to make proxy request
function makeProxyRequest(
  method: string,
  targetUrl: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const options = {
      hostname: '127.0.0.1',
      port: proxyPort,
      path: targetUrl,
      method,
      headers: {
        ...headers,
        Host: url.host,
      },
    };

    const req = httpRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Helper for direct request to proxy (for Revamp API)
function makeDirectRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: proxyPort,
      path,
      method,
      headers: {
        ...headers,
        Host: '127.0.0.1',
      },
    };

    const req = httpRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('HTTP Proxy Integration Tests', () => {
  beforeAll(async () => {
    // Create target server
    targetServer = createHttpServer(createTargetHandler());
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        const addr = targetServer.address();
        targetPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    // Create proxy server
    proxyServer = createHttpProxy(0, '127.0.0.1');
    await new Promise<void>((resolve) => setTimeout(resolve, 100)); // Wait for proxy to start
    const addr = proxyServer.address();
    proxyPort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  });

  beforeEach(() => {
    resetConfig();
    resetMetrics();
  });

  describe('createHttpProxy', () => {
    it('should create a proxy server', () => {
      expect(proxyServer).toBeDefined();
      expect(proxyPort).toBeGreaterThan(0);
    });

    it('should proxy GET requests', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('Target Server Root');
    });

    it('should proxy HTML content', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/html`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<html>');
    });

    it('should proxy JSON content', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/json`);
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
    });

    it('should proxy JavaScript content', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/js`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should proxy CSS content', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/css`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('display');
    });

    it('should proxy POST requests', async () => {
      const response = await makeProxyRequest(
        'POST',
        `http://127.0.0.1:${targetPort}/echo`,
        { 'Content-Type': 'text/plain' },
        'test body'
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('test body');
    });

    it('should handle redirect responses', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/redirect`);
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('should handle 404 responses', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/notfound`);
      expect(response.statusCode).toBe(404);
    });

    it('should not inject CORS headers by default (T9)', async () => {
      // Default posture: no domain profile opted in, so the proxy must not
      // emit cross-origin permission headers. Otherwise every proxied site
      // would be cross-origin readable by every other proxied site.
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/`, {
        Origin: 'http://example.com',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should handle large responses with compression', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/large`, {
        'Accept-Encoding': 'gzip',
      });
      expect(response.statusCode).toBe(200);
      // Response should be compressed or original
    });

    it('should record metrics', async () => {
      resetMetrics(); // Ensure clean slate
      await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/`);
      const metrics = getMetrics();
      expect(metrics.requests.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Revamp API via HTTP Proxy', () => {
    it('should handle /__revamp__/config endpoint through proxy', async () => {
      // Test by proxying to a URL that has the revamp path
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/__revamp__/config`);
      // The proxy intercepts this path before forwarding
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      // Response contains { success: true, config: { ... } }
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('config');
      expect(data.config).toHaveProperty('transformJs');
    });

    it('should handle /__revamp__/metrics/json endpoint through proxy', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/__revamp__/metrics/json`);
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toHaveProperty('requests');
    });

    it('should handle /__revamp__/metrics endpoint through proxy', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/__revamp__/metrics`);
      expect(response.statusCode).toBe(200);
      // This returns HTML dashboard
      expect(response.body).toContain('Revamp');
    });
  });

  describe('Domain Blocking', () => {
    it('should have ad domains configured', async () => {
      // Verify ad domains are configured by default
      const { getConfig } = await import('../config/index.js');
      const config = getConfig();
      expect(config.adDomains).toBeDefined();
      expect(config.adDomains.length).toBeGreaterThan(0);
    });

    it('should proxy normal domains', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/`);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('T25 — per-host metrics through unified pipeline', () => {
    it('records the request URL on the per-host entry after a normal proxy', async () => {
      resetMetrics();
      const targetUrl = `http://127.0.0.1:${targetPort}/html`;
      const response = await makeProxyRequest('GET', targetUrl);
      expect(response.statusCode).toBe(200);

      const metrics = getMetrics();
      const entry = metrics.hosts.find((h) => h.host === '127.0.0.1');
      expect(entry).toBeDefined();
      expect(entry!.lastUrls).toContain(targetUrl);
      // /html → text/html content type → recorded as html transform.
      expect(entry!.transformedHtml).toBeGreaterThan(0);
    });

    it('records blocked-by-tracking events per host', async () => {
      resetMetrics();
      updateConfig({ trackingUrls: ['json'], removeTracking: true });

      await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/json`, {
        Accept: 'application/json',
      });

      const metrics = getMetrics();
      const entry = metrics.hosts.find((h) => h.host === '127.0.0.1');
      expect(entry).toBeDefined();
      expect(entry!.blocked).toBe(1);
    });
  });

  describe('T20 — explanatory error pages', () => {
    it('returns 200 HTML for blocked URL navigation when client accepts text/html', async () => {
      // Add a path-match pattern to trackingUrls so the URL-blocker fires.
      updateConfig({ trackingUrls: ['json'], removeTracking: true });

      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/json`, {
        Accept: 'text/html,application/xhtml+xml',
      });

      expect(response.statusCode).toBe(200);
      const ct = response.headers['content-type'];
      expect(Array.isArray(ct) ? ct[0] : ct).toMatch(/text\/html/);
      expect(response.body).toContain('Blocked by Revamp');
      expect(response.body).toContain('127.0.0.1');
      expect(response.body).toContain('/__revamp__/admin/domains.html');
    });

    it('returns 204 (no content) for blocked URL when client does not accept HTML', async () => {
      updateConfig({ trackingUrls: ['json'], removeTracking: true });

      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/json`, {
        Accept: 'application/json',
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 502 HTML for upstream errors when client accepts text/html', async () => {
      // Point at a port that is definitely closed to trigger a connection error.
      const response = await makeProxyRequest('GET', 'http://127.0.0.1:1/', {
        Accept: 'text/html',
      });

      expect(response.statusCode).toBe(502);
      const ct = response.headers['content-type'];
      expect(Array.isArray(ct) ? ct[0] : ct).toMatch(/text\/html/);
      expect(response.body).toContain('Upstream error');
      expect(response.body).toContain('/__revamp__/admin/domains.html');
    });

    it('returns plain-text 502 for upstream errors when client does not accept HTML', async () => {
      const response = await makeProxyRequest('GET', 'http://127.0.0.1:1/', {
        Accept: 'application/json',
      });

      expect(response.statusCode).toBe(502);
      const ct = response.headers['content-type'];
      expect(Array.isArray(ct) ? ct[0] : ct).not.toMatch(/text\/html/);
    });
  });

  describe('User Agent Spoofing', () => {
    it('should spoof user agent when enabled', async () => {
      updateConfig({ spoofUserAgent: true });

      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/headers`, {
        'User-Agent': 'TestBrowser/1.0',
      });
      expect(response.statusCode).toBe(200);
      const headers = JSON.parse(response.body);
      // User agent should be spoofed to a modern browser
      expect(headers['user-agent']).toContain('Chrome');
    });

    it('should preserve user agent when disabled', async () => {
      updateConfig({ spoofUserAgent: false });

      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/headers`, {
        'User-Agent': 'TestBrowser/1.0',
      });
      expect(response.statusCode).toBe(200);
      const headers = JSON.parse(response.body);
      expect(headers['user-agent']).toBe('TestBrowser/1.0');
    });
  });

  describe('request body-size limit (P1-3)', () => {
    // `bufferRequestBody` used to concatenate every chunk until `end` with no
    // cap, so a 1 GB upload would OOM the iPad-class host. It now enforces a
    // config-driven `maxRequestBodyBytes` and translates to a 413.

    it('returns 413 when request body exceeds maxRequestBodyBytes', async () => {
      // Lower the limit to 1 MB so the test runs in a few hundred ms instead
      // of pushing 50 MB at every CI worker.
      updateConfig({ maxRequestBodyBytes: 1 * 1024 * 1024 });

      type Outcome =
        | { kind: 'response'; statusCode: number; body: string }
        | { kind: 'reset' };

      const outcome = await new Promise<Outcome>((resolve, reject) => {
        const targetUrl = `http://127.0.0.1:${targetPort}/echo`;
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: proxyPort,
            path: targetUrl,
            method: 'POST',
            headers: { Host: `127.0.0.1:${targetPort}`, 'content-type': 'application/octet-stream' },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              resolve({
                kind: 'response',
                statusCode: res.statusCode || 0,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
            res.on('error', reject);
          }
        );
        req.on('error', (err) => {
          // Hitting the cap mid-upload destroys the inbound stream so the
          // remaining bytes never land in memory; the client side observes
          // either a 413 already-written-and-closed response, or — if the
          // proxy destroyed the socket before the response could land —
          // EPIPE/ECONNRESET. Both prove the cap engaged. What we MUST NOT
          // see is a 200 (proxy accepted the oversized body).
          const code = (err as NodeJS.ErrnoException).code;
          if (
            code === 'ECONNRESET' ||
            code === 'EPIPE' ||
            err.message.includes('socket hang up')
          ) {
            resolve({ kind: 'reset' });
          } else {
            reject(err);
          }
        });

        // Push 1.5 MB through, well over the 1 MB cap.
        const chunk = Buffer.alloc(64 * 1024, 0x43);
        let written = 0;
        const target = 1.5 * 1024 * 1024;
        function pump(): void {
          while (written < target) {
            const ok = req.write(chunk);
            written += chunk.length;
            if (!ok) {
              req.once('drain', pump);
              return;
            }
          }
          req.end();
        }
        pump();
      });

      if (outcome.kind === 'response') {
        // Direct 413 from the proxy — this is the happy path when the cap
        // is hit before the request body fully drains.
        expect(outcome.statusCode).toBe(413);
      } else {
        // Cap engaged via stream destruction — also acceptable; the proof
        // is that the upstream `/echo` server never echoed back a 200 with
        // 1.5 MB of body. (Would have surfaced as kind === 'response',
        // statusCode === 200, body.length === 1.5MB.)
        expect(outcome.kind).toBe('reset');
      }
    }, 15_000);
  });

  describe('proxyRequest function', () => {
    it('should be exported', () => {
      expect(typeof proxyRequest).toBe('function');
    });
  });
});

describe('synthetic client-IP buckets isolate unknown CONNECTs (P1-1)', () => {
  // When `socket.remoteAddress` is undefined we used to collapse every
  // unknown client into a single shared 30/min cert-mint bucket. We now
  // generate a per-connection synthetic ID; two such concurrent connections
  // must NOT share a bucket.

  beforeEach(() => {
    resetConfig();
    resetCertRateLimits();
    clearCertCache();
  });

  afterEach(() => {
    resetCertRateLimits();
    clearCertCache();
  });

  it('two CONNECTs with no remoteAddress get two separate rate-limit buckets', async () => {
    const proxy = createHttpProxy(0, '127.0.0.1');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const addr = proxy.address();
    const connectProxyPort = typeof addr === 'object' && addr ? addr.port : 0;
    expect(connectProxyPort).toBeGreaterThan(0);

    try {
      // Drive two CONNECT events directly, simulating sockets whose
      // `remoteAddress` is undefined. We can't rely on a real TCP connection
      // because Node always populates remoteAddress for those — instead we
      // emit the `connect` event with hand-built sockets that have no
      // remoteAddress, which is exactly the scenario the bug protects
      // against.
      const before = new Set(certTesting.mintTimestampKeys());

      const fireConnect = (host: string): void => {
        const fakeReq = Object.create(HttpIncomingMessage.prototype) as IncomingMessage;
        fakeReq.url = `${host}:443`;
        fakeReq.headers = {};
        // Deliberately leave socket undefined so getClientIp() falls
        // through to '' — the exact bug condition.
        // @ts-expect-error force undefined for the test
        fakeReq.socket = undefined;

        const clientSocket = new Socket();
        // No-op writes/ends so the proxy's CONNECT handler doesn't blow up
        // on a missing socket pipe; cert mint happens synchronously before
        // any of this matters.
        clientSocket.write = () => true;
        clientSocket.end = () => clientSocket;

        proxy.emit('connect', fakeReq, clientSocket, Buffer.alloc(0));
      };

      // Both connect events fire synchronously — the cert-mint and
      // rate-limit-bucket registration happen synchronously inside
      // handleConnect (only the fake-HTTPS-server listen is async). We use
      // distinct hostnames so the cert-cache doesn't short-circuit the
      // second call (cache hits skip rate-limit registration).
      fireConnect('first.example.test');
      fireConnect('second.example.test');

      const after = certTesting.mintTimestampKeys();
      const synthetic = after.filter((k) => k.startsWith('__unknown_') && !before.has(k));

      // Both unknown clients should have produced their own synthetic
      // bucket key — never the empty string, never collapsed into one.
      expect(synthetic).toHaveLength(2);
      expect(new Set(synthetic).size).toBe(2);
      for (const k of synthetic) {
        expect(k).not.toBe('');
        expect(k).not.toBe('__unknown_');
      }
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 10_000);

  it('logs a warning when falling back to a synthetic bucket', async () => {
    const proxy = createHttpProxy(0, '127.0.0.1');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence in test */ });

    try {
      const fakeReq = Object.create(HttpIncomingMessage.prototype) as IncomingMessage;
      fakeReq.url = 'example.com:443';
      fakeReq.headers = {};
      // @ts-expect-error force undefined for the test
      fakeReq.socket = undefined;

      const clientSocket = new Socket();
      clientSocket.write = () => true;
      clientSocket.end = () => clientSocket;

      proxy.emit('connect', fakeReq, clientSocket, Buffer.alloc(0));

      const matched = warnSpy.mock.calls.some(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('no client IP — using synthetic bucket')
      );
      expect(matched).toBe(true);
    } finally {
      warnSpy.mockRestore();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});

describe('handleConnect closes gracefully on non-rate-limit cert errors (P1-2)', () => {
  // Previously `throw err` inside the synchronous CONNECT handler surfaced
  // as `uncaughtException`. We now log + record + close gracefully.

  beforeEach(() => {
    resetConfig();
    resetCertRateLimits();
    clearCertCache();
    resetMetrics();
  });

  afterEach(() => {
    resetCertRateLimits();
    clearCertCache();
  });

  it('sends 500 and does not throw uncaughtException when cert mint fails', async () => {
    const proxy = createHttpProxy(0, '127.0.0.1');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Inject a non-rate-limit cert-mint failure by stubbing
    // generateDomainCert via module mock. To stay close to the production
    // path without ESM-mock gymnastics, we override the cache layer to
    // throw on miss: register a listener that destroys the cache key right
    // before we trigger the connect, and stub the underlying RSA generator
    // to crash. Easiest path: spy on `randomUUID` (cheap) — actually,
    // simpler still: trigger cert generation with a hostname that breaks
    // the forge pipeline. We use the empty-string hostname, which forge
    // rejects with a non-CertRateLimitError.

    const uncaught: Error[] = [];
    const handler = (err: Error) => uncaught.push(err);
    process.on('uncaughtException', handler);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence in test */ });

    try {
      const fakeReq = Object.create(HttpIncomingMessage.prototype) as IncomingMessage;
      // Empty-host CONNECT: hostname is ''. forge happily mints a cert for
      // '' so we need a different injection. Use the testing hatch to
      // pre-emptively force the mint timestamp to a huge value so the next
      // call enters the rate-limit branch (NOT what we want for this test)
      // — instead we override generateDomainCert by importing the certs
      // module and replacing its export at runtime. Vitest's
      // `vi.doMock`/`vi.mock` are heavy; we use a direct property override
      // on the module namespace via the loader cache.
      //
      // Actually the cleanest, most-direct injection for the BUG path is:
      // mocking the `node-forge` keypair generator to throw. But that
      // breaks every other test in this file. So instead we rely on
      // node-forge throwing for an obviously-bad domain — control codes:
      const badHost = '\x00\x00\x00';
      fakeReq.url = `${badHost}:443`;
      fakeReq.headers = {};
      const fakeSocket = new Socket();
      Object.defineProperty(fakeSocket, 'remoteAddress', {
        value: '198.51.100.1',
        writable: false,
      });
      fakeReq.socket = fakeSocket;

      const writes: string[] = [];
      const clientSocket = new Socket();
      clientSocket.write = ((data: string | Uint8Array) => {
        writes.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8'));
        return true;
      });
      clientSocket.end = ((data?: string | Uint8Array) => {
        if (data) {
          writes.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8'));
        }
        return clientSocket;
      }) as Socket['end'];

      // node-forge for some inputs *does* succeed even with control bytes.
      // To make this test deterministic we install a one-shot
      // module-level override: monkey-patch the certs module's
      // generateDomainCert via the import binding. Vitest evaluates each
      // test file in isolation, so the override here cannot leak.
      const certsModule = await import('../certs/index.js');
      const originalGenerate = certsModule.generateDomainCert;
      const fakeError = new Error('synthetic non-rate-limit cert failure');
      // Override using Object.defineProperty since the export binding is
      // typically read-only — but esbuild-style live bindings make this
      // unreliable. Use a vi.spyOn-style replacement.
      const spy = vi.spyOn(certsModule, 'generateDomainCert').mockImplementation(() => {
        throw fakeError;
      });

      try {
        proxy.emit('connect', fakeReq, clientSocket, Buffer.alloc(0));
        // Give the handler a tick to log + write the 500.
        await new Promise<void>((resolve) => setImmediate(resolve));

        // Connection closed gracefully with a 500 — not via uncaughtException.
        const combined = writes.join('');
        expect(combined).toContain('500 Internal Server Error');
        expect(uncaught).toHaveLength(0);

        // We logged the error per "no silent error swallowing".
        const matched = errSpy.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].includes('[http-proxy] cert mint failed')
        );
        expect(matched).toBe(true);
      } finally {
        spy.mockRestore();
        // Quiet unused-binding warnings.
        void originalGenerate;
      }
    } finally {
      process.removeListener('uncaughtException', handler);
      errSpy.mockRestore();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  it('rate-limit cert errors still return 429 (regression guard)', async () => {
    const proxy = createHttpProxy(0, '127.0.0.1');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    try {
      const certsModule = await import('../certs/index.js');
      const spy = vi
        .spyOn(certsModule, 'generateDomainCert')
        .mockImplementation((_domain: string, clientIp?: string) => {
          throw new CertRateLimitError(clientIp ?? 'unknown');
        });

      try {
        const fakeReq = Object.create(HttpIncomingMessage.prototype) as IncomingMessage;
        fakeReq.url = 'example.com:443';
        fakeReq.headers = {};
        const fakeSocket = new Socket();
        Object.defineProperty(fakeSocket, 'remoteAddress', {
          value: '198.51.100.2',
          writable: false,
        });
        fakeReq.socket = fakeSocket;

        const writes: string[] = [];
        const clientSocket = new Socket();
        clientSocket.write = ((data: string | Uint8Array) => {
          writes.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8'));
          return true;
        });
        clientSocket.end = ((data?: string | Uint8Array) => {
          if (data) {
            writes.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8'));
          }
          return clientSocket;
        }) as Socket['end'];

        proxy.emit('connect', fakeReq, clientSocket, Buffer.alloc(0));
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(writes.join('')).toContain('429 Too Many Requests');
      } finally {
        spy.mockRestore();
      }
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});
