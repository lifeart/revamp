import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createTestContext,
  createMockRequest,
  type TestPluginContext,
} from '../../../src/plugins/testing.js';
import type { HookResult, PreRequestResult } from '../../../src/plugins/hooks.js';
import type { PluginPermission } from '../../../src/plugins/types.js';

import trackingParamStripperPlugin from './index.js';

const PLUGIN_ID = 'com.revamp.tracking-param-stripper';

// Load permissions from the actual plugin.json so the "manifest is
// sufficient" doc-test below is locked to the real shipped manifest
// (hello-world pattern).
const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, 'plugin.json'), 'utf-8')
) as { permissions: PluginPermission[] };

async function runHook(
  ctx: TestPluginContext,
  url: string
): Promise<HookResult<PreRequestResult> | null> {
  const request = createMockRequest({ url });
  return (await ctx.simulateHook('request:pre', request)) as
    | HookResult<PreRequestResult>
    | null;
}

describe('tracking-param-stripper example plugin', () => {
  it('registers a request:pre hook on activate', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });

    await trackingParamStripperPlugin.activate(ctx);

    expect(ctx.getRegisteredHooks().has('request:pre')).toBe(true);
  });

  it('strips default tracking params and keeps everything else', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(
      ctx,
      'https://example.com/article?id=42&utm_source=mail&utm_medium=email&fbclid=abc123&gclid=xyz&ref=homepage'
    );

    expect(result?.continue).toBe(true);
    expect(result?.value?.url).toBe('https://example.com/article?id=42&ref=homepage');
  });

  it('returns no value when no listed param is present (URL untouched)', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(ctx, 'https://example.com/search?q=hello&page=2');

    expect(result?.continue).toBe(true);
    // No url in the result → the hook executor leaves the request URL as-is.
    expect(result?.value?.url).toBeUndefined();
  });

  it('leaves URLs without a query string completely untouched', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(ctx, 'https://example.com/plain/path');

    expect(result?.continue).toBe(true);
    expect(result?.value?.url).toBeUndefined();
  });

  it('drops the trailing "?" when every param is stripped', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(ctx, 'https://example.com/page?utm_source=a&utm_campaign=b');

    expect(result?.value?.url).toBe('https://example.com/page');
  });

  it('matches the utm_* prefix wildcard from the default list', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(
      ctx,
      'https://example.com/?utm_source=a&utm_anything_else=b&utterly_fine=c'
    );

    // utm_* matches by prefix; "utterly_fine" does not start with "utm_".
    expect(result?.value?.url).toBe('https://example.com/?utterly_fine=c');
  });

  it('config params replace the default list (custom prefix wildcard)', async () => {
    const ctx = createTestContext({
      pluginId: PLUGIN_ID,
      pluginConfig: { params: ['ref_*', 'spm'] },
    });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(
      ctx,
      'https://example.com/?ref_src=tw&ref_url=x&spm=1&utm_source=keepme'
    );

    // utm_source survives because the configured list replaced the default.
    expect(result?.value?.url).toBe('https://example.com/?utm_source=keepme');
  });

  it('strips params case-insensitively', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });
    await trackingParamStripperPlugin.activate(ctx);

    const result = await runHook(ctx, 'https://example.com/?UTM_Source=a&FBCLID=b&id=1');

    expect(result?.value?.url).toBe('https://example.com/?id=1');
  });

  it('unregisters the hook on deactivate', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });

    await trackingParamStripperPlugin.activate(ctx);
    await trackingParamStripperPlugin.deactivate(ctx);

    expect(ctx.getRegisteredHooks().has('request:pre')).toBe(false);
  });

  it('manifest permissions are sufficient to register the hook', async () => {
    // Context built with ONLY the permissions declared in plugin.json — no
    // implicit ALL_PERMISSIONS escape hatch (hello-world doc-test pattern).
    const ctx = createTestContext({
      pluginId: PLUGIN_ID,
      permissions: manifest.permissions,
    });

    await expect(trackingParamStripperPlugin.activate(ctx)).resolves.not.toThrow();
    expect(ctx.getRegisteredHooks().has('request:pre')).toBe(true);

    const result = await runHook(ctx, 'https://example.com/?utm_source=a&id=1');
    expect(result?.value?.url).toBe('https://example.com/?id=1');
  });
});
