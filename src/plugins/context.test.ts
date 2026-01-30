/**
 * Plugin Context Security Tests
 *
 * Tests for SSRF protection, storage limits, and path traversal prevention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPluginContext, cleanupPluginResources } from './context.js';
import type { PluginPermission } from './types.js';

describe('Plugin Context Security', () => {
  const testPluginId = 'com.test.security-plugin';
  const allPermissions: PluginPermission[] = [
    'request:read',
    'request:modify',
    'response:read',
    'response:modify',
    'config:read',
    'config:write',
    'cache:read',
    'cache:write',
    'metrics:read',
    'metrics:write',
    'network:fetch',
    'storage:read',
    'storage:write',
    'api:register',
  ];

  beforeEach(() => {
    cleanupPluginResources(testPluginId);
  });

  afterEach(() => {
    cleanupPluginResources(testPluginId);
  });

  describe('SSRF Protection', () => {
    it('should block localhost URLs', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await expect(context.fetch('http://localhost/api')).rejects.toThrow(
        'Fetch blocked: Localhost URLs are not allowed'
      );

      await expect(context.fetch('http://127.0.0.1/api')).rejects.toThrow(
        'Fetch blocked: Localhost URLs are not allowed'
      );

      await expect(context.fetch('http://0.0.0.0/api')).rejects.toThrow(
        'Fetch blocked: Localhost URLs are not allowed'
      );

      await expect(context.fetch('http://test.localhost/api')).rejects.toThrow(
        'Fetch blocked: Localhost URLs are not allowed'
      );
    });

    it('should block private IP ranges', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // 10.0.0.0/8
      await expect(context.fetch('http://10.0.0.1/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (10.x.x.x) not allowed'
      );

      await expect(context.fetch('http://10.255.255.255/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (10.x.x.x) not allowed'
      );

      // 172.16.0.0/12
      await expect(context.fetch('http://172.16.0.1/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (172.16-31.x.x) not allowed'
      );

      await expect(context.fetch('http://172.31.255.255/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (172.16-31.x.x) not allowed'
      );

      // 192.168.0.0/16
      await expect(context.fetch('http://192.168.0.1/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (192.168.x.x) not allowed'
      );

      await expect(context.fetch('http://192.168.255.255/api')).rejects.toThrow(
        'Fetch blocked: Private IP range (192.168.x.x) not allowed'
      );
    });

    it('should block link-local addresses', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await expect(context.fetch('http://169.254.0.1/api')).rejects.toThrow(
        'Fetch blocked: Link-local IP range not allowed'
      );
    });

    it('should block cloud metadata endpoints', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // AWS/GCP metadata
      await expect(context.fetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        'Fetch blocked: Cloud metadata endpoints not allowed'
      );

      // Google metadata
      await expect(context.fetch('http://metadata.google.internal/computeMetadata')).rejects.toThrow(
        'Fetch blocked: Cloud metadata endpoints not allowed'
      );
    });

    it('should block internal domain patterns', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await expect(context.fetch('http://api.internal/data')).rejects.toThrow(
        'Fetch blocked: Internal domain names not allowed'
      );

      await expect(context.fetch('http://server.local/api')).rejects.toThrow(
        'Fetch blocked: Internal domain names not allowed'
      );

      await expect(context.fetch('http://intranet.corp/api')).rejects.toThrow(
        'Fetch blocked: Internal domain names not allowed'
      );

      await expect(context.fetch('http://printer.lan/api')).rejects.toThrow(
        'Fetch blocked: Internal domain names not allowed'
      );
    });

    it('should block non-http protocols', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await expect(context.fetch('file:///etc/passwd')).rejects.toThrow(
        "Fetch blocked: Protocol 'file:' not allowed"
      );

      await expect(context.fetch('ftp://example.com/file')).rejects.toThrow(
        "Fetch blocked: Protocol 'ftp:' not allowed"
      );
    });

    it('should block invalid URLs', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await expect(context.fetch('not-a-valid-url')).rejects.toThrow(
        'Fetch blocked: Invalid URL'
      );
    });

    it('should allow public URLs', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Note: This test will fail if network is unavailable,
      // but it verifies the URL passes validation
      // We expect it to either succeed or fail due to network, not SSRF block
      try {
        await context.fetch('https://example.com/api');
      } catch (err) {
        // Should NOT be an SSRF block error
        expect(String(err)).not.toContain('Fetch blocked');
      }
    });

    it('should allow public IPs that are not private', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // 8.8.8.8 is Google's public DNS
      try {
        await context.fetch('https://8.8.8.8/');
      } catch (err) {
        expect(String(err)).not.toContain('Fetch blocked');
      }
    });
  });

  describe('Storage Path Traversal Protection', () => {
    it('should sanitize storage keys with path traversal attempts', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Path traversal attempt - ../../../etc/passwd
      // Dots and slashes are replaced with underscores
      // .. -> __, / -> _, so ../../../etc/passwd -> _________etc_passwd
      await context.writeStorage('../../../etc/passwd', { data: 'test' });

      // Should be sanitized to safe key (9 underscores before 'etc')
      const result = await context.readStorage('_________etc_passwd');
      expect(result).toEqual({ data: 'test' });
    });

    it('should sanitize keys with slashes', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await context.writeStorage('path/to/key', { value: 123 });

      // Slashes should be replaced with underscores
      const result = await context.readStorage('path_to_key');
      expect(result).toEqual({ value: 123 });
    });

    it('should allow valid keys', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      await context.writeStorage('valid-key_123', { ok: true });
      const result = await context.readStorage('valid-key_123');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('Storage Rate Limiting', () => {
    it('should enforce maximum value size', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Create a large object (over 1MB)
      const largeData = { data: 'x'.repeat(1024 * 1024 + 1000) };

      await expect(context.writeStorage('large-key', largeData)).rejects.toThrow(
        'Storage value exceeds maximum size'
      );
    });

    it('should allow values under the size limit', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Create a small object
      const smallData = { data: 'small value' };

      await context.writeStorage('small-key', smallData);
      const result = await context.readStorage('small-key');
      expect(result).toEqual(smallData);
    });

    it('should enforce maximum key count', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Write 100 keys (the limit)
      for (let i = 0; i < 100; i++) {
        await context.writeStorage(`key-${i}`, { index: i });
      }

      // 101st key should fail
      await expect(context.writeStorage('key-100', { index: 100 })).rejects.toThrow(
        'Storage key limit reached'
      );
    });

    it('should allow updating existing keys without counting against limit', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Write 100 keys
      for (let i = 0; i < 100; i++) {
        await context.writeStorage(`key-${i}`, { index: i });
      }

      // Update existing key should work
      await context.writeStorage('key-0', { index: 0, updated: true });
      const result = await context.readStorage('key-0');
      expect(result).toEqual({ index: 0, updated: true });
    });

    it('should free up slot when key is deleted', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // Write 100 keys
      for (let i = 0; i < 100; i++) {
        await context.writeStorage(`key-${i}`, { index: i });
      }

      // Delete one key
      await context.deleteStorage('key-0');

      // Now we should be able to add a new key
      await context.writeStorage('new-key', { new: true });
      const result = await context.readStorage('new-key');
      expect(result).toEqual({ new: true });
    });
  });

  describe('Permission Enforcement', () => {
    it('should require network:fetch permission for fetch', async () => {
      const context = createPluginContext(testPluginId, ['storage:read']);

      await expect(context.fetch('https://example.com')).rejects.toThrow(
        "does not have permission 'network:fetch'"
      );
    });

    it('should require storage:read permission for readStorage', async () => {
      const context = createPluginContext(testPluginId, ['network:fetch']);

      await expect(context.readStorage('key')).rejects.toThrow(
        "does not have permission 'storage:read'"
      );
    });

    it('should require storage:write permission for writeStorage', async () => {
      const context = createPluginContext(testPluginId, ['storage:read']);

      await expect(context.writeStorage('key', { data: 'test' })).rejects.toThrow(
        "does not have permission 'storage:write'"
      );
    });
  });
});
