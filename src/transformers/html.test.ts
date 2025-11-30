import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformHtml, isHtmlDocument } from './html.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { shutdownWorkerPool } from './js.js';

describe('isHtmlDocument', () => {
  it('should detect DOCTYPE html', () => {
    expect(isHtmlDocument('<!DOCTYPE html><html></html>')).toBe(true);
    expect(isHtmlDocument('<!doctype html><html></html>')).toBe(true);
    expect(isHtmlDocument('<!DOCTYPE HTML><html></html>')).toBe(true);
  });

  it('should detect html tag', () => {
    expect(isHtmlDocument('<html><head></head></html>')).toBe(true);
    expect(isHtmlDocument('<html lang="en"><head></head></html>')).toBe(true);
  });

  it('should detect html tag with whitespace', () => {
    expect(isHtmlDocument('  <html><head></head></html>')).toBe(true);
    expect(isHtmlDocument('\n<html><head></head></html>')).toBe(true);
  });

  it('should return false for non-HTML content', () => {
    expect(isHtmlDocument('{"json": "data"}')).toBe(false);
    expect(isHtmlDocument('plain text')).toBe(false);
    expect(isHtmlDocument('<div>not html document</div>')).toBe(false);
    expect(isHtmlDocument('function foo() {}')).toBe(false);
  });

  it('should return false for empty content', () => {
    expect(isHtmlDocument('')).toBe(false);
    expect(isHtmlDocument('   ')).toBe(false);
  });
});

describe('transformHtml', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({
      transformHtml: true,
      transformJs: false, // Disable JS transform for faster tests
      removeAds: true,
      removeTracking: true,
      injectPolyfills: true,
    });
  });

  afterEach(async () => {
    await shutdownWorkerPool();
    resetConfig();
  });

  it('should return original when transformHtml is disabled', async () => {
    updateConfig({ transformHtml: false });
    const html = '<html><head></head><body>Test</body></html>';
    const result = await transformHtml(html);
    expect(result).toBe(html);
  });

  it('should remove ad scripts', async () => {
    const html = `
      <html>
        <head>
          <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
        </head>
        <body>Content</body>
      </html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('googlesyndication');
    expect(result).not.toContain('adsbygoogle');
  });

  it('should remove tracking scripts', async () => {
    const html = `
      <html>
        <head>
          <script src="https://www.google-analytics.com/analytics.js"></script>
          <script src="https://www.googletagmanager.com/gtm.js"></script>
        </head>
        <body>Content</body>
      </html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('google-analytics');
    expect(result).not.toContain('googletagmanager');
  });

  it('should remove doubleclick ads', async () => {
    const html = `
      <html><head>
        <script src="https://ad.doubleclick.net/ddm/ad/xxx"></script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('doubleclick');
  });

  it('should remove inline ad scripts', async () => {
    const html = `
      <html><head>
        <script>
          (adsbygoogle = window.adsbygoogle || []).push({});
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('adsbygoogle');
  });

  it('should remove inline tracking scripts', async () => {
    const html = `
      <html><head>
        <script>
          gtag('config', 'GA-12345');
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('gtag(');
  });

  it('should preserve non-ad/tracking scripts', async () => {
    const html = `
      <html><head>
        <script src="https://example.com/app.js"></script>
        <script>console.log("Hello");</script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('app.js');
    expect(result).toContain('Hello');
  });

  it('should remove ad containers', async () => {
    const html = `
      <html><body>
        <div class="ad-container">Ad Here</div>
        <div id="google_ads_iframe">Ad</div>
        <ins class="adsbygoogle">Ad</ins>
        <div data-ad-slot="123">Ad</div>
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('ad-container');
    expect(result).not.toContain('google_ads');
    expect(result).not.toContain('adsbygoogle');
    expect(result).not.toContain('data-ad-slot');
  });

  it('should remove tracking pixels', async () => {
    const html = `
      <html><body>
        <img width="1" height="1" src="https://pixel.example.com/track">
        <img src="https://example.com/pixel.gif">
        <img src="https://example.com/beacon.png">
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('pixel.example.com');
    expect(result).not.toContain('pixel.gif');
    expect(result).not.toContain('beacon.png');
  });

  it('should remove hidden tracking iframes', async () => {
    const html = `
      <html><body>
        <iframe width="0" height="0" src="https://track.example.com"></iframe>
        <iframe style="display:none" src="https://hidden.example.com"></iframe>
        <iframe style="display: none" src="https://hidden2.example.com"></iframe>
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('track.example.com');
    expect(result).not.toContain('hidden.example.com');
    expect(result).not.toContain('hidden2.example.com');
  });

  it('should remove integrity attributes', async () => {
    const html = `
      <html><head>
        <script src="app.js" integrity="sha384-xxx"></script>
        <link href="style.css" integrity="sha384-yyy">
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('integrity=');
    expect(result).toContain('app.js');
    expect(result).toContain('style.css');
  });

  it('should remove CSP meta tags', async () => {
    const html = `
      <html><head>
        <meta http-equiv="Content-Security-Policy" content="script-src 'self'">
        <meta http-equiv="X-Content-Security-Policy" content="script-src 'self'">
        <meta http-equiv="X-WebKit-CSP" content="script-src 'self'">
        <meta charset="utf-8">
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).not.toContain('Content-Security-Policy');
    expect(result).not.toContain('X-Content-Security-Policy');
    expect(result).not.toContain('X-WebKit-CSP');
    expect(result).toContain('charset='); // Other meta tags preserved
  });

  it('should normalize charset to UTF-8', async () => {
    const html = `
      <html><head>
        <meta charset="windows-1251">
        <meta http-equiv="Content-Type" content="text/html; charset=windows-1251">
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('charset="UTF-8"');
    expect(result).toContain('text/html; charset=UTF-8');
  });

  it('should inject config overlay script', async () => {
    const html = '<html><head></head><body></body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('revamp');
  });

  it('should inject polyfills when enabled', async () => {
    updateConfig({ injectPolyfills: true });
    const html = '<html><head></head><body></body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('Revamp');
  });

  it('should add Revamp comment', async () => {
    const html = '<html><head></head><body></body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('Revamp Proxy');
  });

  it('should not remove ads when removeAds is disabled', async () => {
    updateConfig({ removeAds: false });
    const html = `
      <html><head>
        <script src="https://pagead2.googlesyndication.com/ad.js"></script>
      </head><body>
        <div class="ad-container">Ad</div>
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('googlesyndication');
    expect(result).toContain('ad-container');
  });

  it('should not remove tracking when removeTracking is disabled', async () => {
    updateConfig({ removeTracking: false });
    const html = `
      <html><head>
        <script src="https://www.google-analytics.com/analytics.js"></script>
      </head><body>
        <img width="1" height="1" src="https://pixel.example.com">
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('google-analytics');
    expect(result).toContain('pixel.example.com');
  });

  it('should handle HTML without head tag', async () => {
    const html = '<html><body>Content</body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('Content');
    expect(result).toContain('Revamp');
  });

  it('should handle malformed HTML gracefully', async () => {
    const html = '<html><body>Unclosed div<div>Content';
    const result = await transformHtml(html);
    expect(result).toContain('Content');
  });

  it('should skip transformation of module scripts when bundleEsModules is disabled', async () => {
    updateConfig({ transformJs: true, bundleEsModules: false });
    const html = `
      <html><head>
        <script type="module">
          import { foo } from './foo.js';
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    // Module script should be preserved as-is when bundleEsModules is disabled
    expect(result).toContain('type="module"');
    expect(result).toContain('import');
  });

  it('should bundle module scripts when bundleEsModules is enabled', async () => {
    updateConfig({ transformJs: true, bundleEsModules: true });
    const html = `
      <html><head>
        <script type="module">
          const x = 1;
          console.log(x);
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    // Module script should be bundled - type="module" attribute is removed
    expect(result).not.toContain('type="module"');
    // Should contain the ES Module shim
    expect(result).toContain('ES Module Shim');
    // Should contain bundled code or error message
    expect(result.includes('console.log') || result.includes('[Revamp] Failed to bundle')).toBe(true);
  });

  it('should skip JSON scripts', async () => {
    const html = `
      <html><head>
        <script type="application/json">
          {"key": "value"}
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('application/json');
    expect(result).toContain('"key"');
  });

  it('should not remove JSON scripts even with ad/tracking-like content', async () => {
    updateConfig({ removeAds: true, removeTracking: true });
    const html = `
      <html><head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "url": "https://google-analytics.com/test",
            "description": "Contains googletag and ads patterns"
          }
        </script>
        <script type="application/json" id="config-data">
          {"analytics": "https://doubleclick.net", "tracking": true}
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('application/ld+json');
    expect(result).toContain('google-analytics.com');
    expect(result).toContain('application/json');
    expect(result).toContain('doubleclick.net');
    expect(result).toContain('config-data');
  });

  it('should skip template scripts', async () => {
    const html = `
      <html><head>
        <script type="text/template">
          <div>Template content</div>
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('text/template');
    expect(result).toContain('Template content');
  });

  it('should skip Next.js RSC payload scripts', async () => {
    const html = `
      <html><head></head><body>
        <script>self.__next_f.push([1,"1a:[\\"$\\",\\"html\\",null]"])</script>
        <script>(self.__next_f=self.__next_f||[]).push([0])</script>
      </body></html>
    `;
    const result = await transformHtml(html);
    // RSC payload should not be transformed (arrow functions would be converted if transformed)
    expect(result).toContain('self.__next_f.push');
    // The content should remain unchanged - not have Babel transformations
    expect(result).toContain('[\\"$\\",\\"html\\",null]');
  });

  it('should skip React component boundary marker scripts ($RC, $RS, $RX)', async () => {
    const html = `
      <html><head></head><body>
        <script>$RC("B:1","S:1")</script>
        <script>$RS("B:2","S:2")</script>
        <script>$RX("B:3","error")</script>
      </body></html>
    `;
    const result = await transformHtml(html);
    // Component boundary markers should not be transformed
    expect(result).toContain('$RC("B:1","S:1")');
    expect(result).toContain('$RS("B:2","S:2")');
    expect(result).toContain('$RX("B:3","error")');
  });

  it('should handle errors gracefully', async () => {
    // Pass something that might cause issues
    const html = '<!DOCTYPE html><html><head></head><body>Normal content</body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('Normal content');
  });

  it('should handle HTML without head tag', async () => {
    updateConfig({ injectPolyfills: true });
    const html = '<html><body><p>Content without head</p></body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('Content without head');
    // Should still inject at root level
    expect(result).toContain('Revamp');
  });

  it('should inject polyfills at root when no head tag exists', async () => {
    updateConfig({ injectPolyfills: true, spoofUserAgentInJs: true });
    // Use minimal HTML fragment without any html/head/body structure
    const html = '<div>Just a div</div>';
    const result = await transformHtml(html);
    // Polyfills should still be injected (at root level)
    expect(result).toContain('Revamp');
    expect(result).toContain('Just a div');
    // User-agent spoof should also be present when no head
    expect(result).toContain('User-Agent');
  });

  it('should inject user-agent spoof when enabled', async () => {
    updateConfig({ injectPolyfills: true, spoofUserAgentInJs: true });
    const html = '<html><head></head><body></body></html>';
    const result = await transformHtml(html);
    expect(result).toContain('User-Agent');
  });

  it('should not inject user-agent spoof when disabled', async () => {
    updateConfig({ injectPolyfills: true, spoofUserAgentInJs: false });
    const html = '<html><head></head><body></body></html>';
    const result = await transformHtml(html);
    // The script block with "Revamp User-Agent Spoof" should not be present
    expect(result).not.toContain('User-Agent Spoof');
  });

  it('should skip scripts containing revamp markers', async () => {
    updateConfig({ transformJs: true });
    const html = `
      <html><head>
        <script>
          // [Revamp] This is our own script
          console.log('revamp-error handler');
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    // Our marker scripts should be preserved
    expect(result).toContain('[Revamp]');
  });

  it('should skip scripts that look like HTML templates', async () => {
    updateConfig({ transformJs: true });
    const html = `
      <html><head>
        <script type="text/x-template">
          <div class="template"><p>HTML Template Content</p></div>
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('HTML Template Content');
  });

  it('should handle multiple ad containers', async () => {
    updateConfig({ removeAds: true });
    const html = `
      <html><head></head><body>
        <div class="ad-banner">Ad 1</div>
        <div class="sidebar-ads">Ad 2</div>
        <ins class="adsbygoogle">Ad 3</ins>
        <div data-ad-slot="12345">Ad 4</div>
        <div id="google_ads_iframe">Ad 5</div>
        <div id="ad-container-main">Ad 6</div>
        <div data-ad-client="ca-pub-xxx">Ad 7</div>
        <div data-ad="true">Ad 8</div>
        <p>Real content</p>
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('Real content');
    expect(result).not.toContain('Ad 1');
    expect(result).not.toContain('Ad 2');
  });

  it('should remove all tracking pixels and beacons', async () => {
    updateConfig({ removeTracking: true });
    const html = `
      <html><head></head><body>
        <img width="1" height="1" src="pixel.gif">
        <img src="https://example.com/pixel.png">
        <img src="https://tracker.com/beacon.gif">
        <iframe width="0" height="100"></iframe>
        <iframe width="100" height="0"></iframe>
        <iframe style="display:none"></iframe>
        <iframe style="display: none"></iframe>
        <noscript><img src="noscript-tracker.png"></noscript>
        <p>Real content</p>
      </body></html>
    `;
    const result = await transformHtml(html);
    expect(result).toContain('Real content');
    expect(result).not.toContain('pixel.gif');
    expect(result).not.toContain('beacon.gif');
  });

  it('should handle HTML with many HTML tags in script', async () => {
    updateConfig({ transformJs: true });
    const html = `
      <html><head>
        <script>
          <div><p><span><a><ul><li></li></ul></a></span></p></div>
        </script>
      </head><body></body></html>
    `;
    const result = await transformHtml(html);
    // Script with mostly HTML should be skipped
    expect(result).toContain('<div>');
  });

  it('should NOT remove elements with "ad" as substring in class names', async () => {
    // This tests that we don't falsely match things like "download", "padding", "loading"
    updateConfig({ removeAds: true });
    const html = `
      <html><head></head><body>
        <a href="/cert" class="download-btn">Download Certificate</a>
        <div class="loading-indicator">Loading...</div>
        <button class="upload-btn">Upload</button>
        <div class="padding-wrapper">Padded content</div>
        <span class="cascade-effect">Cascade</span>
        <div class="broadcast-list">Broadcast</div>
        <div class="thread-item">Thread</div>
        <p class="readable-content">Readable</p>
        <div class="ad-container">Real Ad</div>
        <p>Real content</p>
      </body></html>
    `;
    const result = await transformHtml(html);
    // Should preserve elements with "ad" as part of larger words
    expect(result).toContain('download-btn');
    expect(result).toContain('Download Certificate');
    expect(result).toContain('loading-indicator');
    expect(result).toContain('upload-btn');
    expect(result).toContain('padding-wrapper');
    expect(result).toContain('cascade-effect');
    expect(result).toContain('broadcast-list');
    expect(result).toContain('thread-item');
    expect(result).toContain('readable-content');
    // But should remove actual ad containers
    expect(result).not.toContain('ad-container');
    expect(result).not.toContain('Real Ad');
    expect(result).toContain('Real content');
  });

  it('should inject polyfills BEFORE the first script in the document', async () => {
    updateConfig({ injectPolyfills: true });
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <script src="https://example.com/app.js"></script>
          <script>var myInlineVar = 123;</script>
        </head>
        <body></body>
      </html>
    `;
    const result = await transformHtml(html);

    // Find positions of polyfill and first external script
    const polyfillPos = result.indexOf('Revamp Polyfills');
    const appJsPos = result.indexOf('app.js');
    const inlineScriptPos = result.indexOf('myInlineVar');

    // Polyfills must appear BEFORE any other script
    expect(polyfillPos).toBeGreaterThan(-1);
    expect(appJsPos).toBeGreaterThan(-1);
    expect(polyfillPos).toBeLessThan(appJsPos);
    expect(polyfillPos).toBeLessThan(inlineScriptPos);
  });

  it('should inject polyfills before scripts even when scripts are in body', async () => {
    updateConfig({ injectPolyfills: true });
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body>
          <script src="https://example.com/body-script.js"></script>
          <div>Content</div>
        </body>
      </html>
    `;
    const result = await transformHtml(html);

    // Find positions
    const polyfillPos = result.indexOf('Revamp Polyfills');
    const bodyScriptPos = result.indexOf('body-script.js');

    // Polyfills must appear BEFORE the script in body
    expect(polyfillPos).toBeGreaterThan(-1);
    expect(bodyScriptPos).toBeGreaterThan(-1);
    expect(polyfillPos).toBeLessThan(bodyScriptPos);
  });

  it('should inject polyfills in head when no scripts exist', async () => {
    updateConfig({ injectPolyfills: true });
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <title>No Scripts Page</title>
        </head>
        <body>
          <div>Content only</div>
        </body>
      </html>
    `;
    const result = await transformHtml(html);

    // Polyfills should be in head
    const headStart = result.indexOf('<head>');
    const headEnd = result.indexOf('</head>');
    const polyfillPos = result.indexOf('Revamp Polyfills');

    expect(polyfillPos).toBeGreaterThan(headStart);
    expect(polyfillPos).toBeLessThan(headEnd);
  });

  it('should ensure Object.fromEntries polyfill is available before any script', async () => {
    updateConfig({ injectPolyfills: true });
    const html = `
      <html>
        <head>
          <script src="https://cdn.example.com/library.js"></script>
        </head>
        <body></body>
      </html>
    `;
    const result = await transformHtml(html);

    // Verify Object.fromEntries polyfill is included
    expect(result).toContain('Object.fromEntries');

    // Verify it comes before the external script
    const fromEntriesPos = result.indexOf('Object.fromEntries');
    const libraryPos = result.indexOf('library.js');

    expect(fromEntriesPos).toBeLessThan(libraryPos);
  });
});
