import { test, expect } from '@playwright/test';

/**
 * Test suite for the Metrics Dashboard and Stats API
 * Tests the /__revamp__/metrics endpoint functionality
 *
 * Uses a local mock server (http://127.0.0.1:9080) to avoid external dependencies
 */

const TEST_SITE = 'http://127.0.0.1:9080';
const METRICS_HTML_PATH = '/__revamp__/metrics';
const METRICS_JSON_PATH = '/__revamp__/metrics/json';

test.describe('Metrics Dashboard', () => {
  test.describe('HTML Dashboard', () => {
    test('should load metrics dashboard', async ({ page }) => {
      // First navigate through proxy to establish connection
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Navigate to metrics dashboard
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check page content
      const title = await page.title();
      expect(title).toContain('Revamp');
      expect(title).toContain('Metrics');

      console.log(`✅ Metrics dashboard loaded - Title: "${title}"`);
    });

    test('should display uptime statistics', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for uptime card
      await expect(page.locator('text=Uptime')).toBeVisible();

      // Should show start time
      const content = await page.content();
      expect(content).toContain('Since');

      console.log('✅ Uptime statistics displayed');
    });

    test('should display request statistics', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for request stats
      await expect(page.locator('text=Total Requests')).toBeVisible();
      await expect(page.locator('text=active connections')).toBeVisible();

      console.log('✅ Request statistics displayed');
    });

    test('should display cache hit rate', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for cache stats
      await expect(page.locator('text=Cache Hit Rate')).toBeVisible();

      // Should have progress bar
      const progressBar = page.locator('.progress-bar');
      await expect(progressBar).toBeVisible();

      console.log('✅ Cache hit rate displayed');
    });

    test('should display blocked requests count', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for blocked stats
      await expect(page.locator('text=Blocked Requests')).toBeVisible();
      await expect(page.locator('text=Ads & trackers blocked')).toBeVisible();

      console.log('✅ Blocked requests count displayed');
    });

    test('should display transformation counts', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for transformation stats
      await expect(page.locator('text=Transformations')).toBeVisible();
      await expect(page.locator('text=JavaScript')).toBeVisible();
      await expect(page.locator('text=CSS').first()).toBeVisible();
      await expect(page.locator('text=HTML').first()).toBeVisible();
      await expect(page.locator('text=Images')).toBeVisible();

      console.log('✅ Transformation counts displayed');
    });

    test('should display bandwidth statistics', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for bandwidth stats
      await expect(page.locator('text=Bandwidth')).toBeVisible();
      await expect(page.locator('text=Downloaded')).toBeVisible();
      await expect(page.locator('text=Sent to Client')).toBeVisible();
      await expect(page.locator('text=Saved')).toBeVisible();

      console.log('✅ Bandwidth statistics displayed');
    });

    test('should display server info', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for server info
      await expect(page.locator('text=Server Info')).toBeVisible();
      await expect(page.locator('text=SOCKS5 Port')).toBeVisible();
      await expect(page.locator('text=HTTP Port')).toBeVisible();
      await expect(page.locator('text=Local IP')).toBeVisible();

      // Should show port numbers
      await expect(page.locator('text=1080')).toBeVisible();
      await expect(page.locator('text=8080')).toBeVisible();

      console.log('✅ Server info displayed');
    });

    test('should display active configuration', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for configuration section
      await expect(page.locator('text=Active Configuration')).toBeVisible();

      // Should show config items with ON/OFF status
      const content = await page.content();
      expect(content).toContain('Transform JS');
      expect(content).toContain('Transform CSS');
      expect(content).toContain('Remove Ads');

      console.log('✅ Active configuration displayed');
    });

    test('should have links to JSON API and PAC file', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.goto(`${TEST_SITE}${METRICS_HTML_PATH}`, { waitUntil: 'domcontentloaded' });

      // Check for links
      const jsonLink = page.locator('a[href*="metrics/json"]');
      await expect(jsonLink).toBeVisible();

      const pacLink = page.locator('a[href*="pac"]');
      await expect(pacLink).toBeVisible();

      console.log('✅ Dashboard has links to JSON API and PAC file');
    });
  });

  test.describe('JSON API', () => {
    test('should return JSON metrics', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          body: await res.json()
        };
      }, METRICS_JSON_PATH);

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('application/json');

      // Check for expected fields
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('requests');
      expect(response.body).toHaveProperty('transforms');
      expect(response.body).toHaveProperty('bandwidth');

      console.log('✅ JSON metrics API returns valid data');
      console.log(`   Uptime: ${response.body.uptime}s, Requests: ${response.body.requests.total}`);
    });

    test('should have complete metrics structure', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const metrics = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
      }, METRICS_JSON_PATH);

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
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('peakConnections');
      expect(metrics).toHaveProperty('cacheHitRate');
      expect(metrics).toHaveProperty('transformRate');
      expect(metrics).toHaveProperty('errors');
      expect(metrics).toHaveProperty('startTime');
      expect(metrics).toHaveProperty('uptime');

      console.log('✅ Metrics JSON has complete structure');
    });

    test('should update metrics after activity', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get initial metrics
      const initialMetrics = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
      }, METRICS_JSON_PATH);

      // Navigate to another page to generate activity (using about instead of external domain)
      await page.goto(`${TEST_SITE}/about`, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get updated metrics
      const updatedMetrics = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.json();
      }, METRICS_JSON_PATH);

      // Total requests should have increased
      expect(updatedMetrics.requests.total).toBeGreaterThan(initialMetrics.requests.total);

      console.log('✅ Metrics update after activity');
      console.log(`   Initial requests: ${initialMetrics.requests.total}, Updated: ${updatedMetrics.requests.total}`);
    });
  });
});
