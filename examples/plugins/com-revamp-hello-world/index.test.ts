import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createTestContext, createMockResponse } from '../../../src/plugins/testing.js';
import type { HookResult } from '../../../src/plugins/hooks.js';
import type { PostResponseResult } from '../../../src/plugins/hooks.js';
import type { PluginPermission } from '../../../src/plugins/types.js';

import helloWorldPlugin from './index.js';

// Round 1 review fix: load permissions from the actual plugin.json so the
// "manifest is sufficient" doc-test below is locked to the real shipped
// manifest. Hard-coding the permission list here would silently desync from
// the JSON and let a future manifest tightening pass tests that should fail.
const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, 'plugin.json'), 'utf-8')
) as { permissions: PluginPermission[] };

describe('hello-world example plugin', () => {
  it('registers a response:post hook on activate', async () => {
    const ctx = createTestContext({ pluginId: 'com.revamp.hello-world' });

    await helloWorldPlugin.activate(ctx);

    const hooks = ctx.getRegisteredHooks();
    expect(hooks.has('response:post')).toBe(true);
  });

  it('adds the x-revamp-hello header with default value', async () => {
    const ctx = createTestContext({ pluginId: 'com.revamp.hello-world' });

    await helloWorldPlugin.activate(ctx);

    const response = createMockResponse({
      responseHeaders: { 'content-type': 'text/html' },
    });

    const result = (await ctx.simulateHook('response:post', response)) as
      | HookResult<PostResponseResult>
      | null;

    expect(result).not.toBeNull();
    expect(result!.continue).toBe(true);
    expect(result!.value?.headers?.['x-revamp-hello']).toBe('world');
    expect(result!.value?.headers?.['content-type']).toBe('text/html');
  });

  it('uses a custom header value from plugin config', async () => {
    const ctx = createTestContext({
      pluginId: 'com.revamp.hello-world',
      pluginConfig: { headerValue: 'greetings' },
    });

    await helloWorldPlugin.activate(ctx);

    const response = createMockResponse();
    const result = (await ctx.simulateHook('response:post', response)) as
      | HookResult<PostResponseResult>
      | null;

    expect(result?.value?.headers?.['x-revamp-hello']).toBe('greetings');
  });

  it('unregisters the hook on deactivate', async () => {
    const ctx = createTestContext({ pluginId: 'com.revamp.hello-world' });

    await helloWorldPlugin.activate(ctx);
    await helloWorldPlugin.deactivate(ctx);

    expect(ctx.getRegisteredHooks().has('response:post')).toBe(false);
  });

  // Round 1 review fix: the previous tests used `createTestContext()` with
  // its default ALL_PERMISSIONS list, so a missing permission in plugin.json
  // would silently pass. This doc-test builds the context with permissions
  // DERIVED from plugin.json so the manifest is locked-in as sufficient
  // for the plugin's hooks. Tightening permissions in plugin.json without
  // also tightening the runtime would break this test, surfacing the drift.
  it('manifest permissions are sufficient to register the hook', async () => {
    const ctx = createTestContext({
      pluginId: 'com.revamp.hello-world',
      permissions: manifest.permissions,
    });

    // Activate must succeed using ONLY the permissions declared in the
    // shipped manifest — no implicit ALL_PERMISSIONS escape hatch.
    await expect(helloWorldPlugin.activate(ctx)).resolves.not.toThrow();
    expect(ctx.getRegisteredHooks().has('response:post')).toBe(true);

    // And the registered hook still produces the expected output.
    const response = createMockResponse();
    const result = (await ctx.simulateHook('response:post', response)) as
      | HookResult<PostResponseResult>
      | null;
    expect(result?.value?.headers?.['x-revamp-hello']).toBe('world');
  });
});
