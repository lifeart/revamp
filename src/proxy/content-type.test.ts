import { describe, it, expect } from 'vitest';
import { getContentType, isBinaryContent } from './content-type.js';

describe('getContentType', () => {
  it('should detect JavaScript from content-type', () => {
    expect(getContentType({ 'content-type': 'application/javascript' }, 'http://example.com/file')).toBe('js');
    expect(getContentType({ 'content-type': 'text/javascript' }, 'http://example.com/file')).toBe('js');
    expect(getContentType({ 'content-type': 'application/ecmascript' }, 'http://example.com/file')).toBe('js');
  });

  it('should detect CSS from content-type', () => {
    expect(getContentType({ 'content-type': 'text/css' }, 'http://example.com/file')).toBe('css');
    expect(getContentType({ 'content-type': 'text/css; charset=utf-8' }, 'http://example.com/file')).toBe('css');
  });

  it('should detect HTML from content-type', () => {
    expect(getContentType({ 'content-type': 'text/html' }, 'http://example.com/file')).toBe('html');
    expect(getContentType({ 'content-type': 'text/html; charset=utf-8' }, 'http://example.com/file')).toBe('html');
  });

  it('should return other for binary types', () => {
    expect(getContentType({ 'content-type': 'image/png' }, 'http://example.com/file.png')).toBe('other');
    expect(getContentType({ 'content-type': 'image/jpeg' }, 'http://example.com/file.jpg')).toBe('other');
    expect(getContentType({ 'content-type': 'video/mp4' }, 'http://example.com/file.mp4')).toBe('other');
    expect(getContentType({ 'content-type': 'application/pdf' }, 'http://example.com/file.pdf')).toBe('other');
    expect(getContentType({ 'content-type': 'application/octet-stream' }, 'http://example.com/file')).toBe('other');
  });

  it('should fallback to URL extension when no content-type', () => {
    expect(getContentType({}, 'http://example.com/script.js')).toBe('js');
    expect(getContentType({}, 'http://example.com/script.mjs')).toBe('js');
    expect(getContentType({}, 'http://example.com/style.css')).toBe('css');
    expect(getContentType({}, 'http://example.com/page.html')).toBe('html');
    expect(getContentType({}, 'http://example.com/page.htm')).toBe('html');
    expect(getContentType({}, 'http://example.com/')).toBe('html');
  });

  it('should detect JS from URL path patterns (YouTube-style URLs)', () => {
    // YouTube uses paths like /s/_/ytmainappweb/_/js/k=... without .js extension
    expect(getContentType({}, 'https://www.youtube.com/s/_/ytmainappweb/_/js/k=ytmainappweb.kevlar_base.en_US.1saR0AquSG0.es5.O/am=AAAQAACA/d=0/rs=AGKMywHL8rJUqMPTxtQ898M2WV31BC8nOQ')).toBe('js');
    expect(getContentType({}, 'https://example.com/_/js/bundle')).toBe('js');
    expect(getContentType({}, 'https://example.com/assets/js/app')).toBe('js');
    expect(getContentType({ 'content-type': 'text/plain' }, 'https://www.youtube.com/s/_/ytmainappweb/_/js/k=test')).toBe('js');
  });

  it('should detect CSS from URL path patterns', () => {
    expect(getContentType({}, 'https://example.com/_/css/styles')).toBe('css');
    expect(getContentType({}, 'https://example.com/assets/css/app')).toBe('css');
  });

  it('should return other for unknown types', () => {
    expect(getContentType({ 'content-type': 'application/x-custom' }, 'http://example.com/file')).toBe('other');
    expect(getContentType({}, 'http://example.com/file.unknown')).toBe('other');
  });

  it('should return other for React Server Component payloads', () => {
    expect(getContentType({ 'content-type': 'text/x-component' }, 'http://example.com/_rsc')).toBe('other');
    expect(getContentType({ 'content-type': 'text/x-component; charset=utf-8' }, 'http://example.com/_rsc')).toBe('other');
    expect(getContentType({ 'content-type': 'application/rsc' }, 'http://example.com/_rsc')).toBe('other');
  });

  it('should return other for Next.js RSC URL patterns', () => {
    // RSC query parameter
    expect(getContentType({ 'content-type': 'text/plain' }, 'http://example.com/page?_rsc=abc123')).toBe('other');
    expect(getContentType({}, 'http://example.com/page?foo=bar&_rsc=xyz')).toBe('other');
    // _next/data paths
    expect(getContentType({ 'content-type': 'text/plain' }, 'http://example.com/_next/data/build123/page.json')).toBe('other');
    // __nextjs paths
    expect(getContentType({}, 'http://example.com/__nextjs_original-stack-frame')).toBe('other');
  });
});

describe('isBinaryContent', () => {
  it('should detect PNG signature', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isBinaryContent(pngHeader)).toBe(true);
  });

  it('should detect JPEG signature', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(isBinaryContent(jpegHeader)).toBe(true);
  });

  it('should detect GIF signature', () => {
    const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    expect(isBinaryContent(gifHeader)).toBe(true);
  });

  it('should detect PDF signature', () => {
    const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    expect(isBinaryContent(pdfHeader)).toBe(true);
  });

  it('should detect ZIP signature', () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(isBinaryContent(zipHeader)).toBe(true);
  });

  it('should detect GZIP signature', () => {
    const gzipHeader = Buffer.from([0x1f, 0x8b, 0x08, 0x00]); // 4 bytes for signature check
    expect(isBinaryContent(gzipHeader)).toBe(true);
  });

  it('should not detect text content as binary', () => {
    const textContent = Buffer.from('Hello, World!');
    expect(isBinaryContent(textContent)).toBe(false);
  });

  it('should not detect HTML as binary', () => {
    const htmlContent = Buffer.from('<!DOCTYPE html><html>');
    expect(isBinaryContent(htmlContent)).toBe(false);
  });

  it('should return false for small buffers', () => {
    expect(isBinaryContent(Buffer.from([0x89]))).toBe(false);
    expect(isBinaryContent(Buffer.from([]))).toBe(false);
  });
});
