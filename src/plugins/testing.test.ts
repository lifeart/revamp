/**
 * Plugin Testing Utilities Tests
 *
 * Tests for the mock fetch, log collector, and other test utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestContext,
  createMockRequest,
  createMockResponse,
  createMockTransform,
  createMockFilter,
  createTestPlugin,
  runPluginLifecycle,
  assertContinues,
  assertStops,
} from './testing.js';
import type { HookResult } from './hooks.js';

describe('Testing Utilities', () => {
  describe('Mock Fetch', () => {
    it('should block network calls by default', async () => {
      const context = createTestContext();

      await expect(context.fetch('https://example.com/api')).rejects.toThrow(
        "Network call to 'https://example.com/api' blocked in test context"
      );
    });

    it('should allow custom mock fetch handler', async () => {
      const context = createTestContext({
        mockFetch: (url) => ({
          status: 200,
          body: { url, mocked: true },
        }),
      });

      const response = await context.fetch('https://api.example.com/data');
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({
        url: 'https://api.example.com/data',
        mocked: true,
      });
    });

    it('should support setMockFetch to change handler', async () => {
      const context = createTestContext();

      // Default should throw
      await expect(context.fetch('https://example.com')).rejects.toThrow();

      // Set a mock handler
      context.setMockFetch(() => ({
        status: 201,
        body: 'created',
      }));

      const response = await context.fetch('https://example.com');
      expect(response.status).toBe(201);
      expect(await response.text()).toBe('created');
    });

    it('should support async mock fetch handlers', async () => {
      const context = createTestContext({
        mockFetch: async (url) => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            status: 200,
            body: { async: true, url },
          };
        },
      });

      const response = await context.fetch('https://example.com/async');
      const json = await response.json() as { async: boolean; url: string };
      expect(json.async).toBe(true);
    });

    it('should support custom headers in mock response', async () => {
      const context = createTestContext({
        mockFetch: () => ({
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-custom-header': 'test-value',
          },
          body: '{}',
        }),
      });

      const response = await context.fetch('https://example.com');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('x-custom-header')).toBe('test-value');
    });

    it('should reset mock fetch on context reset', async () => {
      const context = createTestContext({
        mockFetch: () => ({ status: 200, body: 'original' }),
      });

      let response = await context.fetch('https://example.com');
      expect(await response.text()).toBe('original');

      context.setMockFetch(() => ({ status: 200, body: 'changed' }));
      response = await context.fetch('https://example.com');
      expect(await response.text()).toBe('changed');

      context.reset();
      response = await context.fetch('https://example.com');
      expect(await response.text()).toBe('original');
    });
  });

  describe('Log Collector', () => {
    it('should capture logs by default', () => {
      const context = createTestContext();

      context.log('info', 'Test message', { data: 123 });
      context.log('warn', 'Warning message');
      context.log('error', 'Error message');

      const logs = context.getLogs();
      expect(logs).toHaveLength(3);

      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('Test message');
      expect(logs[0].args).toEqual([{ data: 123 }]);

      expect(logs[1].level).toBe('warn');
      expect(logs[2].level).toBe('error');
    });

    it('should filter logs by level', () => {
      const context = createTestContext();

      context.log('debug', 'Debug 1');
      context.log('info', 'Info 1');
      context.log('warn', 'Warn 1');
      context.log('error', 'Error 1');
      context.log('info', 'Info 2');

      const infoLogs = context.getLogsByLevel('info');
      expect(infoLogs).toHaveLength(2);
      expect(infoLogs[0].message).toBe('Info 1');
      expect(infoLogs[1].message).toBe('Info 2');

      const errorLogs = context.getLogsByLevel('error');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].message).toBe('Error 1');
    });

    it('should clear logs', () => {
      const context = createTestContext();

      context.log('info', 'Message 1');
      context.log('info', 'Message 2');
      expect(context.getLogs()).toHaveLength(2);

      context.clearLogs();
      expect(context.getLogs()).toHaveLength(0);

      context.log('info', 'Message 3');
      expect(context.getLogs()).toHaveLength(1);
    });

    it('should reset logs on context reset', () => {
      const context = createTestContext();

      context.log('info', 'Before reset');
      expect(context.getLogs()).toHaveLength(1);

      context.reset();
      expect(context.getLogs()).toHaveLength(0);
    });

    it('should include timestamp in log entries', () => {
      const context = createTestContext();
      const before = Date.now();

      context.log('info', 'Timestamped message');

      const after = Date.now();
      const logs = context.getLogs();

      expect(logs[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(logs[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should not capture logs when captureLog is false', () => {
      // Note: When captureLog is false, logs go to console
      // We can't easily verify console output, but we can verify no capture
      const context = createTestContext({ captureLog: false });

      context.log('info', 'Not captured');

      // getLogs should still return empty array (it captures nothing)
      expect(context.getLogs()).toHaveLength(0);
    });
  });

  describe('Mock Request/Response', () => {
    it('should create valid request context', () => {
      const request = createMockRequest({
        url: 'https://api.example.com/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        clientIp: '192.168.1.50',
      });

      expect(request.url).toBe('https://api.example.com/users');
      expect(request.method).toBe('POST');
      expect(request.hostname).toBe('api.example.com');
      expect(request.clientIp).toBe('192.168.1.50');
      expect(request.isHttps).toBe(true);
      expect(request.requestId).toBeDefined();
    });

    it('should create valid response context', () => {
      const response = createMockResponse({
        url: 'https://api.example.com/data',
        statusCode: 201,
        responseHeaders: { 'x-request-id': '123' },
        body: Buffer.from('{"created": true}'),
        contentType: 'other',
      });

      expect(response.url).toBe('https://api.example.com/data');
      expect(response.statusCode).toBe(201);
      expect(response.contentType).toBe('other');
      expect(response.body.toString()).toBe('{"created": true}');
    });

    it('should create valid transform context', () => {
      const transform = createMockTransform({
        content: 'const x = 1;',
        type: 'js',
        url: 'https://example.com/script.js',
      });

      expect(transform.content).toBe('const x = 1;');
      expect(transform.type).toBe('js');
      expect(transform.url).toBe('https://example.com/script.js');
    });

    it('should create valid filter context', () => {
      const filter = createMockFilter({
        url: 'https://ads.example.com/tracker.js',
        hostname: 'ads.example.com',
      });

      expect(filter.url).toBe('https://ads.example.com/tracker.js');
      expect(filter.hostname).toBe('ads.example.com');
    });
  });

  describe('Test Plugin', () => {
    it('should create plugin with default manifest', () => {
      const plugin = createTestPlugin();

      expect(plugin.manifest.id).toBe('com.test.plugin');
      expect(plugin.manifest.version).toBe('1.0.0');
      expect(plugin.manifest.permissions).toBeDefined();
    });

    it('should create plugin with custom manifest', () => {
      const plugin = createTestPlugin({
        id: 'com.custom.plugin',
        name: 'Custom Plugin',
        hooks: ['request:pre'],
      });

      expect(plugin.manifest.id).toBe('com.custom.plugin');
      expect(plugin.manifest.name).toBe('Custom Plugin');
      expect(plugin.manifest.hooks).toContain('request:pre');
    });

    it('should create plugin with custom implementation', async () => {
      let initializeCalled = false;
      let activateCalled = false;

      const plugin = createTestPlugin({}, {
        async initialize() {
          initializeCalled = true;
        },
        async activate() {
          activateCalled = true;
        },
      });

      const context = createTestContext();
      await runPluginLifecycle(plugin, context);

      expect(initializeCalled).toBe(true);
      expect(activateCalled).toBe(true);
    });
  });

  describe('Hook Result Assertions', () => {
    it('should pass assertContinues for continue: true', () => {
      const result: HookResult<{ ok: boolean }> = { continue: true, value: { ok: true } };

      expect(() => assertContinues(result)).not.toThrow();
    });

    it('should fail assertContinues for continue: false', () => {
      const result: HookResult<{ ok: boolean }> = { continue: false, value: { ok: false } };

      expect(() => assertContinues(result)).toThrow('Hook stopped the chain');
    });

    it('should fail assertContinues for error result', () => {
      const result: HookResult<never> = { continue: false, error: new Error('Test error') };

      expect(() => assertContinues(result)).toThrow('Hook stopped with error: Test error');
    });

    it('should pass assertStops for continue: false', () => {
      const result: HookResult<{ blocked: boolean }> = { continue: false, value: { blocked: true } };

      expect(() => assertStops(result)).not.toThrow();
    });

    it('should fail assertStops for continue: true', () => {
      const result: HookResult<{ ok: boolean }> = { continue: true, value: { ok: true } };

      expect(() => assertStops(result)).toThrow('Hook continued unexpectedly');
    });
  });

  describe('Test Context Hook Simulation', () => {
    it('should register and simulate hooks', async () => {
      const context = createTestContext();

      context.registerHook('request:pre', async (req) => {
        return {
          continue: true,
          value: { modified: true, url: req.url },
        };
      });

      const request = createMockRequest({ url: 'https://example.com/test' });
      const result = await context.simulateHook('request:pre', request);

      expect(result).not.toBeNull();
      expect(result?.continue).toBe(true);
      if (result && 'value' in result) {
        expect(result.value).toEqual({
          modified: true,
          url: 'https://example.com/test',
        });
      }
    });

    it('should return null for unregistered hooks', async () => {
      const context = createTestContext();

      const result = await context.simulateHook('request:pre', createMockRequest());
      expect(result).toBeNull();
    });

    it('should track registered hooks', () => {
      const context = createTestContext();

      context.registerHook('request:pre', async () => ({ continue: true }), 100);
      context.registerHook('response:post', async () => ({ continue: true }), 50);

      const hooks = context.getRegisteredHooks();
      expect(hooks.size).toBe(2);
      expect(hooks.get('request:pre')?.priority).toBe(100);
      expect(hooks.get('response:post')?.priority).toBe(50);
    });
  });
});
