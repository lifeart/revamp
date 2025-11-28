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
  });
});
