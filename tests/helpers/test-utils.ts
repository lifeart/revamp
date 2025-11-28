/**
 * Shared Test Utilities
 *
 * Helper functions and constants to reduce code duplication in Playwright tests.
 *
 * @module tests/helpers/test-utils
 */

import { Page, expect } from '@playwright/test';

// =============================================================================
// Constants
// =============================================================================

/** Mock server base URL */
export const MOCK_SERVER = 'http://127.0.0.1:9080';

/** Captive portal base URL */
export const PORTAL_BASE = 'http://127.0.0.1:8888';

/** Revamp API paths */
export const API_PATHS = {
  config: '/__revamp__/config',
  metricsHtml: '/__revamp__/metrics',
  metricsJson: '/__revamp__/metrics/json',
  pacSocks5: '/__revamp__/pac/socks5',
  pacHttp: '/__revamp__/pac/http',
  pacCombined: '/__revamp__/pac/combined',
} as const;

/** Default page load options */
export const DEFAULT_LOAD_OPTIONS = {
  waitUntil: 'domcontentloaded' as const,
  timeout: 30000,
};

// =============================================================================
// Navigation Helpers
// =============================================================================

/**
 * Navigate to a page and verify it loaded successfully.
 *
 * @param page - Playwright page
 * @param url - URL to navigate to
 * @param options - Optional navigation options
 * @returns Response status code
 */
export async function navigateAndVerify(
  page: Page,
  url: string,
  options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number } = {}
): Promise<number> {
  const opts = { ...DEFAULT_LOAD_OPTIONS, ...options };
  const response = await page.goto(url, opts);
  const status = response?.status() ?? 0;
  expect(status).toBeLessThan(400);
  return status;
}

/**
 * Navigate to mock server page.
 *
 * @param page - Playwright page
 * @param path - Path on mock server (default: '/')
 * @returns Response status code
 */
export async function goToMockServer(page: Page, path: string = '/'): Promise<number> {
  return navigateAndVerify(page, `${MOCK_SERVER}${path}`);
}

/**
 * Navigate to captive portal.
 *
 * @param page - Playwright page
 * @param path - Path on portal (default: '')
 * @returns Response status code
 */
export async function goToPortal(page: Page, path: string = ''): Promise<number> {
  return navigateAndVerify(page, `${PORTAL_BASE}${path}`);
}

// =============================================================================
// API Helpers
// =============================================================================

/**
 * Fetch JSON from a URL via page context.
 *
 * @param page - Playwright page
 * @param path - API path
 * @returns Parsed JSON response
 */
export async function fetchJson<T = unknown>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (endpoint) => {
    const res = await fetch(endpoint);
    return res.json();
  }, path);
}

/**
 * Fetch text from a URL via page context.
 *
 * @param page - Playwright page
 * @param path - API path
 * @returns Text response
 */
export async function fetchText(page: Page, path: string): Promise<string> {
  return page.evaluate(async (endpoint) => {
    const res = await fetch(endpoint);
    return res.text();
  }, path);
}

/**
 * Fetch with full response details.
 *
 * @param page - Playwright page
 * @param path - API path
 * @param options - Fetch options
 * @returns Response with status, headers, and body
 */
export async function fetchWithDetails<T = unknown>(
  page: Page,
  path: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<{ status: number; headers: Record<string, string | null>; body: T }> {
  return page.evaluate(
    async ({ endpoint, opts }) => {
      const res = await fetch(endpoint, {
        method: opts?.method,
        headers: opts?.headers,
        body: opts?.body,
      });
      const contentType = res.headers.get('content-type') || '';
      const body = contentType.includes('json') ? await res.json() : await res.text();
      return {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type'),
          'access-control-allow-origin': res.headers.get('access-control-allow-origin'),
          'content-disposition': res.headers.get('content-disposition'),
          'cache-control': res.headers.get('cache-control'),
        },
        body,
      };
    },
    { endpoint: path, opts: options }
  );
}

// =============================================================================
// Config API Helpers
// =============================================================================

/** Config response structure */
export interface ConfigResponse {
  success: boolean;
  config: {
    transformJs: boolean;
    transformCss: boolean;
    transformHtml: boolean;
    removeAds: boolean;
    removeTracking: boolean;
    injectPolyfills: boolean;
    spoofUserAgent: boolean;
    spoofUserAgentInJs: boolean;
    cacheEnabled: boolean;
    [key: string]: unknown;
  };
}

/**
 * Get current config via API.
 *
 * @param page - Playwright page
 * @returns Config response
 */
export async function getConfig(page: Page): Promise<ConfigResponse> {
  return fetchJson<ConfigResponse>(page, API_PATHS.config);
}

/**
 * Update config via API.
 *
 * @param page - Playwright page
 * @param config - Partial config to update
 * @returns Update response
 */
export async function updateConfig(
  page: Page,
  config: Partial<ConfigResponse['config']>
): Promise<{ success: boolean }> {
  return page.evaluate(
    async ({ endpoint, cfg }) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      return res.json();
    },
    { endpoint: API_PATHS.config, cfg: config }
  );
}

/**
 * Reset config to defaults via API.
 *
 * @param page - Playwright page
 * @returns Reset response
 */
export async function resetConfig(page: Page): Promise<{ success: boolean }> {
  return page.evaluate(async (endpoint) => {
    const res = await fetch(endpoint, { method: 'DELETE' });
    return res.json();
  }, API_PATHS.config);
}

/**
 * Helper to temporarily change a config value and restore it after.
 *
 * @param page - Playwright page
 * @param key - Config key to change
 * @param testFn - Async function to run with changed config
 */
export async function withConfigValue<K extends keyof ConfigResponse['config']>(
  page: Page,
  key: K,
  newValue: ConfigResponse['config'][K],
  testFn: () => Promise<void>
): Promise<void> {
  const { config: originalConfig } = await getConfig(page);
  const originalValue = originalConfig[key];

  try {
    await updateConfig(page, { [key]: newValue } as Partial<ConfigResponse['config']>);
    await testFn();
  } finally {
    await updateConfig(page, { [key]: originalValue } as Partial<ConfigResponse['config']>);
  }
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Verify page has expected title containing text.
 *
 * @param page - Playwright page
 * @param expectedText - Text that should be in title
 */
export async function expectTitleContains(page: Page, expectedText: string): Promise<void> {
  const title = await page.title();
  expect(title).toContain(expectedText);
}

/**
 * Verify element is visible and has proper styling (not hidden by CSS).
 *
 * @param page - Playwright page
 * @param selector - Element selector
 */
export async function expectVisibleAndClickable(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector);
  await expect(element).toBeVisible({ timeout: 5000 });
  await expect(element).toBeEnabled();

  const styles = await element.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
    };
  });

  expect(styles.display).not.toBe('none');
  expect(styles.visibility).not.toBe('hidden');
  expect(parseFloat(styles.opacity)).toBeGreaterThan(0);
  expect(styles.pointerEvents).not.toBe('none');
}

/**
 * Verify element has minimum dimensions.
 *
 * @param page - Playwright page
 * @param selector - Element selector
 * @param minWidth - Minimum width
 * @param minHeight - Minimum height
 */
export async function expectMinDimensions(
  page: Page,
  selector: string,
  minWidth: number,
  minHeight: number
): Promise<void> {
  const element = page.locator(selector);
  const boundingBox = await element.boundingBox();
  expect(boundingBox).not.toBeNull();
  expect(boundingBox!.width).toBeGreaterThan(minWidth);
  expect(boundingBox!.height).toBeGreaterThan(minHeight);
}

/**
 * Verify text content contains all expected strings.
 *
 * @param page - Playwright page
 * @param selector - Element selector
 * @param expectedTexts - Array of texts that should be present
 */
export async function expectTextContainsAll(
  page: Page,
  selector: string,
  expectedTexts: string[]
): Promise<void> {
  const text = await page.locator(selector).textContent();
  for (const expected of expectedTexts) {
    expect(text).toContain(expected);
  }
}

// =============================================================================
// Certificate Helpers
// =============================================================================

/**
 * Verify certificate response is valid PEM format.
 *
 * @param page - Playwright page
 * @param path - Certificate endpoint path
 */
export async function expectValidCertificate(page: Page, path: string): Promise<void> {
  const response = await fetchWithDetails<string>(page, path);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('x509');
  expect(response.body).toContain('-----BEGIN CERTIFICATE-----');
  expect(response.body).toContain('-----END CERTIFICATE-----');
}

// =============================================================================
// PAC File Helpers
// =============================================================================

/**
 * Verify PAC file is valid and contains expected content.
 *
 * @param page - Playwright page
 * @param path - PAC file endpoint path
 * @param expectedContent - Array of strings that should be in PAC content
 */
export async function expectValidPacFile(
  page: Page,
  path: string,
  expectedContent: string[]
): Promise<void> {
  const response = await fetchWithDetails<string>(page, path);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('proxy-autoconfig');
  expect(response.headers['content-disposition']).toContain('attachment');
  expect(response.headers['access-control-allow-origin']).toBe('*');

  const content = response.body;
  expect(content).toContain('function FindProxyForURL');

  for (const expected of expectedContent) {
    expect(content).toContain(expected);
  }

  // Verify it's valid JavaScript
  const isValid = await page.evaluate((pacContent) => {
    try {
      new Function(pacContent);
      return true;
    } catch {
      return false;
    }
  }, content);
  expect(isValid).toBe(true);
}

// =============================================================================
// Logging Helpers
// =============================================================================

/**
 * Log test success message.
 *
 * @param message - Success message
 */
export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

/**
 * Log test info message.
 *
 * @param message - Info message
 */
export function logInfo(message: string): void {
  console.log(`   ${message}`);
}
