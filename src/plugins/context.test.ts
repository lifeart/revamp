/**
 * Plugin Context Security Tests
 *
 * Tests for SSRF protection, storage limits, and path traversal prevention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPluginContext,
  cleanupPluginResources,
  __ssrfTesting,
} from './context.js';
import { pluginRegistry } from './registry.js';
import type { PluginPermission, PluginManifest } from './types.js';
import type { LookupAddress } from 'node:dns';

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
        /Fetch blocked: (Localhost URLs|Loopback IP range)/
      );

      await expect(context.fetch('http://0.0.0.0/api')).rejects.toThrow(
        /Fetch blocked: (Localhost URLs|Loopback IP range)/
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
        /Fetch blocked: Link-local IP range/
      );
    });

    it('should block cloud metadata endpoints', async () => {
      const context = createPluginContext(testPluginId, allPermissions);

      // AWS/GCP metadata IP — caught by stricter link-local IP check before reaching the cloud-metadata heuristic
      await expect(context.fetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        /Fetch blocked: (Link-local IP range|Cloud metadata endpoints)/
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

  describe('Hook Registration Permission Enforcement (T15)', () => {
    it('should reject response:post registration when plugin has no permissions', () => {
      const context = createPluginContext(testPluginId, []);

      expect(() =>
        context.registerHook('response:post', () => Promise.resolve({ continue: true as const }))
      ).toThrow(
        `Plugin ${testPluginId} lacks permission response:modify required for hook response:post`
      );
    });

    it('should reject request:pre registration without request:modify', () => {
      const context = createPluginContext(testPluginId, ['response:modify']);

      expect(() =>
        context.registerHook('request:pre', () => Promise.resolve({ continue: true as const }))
      ).toThrow(
        `Plugin ${testPluginId} lacks permission request:modify required for hook request:pre`
      );
    });

    it('should reject config:resolution registration without config:read', () => {
      const context = createPluginContext(testPluginId, []);

      expect(() =>
        context.registerHook('config:resolution', () =>
          Promise.resolve({ continue: true as const })
        )
      ).toThrow(
        `Plugin ${testPluginId} lacks permission config:read required for hook config:resolution`
      );
    });

    it('should reject cache:get without cache:read', () => {
      const context = createPluginContext(testPluginId, ['cache:write']);

      expect(() =>
        context.registerHook('cache:get', () => Promise.resolve({ continue: true as const }))
      ).toThrow(
        `Plugin ${testPluginId} lacks permission cache:read required for hook cache:get`
      );
    });

    it('should reject metrics:record without metrics:write', () => {
      const context = createPluginContext(testPluginId, ['metrics:read']);

      expect(() =>
        context.registerHook('metrics:record', () => Promise.resolve())
      ).toThrow(
        `Plugin ${testPluginId} lacks permission metrics:write required for hook metrics:record`
      );
    });
  });
});

describe('Plugin Composition API', () => {
  const ACTIVE_ID = 'com.test.composition-active';
  const LOADED_ID = 'com.test.composition-loaded';
  const UNKNOWN_ID = 'com.test.composition-never-loaded';

  function manifestFor(id: string): PluginManifest {
    return {
      id,
      name: `Composition Test Plugin ${id}`,
      version: '1.0.0',
      description: 'Exercises getActivePlugins / isPluginActive',
      author: 'Revamp Tests',
      revampVersion: '1.0.0',
      main: 'index.js',
      permissions: [],
    };
  }

  beforeEach(() => {
    pluginRegistry.clear();
    pluginRegistry.register({ manifest: manifestFor(ACTIVE_ID) });
    pluginRegistry.updateState(ACTIVE_ID, 'active');
    pluginRegistry.register({ manifest: manifestFor(LOADED_ID) });
    // LOADED_ID stays in 'loaded' state — registered but not active.
  });

  afterEach(() => {
    pluginRegistry.clear();
  });

  it('getActivePlugins returns only active plugin ids', () => {
    // Zero permissions: composition introspection is intentionally ungated.
    const context = createPluginContext(ACTIVE_ID, []);

    const active = context.getActivePlugins();
    expect(active).toContain(ACTIVE_ID);
    expect(active).not.toContain(LOADED_ID);
    expect(active).not.toContain(UNKNOWN_ID);
  });

  it('isPluginActive distinguishes active, inactive and unloaded plugins', () => {
    const context = createPluginContext(ACTIVE_ID, []);

    expect(context.isPluginActive(ACTIVE_ID)).toBe(true);
    // Registered but not activated.
    expect(context.isPluginActive(LOADED_ID)).toBe(false);
    // Never registered at all.
    expect(context.isPluginActive(UNKNOWN_ID)).toBe(false);
  });

  it('reflects state transitions (deactivated plugin disappears)', () => {
    const context = createPluginContext(ACTIVE_ID, []);
    expect(context.isPluginActive(ACTIVE_ID)).toBe(true);

    pluginRegistry.updateState(ACTIVE_ID, 'deactivated');
    expect(context.isPluginActive(ACTIVE_ID)).toBe(false);
    expect(context.getActivePlugins()).not.toContain(ACTIVE_ID);

    pluginRegistry.updateState(LOADED_ID, 'active');
    expect(context.getActivePlugins()).toEqual([LOADED_ID]);
  });
});

describe('SSRF DNS rebinding (T39 P1-2)', () => {
  // Restore the real resolver after each test so we never leak the stub.
  afterEach(() => {
    __ssrfTesting.setResolver(null);
  });

  function stub(addresses: LookupAddress[]): void {
    __ssrfTesting.setResolver(() => Promise.resolve(addresses));
  }

  it('rejects when resolver returns 127.0.0.1', async () => {
    stub([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/Loopback IP range/);
  });

  it('rejects when resolver returns ::1', async () => {
    stub([{ address: '::1', family: 6 }]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/IPv6 loopback/);
  });

  it('rejects when resolver returns ::ffff:169.254.169.254 (IPv4-mapped link-local)', async () => {
    stub([{ address: '::ffff:169.254.169.254', family: 6 }]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/IPv4-mapped IPv6 -> Link-local/);
  });

  it('rejects when resolver returns fe80::1 (IPv6 link-local)', async () => {
    stub([{ address: 'fe80::1', family: 6 }]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/IPv6 link-local/);
  });

  it('rejects when resolver returns fc00::1 (IPv6 ULA)', async () => {
    stub([{ address: 'fc00::1', family: 6 }]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/IPv6 ULA/);
  });

  it('rejects DNS rebinding: pre-check returns public IP, post-check returns 127.0.0.1', async () => {
    // Simulate the classic DNS rebinding race: the resolver hands back a
    // public IP first (so the pre-check passes), then a private IP on a
    // subsequent lookup. With pinned lookup, the second call would either
    // be rejected by the pre-check (this test) or short-circuited by the
    // pinned dispatcher (covered by integration). Here we exercise the
    // rejection path: validation must trip on the second lookup.
    let callCount = 0;
    __ssrfTesting.setResolver(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{ address: '8.8.8.8', family: 4 }] as LookupAddress[]);
      }
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }] as LookupAddress[]);
    });

    // First call: passes (public IP).
    const safe = await __ssrfTesting.assertResolvedHostSafe('rebind.example');
    expect(safe).not.toBeNull();
    expect(safe![0].address).toBe('8.8.8.8');

    // Second call: would have been rebound to 127.0.0.1 — the validator
    // must reject. This proves the assertion catches rebinding even when
    // the dispatcher pin (the actual TOCTOU close) is bypassed.
    await expect(
      __ssrfTesting.assertResolvedHostSafe('rebind.example')
    ).rejects.toThrow(/Loopback IP range/);
  });

  it('returns the validated addresses for caller to pin into Undici dispatcher', async () => {
    // The pinning contract: assertResolvedHostSafe returns the list of safe
    // addresses, so fetch() can build a dispatcher that bypasses the
    // resolver entirely. This is what closes the TOCTOU rebinding window.
    stub([
      { address: '8.8.8.8', family: 4 },
      { address: '8.8.4.4', family: 4 },
    ]);
    const result = await __ssrfTesting.assertResolvedHostSafe('public.example');
    expect(result).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '8.8.4.4', family: 4 },
    ]);
  });

  it('returns null for literal IP hostnames (no DNS work needed)', async () => {
    // Literal IPs have already been classified by the URL-parser path;
    // there's no resolver call to pin, so we return null and let Undici
    // dial the literal directly.
    const result = await __ssrfTesting.assertResolvedHostSafe('1.1.1.1');
    expect(result).toBeNull();
  });

  it('rejects when resolver returns no addresses', async () => {
    stub([]);
    await expect(
      __ssrfTesting.assertResolvedHostSafe('empty.example')
    ).rejects.toThrow(/returned no addresses/);
  });
});
