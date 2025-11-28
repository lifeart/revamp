import { test, expect } from '@playwright/test';
import {
  API_PATHS,
  goToMockServer,
  fetchJson,
  expectTitleContains,
  logSuccess,
  logInfo,
} from './helpers/test-utils';

/**
 * Test suite for the Metrics Dashboard and Stats API
 * Tests the /__revamp__/metrics endpoint functionality
 */

/** Metrics JSON structure */
interface MetricsJson {
  uptime: number;
  startTime: number;
  requests: { total: number; blocked: number; cached: number; transformed: number };
  transforms: { js: number; css: number; html: number; images: number };
  bandwidth: { totalBytesIn: number; totalBytesOut: number; savedBytes: number };
  activeConnections: number;
  peakConnections: number;
  cacheHitRate: number;
  transformRate: number;
  errors: number;
}

test.describe('Metrics Dashboard', () => {
  test.describe('HTML Dashboard', () => {
    test('should load metrics dashboard', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expectTitleContains(page, 'Revamp');
      await expectTitleContains(page, 'Metrics');

      logSuccess(`Metrics dashboard loaded - Title: "${await page.title()}"`);
    });

    test('should display uptime statistics', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Uptime')).toBeVisible();
      const content = await page.content();
      expect(content).toContain('Since');

      logSuccess('Uptime statistics displayed');
    });

    test('should display request statistics', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Total Requests')).toBeVisible();
      await expect(page.locator('text=active connections')).toBeVisible();

      logSuccess('Request statistics displayed');
    });

    test('should display cache hit rate', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Cache Hit Rate')).toBeVisible();
      await expect(page.locator('.progress-bar')).toBeVisible();

      logSuccess('Cache hit rate displayed');
    });

    test('should display blocked requests count', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Blocked Requests')).toBeVisible();
      await expect(page.locator('text=Ads & trackers blocked')).toBeVisible();

      logSuccess('Blocked requests count displayed');
    });

    test('should display transformation counts', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Transformations')).toBeVisible();

      const statLabels = ['JavaScript', 'CSS', 'HTML', 'Images'];
      for (const label of statLabels) {
        await expect(page.locator('.stat-label', { hasText: label })).toBeVisible();
      }

      logSuccess('Transformation counts displayed');
    });

    test('should display bandwidth statistics', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      const expectedTexts = ['Bandwidth', 'Downloaded', 'Sent to Client', 'Saved'];
      for (const text of expectedTexts) {
        await expect(page.locator(`text=${text}`)).toBeVisible();
      }

      logSuccess('Bandwidth statistics displayed');
    });

    test('should display server info', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      const expectedTexts = ['Server Info', 'SOCKS5 Port', 'HTTP Port', 'Local IP', '1080', '8080'];
      for (const text of expectedTexts) {
        await expect(page.locator(`text=${text}`)).toBeVisible();
      }

      logSuccess('Server info displayed');
    });

    test('should display active configuration', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('text=Active Configuration')).toBeVisible();

      const content = await page.content();
      expect(content).toContain('Transform JavaScript');
      expect(content).toContain('Transform CSS');
      expect(content).toContain('Remove Ads');

      logSuccess('Active configuration displayed');
    });

    test('should have links to JSON API and PAC file', async ({ page }) => {
      await goToMockServer(page);
      await goToMockServer(page, API_PATHS.metricsHtml);

      await expect(page.locator('a[href*="metrics/json"]')).toBeVisible();
      await expect(page.locator('a[href*="pac"]')).toBeVisible();

      logSuccess('Dashboard has links to JSON API and PAC file');
    });
  });

  test.describe('JSON API', () => {
    test('should return JSON metrics', async ({ page }) => {
      await goToMockServer(page);

      const metrics = await fetchJson<MetricsJson>(page, API_PATHS.metricsJson);

      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('requests');
      expect(metrics).toHaveProperty('transforms');
      expect(metrics).toHaveProperty('bandwidth');

      logSuccess('JSON metrics API returns valid data');
      logInfo(`Uptime: ${metrics.uptime}s, Requests: ${metrics.requests.total}`);
    });

    test('should have complete metrics structure', async ({ page }) => {
      await goToMockServer(page);

      const metrics = await fetchJson<MetricsJson>(page, API_PATHS.metricsJson);

      // Check requests structure
      expect(metrics.requests).toHaveProperty('total');
      expect(metrics.requests).toHaveProperty('blocked');
      expect(metrics.requests).toHaveProperty('cached');
      expect(metrics.requests).toHaveProperty('transformed');

      // Check transforms structure
      expect(metrics.transforms).toHaveProperty('js');
      expect(metrics.transforms).toHaveProperty('css');
      expect(metrics.transforms).toHaveProperty('html');
      expect(metrics.transforms).toHaveProperty('images');

      // Check bandwidth structure
      expect(metrics.bandwidth).toHaveProperty('totalBytesIn');
      expect(metrics.bandwidth).toHaveProperty('totalBytesOut');
      expect(metrics.bandwidth).toHaveProperty('savedBytes');

      // Check other fields
      const expectedFields = [
        'activeConnections',
        'peakConnections',
        'cacheHitRate',
        'transformRate',
        'errors',
        'startTime',
        'uptime',
      ];
      for (const field of expectedFields) {
        expect(metrics).toHaveProperty(field);
      }

      logSuccess('Metrics JSON has complete structure');
    });

    test('should update metrics after activity', async ({ page }) => {
      await goToMockServer(page);

      const initialMetrics = await fetchJson<MetricsJson>(page, API_PATHS.metricsJson);

      // Navigate to another page to generate activity
      await goToMockServer(page, '/about');

      const updatedMetrics = await fetchJson<MetricsJson>(page, API_PATHS.metricsJson);

      expect(updatedMetrics.requests.total).toBeGreaterThan(initialMetrics.requests.total);

      logSuccess('Metrics update after activity');
      logInfo(`Initial requests: ${initialMetrics.requests.total}, Updated: ${updatedMetrics.requests.total}`);
    });
  });
});
