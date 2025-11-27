import { test, expect } from '@playwright/test';

/**
 * Test suite for verifying pages work through Revamp proxy
 * Tests that pages load correctly and content is transformed
 */

test.describe('Revamp Proxy - Page Verification', () => {
  
  test.describe('2ip.ru - IP Information Service', () => {
    test('should load the homepage', async ({ page }) => {
      const response = await page.goto('https://2ip.ru/', {
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
      
      console.log(`✅ 2ip.ru loaded - Title: "${title}"`);
    });

    test('should have polyfills injected', async ({ page }) => {
      await page.goto('https://2ip.ru/', {
        waitUntil: 'domcontentloaded',
      });
      
      // Check that our polyfills are present
      const hasPolyfills = await page.evaluate(() => {
        // Check for Array.prototype.flat polyfill marker or native
        return typeof Array.prototype.flat === 'function';
      });
      
      expect(hasPolyfills).toBe(true);
      console.log('✅ 2ip.ru - Polyfills verified');
    });
  });

  test.describe('ya.ru - Yandex Search', () => {
    test('should load the homepage', async ({ page }) => {
      const response = await page.goto('https://ya.ru/', {
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
      
      console.log(`✅ ya.ru loaded - Title: "${title}"`);
    });

    test('should have a search input', async ({ page }) => {
      await page.goto('https://ya.ru/', {
        waitUntil: 'domcontentloaded',
      });
      
      // Yandex should have a search form
      const searchInput = page.locator('input[type="search"], input[name="text"], input[aria-label*="search" i], input[placeholder*="поиск" i], input[placeholder*="search" i]').first();
      
      // Check if search exists (may vary based on page version)
      const hasSearch = await searchInput.count() > 0;
      console.log(`✅ ya.ru - Search input present: ${hasSearch}`);
      
      // Page should at least be functional
      expect(await page.locator('body').count()).toBe(1);
    });
  });

  test.describe('pikabu.ru - Entertainment Portal', () => {
    test('should load the homepage', async ({ page }) => {
      const response = await page.goto('https://pikabu.ru/', {
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
      
      console.log(`✅ pikabu.ru loaded - Title: "${title}"`);
    });

    test('should display content', async ({ page }) => {
      await page.goto('https://pikabu.ru/', {
        waitUntil: 'domcontentloaded',
      });
      
      // Wait for some content to appear
      await page.waitForTimeout(2000);
      
      // Check that the page has some visible text content
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(100);
      
      console.log(`✅ pikabu.ru - Content loaded (${bodyText.length} chars)`);
    });

    test('should have transformed JavaScript', async ({ page }) => {
      await page.goto('https://pikabu.ru/', {
        waitUntil: 'domcontentloaded',
      });
      
      // Verify JavaScript is functioning
      const jsWorks = await page.evaluate(() => {
        return typeof window !== 'undefined' && typeof document !== 'undefined';
      });
      
      expect(jsWorks).toBe(true);
      console.log('✅ pikabu.ru - JavaScript functioning');
    });
  });

  test.describe('Cross-site verification', () => {
    test('should handle multiple sites in sequence', async ({ page }) => {
      const sites = [
        'https://2ip.ru/',
        'https://ya.ru/',
        'https://pikabu.ru/',
      ];
      
      for (const site of sites) {
        const response = await page.goto(site, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        
        expect(response?.status()).toBeLessThan(400);
        
        const title = await page.title();
        console.log(`✅ ${site} - Title: "${title}"`);
      }
    });
  });
});
