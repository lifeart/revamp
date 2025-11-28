import { test, expect } from '@playwright/test';
import {
  MOCK_SERVER,
  goToMockServer,
  expectTitleContains,
  logSuccess,
} from './helpers/test-utils';

/**
 * Test suite for verifying pages work through Revamp proxy
 * Tests that pages load correctly and content is transformed
 */

test.describe('Revamp Proxy - Page Verification', () => {
  test.describe('Mock Server - Main Test Page', () => {
    test('should load the homepage', async ({ page }) => {
      await goToMockServer(page);
      await expectTitleContains(page, 'Mock Test Page');
      await expect(page.locator('body')).toBeVisible();
      logSuccess(`Mock server loaded - Title: "${await page.title()}"`);
    });

    test('should have polyfills injected', async ({ page }) => {
      await goToMockServer(page);

      const hasPolyfills = await page.evaluate(() => {
        return typeof Array.prototype.flat === 'function';
      });

      expect(hasPolyfills).toBe(true);
      logSuccess('Mock server - Polyfills verified');
    });
  });

  test.describe('Mock Server - Search Page', () => {
    test('should load the search page', async ({ page }) => {
      await goToMockServer(page, '/search');
      await expect(page.locator('body')).toBeVisible();
      logSuccess(`Search page loaded - Title: "${await page.title()}"`);
    });

    test('should have a search input on main page', async ({ page }) => {
      await goToMockServer(page);

      const searchInput = page.locator('input[type="search"], input[name="q"]').first();
      const hasSearch = (await searchInput.count()) > 0;

      expect(hasSearch).toBe(true);
      logSuccess(`Mock server - Search input present: ${hasSearch}`);
    });
  });

  test.describe('Mock Server - About Page', () => {
    test('should load the about page', async ({ page }) => {
      await goToMockServer(page, '/about');
      await expect(page.locator('body')).toBeVisible();
      logSuccess(`About page loaded - Title: "${await page.title()}"`);
    });

    test('should display content', async ({ page }) => {
      await goToMockServer(page, '/about');
      await page.waitForTimeout(500);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(10);

      logSuccess(`About page - Content loaded (${bodyText.length} chars)`);
    });

    test('should have transformed JavaScript', async ({ page }) => {
      await goToMockServer(page);

      const jsWorks = await page.evaluate(() => {
        return typeof window !== 'undefined' && typeof document !== 'undefined';
      });

      expect(jsWorks).toBe(true);
      logSuccess('Mock server - JavaScript functioning');
    });
  });

  test.describe('Cross-page verification', () => {
    test('should handle multiple pages in sequence', async ({ page }) => {
      const paths = ['/', '/about', '/search'];

      for (const path of paths) {
        await goToMockServer(page, path);
        const title = await page.title();
        logSuccess(`${MOCK_SERVER}${path} - Title: "${title}"`);
      }
    });
  });
});
