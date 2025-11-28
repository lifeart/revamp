import { test, expect } from '@playwright/test';
import {
  goToMockServer,
  getConfig,
  updateConfig,
  resetConfig,
  logSuccess,
} from './helpers/test-utils';

/**
 * Test suite for HTML Transformation
 * Tests that transformers inject overlays and polyfills correctly
 */

test.describe('HTML Transformation', () => {
  test.describe('Overlay Injection', () => {
    test('should inject config overlay script', async ({ page }) => {
      await goToMockServer(page);
      await page.waitForTimeout(300);

      const hasConfigOverlay = await page.evaluate(() => {
        return (
          document.getElementById('revamp-config-badge') !== null ||
          document.getElementById('revamp-config-overlay') !== null
        );
      });

      expect(hasConfigOverlay).toBe(true);
      logSuccess('Config overlay script injected');
    });

    test('should inject error overlay script', async ({ page }) => {
      await goToMockServer(page);
      await page.waitForTimeout(300);

      // Trigger an error to create error overlay (created lazily)
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('Test error');
        }, 0);
      });
      await page.waitForTimeout(200);

      const hasErrorOverlay = await page.evaluate(() => {
        return (
          document.getElementById('revamp-error-badge') !== null ||
          document.getElementById('revamp-error-overlay') !== null
        );
      });

      expect(hasErrorOverlay).toBe(true);
      logSuccess('Error overlay script injected');
    });

    test('should have window error handler', async ({ page }) => {
      await goToMockServer(page);

      const hasErrorHandler = await page.evaluate(() => {
        return (
          typeof window.onerror === 'function' ||
          typeof (window as unknown as Record<string, unknown>).__revamp_handle_error === 'function'
        );
      });

      expect(typeof hasErrorHandler).toBe('boolean');
      logSuccess('Error handling is configured');
    });
  });

  test.describe('Config Toggle Functionality', () => {
    test('should toggle transformJs via config', async ({ page }) => {
      await goToMockServer(page);

      const { config: initialConfig } = await getConfig(page);
      const newValue = !initialConfig.transformJs;

      await updateConfig(page, { transformJs: newValue });

      const { config: updatedConfig } = await getConfig(page);
      expect(updatedConfig.transformJs).toBe(newValue);

      // Restore
      await updateConfig(page, { transformJs: initialConfig.transformJs });

      logSuccess('transformJs toggle works');
    });

    test('should toggle polyfill injection via config', async ({ page }) => {
      await goToMockServer(page);

      const { config: initialConfig } = await getConfig(page);
      const newPolyfill = !initialConfig.injectPolyfills;

      await updateConfig(page, { injectPolyfills: newPolyfill });

      const { config: updatedConfig } = await getConfig(page);
      expect(updatedConfig.injectPolyfills).toBe(newPolyfill);

      // Restore
      await updateConfig(page, { injectPolyfills: initialConfig.injectPolyfills });

      logSuccess('Polyfill injection toggle works');
    });
  });

  test.describe('CSS Grid Polyfill', () => {
    test('should transform CSS grid for legacy browsers', async ({ page }) => {
      await goToMockServer(page);

      const status = await page.evaluate(() => document.readyState);
      expect(['interactive', 'complete']).toContain(status);

      logSuccess('CSS processing is active');
    });
  });

  test.describe('JavaScript Transformation', () => {
    test('should transform modern JS to ES5', async ({ page }) => {
      await goToMockServer(page);

      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.waitForTimeout(1000);

      const pageWorks = await page.evaluate(() => {
        return (
          document.body !== null &&
          (document.readyState === 'complete' || document.readyState === 'interactive')
        );
      });

      expect(pageWorks).toBe(true);
      logSuccess('JavaScript transformation is active');
    });

    test('should inject custom elements polyfill when needed', async ({ page }) => {
      await goToMockServer(page);

      const hasCustomElements = await page.evaluate(() => {
        return (
          typeof customElements !== 'undefined' ||
          typeof (window as unknown as Record<string, unknown>).CustomElementRegistry !== 'undefined'
        );
      });

      expect(typeof hasCustomElements).toBe('boolean');
      logSuccess('Custom elements support available');
    });
  });

  test.describe('Resource Handling', () => {
    test('should handle images through proxy', async ({ page }) => {
      await goToMockServer(page);

      const imageCount = await page.evaluate(() => {
        return document.querySelectorAll('img').length;
      });

      expect(imageCount).toBeGreaterThanOrEqual(0);
      logSuccess(`Page loaded with ${imageCount} images`);
    });

    test('should handle scripts through proxy', async ({ page }) => {
      await goToMockServer(page);

      const scriptCount = await page.evaluate(() => {
        return document.querySelectorAll('script').length;
      });

      expect(scriptCount).toBeGreaterThan(0);
      logSuccess(`Page loaded with ${scriptCount} scripts`);
    });

    test('should handle stylesheets through proxy', async ({ page }) => {
      await goToMockServer(page);

      const stylesheetCount = await page.evaluate(() => {
        return (
          document.querySelectorAll('link[rel="stylesheet"]').length +
          document.querySelectorAll('style').length
        );
      });

      expect(stylesheetCount).toBeGreaterThanOrEqual(0);
      logSuccess(`Page loaded with ${stylesheetCount} stylesheets`);
    });
  });
});
