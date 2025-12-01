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
import { getConfig, type RevampConfig } from '../config/index.js';
import type { JsWorkerInput, JsWorkerOutput } from './js-worker.js';

// Get the directory of this file for resolving the worker
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy-initialized worker pool
let pool: Tinypool | null = null;

/**
 * Resolve the worker file path.
 * Looks for compiled js-worker.js in same directory or dist/.
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
    const cpuCount = cpus().length;

    pool = new Tinypool({
      filename: workerPath,
      // Use all CPUs for maximum parallelism - Babel is CPU-bound
      minThreads: Math.max(2, Math.floor(cpuCount / 2)),
      maxThreads: cpuCount,
      // Allow multiple concurrent tasks per worker for better throughput
      concurrentTasksPerWorker: 2,
      // Idle timeout - terminate workers after 60s of inactivity
      idleTimeout: 60000,
    });

    console.log(`🔧 Babel worker pool initialized with ${pool.options.maxThreads} max threads (${pool.options.concurrentTasksPerWorker} tasks/worker)`);
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
 * Prewarm the worker pool by initializing workers early
 * Call this at application startup for faster first transforms
 */
export async function prewarmWorkerPool(): Promise<void> {
  const config = getConfig();
  if (!config.transformJs) return;

  console.log('🔥 Prewarming Babel worker pool...');
  const workerPool = getPool();

  // Run a minimal transform to ensure workers are ready
  const warmupCode = 'const x = 1;';
  try {
    await workerPool.run({ code: warmupCode, targets: config.targets } as JsWorkerInput);
    console.log('✅ Worker pool prewarmed and ready');
  } catch {
    // Ignore warmup errors
  }
}

/**
 * Check if the code is a React Server Component (RSC) / Next.js data payload.
 * These contain JSON data strings that should not be transformed by Babel.
 */
function isRscPayload(code: string): boolean {
  // Next.js RSC patterns - these scripts contain embedded JSON that Babel can corrupt
  return /self\s*\.\s*__next_[fsc]\s*\.?\s*push|self\s*\.\s*__next_[fsc]\s*=/.test(code) ||
    // RSC wire format at start of content
    /^\s*\d+:["\[]/.test(code) ||
    // React component boundary markers ($RC, $RS, $RX)
    /\$R[CSX]\s*\(/.test(code);
}

/**
 * Transform JavaScript code for legacy browser compatibility
 * Uses worker pool for parallel processing
 *
 * Optimization: Skip transformation for small files or files that don't
 * contain modern JS syntax that needs transpiling.
 */
export async function transformJs(code: string, filename?: string, config?: RevampConfig): Promise<string> {
  const effectiveConfig = config || getConfig();

  if (!effectiveConfig.transformJs) {
    return code;
  }

  // Skip very small files (< 100 bytes) - likely not complex JS
  if (code.length < 100) {
    return code;
  }

  // Skip RSC payloads - they contain JSON data that Babel can corrupt
  if (isRscPayload(code)) {
    console.log(`⏭️ Skipping RSC payload: ${filename || 'unknown'}`);
    return code;
  }

  // For large files (> 10KB), always transform - the heuristic might miss things
  // and the cost of a syntax error is higher than the transform cost
  const isLargeFile = code.length > 10000;

  // Quick heuristic check - skip if no modern JS features detected
  // This avoids expensive Babel parsing for already-compatible code
  if (!isLargeFile && !needsJsTransform(code)) {
    return code;
  }

  try {
    const workerPool = getPool();

    const input: JsWorkerInput = {
      code,
      filename,
      targets: effectiveConfig.targets,
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
  // Check for modern JS features that Safari 9/iOS 9 doesn't support
  const modernPatterns = [
    /\blet\s+\w/,        // let declarations (Safari 9 has issues in strict mode)
    /\bconst\s+\w/,      // const declarations
    /\bclass\s+\w/,      // class declarations
    /=>/,                // Arrow functions
    /`[^`]*`/,           // Template literals
    /\?\./,              // Optional chaining
    /\?\?/,              // Nullish coalescing
    /\.\.\.(?=\w)/,      // Spread in object literals (rough check)
    /async\s+function/,  // Async functions
    /\bawait\s+/,        // Await keyword
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
