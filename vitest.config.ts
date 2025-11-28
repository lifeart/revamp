import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    // Build before running tests to ensure worker files exist
    globalSetup: './vitest.setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/types/**',
        'src/benchmarks/**',
        'src/transformers/polyfills/**',
        'src/transformers/js-worker.ts',
        'src/portal/index.ts',
      ],
    },
  },
});
