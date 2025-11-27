/**
 * Image Transformer
 * Converts modern image formats (WebP, AVIF) to JPEG for legacy browser compatibility
 * iOS 9 Safari doesn't support WebP, so we need to convert on the fly
 */

import sharp from 'sharp';
import { getConfig } from '../config/index.js';

export interface ImageTransformResult {
  data: Buffer;
  contentType: string;
  transformed: boolean;
}

/**
 * Check if the content type is WebP
 */
export function isWebP(contentType: string): boolean {
  return contentType.toLowerCase().includes('image/webp');
}

/**
 * Check if the content type is AVIF
 */
export function isAVIF(contentType: string): boolean {
  return contentType.toLowerCase().includes('image/avif');
}

/**
 * Check if the URL suggests WebP format
 */
export function isWebPUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.webp');
  } catch {
    return false;
  }
}

/**
 * Check if the URL suggests AVIF format
 */
export function isAVIFUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.avif');
  } catch {
    return false;
  }
}

/**
 * Check if image needs transformation for legacy browsers
 */
export function needsImageTransform(contentType: string, url: string): boolean {
  const config = getConfig();
  // Only transform if targeting old iOS (Safari 9 doesn't support WebP)
  const targetsOldSafari = config.targets.some(t => 
    t.includes('safari 9') || 
    t.includes('ios 9') ||
    t.includes('safari 10') ||
    t.includes('ios 10')
  );
  
  if (!targetsOldSafari) {
    return false;
  }
  
  // Check content type first, then URL
  return isWebP(contentType) || isAVIF(contentType) || isWebPUrl(url) || isAVIFUrl(url);
}

/**
 * Transform WebP/AVIF image to JPEG
 */
export async function transformImage(
  imageBuffer: Buffer, 
  contentType: string, 
  url: string
): Promise<ImageTransformResult> {
  // If no transformation needed, return original
  if (!needsImageTransform(contentType, url)) {
    return {
      data: imageBuffer,
      contentType: contentType,
      transformed: false,
    };
  }
  
  try {
    // Determine source format for logging
    const isWebPImage = isWebP(contentType) || isWebPUrl(url);
    const isAVIFImage = isAVIF(contentType) || isAVIFUrl(url);
    const sourceFormat = isWebPImage ? 'WebP' : isAVIFImage ? 'AVIF' : 'unknown';
    
    console.log(`🖼️ Converting ${sourceFormat} to JPEG: ${url}`);
    
    // Use sharp to convert to JPEG
    // Sharp auto-detects the input format
    const convertedBuffer = await sharp(imageBuffer)
      .jpeg({
        quality: 85, // Good quality/size balance
        mozjpeg: true, // Use mozjpeg for better compression
      })
      .toBuffer();
    
    console.log(`✅ Image converted: ${imageBuffer.length} → ${convertedBuffer.length} bytes`);
    
    return {
      data: convertedBuffer,
      contentType: 'image/jpeg',
      transformed: true,
    };
  } catch (error) {
    console.error(`❌ Image conversion error for ${url}:`, error instanceof Error ? error.message : error);
    
    // Return original on error
    return {
      data: imageBuffer,
      contentType: contentType,
      transformed: false,
    };
  }
}

/**
 * Get the new content type after transformation
 * Returns the original if no transformation needed
 */
export function getTransformedContentType(originalContentType: string, url: string): string {
  if (needsImageTransform(originalContentType, url)) {
    return 'image/jpeg';
  }
  return originalContentType;
}
