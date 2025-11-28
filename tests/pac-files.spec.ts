import { test, expect } from '@playwright/test';
import {
  API_PATHS,
  goToMockServer,
  fetchWithDetails,
  fetchText,
  logSuccess,
} from './helpers/test-utils';

/**
 * Test suite for PAC (Proxy Auto-Configuration) Files
 * Tests the /__revamp__/pac/* endpoints
 */

test.describe('PAC Files', () => {
  test.describe('SOCKS5 PAC File', () => {
    test('should download SOCKS5 PAC file', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails<string>(page, API_PATHS.pacSocks5);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('proxy-autoconfig');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('socks5');

      logSuccess('SOCKS5 PAC file downloaded');
    });

    test('should contain FindProxyForURL function', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacSocks5);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('SOCKS5');

      logSuccess('SOCKS5 PAC file contains FindProxyForURL');
    });

    test('should reference correct SOCKS5 port', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacSocks5);
      expect(pacContent).toContain('1080');

      logSuccess('SOCKS5 PAC file references correct port');
    });

    test('should be valid JavaScript', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacSocks5);
      const isValid = await page.evaluate((content) => {
        try {
          new Function(content);
          return true;
        } catch {
          return false;
        }
      }, pacContent);

      expect(isValid).toBe(true);
      logSuccess('SOCKS5 PAC file is valid JavaScript');
    });
  });

  test.describe('HTTP PAC File', () => {
    test('should download HTTP PAC file', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails<string>(page, API_PATHS.pacHttp);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('proxy-autoconfig');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('http');

      logSuccess('HTTP PAC file downloaded');
    });

    test('should contain PROXY directive', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacHttp);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('PROXY');

      logSuccess('HTTP PAC file contains PROXY directive');
    });

    test('should reference correct HTTP port', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacHttp);
      expect(pacContent).toContain('8080');

      logSuccess('HTTP PAC file references correct port');
    });
  });

  test.describe('Combined PAC File', () => {
    test('should download combined PAC file', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails<string>(page, API_PATHS.pacCombined);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('proxy-autoconfig');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('combined');

      logSuccess('Combined PAC file downloaded');
    });

    test('should contain both SOCKS5 and PROXY fallback', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacCombined);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('SOCKS5');
      expect(pacContent).toContain('PROXY');

      logSuccess('Combined PAC file contains both proxy types');
    });

    test('should reference both ports', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacCombined);

      expect(pacContent).toContain('1080');
      expect(pacContent).toContain('8080');

      logSuccess('Combined PAC file references both ports');
    });

    test('should have DIRECT fallback', async ({ page }) => {
      await goToMockServer(page);

      const pacContent = await fetchText(page, API_PATHS.pacCombined);
      expect(pacContent).toContain('DIRECT');

      logSuccess('Combined PAC file has DIRECT fallback');
    });
  });

  test.describe('PAC File Accessibility', () => {
    test('should have CORS headers on PAC files', async ({ page }) => {
      await goToMockServer(page);

      const response = await fetchWithDetails<string>(page, API_PATHS.pacSocks5);
      expect(response.headers['access-control-allow-origin']).toBe('*');

      logSuccess('PAC files have CORS headers');
    });

    test('should work from different page context', async ({ page }) => {
      await goToMockServer(page, '/about');

      const pacContent = await fetchText(page, API_PATHS.pacSocks5);
      expect(pacContent).toContain('FindProxyForURL');

      logSuccess('PAC files accessible from any page through proxy');
    });
  });
});
