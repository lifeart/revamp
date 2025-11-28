/**
 * Proxy Types Module Tests
 * Tests type definitions are properly exported and can be used
 */

import { describe, it, expect } from 'vitest';
import type {
  ContentType,
  HttpResponse,
  ParsedAddress,
  RequestHeaders,
  ResponseHeaders,
  ImageTransformResult,
  CacheMetadata,
} from './types.js';

describe('proxy types', () => {
  describe('ContentType', () => {
    it('should support js type', () => {
      const contentType: ContentType = 'js';
      expect(contentType).toBe('js');
    });

    it('should support css type', () => {
      const contentType: ContentType = 'css';
      expect(contentType).toBe('css');
    });

    it('should support html type', () => {
      const contentType: ContentType = 'html';
      expect(contentType).toBe('html');
    });

    it('should support other type', () => {
      const contentType: ContentType = 'other';
      expect(contentType).toBe('other');
    });
  });

  describe('HttpResponse', () => {
    it('should have required properties', () => {
      const response: HttpResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('Hello'),
      };
      expect(response.statusCode).toBe(200);
      expect(response.statusMessage).toBe('OK');
      expect(response.headers['content-type']).toBe('text/html');
      expect(Buffer.isBuffer(response.body)).toBe(true);
    });

    it('should support array header values', () => {
      const response: HttpResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'set-cookie': ['cookie1=value1', 'cookie2=value2'] },
        body: Buffer.alloc(0),
      };
      expect(Array.isArray(response.headers['set-cookie'])).toBe(true);
    });

    it('should support undefined header values', () => {
      const response: HttpResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'optional-header': undefined },
        body: Buffer.alloc(0),
      };
      expect(response.headers['optional-header']).toBeUndefined();
    });
  });

  describe('ParsedAddress', () => {
    it('should have host, port, and addressType', () => {
      const addr: ParsedAddress = {
        host: 'example.com',
        port: 443,
        addressType: 3, // Domain
      };
      expect(addr.host).toBe('example.com');
      expect(addr.port).toBe(443);
      expect(addr.addressType).toBe(3);
    });

    it('should support IPv4 address type', () => {
      const addr: ParsedAddress = {
        host: '192.168.1.1',
        port: 80,
        addressType: 1, // IPv4
      };
      expect(addr.addressType).toBe(1);
    });

    it('should support IPv6 address type', () => {
      const addr: ParsedAddress = {
        host: '::1',
        port: 80,
        addressType: 4, // IPv6
      };
      expect(addr.addressType).toBe(4);
    });
  });

  describe('RequestHeaders', () => {
    it('should be a string record', () => {
      const headers: RequestHeaders = {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
        'accept': '*/*',
      };
      expect(headers['content-type']).toBe('application/json');
      expect(typeof headers['user-agent']).toBe('string');
    });
  });

  describe('ResponseHeaders', () => {
    it('should support string values', () => {
      const headers: ResponseHeaders = {
        'content-type': 'text/html',
      };
      expect(headers['content-type']).toBe('text/html');
    });

    it('should support array values', () => {
      const headers: ResponseHeaders = {
        'set-cookie': ['a=1', 'b=2'],
      };
      expect(Array.isArray(headers['set-cookie'])).toBe(true);
    });

    it('should support undefined values', () => {
      const headers: ResponseHeaders = {
        'missing': undefined,
      };
      expect(headers['missing']).toBeUndefined();
    });
  });

  describe('ImageTransformResult', () => {
    it('should have transformed flag and data', () => {
      const result: ImageTransformResult = {
        transformed: true,
        data: Buffer.from([0xff, 0xd8, 0xff]),
        contentType: 'image/jpeg',
      };
      expect(result.transformed).toBe(true);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.contentType).toBe('image/jpeg');
    });

    it('should support non-transformed result', () => {
      const result: ImageTransformResult = {
        transformed: false,
        data: Buffer.from([0x52, 0x49, 0x46, 0x46]),
        contentType: 'image/webp',
      };
      expect(result.transformed).toBe(false);
    });
  });

  describe('CacheMetadata', () => {
    it('should have url, contentType, and timestamp', () => {
      const metadata: CacheMetadata = {
        url: 'https://example.com/page',
        contentType: 'text/html',
        timestamp: Date.now(),
      };
      expect(metadata.url).toBe('https://example.com/page');
      expect(metadata.contentType).toBe('text/html');
      expect(typeof metadata.timestamp).toBe('number');
    });
  });
});
