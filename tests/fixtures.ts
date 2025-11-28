import { test as base } from '@playwright/test';
import { startMockServer, MockServer } from './mock-server';

/**
 * Extended Playwright test fixture that provides a mock server for e2e tests
 * The mock server is started once per worker and shared across tests
 */

// Mock server configuration
export const MOCK_HTTP_PORT = 9080;
export const MOCK_HTTPS_PORT = 9443;

// URLs to use in tests (these go through the proxy to the mock server)
export const TEST_URL = `http://127.0.0.1:${MOCK_HTTP_PORT}`;
export const TEST_URL_HTTPS = `https://127.0.0.1:${MOCK_HTTPS_PORT}`;

// Alternative domain names that resolve to mock server (for testing multi-site scenarios)
// In CI/testing, we'll use localhost with different ports or paths
export const MOCK_SITES = {
  main: TEST_URL,
  site1: `${TEST_URL}/site1`,
  site2: `${TEST_URL}/site2`,
  site3: `${TEST_URL}/site3`,
};

// Type for our extended test fixture
type MockServerFixture = {
  mockServer: MockServer;
  testUrl: string;
  testUrlHttps: string | undefined;
};

// Create worker-scoped fixture
export const test = base.extend<{}, MockServerFixture>({
  mockServer: [
    async ({}, use) => {
      // Start mock server once per worker
      const server = await startMockServer({
        httpPort: MOCK_HTTP_PORT,
        httpsPort: MOCK_HTTPS_PORT,
      });

      // Provide server to tests
      await use(server);

      // Cleanup after all tests in worker are done
      await server.close();
    },
    { scope: 'worker' },
  ],

  testUrl: [
    async ({ mockServer }, use) => {
      await use(`http://127.0.0.1:${mockServer.httpPort}`);
    },
    { scope: 'worker' },
  ],

  testUrlHttps: [
    async ({ mockServer }, use) => {
      await use(
        mockServer.httpsPort ? `https://127.0.0.1:${mockServer.httpsPort}` : undefined
      );
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
