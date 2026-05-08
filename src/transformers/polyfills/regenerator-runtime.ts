/**
 * regenerator-runtime polyfill loader.
 *
 * Babel's preset-env transforms `async`/`await` and generators into a state
 * machine that calls `regeneratorRuntime.wrap(...)`. Without this runtime
 * present, transformed code throws `ReferenceError: regeneratorRuntime is not
 * defined` on the iPad. We embed `regenerator-runtime/runtime.js` verbatim
 * at the top of the polyfill bundle so the global exists before any
 * transformed user code runs.
 *
 * The runtime ships as plain ES5 and assigns `regeneratorRuntime = runtime`
 * in non-strict mode (creating a global), with a `globalThis` fallback. The
 * surrounding polyfill IIFE in index.ts is intentionally non-strict for this
 * to work on Safari 9.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadRegeneratorRuntimeSource(): string {
  try {
    const runtimePath = require.resolve('regenerator-runtime/runtime.js');
    return readFileSync(runtimePath, 'utf-8');
  } catch (orig) {
    const message = orig instanceof Error ? orig.message : String(orig);
    throw new Error(
      '[Revamp] Failed to load regenerator-runtime — is the package installed? Original: ' +
        message,
    );
  }
}

export const regeneratorRuntimePolyfill = loadRegeneratorRuntimeSource();
