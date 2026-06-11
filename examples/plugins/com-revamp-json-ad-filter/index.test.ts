import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createTestContext,
  type TestPluginContext,
} from '../../../src/plugins/testing.js';
import type {
  TextContentTransformer,
  TransformDispatchContext,
} from '../../../src/transformers/registry.js';
import { defaultConfig } from '../../../src/config/index.js';
import type { PluginPermission } from '../../../src/plugins/types.js';
import {
  validatePluginConfig,
  type JSONSchema,
} from '../../../src/plugins/validation.js';

import jsonAdFilterPlugin from './index.js';

const PLUGIN_ID = 'com.revamp.json-ad-filter';

// Load permissions/configSchema from the shipped plugin.json so these
// doc-tests are locked to the real manifest (same pattern as hello-world:
// hard-coding them here would silently desync from the JSON).
const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, 'plugin.json'), 'utf-8')
) as { permissions: PluginPermission[]; configSchema: JSONSchema };

/** Dispatch context shaped exactly like the registry hands to transformers. */
function makeDispatchContext(
  overrides: Partial<TransformDispatchContext> = {}
): TransformDispatchContext {
  return {
    url: 'https://news.example.com/api/feed',
    // The coarse content type collapses JSON to 'other' (see
    // src/proxy/content-type.ts) — the matcher must key off rawContentType.
    contentType: 'other',
    rawContentType: 'application/json; charset=utf-8',
    config: defaultConfig,
    profile: null,
    ...overrides,
  };
}

async function activateWithRules(
  rules: unknown
): Promise<{ ctx: TestPluginContext; transformer: TextContentTransformer }> {
  const ctx = createTestContext({
    pluginId: PLUGIN_ID,
    pluginConfig: { rules },
  });
  await jsonAdFilterPlugin.activate(ctx);
  const transformer = ctx.getRegisteredTransformers()[0] as TextContentTransformer;
  return { ctx, transformer };
}

describe('json-ad-filter example plugin', () => {
  it('registers a text-lane transformer on activate', async () => {
    const { ctx, transformer } = await activateWithRules([]);

    expect(ctx.getRegisteredTransformers()).toHaveLength(1);
    expect(transformer.kind).toBe('text');
    expect(transformer.name).toBe('json-ad-filter');
  });

  it('matches JSON content types via rawContentType', async () => {
    const { transformer } = await activateWithRules([]);

    expect(
      transformer.matches(makeDispatchContext({ rawContentType: 'application/json' }))
    ).toBe(true);
    expect(
      transformer.matches(
        makeDispatchContext({ rawContentType: 'application/json; charset=utf-8' })
      )
    ).toBe(true);
    expect(
      transformer.matches(makeDispatchContext({ rawContentType: 'text/json' }))
    ).toBe(true);
    expect(
      transformer.matches(
        makeDispatchContext({ rawContentType: 'application/vnd.api+json' })
      )
    ).toBe(true);

    expect(
      transformer.matches(
        makeDispatchContext({ rawContentType: 'text/html; charset=utf-8', contentType: 'html' })
      )
    ).toBe(false);
    expect(transformer.matches(makeDispatchContext({ rawContentType: '' }))).toBe(false);
  });

  it('removes feed-array ad items selected by an equals predicate', async () => {
    const { transformer } = await activateWithRules([
      {
        urlPattern: 'example.com/api/feed',
        path: 'items[*]',
        when: { field: 'type', equals: 'ad' },
        action: 'remove',
      },
    ]);

    const input = JSON.stringify({
      items: [
        { id: 1, type: 'post', title: 'Hello' },
        { id: 2, type: 'ad', title: 'Buy now' },
        { id: 3, type: 'post', title: 'World' },
        { id: 4, type: 'ad', title: 'Subscribe' },
      ],
    });

    const output = await transformer.transform(input, makeDispatchContext());
    const parsed = JSON.parse(output) as { items: Array<{ id: number; type: string }> };

    expect(parsed.items.map((item) => item.id)).toEqual([1, 3]);
    expect(parsed.items.every((item) => item.type === 'post')).toBe(true);
  });

  it('applies rules at nested paths with a mid-segment array wildcard', async () => {
    const { transformer } = await activateWithRules([
      {
        path: 'data.sections[*].tracking',
        action: 'remove',
      },
    ]);

    const input = JSON.stringify({
      data: {
        sections: [
          { name: 'top', tracking: { pixel: 'https://t.example/1' } },
          { name: 'bottom', tracking: { pixel: 'https://t.example/2' } },
          { name: 'plain' },
        ],
      },
    });

    const output = await transformer.transform(input, makeDispatchContext());
    const parsed = JSON.parse(output) as {
      data: { sections: Array<Record<string, unknown>> };
    };

    expect(parsed.data.sections).toHaveLength(3);
    expect(parsed.data.sections.every((section) => !('tracking' in section))).toBe(true);
    expect(parsed.data.sections[0].name).toBe('top');
  });

  it('supports the null action', async () => {
    const { transformer } = await activateWithRules([
      { path: 'ads[*]', action: 'null' },
    ]);

    const input = JSON.stringify({ ads: [{ id: 'a' }, { id: 'b' }], posts: [1] });
    const output = await transformer.transform(input, makeDispatchContext());
    const parsed = JSON.parse(output) as { ads: unknown[]; posts: number[] };

    expect(parsed.ads).toEqual([null, null]);
    expect(parsed.posts).toEqual([1]);
  });

  it('supports the empty action (type-appropriate replacement)', async () => {
    const { transformer } = await activateWithRules([
      { path: 'sponsored', action: 'empty' },
      { path: 'promoText', action: 'empty' },
      { path: 'adConfig', action: 'empty' },
    ]);

    const input = JSON.stringify({
      sponsored: [{ id: 'a' }],
      promoText: 'BUY NOW',
      adConfig: { provider: 'x' },
      keep: true,
    });
    const output = await transformer.transform(input, makeDispatchContext());
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.sponsored).toEqual([]);
    expect(parsed.promoText).toBe('');
    expect(parsed.adConfig).toEqual({});
    expect(parsed.keep).toBe(true);
  });

  it('supports the contains predicate on strings', async () => {
    const { transformer } = await activateWithRules([
      {
        path: 'items[*]',
        when: { field: 'url', contains: 'doubleclick' },
        action: 'remove',
      },
    ]);

    const input = JSON.stringify({
      items: [
        { id: 1, url: 'https://ads.doubleclick.net/x' },
        { id: 2, url: 'https://cdn.example.com/y' },
      ],
    });
    const output = await transformer.transform(input, makeDispatchContext());
    const parsed = JSON.parse(output) as { items: Array<{ id: number }> };

    expect(parsed.items.map((item) => item.id)).toEqual([2]);
  });

  it('returns the original string byte-identical when no rule changes anything (big-int safe)', async () => {
    const { transformer } = await activateWithRules([
      {
        path: 'items[*]',
        when: { field: 'type', equals: 'ad' },
        action: 'remove',
      },
    ]);

    // id is > Number.MAX_SAFE_INTEGER: a parse → stringify round-trip would
    // corrupt it (9007199254740993 → 9007199254740992). The pretty-printed
    // formatting must survive too.
    const input = '{\n  "id": 9007199254740993,\n  "items": [ { "type": "post" } ]\n}';

    const output = await transformer.transform(input, makeDispatchContext());

    expect(output).toBe(input);
    expect(output).toContain('9007199254740993');
  });

  it('passes malformed JSON through untouched with a debug log', async () => {
    const { ctx, transformer } = await activateWithRules([
      { path: 'items[*]', action: 'remove' },
    ]);

    const input = '{ this is not JSON ]';
    const output = await transformer.transform(input, makeDispatchContext());

    expect(output).toBe(input);
    const debugLogs = ctx.getLogsByLevel('debug');
    expect(debugLogs.some((entry) => entry.message.includes('Malformed JSON'))).toBe(true);
  });

  it('gates rules by urlPattern (substring and * wildcard)', async () => {
    const { transformer } = await activateWithRules([
      {
        urlPattern: 'ads.example.com',
        path: 'items[*]',
        action: 'remove',
      },
    ]);

    const input = JSON.stringify({ items: [{ id: 1 }] });

    // URL does not contain the pattern → byte-identical passthrough.
    const untouched = await transformer.transform(
      input,
      makeDispatchContext({ url: 'https://news.example.com/api/feed' })
    );
    expect(untouched).toBe(input);

    // Wildcard pattern: literal parts must appear in order.
    const { transformer: wildcardTransformer } = await activateWithRules([
      {
        urlPattern: '*example.com/api/*',
        path: 'items[*]',
        action: 'remove',
      },
    ]);
    const filtered = await wildcardTransformer.transform(
      input,
      makeDispatchContext({ url: 'https://news.example.com/api/feed?page=2' })
    );
    expect(JSON.parse(filtered)).toEqual({ items: [] });
  });

  it('unregisters the transformer on deactivate', async () => {
    const ctx = createTestContext({ pluginId: PLUGIN_ID });

    await jsonAdFilterPlugin.activate(ctx);
    expect(ctx.getRegisteredTransformers()).toHaveLength(1);

    await jsonAdFilterPlugin.deactivate(ctx);
    expect(ctx.getRegisteredTransformers()).toHaveLength(0);
  });

  it('manifest permissions are sufficient to register the transformer', async () => {
    // Context built with ONLY the permissions declared in plugin.json — no
    // implicit ALL_PERMISSIONS escape hatch (hello-world doc-test pattern).
    const ctx = createTestContext({
      pluginId: PLUGIN_ID,
      permissions: manifest.permissions,
      pluginConfig: {
        rules: [{ path: 'items[*]', when: { field: 'type', equals: 'ad' }, action: 'remove' }],
      },
    });

    await expect(jsonAdFilterPlugin.activate(ctx)).resolves.not.toThrow();
    const transformer = ctx.getRegisteredTransformers()[0] as TextContentTransformer;
    expect(transformer).toBeDefined();

    const output = await transformer.transform(
      JSON.stringify({ items: [{ type: 'ad' }, { type: 'post' }] }),
      makeDispatchContext()
    );
    expect(JSON.parse(output)).toEqual({ items: [{ type: 'post' }] });
  });

  it('README example config validates against the manifest configSchema', () => {
    const result = validatePluginConfig(
      {
        rules: [
          {
            urlPattern: '*example.com/api/*',
            path: 'items[*]',
            when: { field: 'type', equals: 'ad' },
            action: 'remove',
          },
          { path: 'data.sections[*].tracking', action: 'remove' },
          { path: 'promo', when: { field: 'label', contains: 'Sponsored' }, action: 'empty' },
        ],
      },
      manifest.configSchema
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);

    // And the schema actually rejects a bad action.
    const invalid = validatePluginConfig(
      { rules: [{ path: 'items[*]', action: 'obliterate' }] },
      manifest.configSchema
    );
    expect(invalid.valid).toBe(false);
  });
});
