/**
 * Shared helpers for transformer worker pools (Babel, PostCSS).
 *
 * Both pools offload CPU-intensive transforms to tinypool worker threads so
 * the main event loop stays free to serve concurrent proxy connections.
 * The resolution and sizing logic is identical, so it lives here once.
 */

import { Tinypool } from 'tinypool';
import { resolve } from 'path';
import { cpus } from 'os';
import { existsSync } from 'fs';

/**
 * Resolve a worker file path relative to the calling module's directory.
 *
 * - Production (compiled dist): the worker .js sits next to the compiled
 *   caller in dist/transformers/, so the same-directory path wins.
 * - Development (tsx runs .ts sources): the caller's directory is
 *   src/transformers/ where no compiled worker exists, so we fall back to
 *   dist/transformers/ (built by `pnpm build` or, for unit tests, by
 *   vitest.setup.ts via tsconfig.workers.json).
 *
 * @param moduleDir Directory of the calling module (dirname of import.meta.url)
 * @param workerFileName Compiled worker file name, e.g. 'js-worker.js'
 */
export function resolveWorkerPath(moduleDir: string, workerFileName: string): string {
  // First try the same directory (for compiled code)
  const sameDirPath = resolve(moduleDir, workerFileName);
  if (existsSync(sameDirPath)) {
    return sameDirPath;
  }

  // For tsx/development: look in dist/transformers/
  const distPath = resolve(moduleDir, '../../dist/transformers', workerFileName);
  if (existsSync(distPath)) {
    return distPath;
  }

  // Fallback to same directory path (will error but with clear message)
  return sameDirPath;
}

/**
 * Create a transformer worker pool with the shared sizing defaults.
 *
 * Sizing rationale (shared by the Babel and PostCSS pools):
 * - minThreads cpus/2 (>= 2): keep warm workers around for bursty traffic
 * - maxThreads = cpu count: transforms are CPU-bound
 * - 2 concurrent tasks per worker: better throughput while a task awaits
 * - 60s idle timeout: reap workers when traffic dies down
 */
export function createTransformerPool(workerPath: string): Tinypool {
  const cpuCount = cpus().length;

  return new Tinypool({
    filename: workerPath,
    minThreads: Math.max(2, Math.floor(cpuCount / 2)),
    maxThreads: cpuCount,
    concurrentTasksPerWorker: 2,
    idleTimeout: 60000,
  });
}
