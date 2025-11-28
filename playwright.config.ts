import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially since they share the proxy
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // Single worker to avoid proxy conflicts
  reporter: [['html'], ['list']],

  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000,
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

  // Start the proxy server before running tests
  webServer: {
    command: 'pnpm start',
    // Use captive portal port for ready check since it responds to direct HTTP requests
    // The HTTP proxy port (8080) expects proxied requests, not direct ones
    url: 'http://127.0.0.1:8888',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
