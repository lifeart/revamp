import { describe, it, expect } from 'vitest';
import { getCharset, decodeWindows1251, decodeBufferToString } from './charset.js';

describe('getCharset', () => {
  it('should extract charset from content-type', () => {
    expect(getCharset('text/html; charset=utf-8')).toBe('utf-8');
    expect(getCharset('text/html; charset=UTF-8')).toBe('utf-8');
    expect(getCharset('text/html; charset=windows-1251')).toBe('windows-1251');
  });

  it('should handle quoted charset', () => {
    expect(getCharset('text/html; charset="utf-8"')).toBe('utf-8');
    expect(getCharset("text/html; charset='utf-8'")).toBe('utf-8');
  });

  it('should return utf-8 as default', () => {
    expect(getCharset('text/html')).toBe('utf-8');
    expect(getCharset('')).toBe('utf-8');
  });
});

describe('decodeWindows1251', () => {
  it('should decode ASCII characters unchanged', () => {
    const buffer = Buffer.from('Hello', 'ascii');
    expect(decodeWindows1251(buffer)).toBe('Hello');
  });

  it('should decode Cyrillic characters', () => {
    // Windows-1251 encoded "Привет" (Hello in Russian)
    // П=0xCF, р=0xF0, и=0xE8, в=0xE2, е=0xE5, т=0xF2
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeWindows1251(buffer)).toBe('Привет');
  });

  it('should handle mixed ASCII and Cyrillic', () => {
    // "Hi Мир" - H=0x48, i=0x69, space=0x20, М=0xCC, и=0xE8, р=0xF0
    const buffer = Buffer.from([0x48, 0x69, 0x20, 0xcc, 0xe8, 0xf0]);
    expect(decodeWindows1251(buffer)).toBe('Hi Мир');
  });
});

describe('decodeBufferToString', () => {
  it('should decode UTF-8 by default', () => {
    const buffer = Buffer.from('Hello, мир!', 'utf-8');
    expect(decodeBufferToString(buffer, 'utf-8')).toBe('Hello, мир!');
  });

  it('should decode Windows-1251', () => {
    // Windows-1251 encoded "Привет"
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeBufferToString(buffer, 'windows-1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'cp1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'win1251')).toBe('Привет');
  });

  it('should decode ISO-8859-1 (Latin1)', () => {
    const buffer = Buffer.from([0xc0, 0xc1, 0xc2]); // À Á Â
    expect(decodeBufferToString(buffer, 'iso-8859-1')).toBe('ÀÁÂ');
    expect(decodeBufferToString(buffer, 'latin1')).toBe('ÀÁÂ');
  });

  it('should normalize charset names', () => {
    const buffer = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeBufferToString(buffer, 'Windows-1251')).toBe('Привет');
    expect(decodeBufferToString(buffer, 'WINDOWS-1251')).toBe('Привет');
  });
});
