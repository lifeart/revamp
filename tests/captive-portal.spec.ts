import { test, expect } from '@playwright/test';
import {
  PORTAL_BASE,
  goToPortal,
  expectTitleContains,
  expectVisibleAndClickable,
  expectMinDimensions,
  expectValidCertificate,
  expectTextContainsAll,
  logSuccess,
} from './helpers/test-utils';

/**
 * Test suite for the Captive Portal
 * Tests the certificate download page and related functionality
 */

test.describe('Captive Portal', () => {
  // These tests don't need proxy - they access portal directly
  test.use({ proxy: undefined });

  test.describe('Homepage', () => {
    test('should load the portal page', async ({ page }) => {
      const status = await goToPortal(page);
      expect(status).toBe(200);
      await expectTitleContains(page, 'Revamp');
      logSuccess(`Captive portal loaded - Title: "${await page.title()}"`);
    });

    test('should display Revamp branding', async ({ page }) => {
      await goToPortal(page);

      const hasRevamp = await page.evaluate(() => {
        return document.body.textContent?.includes('Revamp') ?? false;
      });
      expect(hasRevamp).toBe(true);

      logSuccess('Captive portal displays correct branding');
    });

    test('should have download certificate button', async ({ page }) => {
      await goToPortal(page);

      const pageContent = await page.content();
      const hasDownloadContent =
        pageContent.includes('/cert') || pageContent.toLowerCase().includes('download');
      expect(hasDownloadContent).toBe(true);

      logSuccess('Certificate download content present');
    });

    test('should display proxy configuration info', async ({ page }) => {
      await goToPortal(page);
      await expectTextContainsAll(page, 'body', ['1080', '8080']);
      logSuccess('Proxy configuration info displayed');
    });

    test('should have setup steps', async ({ page }) => {
      await goToPortal(page);

      const pageText = await page.textContent('body');
      expect(pageText?.toLowerCase()).toContain('certificate');
      expect(pageText?.toLowerCase()).toContain('install');

      logSuccess('Setup steps present');
    });

    test('should display iOS installation instructions', async ({ page }) => {
      await goToPortal(page);

      const pageText = await page.textContent('body');
      expect(pageText).toContain('Settings');
      expect(pageText?.toLowerCase()).toContain('trust');

      logSuccess('iOS installation instructions displayed');
    });
  });

  test.describe('Certificate Download', () => {
    const certEndpoints = ['/cert', '/certificate', '/cert/revamp-ca.crt'];

    for (const endpoint of certEndpoints) {
      test(`should serve certificate from ${endpoint}`, async ({ page }) => {
        await goToPortal(page);
        await expectValidCertificate(page, endpoint);
        logSuccess(`Certificate available at ${endpoint}`);
      });
    }

    test('certificate should be valid PEM format', async ({ page }) => {
      await goToPortal(page);

      const certContent = await page.evaluate(async () => {
        const response = await fetch('/cert');
        return response.text();
      });

      expect(certContent).toContain('-----BEGIN CERTIFICATE-----');
      expect(certContent).toContain('-----END CERTIFICATE-----');

      logSuccess(`Certificate is valid PEM format (${certContent.length} bytes)`);
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
        expect(response?.headers()['content-type']).toContain('text/html');

        const pageText = await page.textContent('body');
        expect(pageText).toContain('Revamp');

        logSuccess(`Portal page served at ${url}`);
      });
    }
  });

  test.describe('Response Headers', () => {
    test('should have cache-control header on portal page', async ({ page }) => {
      const response = await page.goto(PORTAL_BASE, { timeout: 30000 });

      const cacheControl = response?.headers()['cache-control'];
      expect(cacheControl).toBeDefined();

      logSuccess(`Portal page has cache-control header: ${cacheControl}`);
    });

    test('should serve HTML content type', async ({ page }) => {
      const response = await page.goto(PORTAL_BASE, { timeout: 30000 });

      expect(response?.headers()['content-type']).toContain('text/html');

      logSuccess('Portal serves correct content type');
    });
  });

  test.describe('Download Button Visibility', () => {
    const downloadButtonSelector = 'a:has-text("Download CA Certificate")';

    test('should have visible download certificate button', async ({ page }) => {
      await goToPortal(page);

      const downloadButton = page.locator(downloadButtonSelector);
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      const href = await downloadButton.getAttribute('href');
      expect(href).toBe('/cert/revamp-ca.crt');

      logSuccess('Download certificate button is visible');
    });

    test('download button should be clickable and not obscured', async ({ page }) => {
      await goToPortal(page);
      await expectVisibleAndClickable(page, downloadButtonSelector);
      await expectMinDimensions(page, downloadButtonSelector, 50, 30);

      const boundingBox = await page.locator(downloadButtonSelector).boundingBox();
      logSuccess(`Download button is clickable (${boundingBox!.width}x${boundingBox!.height})`);
    });

    test('download button should have proper styling (not hidden by CSS)', async ({ page }) => {
      await goToPortal(page);
      await expectVisibleAndClickable(page, downloadButtonSelector);

      const styles = await page.locator(downloadButtonSelector).evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return { display: computed.display, visibility: computed.visibility };
      });

      logSuccess(`Download button has proper CSS (display: ${styles.display}, visibility: ${styles.visibility})`);
    });
  });

  test.describe('Portal Access Through Proxy', () => {
    // These tests access the portal THROUGH the proxy to verify transformations don't break it
    test.use({ proxy: { server: 'http://127.0.0.1:8080' } });

    const downloadButtonSelector = 'a:has-text("Download CA Certificate")';

    test('should have visible download button when accessed through proxy', async ({ page }) => {
      await goToPortal(page);

      const downloadButton = page.locator(downloadButtonSelector);
      await expect(downloadButton).toBeVisible({ timeout: 5000 });

      const href = await downloadButton.getAttribute('href');
      expect(href).toBe('/cert/revamp-ca.crt');

      logSuccess('Download button visible through proxy');
    });

    test('download button should be clickable through proxy', async ({ page }) => {
      await goToPortal(page);
      await expectVisibleAndClickable(page, downloadButtonSelector);
      await expectMinDimensions(page, downloadButtonSelector, 50, 30);

      const boundingBox = await page.locator(downloadButtonSelector).boundingBox();
      logSuccess(`Download button clickable through proxy (${boundingBox!.width}x${boundingBox!.height})`);
    });

    test('portal CSS should not be broken by proxy transformations', async ({ page }) => {
      await goToPortal(page);
      await expectVisibleAndClickable(page, downloadButtonSelector);

      const styles = await page.locator(downloadButtonSelector).evaluate((el) => {
        return window.getComputedStyle(el).display;
      });

      logSuccess(`Portal CSS intact through proxy (display: ${styles})`);
    });
  });
});
