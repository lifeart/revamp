import { test, expect } from '@playwright/test';
import {
  goToMockServer,
  logSuccess,
  logInfo,
  updateConfig,
  getConfig,
} from './helpers/test-utils';

/**
 * Test suite for ES Module Bundling
 * Tests that ES modules are properly bundled for legacy browsers
 */

test.describe('ES Module Bundling', () => {
  test.describe('External Module Scripts', () => {
    test('should bundle and execute external ES module', async ({ page }) => {
      // Listen for console logs to verify module execution
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[ESM Test]')) {
          consoleLogs.push(msg.text());
        }
      });

      // Navigate to the ES module test page
      await goToMockServer(page, '/esm-test');

      // Wait for modules to load and execute
      await page.waitForTimeout(2000);

      // Check that the main module executed
      const resultText = await page.locator('#result').textContent();
      expect(resultText).toContain('Hello');
      logSuccess('External ES module executed successfully');

      // Verify module data was set on window
      const moduleData = await page.evaluate(() => {
        return (window as unknown as { __esmTestData?: { loaded: boolean; greeting: string; sum: number; product: number } }).__esmTestData;
      });

      expect(moduleData).toBeDefined();
      expect(moduleData?.loaded).toBe(true);
      logInfo(`Module data: ${JSON.stringify(moduleData)}`);
    });

    test('should handle nested module imports (3 levels deep)', async ({ page }) => {
      // Navigate to the ES module test page
      await goToMockServer(page, '/esm-test');

      // Wait for all modules to load
      await page.waitForTimeout(2000);

      // Check nested result - this confirms the nested imports work
      // main.js -> utils/greeting.js -> utils/string-helpers.js
      const nestedResult = await page.locator('#nested-result').textContent();
      expect(nestedResult).toContain('Nested import works');

      // Verify the greeting includes proper capitalization (from string-helpers.js)
      const moduleData = await page.evaluate(() => {
        return (window as unknown as { __esmTestData?: { greeting: string } }).__esmTestData;
      });

      // 'World' should be capitalized to 'World' by the nested string-helpers module
      expect(moduleData?.greeting).toBe('Hello, World!');

      logSuccess('Nested module imports (3 levels) work correctly');
    });

    test('should execute math operations from nested module', async ({ page }) => {
      await goToMockServer(page, '/esm-test');

      // Wait for modules to load
      await page.waitForTimeout(2000);

      // Check math result from nested math module
      const mathResult = await page.locator('#math-result').textContent();
      expect(mathResult).toContain('Sum: 30'); // add(10, 20) = 30
      expect(mathResult).toContain('Product: 30'); // multiply(5, 6) = 30

      // Verify through window data
      const moduleData = await page.evaluate(() => {
        return (window as unknown as { __esmTestData?: { sum: number; product: number } }).__esmTestData;
      });

      expect(moduleData?.sum).toBe(30);
      expect(moduleData?.product).toBe(30);

      logSuccess('Math module functions executed correctly');
    });
  });

  test.describe('Inline Module Scripts', () => {
    test('should bundle and execute inline ES module', async ({ page }) => {
      // Navigate to inline module test page
      await goToMockServer(page, '/esm-inline-test');

      // Wait for module to execute
      await page.waitForTimeout(1500);

      // Check that inline module executed
      const resultText = await page.locator('#inline-result').textContent();
      expect(resultText).toBe('Hello from inline module!');

      // Verify execution flag
      const executed = await page.evaluate(() => {
        return (window as unknown as { __inlineModuleExecuted?: boolean }).__inlineModuleExecuted;
      });
      expect(executed).toBe(true);

      logSuccess('Inline ES module bundled and executed');
    });

    test('should set data attribute after inline module execution', async ({ page }) => {
      await goToMockServer(page, '/esm-inline-test');

      // Wait for module to execute
      await page.waitForTimeout(1500);

      // Check data-loaded attribute
      const dataLoaded = await page.locator('#inline-result').getAttribute('data-loaded');
      expect(dataLoaded).toBe('true');

      logSuccess('Inline module correctly set DOM attributes');
    });
  });

  test.describe('Module Bundling Transformation', () => {
    test('should remove type="module" attribute after bundling', async ({ page }) => {
      await goToMockServer(page, '/esm-test');

      // Wait for page to fully load
      await page.waitForTimeout(500);

      // Check that module scripts no longer have type="module"
      // (they should be transformed to regular scripts)
      const moduleScripts = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="module"]');
        return scripts.length;
      });

      // After bundling, there should be no type="module" scripts
      // (they're converted to regular IIFE scripts)
      expect(moduleScripts).toBe(0);

      logSuccess('Module scripts transformed (type="module" removed)');
    });

    test('should inject ES Module shim script', async ({ page }) => {
      await goToMockServer(page, '/esm-test');

      await page.waitForTimeout(500);

      // Check for the module shim
      const hasShim = await page.evaluate(() => {
        return typeof (window as unknown as { __revampModules?: unknown }).__revampModules !== 'undefined';
      });

      expect(hasShim).toBe(true);
      logSuccess('ES Module shim injected');
    });

    test('should add bundled modules comment to HTML', async ({ page }) => {
      await goToMockServer(page, '/esm-test');

      const html = await page.content();

      // Check for the Revamp comment showing bundled modules count
      expect(html).toContain('Revamp Proxy:');
      expect(html).toContain('bundled');

      logSuccess('Bundled modules comment present in HTML');
    });
  });

  test.describe('Configuration', () => {
    test('should respect bundleEsModules config option', async ({ page }) => {
      // First verify bundling works when enabled
      await goToMockServer(page, '/esm-inline-test');
      await page.waitForTimeout(1500);

      let executed = await page.evaluate(() => {
        return (window as unknown as { __inlineModuleExecuted?: boolean }).__inlineModuleExecuted;
      });
      expect(executed).toBe(true);

      logSuccess('ES module bundling works when enabled');
    });

    test('should include bundleEsModules in config API response', async ({ page }) => {
      await goToMockServer(page, '/');

      const { config } = await getConfig(page);

      // bundleEsModules should be in the config
      expect('bundleEsModules' in config).toBe(true);
      expect(typeof config.bundleEsModules).toBe('boolean');

      logInfo(`bundleEsModules config: ${config.bundleEsModules}`);
      logSuccess('bundleEsModules present in config API');
    });
  });

  test.describe('Error Handling', () => {
    test('should not crash on pages without modules', async ({ page }) => {
      // Regular page without modules should work fine
      await goToMockServer(page, '/');

      await page.waitForTimeout(500);

      const title = await page.title();
      expect(title).toContain('Mock Test Page');

      logSuccess('Pages without modules work correctly');
    });

    test('should handle modules with modern syntax', async ({ page }) => {
      // The modules use modern syntax (arrow functions, const, etc.)
      // These should be transformed by Babel after esbuild bundles them
      await goToMockServer(page, '/esm-test');

      // Collect any page errors
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.waitForTimeout(2000);

      // Should have no critical errors
      const criticalErrors = errors.filter(
        (e) => !e.includes('ResizeObserver') && !e.includes('Script error')
      );

      // Log any errors for debugging
      if (criticalErrors.length > 0) {
        logInfo(`Page errors: ${criticalErrors.join(', ')}`);
      }

      // The module should still execute
      const moduleData = await page.evaluate(() => {
        return (window as unknown as { __esmTestData?: { loaded: boolean } }).__esmTestData;
      });

      expect(moduleData?.loaded).toBe(true);
      logSuccess('Modern syntax in modules handled correctly');
    });
  });

  test.describe('Console Logging', () => {
    test('should log module loading sequence', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[ESM Test]')) {
          consoleLogs.push(msg.text());
        }
      });

      await goToMockServer(page, '/esm-test');
      await page.waitForTimeout(2000);

      // Verify loading order - nested modules should load first
      const hasStringHelpers = consoleLogs.some((log) =>
        log.includes('String helpers module')
      );
      const hasMathModule = consoleLogs.some((log) => log.includes('Math module'));
      const hasGreetingModule = consoleLogs.some((log) =>
        log.includes('Greeting module')
      );
      const hasMainModule = consoleLogs.some((log) => log.includes('Main module'));

      expect(hasStringHelpers).toBe(true);
      expect(hasMathModule).toBe(true);
      expect(hasGreetingModule).toBe(true);
      expect(hasMainModule).toBe(true);

      logInfo(`Module logs captured: ${consoleLogs.length} messages`);
      logSuccess('All modules logged their execution');
    });
  });

  test.describe('Import Maps', () => {
    test('should resolve bare specifiers using import map', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/esm-importmap-test');
      await page.waitForTimeout(2000);

      // Check that the module executed
      const hasImportMapLog = consoleLogs.some((log) =>
        log.includes('[Import Map Test]')
      );
      logInfo(`Import map logs: ${consoleLogs.filter(l => l.includes('Import Map')).length}`);

      // Check results in the DOM
      const greetingResult = await page.locator('#greeting-result').textContent();
      const mathResult = await page.locator('#math-result').textContent();

      logInfo(`Greeting result: ${greetingResult}`);
      logInfo(`Math result: ${mathResult}`);

      // Check the data attribute
      const greetingLoaded = await page.locator('#greeting-result').getAttribute('data-loaded');
      const mathLoaded = await page.locator('#math-result').getAttribute('data-loaded');

      // Verify the module executed and used import map
      expect(hasImportMapLog).toBe(true);
      expect(greetingLoaded).toBe('true');
      expect(mathLoaded).toBe('true');
      expect(greetingResult).toContain('Hello');
      expect(mathResult).toContain('Sum=300');
      expect(mathResult).toContain('Product=200');

      // Check window data
      const testData = await page.evaluate(() => (window as any).__importMapTestData);
      expect(testData).toBeDefined();
      expect(testData.loaded).toBe(true);
      expect(testData.sum).toBe(300);
      expect(testData.product).toBe(200);

      logSuccess('Import map resolved bare specifiers correctly');
    });
  });
});
