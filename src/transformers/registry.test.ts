import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerTransformer,
  unregisterTransformer,
  unregisterTransformersForPlugin,
  getRegisteredTransformerNames,
  dispatchTextTransform,
  dispatchBinaryTransform,
  hasTextTransformerFor,
  type TransformDispatchContext,
  type ContentTransformer,
} from './registry.js';
import { transformContent } from '../proxy/transform-pipeline.js';
import { createPluginContext } from '../plugins/context.js';
import { defaultConfig, resetConfig, updateConfig } from '../config/index.js';

const PLUGIN_ID = 'com.test.registry-plugin';

function makeCtx(overrides: Partial<TransformDispatchContext> = {}): TransformDispatchContext {
  return {
    url: 'https://example.com/script.js',
    contentType: 'js',
    rawContentType: 'application/javascript',
    config: defaultConfig,
    profile: null,
    ...overrides,
  };
}

/** Names registered during a test; removed in afterEach so the global
 * registry (shared with the built-ins) never leaks across tests. */
let registeredNames: string[] = [];

function track(t: ContentTransformer, pluginId: string | null = PLUGIN_ID): void {
  registerTransformer(t, pluginId);
  registeredNames.push(t.name);
}

afterEach(() => {
  for (const name of registeredNames) {
    unregisterTransformer(name);
  }
  registeredNames = [];
  unregisterTransformersForPlugin(PLUGIN_ID);
});

describe('transformer registry — built-ins', () => {
  it('registers the built-in js/css/html/image transformers', () => {
    const names = getRegisteredTransformerNames();
    expect(names).toContain('js');
    expect(names).toContain('css');
    expect(names).toContain('html');
    expect(names).toContain('image');
  });

  it('rejects duplicate names', () => {
    expect(() =>
      registerTransformer(
        { kind: 'text', name: 'js', matches: () => true, transform: (s) => Promise.resolve(s) },
        PLUGIN_ID
      )
    ).toThrow(/already registered/);
  });

  it('rejects empty names', () => {
    expect(() =>
      registerTransformer(
        { kind: 'text', name: '', matches: () => true, transform: (s) => Promise.resolve(s) },
        PLUGIN_ID
      )
    ).toThrow(/non-empty name/);
  });
});

describe('transformer registry — dispatch order and fallback', () => {
  it('plugin transformers run before built-ins (first match wins)', async () => {
    track({
      kind: 'text',
      name: 'plugin-js',
      matches: (ctx) => ctx.contentType === 'js',
      transform: (input) => Promise.resolve(`PLUGIN(${input})`),
    });

    const result = await dispatchTextTransform('code', makeCtx());
    expect(result).toBe('PLUGIN(code)');
  });

  it('plugin transformers dispatch in registration order among plugins', async () => {
    track({
      kind: 'text',
      name: 'plugin-first',
      matches: (ctx) => ctx.contentType === 'js',
      transform: (input) => Promise.resolve(`FIRST(${input})`),
    });
    track({
      kind: 'text',
      name: 'plugin-second',
      matches: (ctx) => ctx.contentType === 'js',
      transform: (input) => Promise.resolve(`SECOND(${input})`),
    });

    const result = await dispatchTextTransform('code', makeCtx());
    expect(result).toBe('FIRST(code)');
  });

  it('a throwing plugin transformer falls back to the next match with a warning', async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      track({
        kind: 'text',
        name: 'plugin-throws',
        matches: (ctx) => ctx.contentType === 'js',
        transform: () => Promise.reject(new Error('plugin exploded')),
      });
      track({
        kind: 'text',
        name: 'plugin-fallback',
        matches: (ctx) => ctx.contentType === 'js',
        transform: (input) => Promise.resolve(`FALLBACK(${input})`),
      });

      const result = await dispatchTextTransform('code', makeCtx());
      expect(result).toBe('FALLBACK(code)');
      expect(warnCalls.some((c) => String(c[0]).includes('plugin-throws'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('a throwing plugin matches() is treated as a non-match', async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      track({
        kind: 'text',
        name: 'plugin-bad-matcher',
        matches: () => {
          throw new Error('matcher exploded');
        },
        transform: (input) => Promise.resolve(`NEVER(${input})`),
      });

      // No other custom transformer; built-in js matches but with
      // transformJs disabled returns input unchanged — never NEVER(...).
      const result = await dispatchTextTransform('code', makeCtx({
        config: { ...defaultConfig, transformJs: false },
      }));
      expect(result).toBe('code');
      expect(warnCalls.some((c) => String(c[0]).includes('plugin-bad-matcher'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('falls through untransformed when nothing matches', async () => {
    const result = await dispatchTextTransform('plain', makeCtx({ contentType: 'other' }));
    expect(result).toBe('plain');
  });

  it('binary dispatch returns null when no binary transformer matches', async () => {
    // Default config targets are modern — the built-in image transformer's
    // needsImageTransform() declines, so the lane reports "no match".
    const result = await dispatchBinaryTransform(Buffer.from('xx'), makeCtx({
      contentType: 'other',
      rawContentType: 'text/plain',
    }));
    expect(result).toBeNull();
  });

  it('binary plugin transformers are dispatched from the binary lane', async () => {
    track({
      kind: 'binary',
      name: 'plugin-binary',
      matches: (ctx) => ctx.rawContentType === 'application/x-custom-binary',
      transform: (input) =>
        Promise.resolve({
          transformed: true,
          data: Buffer.concat([Buffer.from('BIN:'), input]),
          contentType: 'application/x-transformed',
        }),
    });

    const result = await dispatchBinaryTransform(Buffer.from('raw'), makeCtx({
      contentType: 'other',
      rawContentType: 'application/x-custom-binary',
    }));
    expect(result).not.toBeNull();
    expect(result!.transformed).toBe(true);
    expect(result!.data.toString()).toBe('BIN:raw');
    expect(result!.contentType).toBe('application/x-transformed');
  });
});

describe('transformer registry — hasTextTransformerFor', () => {
  it('matches built-ins for js/css/html', () => {
    expect(hasTextTransformerFor(makeCtx({ contentType: 'js' }))).toBe(true);
    expect(hasTextTransformerFor(makeCtx({ contentType: 'css' }))).toBe(true);
    expect(hasTextTransformerFor(makeCtx({ contentType: 'html' }))).toBe(true);
  });

  it("returns false for 'other' when only built-ins are registered", () => {
    expect(
      hasTextTransformerFor(makeCtx({
        contentType: 'other',
        rawContentType: 'application/json',
        url: 'https://api.example.com/feed',
      }))
    ).toBe(false);
  });

  it("returns true for 'other' when a plugin text transformer matches the raw content type", () => {
    track({
      kind: 'text',
      name: 'plugin-json',
      matches: (ctx) => ctx.rawContentType.includes('application/json'),
      transform: (input) => Promise.resolve(input),
    });

    expect(
      hasTextTransformerFor(makeCtx({
        contentType: 'other',
        rawContentType: 'application/json; charset=utf-8',
      }))
    ).toBe(true);
    expect(
      hasTextTransformerFor(makeCtx({
        contentType: 'other',
        rawContentType: 'text/x-component',
      }))
    ).toBe(false);
  });

  it('ignores binary-lane transformers', () => {
    track({
      kind: 'binary',
      name: 'plugin-binary-probe',
      matches: () => true,
      transform: (input) =>
        Promise.resolve({ transformed: false, data: input, contentType: 'application/octet-stream' }),
    });

    expect(
      hasTextTransformerFor(makeCtx({ contentType: 'other', rawContentType: 'application/json' }))
    ).toBe(false);
  });

  it('treats a throwing plugin matches() as a non-match (exception-safe)', () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      track({
        kind: 'text',
        name: 'plugin-probe-throws',
        matches: () => {
          throw new Error('matcher exploded');
        },
        transform: (input) => Promise.resolve(input),
      });

      expect(
        hasTextTransformerFor(makeCtx({ contentType: 'other', rawContentType: 'application/json' }))
      ).toBe(false);
      expect(warnCalls.some((c) => String(c[0]).includes('plugin-probe-throws'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('transformer registry — unregistration and ownership', () => {
  it('unregisterTransformer removes a plugin transformer', () => {
    track({
      kind: 'text',
      name: 'plugin-removable',
      matches: () => false,
      transform: (s) => Promise.resolve(s),
    });
    expect(getRegisteredTransformerNames()).toContain('plugin-removable');
    expect(unregisterTransformer('plugin-removable')).toBe(true);
    expect(getRegisteredTransformerNames()).not.toContain('plugin-removable');
  });

  it('ownership-scoped unregister cannot touch built-ins or other plugins', () => {
    expect(unregisterTransformer('js', PLUGIN_ID)).toBe(false);
    expect(getRegisteredTransformerNames()).toContain('js');

    track({
      kind: 'text',
      name: 'plugin-owned',
      matches: () => false,
      transform: (s) => Promise.resolve(s),
    });
    expect(unregisterTransformer('plugin-owned', 'com.test.other-plugin')).toBe(false);
    expect(getRegisteredTransformerNames()).toContain('plugin-owned');
  });

  it('unregisterTransformersForPlugin removes everything a plugin registered', () => {
    track({ kind: 'text', name: 'plugin-a', matches: () => false, transform: (s) => Promise.resolve(s) });
    track({ kind: 'text', name: 'plugin-b', matches: () => false, transform: (s) => Promise.resolve(s) });

    unregisterTransformersForPlugin(PLUGIN_ID);

    const names = getRegisteredTransformerNames();
    expect(names).not.toContain('plugin-a');
    expect(names).not.toContain('plugin-b');
    // Built-ins untouched
    expect(names).toContain('js');
  });
});

describe('transformer registry — plugin context integration', () => {
  it('context.registerTransformer requires response:modify', () => {
    const ctx = createPluginContext('com.test.no-perms', []);
    expect(() =>
      ctx.registerTransformer({
        kind: 'text',
        name: 'denied',
        matches: () => false,
        transform: (s) => Promise.resolve(s),
      })
    ).toThrow(/response:modify/);
    expect(getRegisteredTransformerNames()).not.toContain('denied');
  });

  it('context.registerTransformer registers into the pipeline and unregisters by name', () => {
    const ctx = createPluginContext(PLUGIN_ID, ['response:modify']);
    ctx.registerTransformer({
      kind: 'text',
      name: 'ctx-registered',
      matches: () => false,
      transform: (s) => Promise.resolve(s),
    });
    expect(getRegisteredTransformerNames()).toContain('ctx-registered');

    ctx.unregisterTransformer('ctx-registered');
    expect(getRegisteredTransformerNames()).not.toContain('ctx-registered');
  });

  it('context.unregisterTransformer cannot remove built-ins', () => {
    const ctx = createPluginContext(PLUGIN_ID, ['response:modify']);
    ctx.unregisterTransformer('js');
    expect(getRegisteredTransformerNames()).toContain('js');
  });
});

describe('transformer registry — transformContent integration', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('a plugin transformer takes precedence over the built-in inside transformContent', async () => {
    updateConfig({ transformJs: true, cacheEnabled: false });
    track({
      kind: 'text',
      name: 'plugin-pipeline-js',
      matches: (ctx) => ctx.contentType === 'js',
      transform: (input) => Promise.resolve(`/* via plugin */${input}`),
    });

    const result = await transformContent(
      Buffer.from('var x = 1;'),
      'js',
      'https://example.com/registry-pipeline.js'
    );
    expect(result.toString()).toContain('/* via plugin */');
    expect(result.toString()).toContain('var x = 1;');
  });

  it('a throwing plugin transformer never breaks transformContent (built-in fallback)', async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      updateConfig({ transformJs: false, cacheEnabled: false });
      track({
        kind: 'text',
        name: 'plugin-pipeline-throws',
        matches: (ctx) => ctx.contentType === 'js',
        transform: () => Promise.reject(new Error('boom')),
      });

      const result = await transformContent(
        Buffer.from('var safe = true;'),
        'js',
        'https://example.com/registry-pipeline-throws.js'
      );
      // Built-in js transformer matched next; transformJs is disabled so the
      // content passes through unchanged — the response is intact.
      expect(result.toString()).toBe('var safe = true;');
      expect(warnCalls.some((c) => String(c[0]).includes('plugin-pipeline-throws'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});
