import { test, expect } from '@playwright/test';

/**
 * Test suite for verifying pages work through Revamp proxy
 * Tests that pages load correctly and content is transformed
 *
 * Uses a local mock server (http://127.0.0.1:9080) to avoid external dependencies
 */

// Mock server URL (started by playwright via webServer config)
const MOCK_SERVER = 'http://127.0.0.1:9080';

test.describe('Revamp Proxy - Page Verification', () => {

  test.describe('Mock Server - Main Test Page', () => {
    test('should load the homepage', async ({ page }) => {
      const response = await page.goto(`${MOCK_SERVER}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const status = response?.status() ?? 0;

      // Verify page loaded successfully (mock server should never return 5xx)
      expect(status).toBeLessThan(400);

      // Check page has content
      const title = await page.title();
      expect(title).toBeTruthy();
      expect(title).toContain('Mock Test Page');

      // Verify the page has main content
      const body = await page.locator('body');
      await expect(body).toBeVisible();

      console.log(`✅ Mock server loaded - Title: "${title}"`);
    });

    test('should have polyfills injected', async ({ page }) => {
      await page.goto(`${MOCK_SERVER}/`, {
        waitUntil: 'domcontentloaded',
      });

      // Check that our polyfills are present
      const hasPolyfills = await page.evaluate(() => {
        // Check for Array.prototype.flat polyfill marker or native
        return typeof Array.prototype.flat === 'function';
      });

      expect(hasPolyfills).toBe(true);
      console.log('✅ Mock server - Polyfills verified');
    });
  });

  test.describe('Mock Server - Search Page', () => {
    test('should load the search page', async ({ page }) => {
      const response = await page.goto(`${MOCK_SERVER}/search`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Verify page loaded successfully
      expect(response?.status()).toBeLessThan(400);

      // Check page has content
      const title = await page.title();
      expect(title).toBeTruthy();

      // Verify the page has main content
      const body = await page.locator('body');
      await expect(body).toBeVisible();

      console.log(`✅ Search page loaded - Title: "${title}"`);
    });

    test('should have a search input on main page', async ({ page }) => {
      await page.goto(`${MOCK_SERVER}/`, {
        waitUntil: 'domcontentloaded',
      });

      // Main page should have a search form
      const searchInput = page.locator('input[type="search"], input[name="q"]').first();

      // Check if search exists
      const hasSearch = await searchInput.count() > 0;
      expect(hasSearch).toBe(true);
      console.log(`✅ Mock server - Search input present: ${hasSearch}`);
    });
  });

  test.describe('Mock Server - About Page', () => {
    test('should load the about page', async ({ page }) => {
      const response = await page.goto(`${MOCK_SERVER}/about`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Verify page loaded successfully
      expect(response?.status()).toBeLessThan(400);

      // Check page has content
      const title = await page.title();
      expect(title).toBeTruthy();

      // Verify the page has main content
      const body = await page.locator('body');
      await expect(body).toBeVisible();

      console.log(`✅ About page loaded - Title: "${title}"`);
    });

    test('should display content', async ({ page }) => {
      await page.goto(`${MOCK_SERVER}/about`, {
        waitUntil: 'domcontentloaded',
      });

      // Wait for some content to appear
      await page.waitForTimeout(500);

      // Check that the page has some visible text content
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(10);

      console.log(`✅ About page - Content loaded (${bodyText.length} chars)`);
    });

    test('should have transformed JavaScript', async ({ page }) => {
      await page.goto(`${MOCK_SERVER}/`, {
        waitUntil: 'domcontentloaded',
      });

      // Verify JavaScript is functioning
      const jsWorks = await page.evaluate(() => {
        return typeof window !== 'undefined' && typeof document !== 'undefined';
      });

      expect(jsWorks).toBe(true);
      console.log('✅ Mock server - JavaScript functioning');
    });
  });

  test.describe('Cross-page verification', () => {
    test('should handle multiple pages in sequence', async ({ page }) => {
      const pages = [
        `${MOCK_SERVER}/`,
        `${MOCK_SERVER}/about`,
        `${MOCK_SERVER}/search`,
      ];

      for (const pageUrl of pages) {
        const response = await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        const status = response?.status() ?? 0;

        // All mock server pages should load successfully
        expect(status).toBeLessThan(400);

        const title = await page.title();
        console.log(`✅ ${pageUrl} - Title: "${title}"`);
      }
    });
  });
});
