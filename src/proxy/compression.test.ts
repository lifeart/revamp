import { describe, it, expect } from 'vitest';
import {
  shouldCompress,
  acceptsGzip,
  decompressBody,
  compressGzip,
} from './compression.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { gzipSync, brotliCompressSync, deflateSync, gunzipSync } from 'node:zlib';

describe('shouldCompress', () => {
  it('should return true for text content types', () => {
    expect(shouldCompress('text/html')).toBe(true);
    expect(shouldCompress('text/css')).toBe(true);
    expect(shouldCompress('text/plain')).toBe(true);
    expect(shouldCompress('text/html; charset=utf-8')).toBe(true);
  });

  it('should return true for JSON', () => {
    expect(shouldCompress('application/json')).toBe(true);
    expect(shouldCompress('application/json; charset=utf-8')).toBe(true);
  });

  it('should return true for JavaScript', () => {
    expect(shouldCompress('application/javascript')).toBe(true);
    expect(shouldCompress('text/javascript')).toBe(true);
  });

  it('should return true for XML types', () => {
    expect(shouldCompress('application/xml')).toBe(true);
    expect(shouldCompress('application/xhtml+xml')).toBe(true);
    expect(shouldCompress('image/svg+xml')).toBe(true);
  });

  it('should return false for binary types', () => {
    expect(shouldCompress('image/png')).toBe(false);
    expect(shouldCompress('image/jpeg')).toBe(false);
    expect(shouldCompress('application/octet-stream')).toBe(false);
    expect(shouldCompress('video/mp4')).toBe(false);
  });
});

describe('acceptsGzip', () => {
  it('should return true if gzip is in accept-encoding', () => {
    expect(acceptsGzip('gzip, deflate')).toBe(true);
    expect(acceptsGzip('gzip')).toBe(true);
    expect(acceptsGzip('deflate, gzip, br')).toBe(true);
  });

  it('should return false if gzip is not accepted', () => {
    expect(acceptsGzip('deflate')).toBe(false);
    expect(acceptsGzip('br')).toBe(false);
    expect(acceptsGzip('')).toBe(false);
  });

  it('should handle undefined', () => {
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('decompressBody', () => {
  it('should decompress gzip content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = gzipSync(original);

    const result = await decompressBody(compressed, 'gzip');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress brotli content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = brotliCompressSync(original);

    const result = await decompressBody(compressed, 'br');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should decompress deflate content', async () => {
    const original = Buffer.from('Hello, World!');
    const compressed = deflateSync(original);

    const result = await decompressBody(compressed, 'deflate');
    expect(result.toString()).toBe('Hello, World!');
  });

  it('should return unchanged for no encoding', async () => {
    const original = Buffer.from('Hello, World!');

    expect(await decompressBody(original, undefined)).toBe(original);
    expect(await decompressBody(original, '')).toBe(original);
  });

  it('should return unchanged for unknown encoding', async () => {
    const original = Buffer.from('Hello, World!');

    const result = await decompressBody(original, 'unknown');
    expect(result).toBe(original);
  });

  it('should return original on decompression error', async () => {
    const invalidGzip = Buffer.from('not gzip data');

    const result = await decompressBody(invalidGzip, 'gzip');
    expect(result).toBe(invalidGzip);
  });
});

describe('compressGzip', () => {
  it('should compress data', async () => {
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressed = await compressGzip(data);
    expect(compressed.length).toBeLessThan(data.length);
  });

  it('should compress with specified level', async () => {
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressedLevel1 = await compressGzip(data, 1);
    const compressedLevel9 = await compressGzip(data, 9);
    // Level 9 should produce smaller output
    expect(compressedLevel9.length).toBeLessThanOrEqual(compressedLevel1.length);
  });

  it('should produce valid gzip output', async () => {
    const data = Buffer.from('Test data for compression');
    const compressed = await compressGzip(data);
    // Should be decompressible
    const decompressed = gunzipSync(compressed);
    expect(decompressed.toString()).toBe('Test data for compression');
  });

  it('should use config compression level when not specified', async () => {
    updateConfig({ compressionLevel: 9 });
    const data = Buffer.from('Hello World!'.repeat(100));
    const compressed = await compressGzip(data);
    expect(compressed.length).toBeLessThan(data.length);
    resetConfig();
  });
});
