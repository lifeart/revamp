/**
 * Proxy Index Module Tests
 * Tests for re-exported functions from proxy index
 */

import { describe, it, expect } from 'vitest';
import {
  // Config endpoint
  CONFIG_ENDPOINT,
  isConfigEndpoint,
  handleConfigRequest,
  buildRawHttpResponse,
  type ConfigEndpointResult,

  // SOCKS5 protocol
  SOCKS_VERSION,
  AUTH_NO_AUTH,
  AUTH_NO_ACCEPTABLE,
  ADDR_IPV4,
  ADDR_DOMAIN,
  ADDR_IPV6,
  CMD_CONNECT,
  REPLY_SUCCESS,
  REPLY_GENERAL_FAILURE,
  REPLY_NETWORK_UNREACHABLE,
  REPLY_COMMAND_NOT_SUPPORTED,
  REPLY_ADDRESS_TYPE_NOT_SUPPORTED,
  ConnectionState,
  parseAddress,
  createReply,
  isLikelyHttpRequest,
  createAuthResponse,

  // HTTP client
  makeHttpRequest,
  makeHttpsRequest,

  // Shared utilities
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
  removeCorsHeaders,
  SKIP_RESPONSE_HEADERS,
  filterResponseHeaders,
  shouldCompress,
  acceptsGzip,
  decompressBody,
  compressGzip,
  getCharset,
  getContentType,
  isBinaryContent,
  decodeWindows1251,
  decodeBufferToString,
  transformContent,
  shouldBlockDomain,
  shouldBlockUrl,
  SPOOFED_USER_AGENT,
  spoofUserAgent,
} from './index.js';

describe('proxy index exports', () => {
  describe('config endpoint exports', () => {
    it('should export CONFIG_ENDPOINT', () => {
      expect(CONFIG_ENDPOINT).toBe('/__revamp__/config');
    });

    it('should export isConfigEndpoint function', () => {
      expect(typeof isConfigEndpoint).toBe('function');
    });

    it('should export handleConfigRequest function', () => {
      expect(typeof handleConfigRequest).toBe('function');
    });

    it('should export buildRawHttpResponse function', () => {
      expect(typeof buildRawHttpResponse).toBe('function');
    });
  });

  describe('SOCKS5 protocol exports', () => {
    it('should export SOCKS5 constants', () => {
      expect(SOCKS_VERSION).toBe(0x05);
      expect(AUTH_NO_AUTH).toBe(0x00);
      expect(AUTH_NO_ACCEPTABLE).toBe(0xff);
      expect(ADDR_IPV4).toBe(0x01);
      expect(ADDR_DOMAIN).toBe(0x03);
      expect(ADDR_IPV6).toBe(0x04);
      expect(CMD_CONNECT).toBe(0x01);
    });

    it('should export SOCKS5 reply constants', () => {
      expect(REPLY_SUCCESS).toBe(0x00);
      expect(REPLY_GENERAL_FAILURE).toBe(0x01);
      expect(REPLY_NETWORK_UNREACHABLE).toBe(0x03);
      expect(REPLY_COMMAND_NOT_SUPPORTED).toBe(0x07);
      expect(REPLY_ADDRESS_TYPE_NOT_SUPPORTED).toBe(0x08);
    });

    it('should export ConnectionState enum', () => {
      expect(ConnectionState.AWAITING_GREETING).toBeDefined();
      expect(ConnectionState.AWAITING_REQUEST).toBeDefined();
      expect(ConnectionState.CONNECTED).toBeDefined();
    });

    it('should export parseAddress function', () => {
      expect(typeof parseAddress).toBe('function');
    });

    it('should export createReply function', () => {
      expect(typeof createReply).toBe('function');
    });

    it('should export isLikelyHttpRequest function', () => {
      expect(typeof isLikelyHttpRequest).toBe('function');
    });

    it('should export createAuthResponse function', () => {
      expect(typeof createAuthResponse).toBe('function');
    });
  });

  describe('HTTP client exports', () => {
    it('should export makeHttpRequest function', () => {
      expect(typeof makeHttpRequest).toBe('function');
    });

    it('should export makeHttpsRequest function', () => {
      expect(typeof makeHttpsRequest).toBe('function');
    });
  });

  describe('shared utilities exports', () => {
    describe('CORS exports', () => {
      it('should export CORS constants', () => {
        expect(typeof CORS_ALLOWED_METHODS).toBe('string');
        expect(typeof CORS_ALLOWED_HEADERS).toBe('string');
        expect(typeof CORS_EXPOSE_HEADERS).toBe('string');
      });

      it('should export CORS functions', () => {
        expect(typeof buildCorsHeaders).toBe('function');
        expect(typeof buildCorsPreflightResponse).toBe('function');
        expect(typeof buildCorsHeadersString).toBe('function');
        expect(typeof removeCorsHeaders).toBe('function');
      });
    });

    describe('header exports', () => {
      it('should export SKIP_RESPONSE_HEADERS', () => {
        expect(SKIP_RESPONSE_HEADERS).toBeDefined();
        expect(Array.isArray(SKIP_RESPONSE_HEADERS) || SKIP_RESPONSE_HEADERS instanceof Set).toBe(true);
      });

      it('should export filterResponseHeaders function', () => {
        expect(typeof filterResponseHeaders).toBe('function');
      });
    });

    describe('compression exports', () => {
      it('should export compression functions', () => {
        expect(typeof shouldCompress).toBe('function');
        expect(typeof acceptsGzip).toBe('function');
        expect(typeof decompressBody).toBe('function');
        expect(typeof compressGzip).toBe('function');
      });
    });

    describe('content exports', () => {
      it('should export content functions', () => {
        expect(typeof getCharset).toBe('function');
        expect(typeof getContentType).toBe('function');
        expect(typeof isBinaryContent).toBe('function');
        expect(typeof decodeWindows1251).toBe('function');
        expect(typeof decodeBufferToString).toBe('function');
        expect(typeof transformContent).toBe('function');
      });
    });

    describe('blocking exports', () => {
      it('should export blocking functions', () => {
        expect(typeof shouldBlockDomain).toBe('function');
        expect(typeof shouldBlockUrl).toBe('function');
      });
    });

    describe('user agent exports', () => {
      it('should export SPOOFED_USER_AGENT', () => {
        expect(typeof SPOOFED_USER_AGENT).toBe('string');
        expect(SPOOFED_USER_AGENT.length).toBeGreaterThan(0);
      });

      it('should export spoofUserAgent function', () => {
        expect(typeof spoofUserAgent).toBe('function');
      });
    });
  });

  describe('exported functions work correctly', () => {
    it('isConfigEndpoint should work', () => {
      expect(isConfigEndpoint('/__revamp__/config')).toBe(true);
      expect(isConfigEndpoint('/other')).toBe(false);
    });

    it('isLikelyHttpRequest should work', () => {
      // It checks first byte - 'G' for GET, 'P' for POST, etc.
      expect(isLikelyHttpRequest(0x47)).toBe(true); // 'G' for GET
      expect(isLikelyHttpRequest(0x05)).toBe(false); // SOCKS5 version byte
    });

    it('createReply should work', () => {
      const reply = createReply(REPLY_SUCCESS);
      expect(Buffer.isBuffer(reply)).toBe(true);
      expect(reply[0]).toBe(SOCKS_VERSION);
      expect(reply[1]).toBe(REPLY_SUCCESS);
    });

    it('getContentType should work', () => {
      const headers = { 'content-type': 'application/javascript' };
      expect(getContentType(headers, 'http://example.com/script.js')).toBe('js');
    });

    it('shouldBlockDomain should work', () => {
      expect(shouldBlockDomain('example.com')).toBe(false);
    });
  });
});
