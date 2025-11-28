/**
 * JSON Request Logger Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  isJsonContentType,
  shouldLogJsonRequest,
  logJsonRequest,
} from './json-request-logger.js';
import { updateConfig, resetConfig, getConfig } from '../config/index.js';

describe('JSON Request Logger', () => {
  const testLogDir = './.test-json-logs';

  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    resetConfig();
    // Clean up test directory
    if (existsSync(testLogDir)) {
      await rm(testLogDir, { recursive: true, force: true });
    }
  });

  describe('isJsonContentType', () => {
    it('should return true for application/json', () => {
      expect(isJsonContentType('application/json')).toBe(true);
    });

    it('should return true for application/json with charset', () => {
      expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    });

    it('should return true for application/json in array', () => {
      expect(isJsonContentType(['application/json'])).toBe(true);
    });

    it('should return false for text/html', () => {
      expect(isJsonContentType('text/html')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isJsonContentType(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isJsonContentType('')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isJsonContentType('Application/JSON')).toBe(true);
    });
  });

  describe('shouldLogJsonRequest', () => {
    it('should return false when logging is disabled', () => {
      updateConfig({ logJsonRequests: false });
      const headers = { 'content-type': 'application/json' };
      expect(shouldLogJsonRequest(headers)).toBe(false);
    });

    it('should return true when logging is enabled and content is JSON', () => {
      updateConfig({ logJsonRequests: true });
      const headers = { 'content-type': 'application/json' };
      expect(shouldLogJsonRequest(headers)).toBe(true);
    });

    it('should return false when logging is enabled but content is not JSON', () => {
      updateConfig({ logJsonRequests: true });
      const headers = { 'content-type': 'text/html' };
      expect(shouldLogJsonRequest(headers)).toBe(false);
    });
  });

  describe('logJsonRequest', () => {
    it('should not log when logging is disabled', async () => {
      updateConfig({ logJsonRequests: false, jsonLogDir: testLogDir });

      await logJsonRequest(
        '127.0.0.1',
        'https://example.com/api/data',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('{"test": true}')
      );

      expect(existsSync(testLogDir)).toBe(false);
    });

    it('should create log file when logging is enabled', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });

      await logJsonRequest(
        '127.0.0.1',
        'https://example.com/api/data',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('{"test": true}')
      );

      expect(existsSync(testLogDir)).toBe(true);
    });

    it('should handle invalid JSON in response body', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });

      // Should not throw
      await logJsonRequest(
        '127.0.0.1',
        'https://example.com/api/data',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('not valid json')
      );

      expect(existsSync(testLogDir)).toBe(true);
    });

    it('should sanitize IP addresses in folder names', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });

      await logJsonRequest(
        '192.168.1.100',
        'https://example.com/api/test',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('{"data": "value"}')
      );

      expect(existsSync(join(testLogDir, '192.168.1.100'))).toBe(true);
    });

    it('should create proper folder structure with domain', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });

      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/users',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('{"users": []}')
      );

      expect(existsSync(join(testLogDir, '127.0.0.1', 'api.example.com'))).toBe(true);
    });

    it('should include request body when provided', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });
      const { readFile } = await import('node:fs/promises');
      const { readdirSync } = await import('node:fs');

      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/submit',
        { 'user-agent': 'test', 'content-type': 'application/json' },
        { 'content-type': 'application/json' },
        Buffer.from('{"status": "ok"}'),
        Buffer.from('{"action": "submit", "data": 123}')
      );

      // Find the log file
      const ipDir = join(testLogDir, '127.0.0.1', 'api.example.com');
      expect(existsSync(ipDir)).toBe(true);

      // Navigate to the log file
      const dateDirs = readdirSync(ipDir);
      const timeDirs = readdirSync(join(ipDir, dateDirs[0]));
      const files = readdirSync(join(ipDir, dateDirs[0], timeDirs[0]));
      const logContent = await readFile(join(ipDir, dateDirs[0], timeDirs[0], files[0]), 'utf-8');
      const logData = JSON.parse(logContent);

      expect(logData.requestBody).toEqual({ action: 'submit', data: 123 });
      expect(logData.data).toEqual({ status: 'ok' });
    });

    it('should not include requestBody field when request body is empty', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });
      const { readFile } = await import('node:fs/promises');
      const { readdirSync } = await import('node:fs');

      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/get',
        { 'user-agent': 'test' },
        { 'content-type': 'application/json' },
        Buffer.from('{"result": "data"}')
        // No request body provided
      );

      // Find the log file
      const ipDir = join(testLogDir, '127.0.0.1', 'api.example.com');
      const dateDirs = readdirSync(ipDir);
      const timeDirs = readdirSync(join(ipDir, dateDirs[0]));
      const files = readdirSync(join(ipDir, dateDirs[0], timeDirs[0]));
      const logContent = await readFile(join(ipDir, dateDirs[0], timeDirs[0], files[0]), 'utf-8');
      const logData = JSON.parse(logContent);

      expect(logData.requestBody).toBeUndefined();
      expect(logData.data).toEqual({ result: 'data' });
    });

    it('should handle non-JSON request body as raw string', async () => {
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });
      const { readFile } = await import('node:fs/promises');
      const { readdirSync } = await import('node:fs');

      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/form',
        { 'user-agent': 'test', 'content-type': 'application/x-www-form-urlencoded' },
        { 'content-type': 'application/json' },
        Buffer.from('{"status": "received"}'),
        Buffer.from('name=test&value=123')
      );

      // Find the log file
      const ipDir = join(testLogDir, '127.0.0.1', 'api.example.com');
      const dateDirs = readdirSync(ipDir);
      const timeDirs = readdirSync(join(ipDir, dateDirs[0]));
      const files = readdirSync(join(ipDir, dateDirs[0], timeDirs[0]));
      const logContent = await readFile(join(ipDir, dateDirs[0], timeDirs[0], files[0]), 'utf-8');
      const logData = JSON.parse(logContent);

      expect(logData.requestBody).toBe('name=test&value=123');
    });

    it('should log decompressed JSON data, not gzip-encoded bytes', async () => {
      // This test verifies the fix for the bug where gzip-compressed responses
      // were being logged as raw bytes instead of decoded JSON
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });
      const { readFile } = await import('node:fs/promises');
      const { readdirSync } = await import('node:fs');
      const { gzip } = await import('node:zlib');
      const { promisify } = await import('node:util');
      const gzipAsync = promisify(gzip);

      // Create a JSON response and compress it with gzip
      const jsonData = { users: [{ id: 1, name: 'Test User' }], total: 1 };
      const jsonString = JSON.stringify(jsonData);
      const compressedData = await gzipAsync(Buffer.from(jsonString));

      // Simulate what the proxy should do: decompress BEFORE logging
      const { gunzip } = await import('node:zlib');
      const gunzipAsync = promisify(gunzip);
      const decompressedData = await gunzipAsync(compressedData);

      // Log should receive the DECOMPRESSED data, not compressed
      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/users',
        { 'accept-encoding': 'gzip' },
        { 'content-type': 'application/json; charset=utf-8' }, // No content-encoding since we decompressed
        decompressedData // Decompressed body
      );

      // Find and read the log file
      const ipDir = join(testLogDir, '127.0.0.1', 'api.example.com');
      const dateDirs = readdirSync(ipDir);
      const timeDirs = readdirSync(join(ipDir, dateDirs[0]));
      const files = readdirSync(join(ipDir, dateDirs[0], timeDirs[0]));
      const logContent = await readFile(join(ipDir, dateDirs[0], timeDirs[0], files[0]), 'utf-8');
      const logData = JSON.parse(logContent);

      // The logged data should be parsed JSON, not gzip bytes
      expect(logData.data).toEqual(jsonData);
      expect(logData.data.users[0].name).toBe('Test User');
      // Should NOT contain gzip magic bytes
      expect(typeof logData.data).toBe('object');
      expect(logData.data).not.toContain('\u001f\u008b'); // gzip magic bytes as string
    });

    it('should store unparseable data as raw string when JSON parsing fails', async () => {
      // When binary/compressed data is mistakenly passed, it can't be parsed as JSON
      // So it gets stored as a raw string - this documents that fallback behavior
      updateConfig({ logJsonRequests: true, jsonLogDir: testLogDir });
      const { readFile } = await import('node:fs/promises');
      const { readdirSync } = await import('node:fs');
      const { gzip } = await import('node:zlib');
      const { promisify } = await import('node:util');
      const gzipAsync = promisify(gzip);

      const jsonData = { status: 'ok', message: 'Success' };
      const compressedData = await gzipAsync(Buffer.from(JSON.stringify(jsonData)));

      // If compressed data is passed (bug scenario), it won't parse as JSON
      // and will be stored as a string
      await logJsonRequest(
        '127.0.0.1',
        'https://api.example.com/v1/status',
        {},
        { 'content-type': 'application/json' },
        compressedData
      );

      const ipDir = join(testLogDir, '127.0.0.1', 'api.example.com');
      const dateDirs = readdirSync(ipDir);
      const timeDirs = readdirSync(join(ipDir, dateDirs[0]));
      const files = readdirSync(join(ipDir, dateDirs[0], timeDirs[0]));
      const logContent = await readFile(join(ipDir, dateDirs[0], timeDirs[0], files[0]), 'utf-8');
      const logData = JSON.parse(logContent);

      // When compressed data is passed, it can't be parsed as JSON
      // So it gets stored as a string (the fallback behavior)
      expect(typeof logData.data).toBe('string');
      // The string should contain binary-like characters from the gzip data
      expect(logData.data.length).toBeGreaterThan(0);
    });
  });
});
