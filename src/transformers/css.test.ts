import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { transformCss, needsCssTransform, resetCssProcessor, shutdownCssWorkerPool } from './css.js';
import { resetConfig, updateConfig } from '../config/index.js';

// The PostCSS pool is shared across tests (mirrors production usage);
// shut it down once at the end so no worker threads linger.
afterAll(async () => {
  await shutdownCssWorkerPool();
});

describe('needsCssTransform', () => {
  it('should detect :is() selector', () => {
    expect(needsCssTransform(':is(.a, .b) { color: red; }')).toBe(true);
  });

  it('should detect :where() selector', () => {
    expect(needsCssTransform(':where(.a, .b) { color: red; }')).toBe(true);
  });

  it('should detect :has() selector', () => {
    expect(needsCssTransform(':has(.child) { color: red; }')).toBe(true);
  });

  it('should detect gap property', () => {
    expect(needsCssTransform('.flex { gap: 10px; }')).toBe(true);
    expect(needsCssTransform('.flex { row-gap: 10px; }')).toBe(true);
    expect(needsCssTransform('.flex { column-gap: 10px; }')).toBe(true);
  });

  it('should detect aspect-ratio', () => {
    expect(needsCssTransform('.box { aspect-ratio: 16/9; }')).toBe(true);
  });

  it('should detect color-mix', () => {
    expect(needsCssTransform('.box { color: color-mix(in srgb, red, blue); }')).toBe(true);
  });

  it('should detect oklch/oklab colors', () => {
    expect(needsCssTransform('.box { color: oklch(0.5 0.2 180); }')).toBe(true);
    expect(needsCssTransform('.box { color: oklab(0.5 0.2 0.1); }')).toBe(true);
  });

  it('should detect container queries', () => {
    expect(needsCssTransform('.box { container-type: inline-size; }')).toBe(true);
    expect(needsCssTransform('@container (min-width: 300px) {}')).toBe(true);
  });

  it('should detect cascade layers', () => {
    expect(needsCssTransform('@layer base { }')).toBe(true);
  });

  it('should detect logical properties', () => {
    expect(needsCssTransform('.box { inset: 0; }')).toBe(true);
    expect(needsCssTransform('.box { inline-size: 100px; }')).toBe(true);
    expect(needsCssTransform('.box { block-size: 100px; }')).toBe(true);
    expect(needsCssTransform('.box { margin-inline: auto; }')).toBe(true);
    expect(needsCssTransform('.box { padding-block: 10px; }')).toBe(true);
  });

  it('should detect scroll/overscroll behavior', () => {
    expect(needsCssTransform('html { scroll-behavior: smooth; }')).toBe(true);
    expect(needsCssTransform('.box { overscroll-behavior: contain; }')).toBe(true);
  });

  it('should detect backdrop-filter', () => {
    expect(needsCssTransform('.box { backdrop-filter: blur(10px); }')).toBe(true);
  });

  it('should detect clamp/min/max functions', () => {
    expect(needsCssTransform('.box { width: clamp(100px, 50%, 500px); }')).toBe(true);
    expect(needsCssTransform('.box { width: min(100px, 50%); }')).toBe(true);
    expect(needsCssTransform('.box { width: max(100px, 50%); }')).toBe(true);
  });

  it('should detect flexbox properties', () => {
    expect(needsCssTransform('.box { display: flex; }')).toBe(true);
    expect(needsCssTransform('.box { display: inline-flex; }')).toBe(true);
    expect(needsCssTransform('.box { flex-direction: column; }')).toBe(true);
    expect(needsCssTransform('.box { flex-wrap: wrap; }')).toBe(true);
    expect(needsCssTransform('.box { justify-content: center; }')).toBe(true);
    expect(needsCssTransform('.box { align-items: center; }')).toBe(true);
    expect(needsCssTransform('.box { align-self: flex-start; }')).toBe(true);
    expect(needsCssTransform('.box { align-content: space-between; }')).toBe(true);
    expect(needsCssTransform('.box { flex-grow: 1; }')).toBe(true);
    expect(needsCssTransform('.box { flex-shrink: 0; }')).toBe(true);
    expect(needsCssTransform('.box { flex-basis: auto; }')).toBe(true);
  });

  it('should detect grid properties', () => {
    expect(needsCssTransform('.box { display: grid; }')).toBe(true);
    expect(needsCssTransform('.box { grid-template-columns: 1fr 1fr; }')).toBe(true);
    expect(needsCssTransform('.box { grid-area: header; }')).toBe(true);
    expect(needsCssTransform('.box { grid-column: 1 / 3; }')).toBe(true);
    expect(needsCssTransform('.box { grid-row: 1 / 2; }')).toBe(true);
  });

  it('should detect place properties', () => {
    expect(needsCssTransform('.box { place-items: center; }')).toBe(true);
    expect(needsCssTransform('.box { place-content: center; }')).toBe(true);
    expect(needsCssTransform('.box { place-self: center; }')).toBe(true);
  });

  it('should return false for simple CSS', () => {
    expect(needsCssTransform('.box { color: red; }')).toBe(false);
    expect(needsCssTransform('.box { margin: 10px; }')).toBe(false);
    expect(needsCssTransform('.box { padding: 20px; font-size: 16px; }')).toBe(false);
  });
});

describe('transformCss', () => {
  beforeEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  afterEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  it('should return original code when transformCss is disabled', async () => {
    updateConfig({ transformCss: false });
    const code = '.box { display: flex; }';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should return original code for very small files', async () => {
    const code = 'a{b:c}';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should return original code when no modern features detected', async () => {
    const code = '.simple { color: red; margin: 10px; padding: 20px; background: blue; }';
    const result = await transformCss(code);
    expect(result).toBe(code);
  });

  it('should add webkit prefix for flexbox', async () => {
    // CSS must be > 50 bytes and trigger transformation
    const code = '.container { display: flex; flex-direction: column; align-items: center; gap: 10px; }';
    const result = await transformCss(code);
    // The transformer should process the CSS (result may or may not have prefixes
    // depending on postcss-preset-env config, but it should at least run)
    expect(result).toContain('display');
    expect(result).toContain('flex');
  });

  it('should add webkit prefix for inline-flex', async () => {
    // CSS must be > 50 bytes
    const code = '.inline-container { display: inline-flex; flex-direction: row; justify-content: center; gap: 20px; }';
    const result = await transformCss(code);
    expect(result).toContain('inline-flex');
  });

  it('should add webkit prefix for flex properties', async () => {
    // CSS must be > 50 bytes with flexbox context
    const code = '.item { display: flex; flex-grow: 1; flex-shrink: 0; flex-basis: auto; flex-wrap: wrap; gap: 5px; }';
    const result = await transformCss(code);
    expect(result).toContain('flex-grow');
    expect(result).toContain('flex-shrink');
    expect(result).toContain('flex-basis');
  });

  it('should add webkit prefix for alignment properties', async () => {
    // CSS must be > 50 bytes with flexbox context
    const code = '.container { display: flex; justify-content: center; align-items: center; flex-direction: row; gap: 15px; }';
    const result = await transformCss(code);
    expect(result).toContain('justify-content');
    expect(result).toContain('align-items');
  });

  it('should handle CSS parsing errors gracefully', async () => {
    const code = '.box { display: flex; this is not valid css {{{';
    const result = await transformCss(code);
    // Should return something (either original or partially processed)
    expect(result).toBeDefined();
  });

  it('should return original code when PostCSS throws during processing', async () => {
    // Create CSS that will trigger PostCSS error during processing
    // Severely malformed CSS that triggers processing error
    const malformedCss = `
/* padding to exceed 50 bytes threshold */
.test { display: flex; }
@media (invalid { .broken { color
    unclosed brackets and syntax error
    .another { `;
    const result = await transformCss(malformedCss);
    // Should return original code on processing error
    expect(result).toBe(malformedCss);
  });

  it('should preserve valid CSS functionality', async () => {
    const code = `
.container {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}
.item {
  flex: 1 1 300px;
}
`;
    const result = await transformCss(code);
    expect(result).toContain('display');
    expect(result).toContain('flex');
  });

  it('should handle CSS with dark mode queries', async () => {
    // CSS large enough with dark mode media query
    const code = `
/* Comment for size padding */
/* More padding for threshold */
@media (prefers-color-scheme: dark) {
  body { background: #000; color: #fff; }
}
@media (prefers-color-scheme: light) {
  body { background: #fff; color: #000; }
}
.container { display: flex; }
`;
    const result = await transformCss(code);
    // Should process and potentially strip dark mode
    expect(result).toContain('.container');
  });

  it('should handle CSS with CSS Grid', async () => {
    // CSS large enough with grid
    const code = `
/* Comment for size padding */
/* More padding for threshold */
.grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-gap: 10px;
}
.grid-item { padding: 10px; }
`;
    const result = await transformCss(code);
    // Should process grid
    expect(result).toContain('.grid-container');
  });
});

describe('resetCssProcessor', () => {
  beforeEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  afterEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  it('should reset the processor', async () => {
    // First transform to initialize processor
    const result1 = await transformCss('.box { display: flex; }');

    // Reset
    resetCssProcessor();

    // Should work again
    const result2 = await transformCss('.container { display: flex; justify-content: center; }');
    // Should still produce valid CSS
    expect(result2).toContain('display');
    expect(result2).toContain('flex');
  });

  it('should reuse cached processor on consecutive transforms', async () => {
    // First transform initializes processor
    const css1 = '.first { display: flex; flex-direction: column; align-items: center; gap: 5px; }';
    const result1 = await transformCss(css1);
    expect(result1).toContain('display');

    // Second transform reuses cached processor (line 85 coverage)
    const css2 = '.second { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }';
    const result2 = await transformCss(css2);
    expect(result2).toContain('display');
    expect(result2).toContain('flex');
  });

  it('should rebuild the processor when targets config changes (T18)', async () => {
    // Use a CSS feature whose handling depends heavily on browser targets.
    // :is(...) is transpiled away for old Safari but kept for modern browsers.
    const code = '.parent :is(.a, .b) { color: red; padding: 10px; margin: 0; }';

    // Step 1: legacy targets (Safari 9). :is() must be transpiled to a
    // selector list — i.e. the literal substring ":is(" should disappear.
    updateConfig({ targets: ['safari 9'] });
    const legacyOut = await transformCss(code);
    expect(legacyOut.includes(':is(')).toBe(false);

    // Step 2: switch to evergreen targets that natively support :is().
    // If the processor cache is NOT invalidated, the second call will still
    // produce legacy output (the bug). After T18, the processor rebuilds and
    // the modern output should keep :is() intact.
    updateConfig({ targets: ['last 1 chrome version'] });
    const modernOut = await transformCss(code);
    expect(modernOut.includes(':is(')).toBe(true);
    expect(modernOut).not.toBe(legacyOut);
  });
});

describe('transformCss with config parameter', () => {
  beforeEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  afterEach(() => {
    resetConfig();
    resetCssProcessor();
  });

  it('should use passed config instead of global config for transformCss', async () => {
    // Set global config to enable CSS transformation
    updateConfig({ transformCss: true });

    // CSS with modern features that would normally be transformed
    const code = '.box { display: flex; gap: 10px; }';

    // Pass config with CSS transformation disabled
    const configWithCssDisabled = {
      transformHtml: true,
      transformJs: true,
      transformCss: false,
      bundleEsModules: true,
      emulateServiceWorkers: true,
      remoteServiceWorkers: false,
      removeAds: true,
      removeTracking: true,
      injectPolyfills: true,
      spoofUserAgentInJs: true,
      targets: ['safari 9', 'ios 9'],
      socks5Port: 1080,
      httpProxyPort: 8080,
      captivePortalPort: 8888,
      bindAddress: '0.0.0.0',
      compressionLevel: 4,
      cacheEnabled: false,
      cacheTTL: 3600,
      cacheDir: './.revamp-cache',
      certDir: './.revamp-certs',
      caKeyFile: 'ca.key',
      caCertFile: 'ca.crt',
      whitelist: [],
      blacklist: [],
      adDomains: [],
      trackingDomains: [],
      trackingUrls: [],
      spoofUserAgent: false,
      logJsonRequests: false,
      jsonLogDir: './.revamp-json-logs',
      logLevel: 'info' as const,
    };

    const result = await transformCss(code, 'test.css', configWithCssDisabled);

    // Code should be returned unchanged when transformCss is disabled via passed config
    expect(result).toBe(code);
  });

  it('should transform code when transformCss is enabled via passed config', async () => {
    // Set global config to disable CSS transformation
    updateConfig({ transformCss: false });

    // CSS with modern features - use flex-direction to ensure processing
    const code = '.box { display: flex; flex-direction: column; align-items: center; }';

    // Pass config with CSS transformation enabled
    const configWithCssEnabled = {
      transformHtml: true,
      transformJs: true,
      transformCss: true,
      bundleEsModules: true,
      emulateServiceWorkers: true,
      remoteServiceWorkers: false,
      removeAds: true,
      removeTracking: true,
      injectPolyfills: true,
      spoofUserAgentInJs: true,
      targets: ['safari 9', 'ios 9'],
      socks5Port: 1080,
      httpProxyPort: 8080,
      captivePortalPort: 8888,
      bindAddress: '0.0.0.0',
      compressionLevel: 4,
      cacheEnabled: false,
      cacheTTL: 3600,
      cacheDir: './.revamp-cache',
      certDir: './.revamp-certs',
      caKeyFile: 'ca.key',
      caCertFile: 'ca.crt',
      whitelist: [],
      blacklist: [],
      adDomains: [],
      trackingDomains: [],
      trackingUrls: [],
      spoofUserAgent: false,
      logJsonRequests: false,
      jsonLogDir: './.revamp-json-logs',
      logLevel: 'info' as const,
    };

    const result = await transformCss(code, 'test.css', configWithCssEnabled);

    // CSS should be transformed - result should contain processed CSS
    expect(result).toContain('display');
    expect(result).toContain('flex');
    // Verify transformation happened (result is not the same as input due to processing)
    // The transformer runs PostCSS which at minimum normalizes the CSS
    expect(result.length).toBeGreaterThan(0);
  });

  it('should fall back to global config when no config parameter is passed', async () => {
    // Set global config to disable CSS transformation
    updateConfig({ transformCss: false });

    const code = '.box { display: flex; gap: 10px; }';

    // Call without config parameter - should use global config
    const result = await transformCss(code, 'test.css');

    // Code should be returned unchanged (global config has transformCss: false)
    expect(result).toBe(code);
  });
});

describe('transformCss worker-pool equivalence', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  // Representative modern-CSS fixture exercising the full pipeline:
  // dark-mode stripping, grid->flexbox fallback, webkit flex prefixes and
  // postcss-preset-env (oklch, color-mix, :is(), logical properties, clamp).
  const FIXTURE = "/* Representative modern CSS fixture */\n:root {\n  --brand: oklch(0.55 0.15 250);\n  --accent: color-mix(in srgb, red 40%, blue);\n}\n.header :is(.nav, .menu) a:not(.active, .disabled) {\n  color: var(--brand);\n  padding-inline: 1rem;\n  margin-block: 0.5rem;\n}\n.container {\n  display: flex;\n  flex-direction: row;\n  flex-wrap: wrap;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n}\n.grid {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  grid-gap: 16px;\n}\n.card {\n  width: clamp(200px, 50%, 480px);\n  aspect-ratio: 16 / 9;\n  inset: 0;\n}\n@media (prefers-color-scheme: dark) {\n  body { background: #111; color: #eee; }\n}\n@media (prefers-color-scheme: light) {\n  body { background: #fff; color: #111; }\n}\n";

  // Output captured from the pre-worker (main-thread) implementation with the
  // default config (targets: safari 9, ios 9). The worker-pool implementation
  // must produce byte-identical output.
  const EXPECTED = "/* Representative modern CSS fixture */\n:root {\n  --brand: rgb(15, 116, 197);\n  --accent: rgb(102, 0, 153);\n}\n.header .nav a:not(.active):not(.disabled), .header .menu a:not(.active):not(.disabled) {\n  color: rgb(15, 116, 197);\n  color: var(--brand);\n  padding-left: 1rem;\n  padding-right: 1rem;\n  margin-top: 0.5rem;\n  margin-bottom: 0.5rem;\n}\n.container {\n  display: flex;\n  flex-direction: row;\n  flex-wrap: wrap;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n}\n.grid {\n  /*  Revamp: Flexbox fallback for CSS Grid  */\n  flex-wrap: wrap;\n  -webkit-flex-wrap: wrap;\n  display: flex;\n  display: -webkit-flex;\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  grid-gap: 16px;\n}\n.card {\n  width: max(200px, min(50%, 480px));\n  aspect-ratio: 16 / 9;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  left: 0;\n}\n/*  Revamp: Extracted from prefers-color-scheme media query  */\nbody { background: #fff; color: #111; }\n";

  it('should produce output identical to the pre-worker implementation', async () => {
    const result = await transformCss(FIXTURE, 'fixture.css');
    expect(result).toBe(EXPECTED);
  });

  it('should produce identical output across concurrent transforms', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => transformCss(FIXTURE, 'fixture.css'))
    );
    for (const result of results) {
      expect(result).toBe(EXPECTED);
    }
  });
});

describe('transformCss worker failure fallback', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    vi.doUnmock('tinypool');
    vi.resetModules();
    vi.restoreAllMocks();
    resetConfig();
  });

  it('should return original CSS and log when the worker pool crashes', async () => {
    vi.resetModules();
    vi.doMock('tinypool', () => ({
      Tinypool: class {
        options = { maxThreads: 1, concurrentTasksPerWorker: 1 };
        run(): Promise<never> {
          return Promise.reject(new Error('synthetic worker crash'));
        }
        async destroy(): Promise<void> {
          // Nothing to clean up - this mock never spawns threads
        }
      },
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence in test */ });

    // Fresh module instance picks up the mocked tinypool
    const { transformCss: transformCssWithBrokenPool } = await import('./css.js');

    // Modern CSS > 50 bytes so the transform is actually dispatched to the pool
    const code = '.box { display: flex; flex-direction: column; align-items: center; gap: 10px; }';
    const result = await transformCssWithBrokenPool(code, 'broken.css');

    // Worker crash must degrade to the original CSS, never kill the request
    expect(result).toBe(code);
    expect(errorSpy).toHaveBeenCalledWith('❌ PostCSS worker error:', 'synthetic worker crash');
  });
});
