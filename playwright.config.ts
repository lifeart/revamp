import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially since they share the proxy
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // Single worker to avoid proxy conflicts
  reporter: [['html'], ['list']],

  timeout: 5000, // 5 seconds per test
  expect: {
    timeout: 3000,
  },

  use: {
    // Ignore HTTPS errors since we're using self-signed certs
    ignoreHTTPSErrors: true,

    // Trace on failure for debugging
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Set a reasonable viewport
    viewport: { width: 1280, height: 720 },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use HTTP proxy - Chromium handles CONNECT tunneling automatically
        proxy: {
          server: 'http://127.0.0.1:8080',
        },
      },
    },
  ],

  // Start both the proxy server and mock server before running tests
  webServer: [
    {
      command: 'pnpm start',
      // Use captive portal port for ready check since it responds to direct HTTP requests
      // The HTTP proxy port (8080) expects proxied requests, not direct ones
      url: 'http://127.0.0.1:8888',
      reuseExistingServer: false,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm mock-server',
      // Mock server HTTP port for ready check
      url: 'http://127.0.0.1:9080',
      reuseExistingServer: false,
      timeout: 10000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
