import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isWebP,
  isAVIF,
  isWebPUrl,
  isAVIFUrl,
  needsImageTransform,
  transformImage,
  getTransformedContentType,
} from './image.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('isWebP', () => {
  it('should detect WebP content type', () => {
    expect(isWebP('image/webp')).toBe(true);
    expect(isWebP('IMAGE/WEBP')).toBe(true);
    expect(isWebP('image/webp; charset=utf-8')).toBe(true);
  });

  it('should return false for non-WebP types', () => {
    expect(isWebP('image/jpeg')).toBe(false);
    expect(isWebP('image/png')).toBe(false);
    expect(isWebP('image/gif')).toBe(false);
    expect(isWebP('application/octet-stream')).toBe(false);
  });
});

describe('isAVIF', () => {
  it('should detect AVIF content type', () => {
    expect(isAVIF('image/avif')).toBe(true);
    expect(isAVIF('IMAGE/AVIF')).toBe(true);
    expect(isAVIF('image/avif; charset=utf-8')).toBe(true);
  });

  it('should return false for non-AVIF types', () => {
    expect(isAVIF('image/jpeg')).toBe(false);
    expect(isAVIF('image/png')).toBe(false);
    expect(isAVIF('image/webp')).toBe(false);
  });
});

describe('isWebPUrl', () => {
  it('should detect WebP URLs', () => {
    expect(isWebPUrl('https://example.com/image.webp')).toBe(true);
    expect(isWebPUrl('https://example.com/image.WEBP')).toBe(true);
    expect(isWebPUrl('https://example.com/path/to/image.webp?v=1')).toBe(true);
  });

  it('should return false for non-WebP URLs', () => {
    expect(isWebPUrl('https://example.com/image.jpg')).toBe(false);
    expect(isWebPUrl('https://example.com/image.png')).toBe(false);
    expect(isWebPUrl('https://example.com/webp/image.jpg')).toBe(false);
  });

  it('should handle invalid URLs gracefully', () => {
    expect(isWebPUrl('not a url')).toBe(false);
    expect(isWebPUrl('')).toBe(false);
  });
});

describe('isAVIFUrl', () => {
  it('should detect AVIF URLs', () => {
    expect(isAVIFUrl('https://example.com/image.avif')).toBe(true);
    expect(isAVIFUrl('https://example.com/image.AVIF')).toBe(true);
    expect(isAVIFUrl('https://example.com/path/to/image.avif?v=1')).toBe(true);
  });

  it('should return false for non-AVIF URLs', () => {
    expect(isAVIFUrl('https://example.com/image.jpg')).toBe(false);
    expect(isAVIFUrl('https://example.com/image.png')).toBe(false);
  });

  it('should handle invalid URLs gracefully', () => {
    expect(isAVIFUrl('not a url')).toBe(false);
    expect(isAVIFUrl('')).toBe(false);
  });
});

describe('needsImageTransform', () => {
  beforeEach(() => {
    resetConfig();
    // Target old Safari by default for tests
    updateConfig({ targets: ['safari 9', 'ios 9'] });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should return true for WebP when targeting old Safari', () => {
    expect(needsImageTransform('image/webp', 'https://example.com/image.webp')).toBe(true);
  });

  it('should return true for AVIF when targeting old Safari', () => {
    expect(needsImageTransform('image/avif', 'https://example.com/image.avif')).toBe(true);
  });

  it('should return true based on URL extension', () => {
    expect(needsImageTransform('application/octet-stream', 'https://example.com/image.webp')).toBe(true);
    expect(needsImageTransform('application/octet-stream', 'https://example.com/image.avif')).toBe(true);
  });

  it('should return false for JPEG/PNG', () => {
    expect(needsImageTransform('image/jpeg', 'https://example.com/image.jpg')).toBe(false);
    expect(needsImageTransform('image/png', 'https://example.com/image.png')).toBe(false);
  });

  it('should return false when not targeting old Safari', () => {
    updateConfig({ targets: ['chrome 90', 'firefox 90'] });
    expect(needsImageTransform('image/webp', 'https://example.com/image.webp')).toBe(false);
    expect(needsImageTransform('image/avif', 'https://example.com/image.avif')).toBe(false);
  });

  it('should detect Safari 10 as old Safari', () => {
    updateConfig({ targets: ['safari 10'] });
    expect(needsImageTransform('image/webp', 'https://example.com/image.webp')).toBe(true);
  });

  it('should detect iOS 10 as old Safari', () => {
    updateConfig({ targets: ['ios 10'] });
    expect(needsImageTransform('image/webp', 'https://example.com/image.webp')).toBe(true);
  });
});

describe('transformImage', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ targets: ['safari 9', 'ios 9'] });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should return original for non-WebP/AVIF images', async () => {
    const buffer = Buffer.from('fake jpeg data');
    const result = await transformImage(buffer, 'image/jpeg', 'https://example.com/image.jpg');

    expect(result.transformed).toBe(false);
    expect(result.data).toBe(buffer);
    expect(result.contentType).toBe('image/jpeg');
  });

  it('should return original for empty buffer', async () => {
    const buffer = Buffer.from('');
    const result = await transformImage(buffer, 'image/webp', 'https://example.com/image.webp');

    expect(result.transformed).toBe(false);
    expect(result.data).toBe(buffer);
  });

  it('should return original for buffer smaller than minimum size', async () => {
    const buffer = Buffer.from('tiny'); // Less than 12 bytes
    const result = await transformImage(buffer, 'image/webp', 'https://example.com/image.webp');

    expect(result.transformed).toBe(false);
  });

  it('should return original when not targeting old Safari', async () => {
    updateConfig({ targets: ['chrome 90'] });

    const buffer = Buffer.alloc(100);
    const result = await transformImage(buffer, 'image/webp', 'https://example.com/image.webp');

    expect(result.transformed).toBe(false);
  });

  it('should handle transform errors gracefully', async () => {
    // Invalid image data should not crash
    const buffer = Buffer.alloc(100, 0xff); // Invalid image data
    const result = await transformImage(buffer, 'image/webp', 'https://example.com/image.webp');

    // Should return original on error
    expect(result.data).toBe(buffer);
    expect(result.transformed).toBe(false);
  });
});

describe('getTransformedContentType', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ targets: ['safari 9', 'ios 9'] });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should return image/jpeg for WebP when targeting old Safari', () => {
    expect(getTransformedContentType('image/webp', 'https://example.com/image.webp')).toBe('image/jpeg');
  });

  it('should return image/jpeg for AVIF when targeting old Safari', () => {
    expect(getTransformedContentType('image/avif', 'https://example.com/image.avif')).toBe('image/jpeg');
  });

  it('should return original content type for non-modern formats', () => {
    expect(getTransformedContentType('image/jpeg', 'https://example.com/image.jpg')).toBe('image/jpeg');
    expect(getTransformedContentType('image/png', 'https://example.com/image.png')).toBe('image/png');
  });

  it('should return original when not targeting old Safari', () => {
    updateConfig({ targets: ['chrome 90'] });
    expect(getTransformedContentType('image/webp', 'https://example.com/image.webp')).toBe('image/webp');
  });
});
