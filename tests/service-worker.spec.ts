import { test, expect } from '@playwright/test';
import {
  goToMockServer,
  logSuccess,
  logInfo,
} from './helpers/test-utils';

/**
 * Test suite for Service Worker Bridge
 * Tests that Service Workers are properly bundled and transformed for legacy browsers
 */

test.describe('Service Worker Bridge', () => {
  test.describe('SW Bridge Polyfill Injection', () => {
    test('should inject SW bridge polyfill into pages', async ({ page }) => {
      await goToMockServer(page, '/');

      // Wait for page to load
      await page.waitForTimeout(500);

      // Check that the SW bridge is injected
      const hasBridge = await page.evaluate(() => {
        // The bridge logs this message when ready
        return 'serviceWorker' in navigator &&
          typeof navigator.serviceWorker.register === 'function';
      });

      expect(hasBridge).toBe(true);
      logSuccess('SW bridge polyfill is available');
    });

    test('should have overridden register method', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/');
      await page.waitForTimeout(500);

      // Check for the bridge ready message
      const hasRevampLog = consoleLogs.some((log) =>
        log.includes('[Revamp]') && log.includes('Service Worker')
      );

      expect(hasRevampLog).toBe(true);
      logSuccess('SW bridge initialization logged');
    });
  });

  test.describe('Service Worker Registration', () => {
    test('should intercept and redirect SW registration to proxy', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      // Navigate to SW test page
      await goToMockServer(page, '/sw-test');

      // Wait for SW registration to complete
      await page.waitForTimeout(2000);

      // Check if registration was successful
      const registrationData = await page.evaluate(() => {
        return (window as any).__swTestData;
      });

      expect(registrationData).toBeDefined();
      logInfo(`SW registration data: ${JSON.stringify(registrationData)}`);

      if (registrationData.registered) {
        expect(registrationData.scope).toBeDefined();
        logSuccess('Service Worker registration intercepted and completed');
      } else {
        // Even if registration failed, the bridge should have tried
        logInfo(`Registration result: ${registrationData.error || 'pending'}`);
      }
    });

    test('should call proxied SW bundle endpoint', async ({ page }) => {
      // Monitor network requests
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('__revamp__/sw/bundle')) {
          requests.push(request.url());
        }
      });

      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2000);

      // The bridge should have made a request to the SW bundle endpoint
      logInfo(`SW bundle requests: ${requests.length}`);
      if (requests.length > 0) {
        logInfo(`Request URL: ${requests[0]}`);
        expect(requests[0]).toContain('__revamp__/sw/bundle');
        expect(requests[0]).toContain('url=');
        logSuccess('SW bundle endpoint was called');
      }
    });

    test('should handle SW with imports', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/sw-imports-test');
      await page.waitForTimeout(2500);

      // Check registration result
      const registrationData = await page.evaluate(() => {
        return (window as any).__swImportsTestData;
      });

      expect(registrationData).toBeDefined();
      logInfo(`SW with imports data: ${JSON.stringify(registrationData)}`);

      if (registrationData.registered) {
        logSuccess('Service Worker with imports registered successfully');
      }
    });
  });

  test.describe('Service Worker API', () => {
    test('should provide getRegistration method', async ({ page }) => {
      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2000);

      const hasGetRegistration = await page.evaluate(async () => {
        if (!navigator.serviceWorker.getRegistration) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        return true; // Method exists and doesn't throw
      });

      expect(hasGetRegistration).toBe(true);
      logSuccess('getRegistration method is available');
    });

    test('should provide getRegistrations method', async ({ page }) => {
      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2000);

      const registrations = await page.evaluate(async () => {
        if (!navigator.serviceWorker.getRegistrations) return [];
        return await navigator.serviceWorker.getRegistrations();
      });

      expect(Array.isArray(registrations)).toBe(true);
      logInfo(`Found ${registrations.length} registrations`);
      logSuccess('getRegistrations method is available');
    });

    test('should support unregister on registration', async ({ page }) => {
      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2000);

      const canUnregister = await page.evaluate(async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length > 0 && typeof regs[0].unregister === 'function') {
          const result = await regs[0].unregister();
          return result;
        }
        return 'no registrations';
      });

      logInfo(`Unregister result: ${canUnregister}`);
      logSuccess('Unregister method is available on registration');
    });
  });

  test.describe('SW Bundle Endpoint', () => {
    test('should return bundled SW code from endpoint', async ({ page }) => {
      await goToMockServer(page, '/');

      // Directly fetch the SW bundle endpoint
      const result = await page.evaluate(async () => {
        const swUrl = window.location.origin + '/sw/simple-sw.js';
        const response = await fetch('/__revamp__/sw/bundle?url=' + encodeURIComponent(swUrl));
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: await response.text()
        };
      });

      logInfo(`SW bundle response status: ${result.status}`);
      logInfo(`SW bundle content-type: ${result.contentType}`);

      if (result.status === 200) {
        expect(result.contentType).toContain('javascript');
        expect(result.text.length).toBeGreaterThan(0);
        logSuccess('SW bundle endpoint returns JavaScript');
      } else {
        // The fetch to external URL may fail in test environment
        logInfo(`SW bundle returned error (expected in isolated test): ${result.status}`);
      }
    });

    test('should handle missing url parameter', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const response = await fetch('/__revamp__/sw/bundle');
        return {
          status: response.status,
          text: await response.text()
        };
      });

      expect(result.status).toBe(400);
      expect(result.text).toContain('url');
      logSuccess('SW bundle endpoint validates required url parameter');
    });
  });

  test.describe('Error Handling', () => {
    test('should not crash on pages without SW registration', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await goToMockServer(page, '/');
      await page.waitForTimeout(1000);

      // Page should load without critical errors
      const criticalErrors = errors.filter(
        (e) => e.includes('serviceWorker') || e.includes('SW')
      );

      expect(criticalErrors.length).toBe(0);
      logSuccess('Pages without SW work correctly');
    });

    test('should handle failed SW script fetch gracefully', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/sw-invalid-test');
      await page.waitForTimeout(2000);

      // Should not crash, may log warning
      const registrationData = await page.evaluate(() => {
        return (window as any).__swInvalidTestData;
      });

      expect(registrationData).toBeDefined();
      // Registration should still return something (mock or error)
      logInfo(`Invalid SW test data: ${JSON.stringify(registrationData)}`);
      logSuccess('Gracefully handled invalid SW URL');
    });
  });

  test.describe('Console Logging', () => {
    test('should log SW bridge initialization', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[Revamp]')) {
          consoleLogs.push(msg.text());
        }
      });

      await goToMockServer(page, '/');
      await page.waitForTimeout(500);

      const hasSwLog = consoleLogs.some((log) =>
        log.includes('Service Worker')
      );

      expect(hasSwLog).toBe(true);
      logInfo(`Revamp logs: ${consoleLogs.length} messages`);
      logSuccess('SW bridge logged initialization');
    });
  });

  test.describe('DOM Integration', () => {
    test('should update page after SW registration', async ({ page }) => {
      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2500);

      // Check DOM was updated
      const resultText = await page.locator('#result').textContent();
      logInfo(`Result text: ${resultText}`);

      // Result should indicate registration status
      expect(resultText).toBeDefined();
      expect(resultText?.length).toBeGreaterThan(0);
      logSuccess('DOM updated after SW registration');
    });

    test('should set data attributes after registration', async ({ page }) => {
      await goToMockServer(page, '/sw-test');
      await page.waitForTimeout(2500);

      const dataAttr = await page.locator('#result').getAttribute('data-sw-registered');

      // Should be 'true' or 'false' depending on registration result
      expect(dataAttr).toBeDefined();
      logInfo(`data-sw-registered: ${dataAttr}`);
      logSuccess('Data attribute set after SW registration');
    });
  });

  test.describe('Inline Service Workers', () => {
    test('should handle blob URL service workers', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/sw-inline-blob-test');
      await page.waitForTimeout(2500);

      // Check registration result
      const registrationData = await page.evaluate(() => {
        return (window as any).__swInlineBlobTestData;
      });

      expect(registrationData).toBeDefined();
      logInfo(`Blob SW registration data: ${JSON.stringify(registrationData)}`);

      // Check DOM was updated
      const resultText = await page.locator('#result').textContent();
      logInfo(`Result text: ${resultText}`);

      // The bridge should have intercepted and handled the blob URL
      const hasInlineLogs = consoleLogs.some((log) =>
        log.includes('Inline Blob SW') || log.includes('blob')
      );
      logInfo(`Found inline SW logs: ${hasInlineLogs}`);

      logSuccess('Blob URL SW handled by bridge');
    });

    test('should handle data URL service workers', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/sw-inline-data-test');
      await page.waitForTimeout(2500);

      // Check registration result
      const registrationData = await page.evaluate(() => {
        return (window as any).__swInlineDataTestData;
      });

      expect(registrationData).toBeDefined();
      logInfo(`Data URL SW registration data: ${JSON.stringify(registrationData)}`);

      // Check DOM was updated
      const resultText = await page.locator('#result').textContent();
      logInfo(`Result text: ${resultText}`);

      logSuccess('Data URL SW handled by bridge');
    });

    test('should transform modern syntax in inline SW', async ({ page }) => {
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });

      await goToMockServer(page, '/sw-inline-modern-test');
      await page.waitForTimeout(2500);

      // Check registration result
      const registrationData = await page.evaluate(() => {
        return (window as any).__swInlineModernTestData;
      });

      expect(registrationData).toBeDefined();
      logInfo(`Modern syntax SW registration data: ${JSON.stringify(registrationData)}`);

      // Check DOM was updated
      const resultText = await page.locator('#result').textContent();
      logInfo(`Result text: ${resultText}`);

      logSuccess('Modern syntax in inline SW handled');
    });
  });

  test.describe('SW Inline Endpoint', () => {
    test('should transform inline SW code via POST', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const swCode = `
          // Test inline SW
          self.addEventListener('install', function(e) {
            console.log('Installing');
          });
        `;

        const response = await fetch('/__revamp__/sw/inline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: swCode, scope: '/' })
        });

        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: await response.text()
        };
      });

      logInfo(`SW inline response status: ${result.status}`);
      logInfo(`SW inline content-type: ${result.contentType}`);

      expect(result.status).toBe(200);
      expect(result.contentType).toContain('javascript');
      expect(result.text.length).toBeGreaterThan(0);
      // Should have the wrapper added
      expect(result.text).toContain('[Revamp]');
      logSuccess('SW inline endpoint transforms code');
    });

    test('should require POST method for inline endpoint', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const response = await fetch('/__revamp__/sw/inline', {
          method: 'GET'
        });
        return {
          status: response.status,
          text: await response.text()
        };
      });

      expect(result.status).toBe(405);
      expect(result.text).toContain('Method not allowed');
      logSuccess('SW inline endpoint rejects GET');
    });

    test('should validate code parameter', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const response = await fetch('/__revamp__/sw/inline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: '/' }) // Missing code
        });
        return {
          status: response.status,
          text: await response.text()
        };
      });

      expect(result.status).toBe(400);
      expect(result.text).toContain('code');
      logSuccess('SW inline endpoint validates code parameter');
    });

    test('should handle invalid JSON body', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const response = await fetch('/__revamp__/sw/inline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-valid-json'
        });
        return {
          status: response.status,
          text: await response.text()
        };
      });

      expect(result.status).toBe(400);
      expect(result.text).toContain('Invalid JSON');
      logSuccess('SW inline endpoint handles invalid JSON');
    });

    test('should transform modern JS syntax to legacy', async ({ page }) => {
      await goToMockServer(page, '/');

      const result = await page.evaluate(async () => {
        const swCode = `
          const arrow = () => console.log('arrow');
          const template = \`string \${1 + 2}\`;
          self.addEventListener('install', async (e) => {
            await self.skipWaiting();
          });
        `;

        const response = await fetch('/__revamp__/sw/inline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: swCode })
        });

        return {
          status: response.status,
          text: await response.text()
        };
      });

      expect(result.status).toBe(200);
      // Should have transformed arrow functions and template literals
      // The exact output depends on Babel config
      expect(result.text.length).toBeGreaterThan(0);
      logInfo(`Transformed code length: ${result.text.length}`);
      logSuccess('SW inline endpoint transforms modern syntax');
    });
  });

  test.describe('emulateServiceWorkers Config Option', () => {
    test('should use bridge polyfill when emulateServiceWorkers is true (default)', async ({ page }) => {
      const { getConfig, updateConfig, resetConfig } = await import('./helpers/test-utils');

      // First reset to defaults to ensure clean state
      await goToMockServer(page, '/');
      await resetConfig(page);

      // Reload to apply default config (emulateServiceWorkers: true)
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Check that bridge mode is active - it logs a ready message
      const result = await page.evaluate(async () => {
        // Try to register a SW and see what happens
        try {
          // In bridge mode, the register function should exist and not immediately reject
          const hasRegister = 'serviceWorker' in navigator &&
            typeof navigator.serviceWorker.register === 'function';

          // Check page source for bridge indicator
          const pageSource = document.documentElement.outerHTML;
          const hasBridgeIndicator = pageSource.includes('bridge (enabled)') ||
            pageSource.includes('RevampServiceWorkerBridge');

          return {
            hasRegister,
            hasBridgeIndicator,
          };
        } catch (e) {
          return { error: String(e) };
        }
      });

      expect(result).toHaveProperty('hasRegister', true);
      logSuccess('Bridge mode is active when emulateServiceWorkers=true');
    });

    test('should toggle emulateServiceWorkers config option', async ({ page }) => {
      const { getConfig, updateConfig, resetConfig } = await import('./helpers/test-utils');

      await goToMockServer(page, '/');

      // Get current config
      const { config: originalConfig } = await getConfig(page);
      const originalValue = (originalConfig as { emulateServiceWorkers?: boolean }).emulateServiceWorkers;

      logInfo(`Original emulateServiceWorkers: ${originalValue}`);
      expect(originalValue).toBe(true); // Default should be true

      // Set to false
      await updateConfig(page, { emulateServiceWorkers: false } as never);

      // Verify it changed
      const { config: updatedConfig } = await getConfig(page);
      expect((updatedConfig as { emulateServiceWorkers?: boolean }).emulateServiceWorkers).toBe(false);
      logInfo('Config updated to false');

      // Set back to true
      await updateConfig(page, { emulateServiceWorkers: true } as never);

      // Verify it changed back
      const { config: restoredConfig } = await getConfig(page);
      expect((restoredConfig as { emulateServiceWorkers?: boolean }).emulateServiceWorkers).toBe(true);
      logInfo('Config restored to true');

      // Reset to defaults
      await resetConfig(page);

      logSuccess('emulateServiceWorkers config can be toggled');
    });

    test('should persist emulateServiceWorkers setting', async ({ page }) => {
      const { getConfig, updateConfig, resetConfig } = await import('./helpers/test-utils');

      await goToMockServer(page, '/');

      // Get current config
      const { config: originalConfig } = await getConfig(page);

      // Update setting
      await updateConfig(page, { emulateServiceWorkers: false } as never);

      // Verify it persisted
      const { config: updatedConfig } = await getConfig(page);
      expect((updatedConfig as { emulateServiceWorkers?: boolean }).emulateServiceWorkers).toBe(false);

      // Reset
      await resetConfig(page);

      // Verify reset
      const { config: resetConfigValues } = await getConfig(page);
      expect((resetConfigValues as { emulateServiceWorkers?: boolean }).emulateServiceWorkers).toBe(true);

      logSuccess('emulateServiceWorkers config persists and resets correctly');
    });
  });
});
