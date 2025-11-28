/**
 * JavaScript Transformer using Babel Worker Pool
 * Transforms modern JavaScript to be compatible with iOS 11 Safari
 *
 * Uses tinypool to offload CPU-intensive Babel transforms to worker threads,
 * keeping the main event loop free for handling concurrent requests.
 */

import { Tinypool } from 'tinypool';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { cpus } from 'os';
import { existsSync } from 'fs';
import { getConfig } from '../config/index.js';
import type { JsWorkerInput, JsWorkerOutput } from './js-worker.js';

// Get the directory of this file for resolving the worker
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy-initialized worker pool
let pool: Tinypool | null = null;

/**
 * Resolve the worker file path.
 * When running with tsx (development), the worker needs to be in dist/.
 * When running compiled code, it's in the same directory.
 */
function resolveWorkerPath(): string {
  // First try the same directory (for compiled code)
  const sameDirPath = resolve(__dirname, 'js-worker.js');
  if (existsSync(sameDirPath)) {
    return sameDirPath;
  }

  // For tsx/development: look in dist/transformers/
  const distPath = resolve(__dirname, '../../dist/transformers/js-worker.js');
  if (existsSync(distPath)) {
    return distPath;
  }

  // Fallback to same directory path (will error but with clear message)
  return sameDirPath;
}

/**
 * Get or create the Babel worker pool
 * Uses lazy initialization to avoid startup overhead if JS transform is disabled
 */
function getPool(): Tinypool {
  if (!pool) {
    const workerPath = resolveWorkerPath();

    pool = new Tinypool({
      filename: workerPath,
      // Number of workers - use CPU count minus 1 to leave room for main thread
      // Minimum 2 workers for some parallelism
      minThreads: 2,
      maxThreads: Math.max(2, cpus().length - 1),
      // Idle timeout - terminate workers after 30s of inactivity
      idleTimeout: 30000,
    });

    console.log(`🔧 Babel worker pool initialized with ${pool.options.maxThreads} max threads`);
  }

  return pool;
}

/**
 * Gracefully shutdown the worker pool
 * Call this when the application is shutting down
 */
export async function shutdownWorkerPool(): Promise<void> {
  if (pool) {
    console.log('🔧 Shutting down Babel worker pool...');
    await pool.destroy();
    pool = null;
  }
}

/**
 * Transform JavaScript code for legacy browser compatibility
 * Uses worker pool for parallel processing
 */
export async function transformJs(code: string, filename?: string): Promise<string> {
  const config = getConfig();

  if (!config.transformJs) {
    return code;
  }

  try {
    const workerPool = getPool();

    const input: JsWorkerInput = {
      code,
      filename,
      targets: config.targets,
    };

    const result = await workerPool.run(input) as JsWorkerOutput;

    if (result.error) {
      if (result.isIgnorable) {
        console.warn(`⚠️ Skipping JS transform (non-critical parse issue): ${filename || 'unknown'}`);
        return result.code;
      }

      console.error('❌ Babel transform error:', result.error);
      return result.code;
    }

    return result.code;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Babel worker error:', errorMessage);
    // Return original code on error to not break the page
    return code;
  }
}

/**
 * Check if the code likely needs transformation
 * Quick heuristic to avoid unnecessary processing
 */
export function needsJsTransform(code: string): boolean {
  // Check for modern JS features that iOS 11 doesn't support
  const modernPatterns = [
    /\?\./,              // Optional chaining
    /\?\?/,              // Nullish coalescing
    /\.\.\.(?=\w)/,      // Spread in object literals (rough check)
    /async\s+function\*/, // Async generators
    /for\s+await/,       // For-await-of
    /\#\w+/,             // Private class fields
    /static\s+\{/,       // Static blocks
    /(?<!\w)import\s*\(/,// Dynamic import
    /BigInt|(?<!\w)\d+n(?!\w)/, // BigInt
    /Array\.prototype\.flat/, // Array.flat
    /Object\.fromEntries/,    // Object.fromEntries
    /String\.prototype\.matchAll/, // String.matchAll
    /Promise\.allSettled/,    // Promise.allSettled
    /globalThis/,             // globalThis
  ];

  return modernPatterns.some(pattern => pattern.test(code));
}
