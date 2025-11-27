import { describe, it, expect } from 'vitest';
import {
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
} from './socks5-protocol.js';

describe('SOCKS5 Protocol Constants', () => {
  it('should have correct SOCKS version', () => {
    expect(SOCKS_VERSION).toBe(0x05);
  });

  it('should have correct authentication method constants', () => {
    expect(AUTH_NO_AUTH).toBe(0x00);
    expect(AUTH_NO_ACCEPTABLE).toBe(0xff);
  });

  it('should have correct address type constants', () => {
    expect(ADDR_IPV4).toBe(0x01);
    expect(ADDR_DOMAIN).toBe(0x03);
    expect(ADDR_IPV6).toBe(0x04);
  });

  it('should have correct command constants', () => {
    expect(CMD_CONNECT).toBe(0x01);
  });

  it('should have correct reply code constants', () => {
    expect(REPLY_SUCCESS).toBe(0x00);
    expect(REPLY_GENERAL_FAILURE).toBe(0x01);
    expect(REPLY_NETWORK_UNREACHABLE).toBe(0x03);
    expect(REPLY_COMMAND_NOT_SUPPORTED).toBe(0x07);
    expect(REPLY_ADDRESS_TYPE_NOT_SUPPORTED).toBe(0x08);
  });
});

describe('ConnectionState enum', () => {
  it('should have correct state values', () => {
    expect(ConnectionState.AWAITING_GREETING).toBeDefined();
    expect(ConnectionState.AWAITING_REQUEST).toBeDefined();
    expect(ConnectionState.CONNECTED).toBeDefined();
  });
});

describe('parseAddress', () => {
  describe('IPv4 addresses', () => {
    it('should parse a valid IPv4 address', () => {
      // Address type (1) + IP (4 bytes: 192.168.1.1) + Port (2 bytes: 8080)
      const buffer = Buffer.from([ADDR_IPV4, 192, 168, 1, 1, 0x1f, 0x90]); // Port 8080 = 0x1f90
      const result = parseAddress(buffer, 0);
      
      expect(result).not.toBeNull();
      expect(result!.host).toBe('192.168.1.1');
      expect(result!.port).toBe(8080);
      expect(result!.addressType).toBe(ADDR_IPV4);
    });

    it('should parse IPv4 address at offset', () => {
      const buffer = Buffer.from([0x00, 0x00, ADDR_IPV4, 127, 0, 0, 1, 0x00, 0x50]); // Port 80 = 0x0050
      const result = parseAddress(buffer, 2);
      
      expect(result).not.toBeNull();
      expect(result!.host).toBe('127.0.0.1');
      expect(result!.port).toBe(80);
    });

    it('should return null for incomplete IPv4 buffer', () => {
      // Missing port bytes
      const buffer = Buffer.from([ADDR_IPV4, 192, 168, 1, 1]);
      const result = parseAddress(buffer, 0);
      
      expect(result).toBeNull();
    });
  });

  describe('Domain addresses', () => {
    it('should parse a domain address', () => {
      // Address type (3) + Length (11) + "example.com" + Port (2 bytes: 443)
      const domain = 'example.com';
      const buffer = Buffer.concat([
        Buffer.from([ADDR_DOMAIN, domain.length]),
        Buffer.from(domain, 'ascii'),
        Buffer.from([0x01, 0xbb]), // Port 443 = 0x01bb
      ]);
      const result = parseAddress(buffer, 0);
      
      expect(result).not.toBeNull();
      expect(result!.host).toBe('example.com');
      expect(result!.port).toBe(443);
      expect(result!.addressType).toBe(ADDR_DOMAIN);
    });

    it('should parse short domain', () => {
      const domain = 'a.io';
      const buffer = Buffer.concat([
        Buffer.from([ADDR_DOMAIN, domain.length]),
        Buffer.from(domain, 'ascii'),
        Buffer.from([0x00, 0x50]), // Port 80
      ]);
      const result = parseAddress(buffer, 0);
      
      expect(result).not.toBeNull();
      expect(result!.host).toBe('a.io');
      expect(result!.port).toBe(80);
    });

    it('should return null for incomplete domain buffer', () => {
      // Says domain is 11 bytes but only has 5
      const buffer = Buffer.from([ADDR_DOMAIN, 11, 0x65, 0x78, 0x61, 0x6d, 0x70]);
      const result = parseAddress(buffer, 0);
      
      expect(result).toBeNull();
    });
  });

  describe('IPv6 addresses', () => {
    it('should parse an IPv6 address', () => {
      // Address type (4) + 16 bytes IPv6 + Port (2 bytes)
      // IPv6: 2001:0db8:0000:0000:0000:0000:0000:0001
      const buffer = Buffer.alloc(19);
      buffer[0] = ADDR_IPV6;
      buffer.writeUInt16BE(0x2001, 1);
      buffer.writeUInt16BE(0x0db8, 3);
      buffer.writeUInt16BE(0x0000, 5);
      buffer.writeUInt16BE(0x0000, 7);
      buffer.writeUInt16BE(0x0000, 9);
      buffer.writeUInt16BE(0x0000, 11);
      buffer.writeUInt16BE(0x0000, 13);
      buffer.writeUInt16BE(0x0001, 15);
      buffer.writeUInt16BE(8080, 17); // Port
      
      const result = parseAddress(buffer, 0);
      
      expect(result).not.toBeNull();
      expect(result!.host).toBe('2001:db8:0:0:0:0:0:1');
      expect(result!.port).toBe(8080);
      expect(result!.addressType).toBe(ADDR_IPV6);
    });

    it('should return null for incomplete IPv6 buffer', () => {
      // Only 10 bytes when we need 19
      const buffer = Buffer.alloc(10);
      buffer[0] = ADDR_IPV6;
      const result = parseAddress(buffer, 0);
      
      expect(result).toBeNull();
    });
  });

  describe('Invalid addresses', () => {
    it('should return null for unknown address type', () => {
      const buffer = Buffer.from([0x99, 192, 168, 1, 1, 0x00, 0x50]);
      const result = parseAddress(buffer, 0);
      
      expect(result).toBeNull();
    });
  });
});

describe('createReply', () => {
  it('should create a success reply with default bind address', () => {
    const reply = createReply(REPLY_SUCCESS);
    
    // VER (1) + REP (1) + RSV (1) + ATYP (1) + IPv4 (4) + PORT (2) = 10 bytes
    expect(reply.length).toBe(10);
    expect(reply[0]).toBe(SOCKS_VERSION);
    expect(reply[1]).toBe(REPLY_SUCCESS);
    expect(reply[2]).toBe(0x00); // Reserved
    expect(reply[3]).toBe(ADDR_IPV4);
    // Address: 0.0.0.0
    expect(reply[4]).toBe(0);
    expect(reply[5]).toBe(0);
    expect(reply[6]).toBe(0);
    expect(reply[7]).toBe(0);
    // Port: 0
    expect(reply.readUInt16BE(8)).toBe(0);
  });

  it('should create a reply with custom bind address and port', () => {
    const reply = createReply(REPLY_SUCCESS, ADDR_IPV4, '192.168.1.100', 12345);
    
    expect(reply[0]).toBe(SOCKS_VERSION);
    expect(reply[1]).toBe(REPLY_SUCCESS);
    expect(reply[3]).toBe(ADDR_IPV4);
    expect(reply[4]).toBe(192);
    expect(reply[5]).toBe(168);
    expect(reply[6]).toBe(1);
    expect(reply[7]).toBe(100);
    expect(reply.readUInt16BE(8)).toBe(12345);
  });

  it('should create a failure reply', () => {
    const reply = createReply(REPLY_GENERAL_FAILURE);
    
    expect(reply[0]).toBe(SOCKS_VERSION);
    expect(reply[1]).toBe(REPLY_GENERAL_FAILURE);
  });

  it('should create IPv6 reply', () => {
    const reply = createReply(REPLY_SUCCESS, ADDR_IPV6);
    
    // VER (1) + REP (1) + RSV (1) + ATYP (1) + IPv6 (16) + PORT (2) = 22 bytes
    expect(reply.length).toBe(22);
    expect(reply[3]).toBe(ADDR_IPV6);
  });

  it('should fallback to IPv4 zeros for domain address type', () => {
    const reply = createReply(REPLY_SUCCESS, ADDR_DOMAIN);
    
    // Should fallback to IPv4 format
    expect(reply.length).toBe(10);
    expect(reply[3]).toBe(ADDR_IPV4);
  });
});

describe('isLikelyHttpRequest', () => {
  it('should detect GET request', () => {
    expect(isLikelyHttpRequest('G'.charCodeAt(0))).toBe(true);
  });

  it('should detect POST request', () => {
    expect(isLikelyHttpRequest('P'.charCodeAt(0))).toBe(true);
  });

  it('should detect HEAD request', () => {
    expect(isLikelyHttpRequest('H'.charCodeAt(0))).toBe(true);
  });

  it('should detect OPTIONS request', () => {
    expect(isLikelyHttpRequest('O'.charCodeAt(0))).toBe(true);
  });

  it('should detect CONNECT request', () => {
    expect(isLikelyHttpRequest('C'.charCodeAt(0))).toBe(true);
  });

  it('should detect DELETE request', () => {
    expect(isLikelyHttpRequest('D'.charCodeAt(0))).toBe(true);
  });

  it('should not detect SOCKS5 greeting (version byte)', () => {
    expect(isLikelyHttpRequest(0x05)).toBe(false);
  });

  it('should not detect random bytes', () => {
    expect(isLikelyHttpRequest(0x00)).toBe(false);
    expect(isLikelyHttpRequest(0xff)).toBe(false);
    expect(isLikelyHttpRequest('A'.charCodeAt(0))).toBe(false);
    expect(isLikelyHttpRequest('Z'.charCodeAt(0))).toBe(false);
  });
});

describe('createAuthResponse', () => {
  it('should create no-auth response', () => {
    const response = createAuthResponse(AUTH_NO_AUTH);
    
    expect(response.length).toBe(2);
    expect(response[0]).toBe(SOCKS_VERSION);
    expect(response[1]).toBe(AUTH_NO_AUTH);
  });

  it('should create no-acceptable-methods response', () => {
    const response = createAuthResponse(AUTH_NO_ACCEPTABLE);
    
    expect(response.length).toBe(2);
    expect(response[0]).toBe(SOCKS_VERSION);
    expect(response[1]).toBe(AUTH_NO_ACCEPTABLE);
  });
});
