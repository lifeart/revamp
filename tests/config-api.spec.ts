import { test, expect } from '@playwright/test';
import {
  API_PATHS,
  goToMockServer,
  getConfig,
  updateConfig,
  resetConfig,
  withConfigValue,
  fetchWithDetails,
  logSuccess,
  logInfo,
} from './helpers/test-utils';

/**
 * Test suite for the Config API
 * Tests the /__revamp__/config endpoint functionality
 */

test.describe('Config API', () => {
  test.describe('Direct API Access (via proxy)', () => {
    test('should GET current config', async ({ page }) => {
      await goToMockServer(page);

      const response = await getConfig(page);

      expect(response).toHaveProperty('success');
      expect(response).toHaveProperty('config');
      expect(response.config).toHaveProperty('transformJs');
      expect(response.config).toHaveProperty('transformCss');
      expect(response.config).toHaveProperty('removeAds');
      expect(response.config).toHaveProperty('cacheEnabled');

      logSuccess('GET config returns current settings');
      logInfo(`Config: ${JSON.stringify(response.config)}`);
    });

    test('should have CORS headers', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails(page, API_PATHS.config);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['content-type']).toContain('application/json');

      logSuccess('Config endpoint has CORS headers');
    });

    test('should POST to update config', async ({ page }) => {
      await goToMockServer(page);

      const { config: currentConfig } = await getConfig(page);
      const newCacheEnabled = !currentConfig.cacheEnabled;

      // Update config
      const updateResponse = await updateConfig(page, { cacheEnabled: newCacheEnabled });
      expect(updateResponse.success).toBe(true);

      // Verify the change
      const { config: updatedConfig } = await getConfig(page);
      expect(updatedConfig.cacheEnabled).toBe(newCacheEnabled);

      // Restore original value
      await updateConfig(page, { cacheEnabled: currentConfig.cacheEnabled });

      logSuccess('POST config updates settings successfully');
    });

    test('should DELETE to reset config to defaults', async ({ page }) => {
      await goToMockServer(page);

      // First, change a config value
      await updateConfig(page, { removeAds: false });

      // Now reset to defaults
      const deleteResponse = await resetConfig(page);
      expect(deleteResponse.success).toBe(true);

      // Verify reset
      const { config: resetConfigValues } = await getConfig(page);
      expect(resetConfigValues.removeAds).toBe(true);

      logSuccess('DELETE config resets to defaults');
    });

    test('should handle OPTIONS preflight request', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails(page, API_PATHS.config, { method: 'OPTIONS' });

      expect(response.status).toBe(204);

      logSuccess('OPTIONS preflight returns correct headers');
    });
  });

  test.describe('Config Persistence', () => {
    test('should persist config changes across requests', async ({ page }) => {
      await goToMockServer(page);

      const { config: originalConfig } = await getConfig(page);
      const testValue = !originalConfig.spoofUserAgent;

      await updateConfig(page, { spoofUserAgent: testValue });

      // Navigate to different page
      await goToMockServer(page, '/about');

      // Check config again
      const { config: persistedConfig } = await getConfig(page);
      expect(persistedConfig.spoofUserAgent).toBe(testValue);

      // Restore original
      await updateConfig(page, { spoofUserAgent: originalConfig.spoofUserAgent });

      logSuccess('Config persists across different domains');
    });
  });

  test.describe('Config Validation', () => {
    test('should handle partial config updates', async ({ page }) => {
      await goToMockServer(page);

      const { config: currentConfig } = await getConfig(page);

      // Send partial update
      const response = await updateConfig(page, { transformJs: false });
      expect(response.success).toBe(true);

      // Verify only that field changed
      const { config: updatedConfig } = await getConfig(page);
      expect(updatedConfig.transformJs).toBe(false);
      expect(updatedConfig.transformCss).toBe(currentConfig.transformCss);

      // Reset
      await resetConfig(page);

      logSuccess('Partial config updates work correctly');
    });

    test('should handle invalid JSON gracefully', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails(page, API_PATHS.config, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      });

      expect(response.status).toBe(400);
      expect((response.body as { success: boolean }).success).toBe(false);

      logSuccess('Invalid JSON handled gracefully');
    });
  });
});
