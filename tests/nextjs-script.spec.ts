import { test, expect } from '@playwright/test';
import { goToMockServer, logSuccess } from './helpers/test-utils';

/**
 * Test suite for Next.js self.__next_f.push() script pattern
 * Ensures the proxy correctly transforms and serves pages with Next.js RSC flight data
 */

test.describe('Next.js Script Transformation', () => {
  test.describe('self.__next_f.push() Pattern', () => {
    test('should execute self.__next_f.push() without runtime errors', async ({ page }) => {
      // Collect any page errors
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      // Check that push was called
      const testData = await page.evaluate(() => {
        return (window as unknown as { __nextjsTestData: unknown }).__nextjsTestData;
      });

      expect(testData).toBeDefined();
      expect((testData as { pushCalled: boolean }).pushCalled).toBe(true);
      expect(errors).toHaveLength(0);

      logSuccess('self.__next_f.push() executed without runtime errors');
    });

    test('should be able to parse the JSON payload from push argument', async ({ page }) => {
      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      const testData = await page.evaluate(() => {
        return (window as unknown as { __nextjsTestData: {
          pushCalled: boolean;
          parseSuccess: boolean;
          parsedJson: unknown;
          parseError?: string;
        } }).__nextjsTestData;
      });

      expect(testData.parseSuccess).toBe(true);
      expect(testData.parsedJson).toBeDefined();
      expect(testData.parseError).toBeUndefined();

      // Verify the parsed JSON has expected structure (React element array)
      const parsed = testData.parsedJson as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toBe('$'); // React element marker
      expect(parsed[1]).toBe('footer'); // Element type

      logSuccess('JSON payload parsed successfully from self.__next_f.push() argument');
    });

    test('should have correct footer element properties in parsed JSON', async ({ page }) => {
      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      const testData = await page.evaluate(() => {
        return (window as unknown as { __nextjsTestData: {
          parsedJson: unknown;
        } }).__nextjsTestData;
      });

      const parsed = testData.parsedJson as [string, string, null, { id: string; className: string }];

      // Verify React element structure: ["$", "footer", null, {props}]
      expect(parsed[0]).toBe('$');
      expect(parsed[1]).toBe('footer');
      expect(parsed[2]).toBeNull();
      expect(parsed[3]).toHaveProperty('id', 'footer');
      expect(parsed[3]).toHaveProperty('className');
      expect(parsed[3].className).toContain('bg-neutral-900');

      logSuccess('Parsed JSON contains correct footer element properties');
    });

    test('should not have any JavaScript errors on the page', async ({ page }) => {
      const errors: { message: string; source?: string; line?: number }[] = [];

      page.on('pageerror', (err) => {
        errors.push({ message: err.message });
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push({ message: msg.text() });
        }
      });

      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(1000);

      // Check for errors captured by the page's own error handler
      const pageErrors = await page.evaluate(() => {
        return (window as unknown as { __nextjsTestData: { errors: unknown[] } }).__nextjsTestData.errors;
      });

      expect(errors).toHaveLength(0);
      expect(pageErrors).toHaveLength(0);

      logSuccess('No JavaScript errors detected on page');
    });

    test('should update DOM correctly after script execution', async ({ page }) => {
      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      // Check result element
      const resultEl = page.locator('#result');
      await expect(resultEl).toBeVisible();
      const resultText = await resultEl.textContent();
      expect(resultText).toContain('Push called');

      // Check parsed data element
      const parsedEl = page.locator('#parsed-data');
      await expect(parsedEl).toBeVisible();
      await expect(parsedEl).toHaveAttribute('data-loaded', 'true');

      logSuccess('DOM updated correctly after script execution');
    });

    test('should preserve __next_f array functionality', async ({ page }) => {
      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      // Verify __next_f array exists and has data
      const nextFData = await page.evaluate(() => {
        const win = window as unknown as { __next_f: unknown[] };
        return {
          exists: Array.isArray(win.__next_f),
          length: win.__next_f?.length ?? 0,
          firstItem: win.__next_f?.[0]
        };
      });

      expect(nextFData.exists).toBe(true);
      expect(nextFData.length).toBeGreaterThan(0);
      expect(nextFData.firstItem).toBeDefined();

      logSuccess('__next_f array preserved and functional');
    });

    test('should handle Cyrillic characters in JSON payload', async ({ page }) => {
      await goToMockServer(page, '/nextjs-script-test');
      await page.waitForTimeout(500);

      const testData = await page.evaluate(() => {
        return (window as unknown as { __nextjsTestData: {
          parsedJson: unknown;
        } }).__nextjsTestData;
      });

      // Convert to string to check for Cyrillic content
      const jsonString = JSON.stringify(testData.parsedJson);

      // The mock contains "Мы в соцсетях" (Russian: "We are on social networks")
      expect(jsonString).toContain('Мы в соцсетях');

      logSuccess('Cyrillic characters preserved correctly in JSON payload');
    });
  });
});
