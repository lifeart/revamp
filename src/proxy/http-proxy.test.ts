/**
 * HTTP Proxy Integration Tests
 *
 * Tests createHttpProxy with real proxy connections.
 * NO MOCKING - uses actual HTTP proxy server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHttpProxy, proxyRequest } from './http-proxy.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { resetMetrics, getMetrics } from '../metrics/index.js';

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

    it('should add CORS headers', async () => {
      const response = await makeProxyRequest('GET', `http://127.0.0.1:${targetPort}/`, {
        Origin: 'http://example.com',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
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

  describe('proxyRequest function', () => {
    it('should be exported', () => {
      expect(typeof proxyRequest).toBe('function');
    });
  });
});
