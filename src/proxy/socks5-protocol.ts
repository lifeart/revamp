/**
 * SOCKS5 Protocol Implementation
 * 
 * Handles SOCKS5 protocol parsing, constants, and reply construction.
 * Reference: RFC 1928 - SOCKS Protocol Version 5
 */

import type { ParsedAddress } from './types.js';

// =============================================================================
// SOCKS5 Protocol Constants
// =============================================================================

/** SOCKS protocol version 5 */
export const SOCKS_VERSION = 0x05;

// Authentication methods
/** No authentication required */
export const AUTH_NO_AUTH = 0x00;
/** No acceptable authentication methods */
export const AUTH_NO_ACCEPTABLE = 0xff;

// Address types
/** IPv4 address (4 bytes) */
export const ADDR_IPV4 = 0x01;
/** Domain name (length-prefixed) */
export const ADDR_DOMAIN = 0x03;
/** IPv6 address (16 bytes) */
export const ADDR_IPV6 = 0x04;

// Commands
/** CONNECT command - establish TCP connection */
export const CMD_CONNECT = 0x01;
// export const CMD_BIND = 0x02;     // Not implemented
// export const CMD_UDP = 0x03;      // Not implemented

// Reply codes
/** Success */
export const REPLY_SUCCESS = 0x00;
/** General SOCKS server failure */
export const REPLY_GENERAL_FAILURE = 0x01;
/** Connection not allowed by ruleset */
// export const REPLY_CONNECTION_NOT_ALLOWED = 0x02;
/** Network unreachable */
export const REPLY_NETWORK_UNREACHABLE = 0x03;
/** Host unreachable */
// export const REPLY_HOST_UNREACHABLE = 0x04;
/** Connection refused */
// export const REPLY_CONNECTION_REFUSED = 0x05;
/** TTL expired */
// export const REPLY_TTL_EXPIRED = 0x06;
/** Command not supported */
export const REPLY_COMMAND_NOT_SUPPORTED = 0x07;
/** Address type not supported */
export const REPLY_ADDRESS_TYPE_NOT_SUPPORTED = 0x08;

// =============================================================================
// Connection States
// =============================================================================

/**
 * SOCKS5 connection state machine states
 */
export enum ConnectionState {
  /** Waiting for client greeting with auth methods */
  AWAITING_GREETING,
  /** Waiting for client connection request */
  AWAITING_REQUEST,
  /** Connection established, data passthrough mode */
  CONNECTED,
}

// =============================================================================
// Protocol Parsing Functions
// =============================================================================

/**
 * Parse a SOCKS5 address from a buffer
 * 
 * Address format depends on type:
 * - IPv4: 4 bytes
 * - Domain: 1 byte length + domain bytes
 * - IPv6: 16 bytes
 * 
 * Port is always 2 bytes big-endian following the address
 * 
 * @param buffer - Buffer containing the address
 * @param offset - Starting offset in the buffer
 * @returns Parsed address or null if incomplete/invalid
 */
export function parseAddress(buffer: Buffer, offset: number): ParsedAddress | null {
  const addressType = buffer[offset];
  let host: string;
  let port: number;
  
  switch (addressType) {
    case ADDR_IPV4:
      // IPv4: 4 bytes for address + 2 bytes for port
      if (buffer.length < offset + 7) return null;
      host = `${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}.${buffer[offset + 4]}`;
      port = buffer.readUInt16BE(offset + 5);
      break;
      
    case ADDR_DOMAIN:
      // Domain: 1 byte length + domain bytes + 2 bytes port
      const domainLength = buffer[offset + 1];
      if (buffer.length < offset + 2 + domainLength + 2) return null;
      host = buffer.subarray(offset + 2, offset + 2 + domainLength).toString('ascii');
      port = buffer.readUInt16BE(offset + 2 + domainLength);
      break;
      
    case ADDR_IPV6:
      // IPv6: 16 bytes for address + 2 bytes for port
      if (buffer.length < offset + 19) return null;
      const ipv6Parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        ipv6Parts.push(buffer.readUInt16BE(offset + 1 + i * 2).toString(16));
      }
      host = ipv6Parts.join(':');
      port = buffer.readUInt16BE(offset + 17);
      break;
      
    default:
      return null;
  }
  
  return { host, port, addressType };
}

/**
 * Create a SOCKS5 reply packet
 * 
 * Reply format:
 * +----+-----+-------+------+----------+----------+
 * |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
 * +----+-----+-------+------+----------+----------+
 * | 1  |  1  | X'00' |  1   | Variable |    2     |
 * +----+-----+-------+------+----------+----------+
 * 
 * @param replyCode - Reply status code
 * @param addressType - Address type for bind address (default: IPv4)
 * @param bindAddress - Bound address (default: 0.0.0.0)
 * @param bindPort - Bound port (default: 0)
 * @returns Buffer containing the reply packet
 */
export function createReply(
  replyCode: number,
  addressType: number = ADDR_IPV4,
  bindAddress: string = '0.0.0.0',
  bindPort: number = 0
): Buffer {
  let addressBuffer: Buffer;
  
  if (addressType === ADDR_IPV4) {
    const parts = bindAddress.split('.').map(Number);
    addressBuffer = Buffer.from([ADDR_IPV4, ...parts]);
  } else if (addressType === ADDR_IPV6) {
    // Simplified: just use zeros for IPv6 bind address
    addressBuffer = Buffer.alloc(17);
    addressBuffer[0] = ADDR_IPV6;
  } else {
    // Domain - shouldn't happen in replies, fallback to IPv4 zeros
    addressBuffer = Buffer.from([ADDR_IPV4, 0, 0, 0, 0]);
  }
  
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(bindPort, 0);
  
  return Buffer.concat([
    Buffer.from([SOCKS_VERSION, replyCode, 0x00]), // VER, REP, RSV
    addressBuffer,
    portBuffer,
  ]);
}

/**
 * Check if a byte value looks like the start of an HTTP method
 * 
 * Used to detect when an HTTP request is accidentally sent to the SOCKS port.
 * HTTP methods start with: C(ONNECT), D(ELETE), G(ET), H(EAD), O(PTIONS), P(OST/UT/ATCH)
 * 
 * @param byte - First byte of the incoming data
 * @returns true if it looks like an HTTP request
 */
export function isLikelyHttpRequest(byte: number): boolean {
  // ASCII: C=67, D=68, G=71, H=72, O=79, P=80
  const httpMethodStartBytes = [67, 68, 71, 72, 79, 80];
  return httpMethodStartBytes.includes(byte);
}

/**
 * Create authentication method response
 * 
 * @param method - Selected authentication method
 * @returns Buffer containing the auth response
 */
export function createAuthResponse(method: number): Buffer {
  return Buffer.from([SOCKS_VERSION, method]);
}
