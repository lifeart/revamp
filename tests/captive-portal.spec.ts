import { test, expect } from '@playwright/test';

/**
 * Test suite for the Captive Portal
 * Tests the certificate download page and related functionality
 */

const PORTAL_BASE = 'http://127.0.0.1:8888';

test.describe('Captive Portal', () => {
  // These tests don't need proxy - they access portal directly
  test.use({ proxy: undefined });

  test.describe('Homepage', () => {
    test('should load the portal page', async ({ page }) => {
      const response = await page.goto(PORTAL_BASE, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      expect(response?.status()).toBe(200);

      // Check page title
      const title = await page.title();
      expect(title).toContain('Revamp');

      console.log(`✅ Captive portal loaded - Title: "${title}"`);
    });

    test('should display Revamp branding', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Check for main heading with Revamp text
      const hasRevamp = await page.evaluate(() => {
        return document.body.textContent?.includes('Revamp') ?? false;
      });
      expect(hasRevamp).toBe(true);

      console.log('✅ Captive portal displays correct branding');
    });

    test('should have download certificate button', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Check page contains download text
      const pageContent = await page.content();
      const hasDownloadContent = pageContent.includes('/cert') ||
                                  pageContent.toLowerCase().includes('download');
      expect(hasDownloadContent).toBe(true);

      console.log('✅ Certificate download content present');
    });

    test('should display proxy configuration info', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Check page contains proxy port information
      const pageText = await page.textContent('body');

      // Should show proxy ports
      expect(pageText).toContain('1080'); // SOCKS5 port
      expect(pageText).toContain('8080'); // HTTP port

      console.log('✅ Proxy configuration info displayed');
    });

    test('should have setup steps', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Check for setup step content
      const pageText = await page.textContent('body');

      expect(pageText?.toLowerCase()).toContain('certificate');
      expect(pageText?.toLowerCase()).toContain('install');

      console.log('✅ Setup steps present');
    });

    test('should display iOS installation instructions', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Check for iOS-specific instruction keywords
      const pageText = await page.textContent('body');

      // Should mention Settings and certificate trust
      expect(pageText).toContain('Settings');
      expect(pageText?.toLowerCase()).toContain('trust');

      console.log('✅ iOS installation instructions displayed');
    });
  });

  test.describe('Certificate Download', () => {
    test('should download CA certificate from /cert', async ({ page }) => {
      // Load portal first
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Fetch certificate content via page context
      const certContent = await page.evaluate(async () => {
        const response = await fetch('/cert');
        const headers = {
          contentType: response.headers.get('content-type'),
          disposition: response.headers.get('content-disposition')
        };
        const text = await response.text();
        return { headers, text, status: response.status };
      });

      expect(certContent.status).toBe(200);
      expect(certContent.headers.contentType).toContain('x509');
      expect(certContent.text).toContain('-----BEGIN CERTIFICATE-----');

      console.log('✅ Certificate available at /cert');
    });

    test('should serve certificate from /certificate alias', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const certContent = await page.evaluate(async () => {
        const response = await fetch('/certificate');
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: await response.text()
        };
      });

      expect(certContent.status).toBe(200);
      expect(certContent.contentType).toContain('x509');
      expect(certContent.text).toContain('-----BEGIN CERTIFICATE-----');

      console.log('✅ Certificate available at /certificate');
    });

    test('should serve certificate from /cert/revamp-ca.crt', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const certContent = await page.evaluate(async () => {
        const response = await fetch('/cert/revamp-ca.crt');
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: await response.text()
        };
      });

      expect(certContent.status).toBe(200);
      expect(certContent.contentType).toContain('x509');
      expect(certContent.text).toContain('-----BEGIN CERTIFICATE-----');

      console.log('✅ Certificate available at /cert/revamp-ca.crt');
    });

    test('certificate should be valid PEM format', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Fetch certificate content via page context
      const certContent = await page.evaluate(async () => {
        const response = await fetch('/cert');
        return response.text();
      });

      expect(certContent).toContain('-----BEGIN CERTIFICATE-----');
      expect(certContent).toContain('-----END CERTIFICATE-----');

      console.log(`✅ Certificate is valid PEM format (${certContent.length} bytes)`);
    });
  });

  test.describe('iOS Captive Portal Detection URLs', () => {
    const captiveUrls = [
      '/hotspot-detect.html',
      '/library/test/success.html',
      '/success.txt',
      '/generate_204',
      '/gen_204',
    ];

    for (const url of captiveUrls) {
      test(`should serve portal page at ${url}`, async ({ page }) => {
        const response = await page.goto(`${PORTAL_BASE}${url}`, { timeout: 30000 });

        expect(response?.status()).toBe(200);

        const contentType = response?.headers()['content-type'];
        expect(contentType).toContain('text/html');

        // Page should contain portal content
        const pageText = await page.textContent('body');
        expect(pageText).toContain('Revamp');

        console.log(`✅ Portal page served at ${url}`);
      });
    }
  });

  test.describe('Response Headers', () => {
    test('should have cache-control header on portal page', async ({ page }) => {
      const response = await page.goto(PORTAL_BASE, { timeout: 30000 });

      const cacheControl = response?.headers()['cache-control'];
      // Should have some cache control (no-cache, no-store, or max-age=0)
      expect(cacheControl).toBeDefined();

      console.log(`✅ Portal page has cache-control header: ${cacheControl}`);
    });

    test('should serve HTML content type', async ({ page }) => {
      const response = await page.goto(PORTAL_BASE, { timeout: 30000 });

      const contentType = response?.headers()['content-type'];
      expect(contentType).toContain('text/html');

      console.log('✅ Portal serves correct content type');
    });
  });
});
