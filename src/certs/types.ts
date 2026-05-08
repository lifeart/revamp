/**
 * Public-ish type definitions shared between `index.ts` and `internals.ts`.
 *
 * Keep this module tiny — it must not pull in node:fs or node-forge so that
 * `internals.ts` can be imported from a test-only file without dragging
 * production-only dependencies into the unit-test graph.
 */

/**
 * Certificate key-pair (PEM format).
 */
export interface CertificatePair {
  key: string;
  cert: string;
}
