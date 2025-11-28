import { test, expect } from '@playwright/test';

/**
 * Test suite for PAC (Proxy Auto-Configuration) Files
 * Tests the /__revamp__/pac/* endpoints
 *
 * Uses a local mock server (http://127.0.0.1:9080) to avoid external dependencies
 */

const TEST_SITE = 'http://127.0.0.1:9080';
const PAC_SOCKS5_PATH = '/__revamp__/pac/socks5';
const PAC_HTTP_PATH = '/__revamp__/pac/http';
const PAC_COMBINED_PATH = '/__revamp__/pac/combined';

test.describe('PAC Files', () => {
  test.describe('SOCKS5 PAC File', () => {
    test('should download SOCKS5 PAC file', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          disposition: res.headers.get('content-disposition'),
          body: await res.text()
        };
      }, PAC_SOCKS5_PATH);

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('proxy-autoconfig');
      expect(response.disposition).toContain('attachment');
      expect(response.disposition).toContain('socks5');

      console.log('✅ SOCKS5 PAC file downloaded');
    });

    test('should contain FindProxyForURL function', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_SOCKS5_PATH);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('SOCKS5');

      console.log('✅ SOCKS5 PAC file contains FindProxyForURL');
    });

    test('should reference correct SOCKS5 port', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_SOCKS5_PATH);

      // Default SOCKS5 port is 1080
      expect(pacContent).toContain('1080');

      console.log('✅ SOCKS5 PAC file references correct port');
    });

    test('should be valid JavaScript', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const isValid = await page.evaluate(async (path) => {
        const res = await fetch(path);
        const content = await res.text();
        try {
          // Try to evaluate the PAC file
          new Function(content);
          return true;
        } catch (e) {
          return false;
        }
      }, PAC_SOCKS5_PATH);

      expect(isValid).toBe(true);

      console.log('✅ SOCKS5 PAC file is valid JavaScript');
    });
  });

  test.describe('HTTP PAC File', () => {
    test('should download HTTP PAC file', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          disposition: res.headers.get('content-disposition'),
          body: await res.text()
        };
      }, PAC_HTTP_PATH);

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('proxy-autoconfig');
      expect(response.disposition).toContain('attachment');
      expect(response.disposition).toContain('http');

      console.log('✅ HTTP PAC file downloaded');
    });

    test('should contain PROXY directive', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_HTTP_PATH);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('PROXY');

      console.log('✅ HTTP PAC file contains PROXY directive');
    });

    test('should reference correct HTTP port', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_HTTP_PATH);

      // Default HTTP proxy port is 8080
      expect(pacContent).toContain('8080');

      console.log('✅ HTTP PAC file references correct port');
    });
  });

  test.describe('Combined PAC File', () => {
    test('should download combined PAC file', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          disposition: res.headers.get('content-disposition'),
          body: await res.text()
        };
      }, PAC_COMBINED_PATH);

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('proxy-autoconfig');
      expect(response.disposition).toContain('attachment');
      expect(response.disposition).toContain('combined');

      console.log('✅ Combined PAC file downloaded');
    });

    test('should contain both SOCKS5 and PROXY fallback', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_COMBINED_PATH);

      expect(pacContent).toContain('function FindProxyForURL');
      expect(pacContent).toContain('SOCKS5');
      expect(pacContent).toContain('PROXY');

      console.log('✅ Combined PAC file contains both proxy types');
    });

    test('should reference both ports', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_COMBINED_PATH);

      expect(pacContent).toContain('1080'); // SOCKS5 port
      expect(pacContent).toContain('8080'); // HTTP port

      console.log('✅ Combined PAC file references both ports');
    });

    test('should have DIRECT fallback', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_COMBINED_PATH);

      expect(pacContent).toContain('DIRECT');

      console.log('✅ Combined PAC file has DIRECT fallback');
    });
  });

  test.describe('PAC File Accessibility', () => {
    test('should have CORS headers on PAC files', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const response = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return {
          cors: res.headers.get('access-control-allow-origin')
        };
      }, PAC_SOCKS5_PATH);

      expect(response.cors).toBe('*');

      console.log('✅ PAC files have CORS headers');
    });

    test('should work from different page context', async ({ page }) => {
      // Navigate to different page (using about instead of external domain)
      await page.goto(`${TEST_SITE}/about`, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Fetch PAC file from this domain context
      const pacContent = await page.evaluate(async (path) => {
        const res = await fetch(path);
        return res.text();
      }, PAC_SOCKS5_PATH);

      expect(pacContent).toContain('FindProxyForURL');

      console.log('✅ PAC files accessible from any page through proxy');
    });
  });
});
