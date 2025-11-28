#!/usr/bin/env npx ts-node
/**
 * Performance Benchmark for Revamp Proxy
 *
 * Tests parallel request handling with the new worker pool architecture.
 * Run with: npx ts-node src/benchmarks/parallel-transform.ts
 */

import { transformJs } from '../transformers/js.js';
import { transformCss } from '../transformers/css.js';
import { compressGzip, decompressBody } from '../proxy/shared.js';
import { updateConfig } from '../config/index.js';

// Sample JavaScript code with modern features (needs transformation)
// Each iteration is wrapped in an IIFE to avoid duplicate declarations
const SAMPLE_JS = Array.from({ length: 10 }, (_, i) => `
(function sample${i}() {
  const data${i} = { name: 'test', value: ${42 + i} };
  const copy${i} = { ...data${i}, extra: true };
  const getName${i} = () => copy${i}?.name ?? 'default';
  const result${i} = async () => {
    const items = [1, 2, 3, 4, 5];
    const doubled = items.map(x => x * 2);
    return doubled;
  };
  class MyClass${i} {
    #privateField = ${123 + i};
    static staticField = 'hello';
    getPrivate() { return this.#privateField; }
  }
  const arr${i} = [1, [2, [3]]];
  const flat${i} = arr${i}.flat(2);
  const entries${i} = Object.fromEntries([['a', 1], ['b', 2]]);
  globalThis.myGlobal${i} = 'test';
  return result${i};
})();
`).join('\n');

// Sample CSS with modern features
const SAMPLE_CSS = `
.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.item {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  aspect-ratio: 16 / 9;
  background-color: color-mix(in oklch, red 50%, blue);
}

@media (prefers-color-scheme: dark) {
  .dark-item { background: black; }
}

:is(.a, .b, .c) {
  margin-inline: auto;
  padding-block: 1rem;
}
`.repeat(5);

// Sample data for compression
const SAMPLE_DATA = Buffer.from(SAMPLE_JS.repeat(5));

interface BenchmarkResult {
  name: string;
  sequential: number;
  parallel: number;
  speedup: number;
  opsPerSecond: number;
}

async function benchmark(
  name: string,
  fn: () => Promise<unknown>,
  iterations: number = 10
): Promise<{ sequential: number; parallel: number }> {
  // Warm up
  await fn();
  await fn();

  // Sequential execution
  const seqStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const seqTime = performance.now() - seqStart;

  // Parallel execution
  const parStart = performance.now();
  await Promise.all(Array(iterations).fill(0).map(() => fn()));
  const parTime = performance.now() - parStart;

  return {
    sequential: seqTime / iterations,
    parallel: parTime / iterations,
  };
}

async function runBenchmarks() {
  console.log('🚀 Revamp Performance Benchmark\n');
  console.log('=' .repeat(60));

  // Enable transformations
  updateConfig({
    transformJs: true,
    transformCss: true,
    compressionLevel: 4,
  });

  const results: BenchmarkResult[] = [];
  const iterations = 20;

  // Benchmark JS transformation
  console.log('\n📦 JavaScript Transformation (Babel Worker Pool)');
  console.log('-'.repeat(60));
  const jsResult = await benchmark(
    'JS Transform',
    () => transformJs(SAMPLE_JS, 'benchmark.js'),
    iterations
  );
  results.push({
    name: 'JS Transform',
    ...jsResult,
    speedup: jsResult.sequential / jsResult.parallel,
    opsPerSecond: 1000 / jsResult.parallel,
  });
  console.log(`  Sequential: ${jsResult.sequential.toFixed(2)}ms per op`);
  console.log(`  Parallel:   ${jsResult.parallel.toFixed(2)}ms per op`);
  console.log(`  Speedup:    ${(jsResult.sequential / jsResult.parallel).toFixed(2)}x`);

  // Benchmark CSS transformation
  console.log('\n🎨 CSS Transformation (PostCSS)');
  console.log('-'.repeat(60));
  const cssResult = await benchmark(
    'CSS Transform',
    () => transformCss(SAMPLE_CSS, 'benchmark.css'),
    iterations
  );
  results.push({
    name: 'CSS Transform',
    ...cssResult,
    speedup: cssResult.sequential / cssResult.parallel,
    opsPerSecond: 1000 / cssResult.parallel,
  });
  console.log(`  Sequential: ${cssResult.sequential.toFixed(2)}ms per op`);
  console.log(`  Parallel:   ${cssResult.parallel.toFixed(2)}ms per op`);
  console.log(`  Speedup:    ${(cssResult.sequential / cssResult.parallel).toFixed(2)}x`);

  // Benchmark gzip compression
  console.log('\n🗜️ Gzip Compression (Async zlib)');
  console.log('-'.repeat(60));
  const gzipResult = await benchmark(
    'Gzip Compress',
    () => compressGzip(SAMPLE_DATA),
    iterations
  );
  results.push({
    name: 'Gzip Compress',
    ...gzipResult,
    speedup: gzipResult.sequential / gzipResult.parallel,
    opsPerSecond: 1000 / gzipResult.parallel,
  });
  console.log(`  Sequential: ${gzipResult.sequential.toFixed(2)}ms per op`);
  console.log(`  Parallel:   ${gzipResult.parallel.toFixed(2)}ms per op`);
  console.log(`  Speedup:    ${(gzipResult.sequential / gzipResult.parallel).toFixed(2)}x`);

  // Benchmark decompression
  const compressed = await compressGzip(SAMPLE_DATA);
  console.log('\n📤 Gzip Decompression (Async zlib)');
  console.log('-'.repeat(60));
  const gunzipResult = await benchmark(
    'Gzip Decompress',
    () => decompressBody(compressed, 'gzip'),
    iterations
  );
  results.push({
    name: 'Gzip Decompress',
    ...gunzipResult,
    speedup: gunzipResult.sequential / gunzipResult.parallel,
    opsPerSecond: 1000 / gunzipResult.parallel,
  });
  console.log(`  Sequential: ${gunzipResult.sequential.toFixed(2)}ms per op`);
  console.log(`  Parallel:   ${gunzipResult.parallel.toFixed(2)}ms per op`);
  console.log(`  Speedup:    ${(gunzipResult.sequential / gunzipResult.parallel).toFixed(2)}x`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log('\n| Operation | Sequential | Parallel | Speedup | Ops/sec |');
  console.log('|-----------|------------|----------|---------|---------|');
  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(9)} | ${r.sequential.toFixed(2).padStart(8)}ms | ${r.parallel.toFixed(2).padStart(6)}ms | ${r.speedup.toFixed(2).padStart(6)}x | ${r.opsPerSecond.toFixed(1).padStart(7)} |`
    );
  }

  const avgSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) / results.length;
  console.log(`\n✨ Average parallel speedup: ${avgSpeedup.toFixed(2)}x`);
  console.log('\nNote: Higher speedup with more concurrent requests.');
  console.log('      Worker pool benefits increase under heavy load.\n');

  // Cleanup
  const { shutdownWorkerPool } = await import('../transformers/js.js');
  await shutdownWorkerPool();
}

runBenchmarks().catch(console.error);
