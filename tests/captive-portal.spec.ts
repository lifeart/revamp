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

  test.describe('Download Button Visibility', () => {
    test('should have visible download certificate button', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Find the download button by text content
      const downloadButton = page.locator('a:has-text("Download CA Certificate")');

      // Button should exist
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      // Button should link to certificate
      const href = await downloadButton.getAttribute('href');
      expect(href).toBe('/cert/revamp-ca.crt');

      console.log('✅ Download certificate button is visible');
    });

    test('download button should be clickable and not obscured', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const downloadButton = page.locator('a:has-text("Download CA Certificate")');

      // Check the button is visible and enabled
      await expect(downloadButton).toBeVisible({ timeout: 5000 });
      await expect(downloadButton).toBeEnabled();

      // Get bounding box to verify it has proper size
      const boundingBox = await downloadButton.boundingBox();
      expect(boundingBox).not.toBeNull();
      expect(boundingBox!.width).toBeGreaterThan(50);
      expect(boundingBox!.height).toBeGreaterThan(30);

      console.log(`✅ Download button is clickable (${boundingBox!.width}x${boundingBox!.height})`);
    });

    test('download button should have proper styling (not hidden by CSS)', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const downloadButton = page.locator('a:has-text("Download CA Certificate")');
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      // Check computed styles
      const styles = await downloadButton.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          display: computed.display,
          visibility: computed.visibility,
          opacity: computed.opacity,
          pointerEvents: computed.pointerEvents,
          width: computed.width,
          height: computed.height,
        };
      });

      // Verify button is not hidden by CSS
      expect(styles.display).not.toBe('none');
      expect(styles.visibility).not.toBe('hidden');
      expect(parseFloat(styles.opacity)).toBeGreaterThan(0);
      expect(styles.pointerEvents).not.toBe('none');

      console.log(`✅ Download button has proper CSS (display: ${styles.display}, visibility: ${styles.visibility})`);
    });
  });

  test.describe('Portal Access Through Proxy', () => {
    // These tests access the portal THROUGH the proxy to verify transformations don't break it
    test.use({ proxy: { server: 'http://127.0.0.1:8080' } });

    test('should have visible download button when accessed through proxy', async ({ page }) => {
      // Access captive portal through the HTTP proxy
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      // Find the download button
      const downloadButton = page.locator('a:has-text("Download CA Certificate")');

      // Button should exist and be visible even after proxy transformation
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      const href = await downloadButton.getAttribute('href');
      expect(href).toBe('/cert/revamp-ca.crt');

      console.log('✅ Download button visible through proxy');
    });

    test('download button should be clickable through proxy', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const downloadButton = page.locator('a:has-text("Download CA Certificate")');

      await expect(downloadButton).toBeVisible({ timeout: 5000 });
      await expect(downloadButton).toBeEnabled();

      // Verify bounding box (button has proper size)
      const boundingBox = await downloadButton.boundingBox();
      expect(boundingBox).not.toBeNull();
      expect(boundingBox!.width).toBeGreaterThan(50);
      expect(boundingBox!.height).toBeGreaterThan(30);

      console.log(`✅ Download button clickable through proxy (${boundingBox!.width}x${boundingBox!.height})`);
    });

    test('portal CSS should not be broken by proxy transformations', async ({ page }) => {
      await page.goto(PORTAL_BASE, { timeout: 30000 });

      const downloadButton = page.locator('a:has-text("Download CA Certificate")');
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      const styles = await downloadButton.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          display: computed.display,
          visibility: computed.visibility,
          opacity: computed.opacity,
          backgroundColor: computed.backgroundColor,
          pointerEvents: computed.pointerEvents,
        };
      });

      // Button should not be hidden by CSS transformations
      expect(styles.display).not.toBe('none');
      expect(styles.visibility).not.toBe('hidden');
      expect(parseFloat(styles.opacity)).toBeGreaterThan(0);
      expect(styles.pointerEvents).not.toBe('none');

      console.log(`✅ Portal CSS intact through proxy (display: ${styles.display})`);
    });
  });
});
