/**
 * Vitest global setup - runs once before all tests
 * Builds only the worker entry (not the full project) so unit tests start fast.
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname portably for ESM. The bare `__dirname` global only works
// under Node's CJS loader; vitest happens to provide it today but ESM-strict
// runtimes do not.
const setupDir = fileURLToPath(new URL('.', import.meta.url));

export default async function setup() {
  const workerPath = resolve(setupDir, 'dist/transformers/js-worker.js');

  if (!existsSync(workerPath)) {
    console.log('Building worker entry (tsconfig.workers.json)...');
    execSync('pnpm exec tsc --project tsconfig.workers.json', {
      stdio: 'inherit',
    });
  }
}
