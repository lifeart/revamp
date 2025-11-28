/**
 * Vitest global setup - runs once before all tests
 * Builds the project to ensure worker files exist
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

export default async function setup() {
  const workerPath = resolve(__dirname, 'dist/transformers/js-worker.js');

  if (!existsSync(workerPath)) {
    console.log('🔨 Building project for worker files...');
    execSync('pnpm build', { stdio: 'inherit' });
  }
}
