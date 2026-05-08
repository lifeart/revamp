/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended-type-checked'],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'dist/',
    'coverage/',
    'node_modules/',
    'public/',
    'playwright-report/',
    'test-results/',
    'tests/',
    '*.config.ts',
    '*.config.js',
    '*.config.cjs',
    'vitest.setup.ts',
    '.eslintrc.cjs',
  ],
  // T31 strict rules enforced as ERRORS at the top level — new code must
  // pass cleanly. Files with preexisting violations are carved out below in
  // `overrides` and tracked for cleanup under T16 ("eliminate silent catch")
  // and the Batch B/C/E tickets that touch the affected modules.
  //
  // The list of legacy files in the override is the exact set that fails
  // today (per `pnpm lint`). When a file is cleaned up, drop it from the
  // override; do NOT add new entries — fix new violations instead.
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-empty-function': 'error',
    'no-empty': 'error',
    // The `recommended-type-checked` preset flags many preexisting unsafe
    // accesses across legacy modules; downgrade to keep CI green and let new
    // code be reviewed against the stricter intent. These are not part of
    // T31's strict-rule set, so they remain at warn globally for now.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-function-type': 'warn',
    '@typescript-eslint/require-await': 'warn',
    '@typescript-eslint/await-thenable': 'warn',
    '@typescript-eslint/no-redundant-type-constituents': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/no-base-to-string': 'warn',
    '@typescript-eslint/unbound-method': 'warn',
    '@typescript-eslint/only-throw-error': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    'no-useless-escape': 'warn',
    'no-control-regex': 'warn',
    'no-prototype-builtins': 'warn',
    'no-async-promise-executor': 'warn',
    'no-case-declarations': 'warn',
    'prefer-const': 'warn',
    '@typescript-eslint/prefer-promise-reject-errors': 'warn',
    '@typescript-eslint/restrict-plus-operands': 'warn',
  },
  overrides: [
    // ---------------------------------------------------------------
    // Legacy carve-out: files with preexisting T31-rule violations.
    // Listed explicitly — do NOT broaden the glob. When a file is
    // cleaned up, remove it from the corresponding list below.
    // ---------------------------------------------------------------

    // Files that still violate `@typescript-eslint/no-unused-vars`.
    {
      files: [
        'src/cache/index.ts',
        'src/certs/index.test.ts',
        'src/certs/index.ts',
        'src/config/index.test.ts',
        'src/config/index.ts',
        'src/filters/index.ts',
        'src/index.ts',
        'src/logger/json-request-logger.test.ts',
        'src/pac/index.test.ts',
        'src/plugins/hook-executor.test.ts',
        'src/plugins/loader.ts',
        'src/plugins/testing.test.ts',
        'src/plugins/testing.ts',
        'src/plugins/validation.test.ts',
        'src/portal/index.ts',
        'src/proxy/config-endpoint.ts',
        'src/proxy/http-client.test.ts',
        'src/proxy/http-client.ts',
        'src/proxy/http-proxy.test.ts',
        'src/proxy/http-proxy.ts',
        'src/proxy/index.test.ts',
        'src/proxy/remote-sw-server.ts',
        'src/proxy/revamp-api.ts',
        'src/proxy/shared.ts',
        'src/proxy/socks5.test.ts',
        'src/proxy/socks5.ts',
        'src/transformers/css-grid-fallback.test.ts',
        'src/transformers/css-grid-fallback.ts',
        'src/transformers/css.test.ts',
        'src/transformers/css.ts',
        'src/transformers/dark-mode-strip.ts',
        'src/transformers/esm-bundler.test.ts',
        'src/transformers/esm-bundler.ts',
        'src/transformers/html.ts',
        'src/transformers/image.test.ts',
        'src/transformers/js-worker.ts',
        'src/transformers/js.test.ts',
        'src/transformers/sw-bundler.test.ts',
        'src/transformers/sw-bundler.ts',
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
      },
    },

    // Files that still violate `@typescript-eslint/no-floating-promises`.
    {
      files: [
        'src/cache/index.ts',
        'src/config/storage.ts',
        'src/proxy/http-client.ts',
        'src/proxy/http-proxy.ts',
        'src/proxy/remote-sw-server.ts',
        'src/proxy/socks5.ts',
      ],
      rules: {
        '@typescript-eslint/no-floating-promises': 'warn',
      },
    },

    // Files that still violate `@typescript-eslint/no-misused-promises`.
    {
      files: [
        'src/plugins/loader.ts',
        'src/proxy/http-client.ts',
        'src/proxy/http-proxy.ts',
        'src/proxy/remote-sw-server.ts',
        'src/proxy/socks5.ts',
        'src/proxy/upstream-cert-validation.test.ts',
      ],
      rules: {
        '@typescript-eslint/no-misused-promises': 'warn',
      },
    },

    // Files that still violate `@typescript-eslint/no-empty-function`.
    {
      files: ['src/cache/index.ts'],
      rules: {
        '@typescript-eslint/no-empty-function': 'warn',
      },
    },

    // ---------------------------------------------------------------
    // examples/ and scripts/ — out of tree, so the type-aware project
    // doesn't cover them. Disable type-aware parsing here (we still get
    // the syntactic rules) so we can lint these files at all without
    // adding a second tsconfig.
    // ---------------------------------------------------------------
    {
      files: ['examples/**/*.{js,mjs,cjs,ts}', 'scripts/**/*.{js,mjs,cjs,ts}'],
      // Disable type-aware parsing — these files live outside the main
      // tsconfig include glob, and adding a second tsconfig is out of
      // scope for Batch H. The `disable-type-checked` preset turns off
      // every rule that requires the TypeScript program (no-floating-
      // promises, no-misused-promises, no-unsafe-*, etc.). Syntactic T31
      // rules (`no-unused-vars`, `no-empty-function`, `no-empty`) stay at
      // error level via the top-level config.
      parserOptions: {
        project: null,
      },
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
    },
  ],
};
