/**
 * CSS Transformer using PostCSS Worker Pool
 * Transforms modern CSS to be compatible with iOS 9+ Safari (iPad 2+)
 *
 * Uses tinypool to offload CPU-intensive PostCSS transforms to worker threads,
 * keeping the main event loop free for handling concurrent requests.
 */

import { fileURLToPath } from 'url';
import { log } from '../logger/log.js';
import { dirname } from 'path';
import type { Tinypool } from 'tinypool';
import { getConfig, type RevampConfig } from '../config/index.js';
import { resolveWorkerPath, createTransformerPool } from './worker-pool.js';
import type { CssWorkerInput, CssWorkerOutput } from './css-worker.js';

// Get the directory of this file for resolving the worker
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy-initialized worker pool
let pool: Tinypool | null = null;

/**
 * Get or create the PostCSS worker pool
 * Uses lazy initialization to avoid startup overhead if CSS transform is disabled
 */
function getPool(): Tinypool {
  if (!pool) {
    const workerPath = resolveWorkerPath(__dirname, 'css-worker.js');
    pool = createTransformerPool(workerPath);

    log.debug(`🎨 PostCSS worker pool initialized with ${pool.options.maxThreads} max threads (${pool.options.concurrentTasksPerWorker} tasks/worker)`);
  }

  return pool;
}

/**
 * Gracefully shutdown the worker pool
 * Call this when the application is shutting down
 */
export async function shutdownCssWorkerPool(): Promise<void> {
  if (pool) {
    log.debug('🎨 Shutting down PostCSS worker pool...');
    await pool.destroy();
    pool = null;
  }
}

/**
 * Prewarm the worker pool by initializing workers early
 * Call this at application startup for faster first transforms
 */
export async function prewarmCssWorkerPool(): Promise<void> {
  const config = getConfig();
  if (!config.transformCss) return;

  log.debug('🔥 Prewarming PostCSS worker pool...');
  const workerPool = getPool();

  // Run a minimal transform to ensure workers are ready
  const warmupCode = '.warmup { display: flex; }';
  try {
    await workerPool.run({ code: warmupCode, targets: config.targets } as CssWorkerInput);
    log.debug('✅ PostCSS worker pool prewarmed and ready');
  } catch (error) {
    // Warmup failures are non-fatal (the pool retries lazily on first real
    // transform), but they must be visible — a broken worker file would
    // otherwise surface much later as per-request fallbacks.
    log.warn('⚠️ PostCSS worker pool warmup failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Transform CSS code for legacy browser compatibility
 * Uses worker pool for parallel processing
 *
 * Optimization: Skip transformation for small files or files that don't
 * contain modern CSS features that need transpiling.
 */
export async function transformCss(code: string, filename?: string, config?: RevampConfig): Promise<string> {
  const effectiveConfig = config || getConfig();

  if (!effectiveConfig.transformCss) {
    return code;
  }

  // Skip very small files (< 50 bytes) - likely not complex CSS
  if (code.length < 50) {
    return code;
  }

  // Quick heuristic check - skip if no modern CSS features detected
  // This avoids expensive PostCSS parsing for already-compatible code
  if (!needsCssTransform(code)) {
    return code;
  }

  try {
    const workerPool = getPool();

    const input: CssWorkerInput = {
      code,
      filename,
      // The PostCSS processor has always been built from the GLOBAL config
      // targets (not a per-request config override) — preserve that.
      targets: getConfig().targets,
    };

    const result = await workerPool.run(input) as CssWorkerOutput;

    if (result.error) {
      log.error('❌ PostCSS transform error:', result.error);
      // Worker already returns the original code on transform errors
      return result.css;
    }

    return result.css;
  } catch (error) {
    log.error('❌ PostCSS worker error:', error instanceof Error ? error.message : error);
    // Return original code on error to not break the page
    return code;
  }
}

/**
 * Check if the CSS likely needs transformation
 * Quick heuristic to avoid unnecessary processing
 */
export function needsCssTransform(code: string): boolean {
  // Check for modern CSS features that iOS 9 doesn't support well
  const modernPatterns = [
    /:is\(/,                  // :is() selector
    /:where\(/,               // :where() selector
    /:has\(/,                 // :has() selector
    /gap:/,                   // gap property (needs prefixes in older Safari)
    /row-gap:/,               // row-gap property
    /column-gap:/,            // column-gap property
    /aspect-ratio:/,          // aspect-ratio
    /color-mix\(/,            // color-mix()
    /oklch\(/,                // oklch color
    /oklab\(/,                // oklab color
    /container-type:/,        // container queries
    /@container/,             // container queries
    /@layer/,                 // cascade layers
    /inset:/,                 // logical property
    /inline-size:/,           // logical property
    /block-size:/,            // logical property
    /margin-inline:/,         // logical property
    /padding-block:/,         // logical property
    /scroll-behavior:/,       // scroll-behavior
    /overscroll-behavior:/,   // overscroll-behavior
    /backdrop-filter:/,       // backdrop-filter (partial iOS support)
    /clamp\(/,                // clamp() function
    /min\(/,                  // min() function
    /max\(/,                  // max() function
    /display:\s*flex/,        // flexbox - needs -webkit- for Safari 9
    /display:\s*inline-flex/, // inline-flex - needs -webkit- for Safari 9
    /display:\s*grid/,        // grid - needs prefixes
    /flex-direction:/,        // flexbox property
    /flex-wrap:/,             // flexbox property
    /justify-content:/,       // flexbox property
    /align-items:/,           // flexbox property
    /align-self:/,            // flexbox property
    /align-content:/,         // flexbox property
    /flex-grow:/,             // flexbox property
    /flex-shrink:/,           // flexbox property
    /flex-basis:/,            // flexbox property
    /grid-template/,          // grid property
    /grid-area:/,             // grid property
    /grid-column:/,           // grid property
    /grid-row:/,              // grid property
    /place-items:/,           // shorthand for align-items + justify-items
    /place-content:/,         // shorthand for align-content + justify-content
    /place-self:/,            // shorthand for align-self + justify-self
  ];

  return modernPatterns.some(pattern => pattern.test(code));
}

/**
 * Reset the processor (useful if config changes)
 *
 * Kept for API compatibility. The PostCSS processor now lives inside each
 * worker thread and is keyed by the targets it was built with, so it rebuilds
 * automatically whenever config.targets changes — no manual reset is needed.
 */
export function resetCssProcessor(): void {
  // Intentionally a no-op: worker-side processors invalidate themselves
  // when the targets passed with each task change.
}
