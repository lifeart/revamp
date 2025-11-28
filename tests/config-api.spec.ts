import { test, expect, request } from '@playwright/test';

/**
 * Test suite for the Config API
 * Tests the /__revamp__/config endpoint functionality
 */

// Use a real site that we can access through the proxy
const TEST_SITE = 'https://ya.ru';
const CONFIG_PATH = '/__revamp__/config';

test.describe('Config API', () => {
  test.describe('Direct API Access (via proxy)', () => {
    test('should GET current config', async ({ page }) => {
      // Navigate to a site through proxy first
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Make request to config endpoint (intercepted by proxy)
      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.json()
        };
      }, CONFIG_PATH);

      expect(response.status).toBe(200);
      // API returns { success: true, config: {...} } wrapper
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('config');
      expect(response.body.config).toHaveProperty('transformJs');
      expect(response.body.config).toHaveProperty('transformCss');
      expect(response.body.config).toHaveProperty('removeAds');
      expect(response.body.config).toHaveProperty('cacheEnabled');

      console.log('✅ GET config returns current settings');
      console.log('   Config:', JSON.stringify(response.body.config));
    });

    test('should have CORS headers', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return {
          status: res.status,
          headers: {
            'access-control-allow-origin': res.headers.get('access-control-allow-origin'),
            'content-type': res.headers.get('content-type'),
          }
        };
      }, CONFIG_PATH);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['content-type']).toContain('application/json');

      console.log('✅ Config endpoint has CORS headers');
    });

    test('should POST to update config', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get current config first (API returns { success, config })
      const currentResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);
      const currentConfig = currentResponse.config;

      // Try to update config (toggle a value)
      const newCacheEnabled = !currentConfig.cacheEnabled;

      const updateResponse = await page.evaluate(async ({ endpoint, newValue }) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cacheEnabled: newValue })
        });
        return {
          status: res.status,
          body: await res.json()
        };
      }, { endpoint: CONFIG_PATH, newValue: newCacheEnabled });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);

      // Verify the change (API returns { success, config })
      const updatedResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);

      expect(updatedResponse.config.cacheEnabled).toBe(newCacheEnabled);

      // Restore original value
      await page.evaluate(async ({ endpoint, originalValue }) => {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cacheEnabled: originalValue })
        });
      }, { endpoint: CONFIG_PATH, originalValue: currentConfig.cacheEnabled });

      console.log('✅ POST config updates settings successfully');
    });

    test('should DELETE to reset config to defaults', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // First, change a config value
      await page.evaluate(async (endpoint) => {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeAds: false })
        });
      }, CONFIG_PATH);

      // Now reset to defaults
      const deleteResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint, { method: 'DELETE' });
        return {
          status: res.status,
          body: await res.json()
        };
      }, CONFIG_PATH);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify reset (API returns { success, config })
      const resetResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);

      // Defaults should have removeAds: true
      expect(resetResponse.config.removeAds).toBe(true);

      console.log('✅ DELETE config resets to defaults');
    });

    test('should handle OPTIONS preflight request', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint, { method: 'OPTIONS' });
        return {
          status: res.status,
          headers: {
            'access-control-allow-methods': res.headers.get('access-control-allow-methods'),
          }
        };
      }, CONFIG_PATH);

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('GET');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-methods']).toContain('DELETE');

      console.log('✅ OPTIONS preflight returns correct headers');
    });
  });

  test.describe('Config Persistence', () => {
    test('should persist config changes across requests', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get original config (API returns { success, config })
      const originalResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);
      const originalConfig = originalResponse.config;

      // Update config
      const testValue = !originalConfig.spoofUserAgent;
      await page.evaluate(async ({ endpoint, value }) => {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spoofUserAgent: value })
        });
      }, { endpoint: CONFIG_PATH, value: testValue });

      // Navigate to different page
      await page.goto('https://pikabu.ru/', { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check config again from different domain (API returns { success, config })
      const persistedResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);

      expect(persistedResponse.config.spoofUserAgent).toBe(testValue);

      // Restore original
      await page.evaluate(async ({ endpoint, value }) => {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spoofUserAgent: value })
        });
      }, { endpoint: CONFIG_PATH, value: originalConfig.spoofUserAgent });

      console.log('✅ Config persists across different domains');
    });
  });

  test.describe('Config Validation', () => {
    test('should handle partial config updates', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get current full config (API returns { success, config })
      const currentResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);
      const currentConfig = currentResponse.config;

      // Send partial update
      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transformJs: false })
        });
        return res.json();
      }, CONFIG_PATH);

      expect(response.success).toBe(true);

      // Verify only that field changed (API returns { success, config })
      const updatedResponse = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint);
        return res.json();
      }, CONFIG_PATH);

      expect(updatedResponse.config.transformJs).toBe(false);
      // Other fields should be unchanged
      expect(updatedResponse.config.transformCss).toBe(currentConfig.transformCss);

      // Reset
      await page.evaluate(async (endpoint) => {
        await fetch(endpoint, { method: 'DELETE' });
      }, CONFIG_PATH);

      console.log('✅ Partial config updates work correctly');
    });

    test('should handle invalid JSON gracefully', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (endpoint) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json {'
        });
        return {
          status: res.status,
          body: await res.json()
        };
      }, CONFIG_PATH);

      // Should return error status
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);

      console.log('✅ Invalid JSON handled gracefully');
    });
  });
});
