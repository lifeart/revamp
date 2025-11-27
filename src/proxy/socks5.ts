/**
 * SOCKS5 Proxy Server
 * Implements SOCKS5 protocol for legacy device connections
 */

import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import { getConfig } from '../config/index.js';

// SOCKS5 constants
const SOCKS_VERSION = 0x05;

// Authentication methods
const AUTH_NO_AUTH = 0x00;
const AUTH_NO_ACCEPTABLE = 0xff;

// Address types
const ADDR_IPV4 = 0x01;
const ADDR_DOMAIN = 0x03;
const ADDR_IPV6 = 0x04;

// Commands
const CMD_CONNECT = 0x01;
// const CMD_BIND = 0x02;     // Not implemented
// const CMD_UDP = 0x03;      // Not implemented

// Reply codes
const REPLY_SUCCESS = 0x00;
const REPLY_GENERAL_FAILURE = 0x01;
// const REPLY_CONNECTION_NOT_ALLOWED = 0x02;
const REPLY_NETWORK_UNREACHABLE = 0x03;
// const REPLY_HOST_UNREACHABLE = 0x04;
// const REPLY_CONNECTION_REFUSED = 0x05;
// const REPLY_TTL_EXPIRED = 0x06;
const REPLY_COMMAND_NOT_SUPPORTED = 0x07;
const REPLY_ADDRESS_TYPE_NOT_SUPPORTED = 0x08;

interface ParsedAddress {
  host: string;
  port: number;
  addressType: number;
}

enum ConnectionState {
  AWAITING_GREETING,
  AWAITING_REQUEST,
  CONNECTED,
}

function parseAddress(buffer: Buffer, offset: number): ParsedAddress | null {
  const addressType = buffer[offset];
  let host: string;
  let port: number;
  let endOffset: number;
  
  switch (addressType) {
    case ADDR_IPV4:
      if (buffer.length < offset + 7) return null;
      host = `${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}.${buffer[offset + 4]}`;
      port = buffer.readUInt16BE(offset + 5);
      endOffset = offset + 7;
      break;
      
    case ADDR_DOMAIN:
      const domainLength = buffer[offset + 1];
      if (buffer.length < offset + 2 + domainLength + 2) return null;
      host = buffer.subarray(offset + 2, offset + 2 + domainLength).toString('ascii');
      port = buffer.readUInt16BE(offset + 2 + domainLength);
      endOffset = offset + 4 + domainLength;
      break;
      
    case ADDR_IPV6:
      if (buffer.length < offset + 19) return null;
      const ipv6Parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        ipv6Parts.push(buffer.readUInt16BE(offset + 1 + i * 2).toString(16));
      }
      host = ipv6Parts.join(':');
      port = buffer.readUInt16BE(offset + 17);
      endOffset = offset + 19;
      break;
      
    default:
      return null;
  }
  
  return { host, port, addressType };
}

function createReply(
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
    // Simplified: just use zeros
    addressBuffer = Buffer.alloc(17);
    addressBuffer[0] = ADDR_IPV6;
  } else {
    // Domain - shouldn't happen in replies usually
    addressBuffer = Buffer.from([ADDR_IPV4, 0, 0, 0, 0]);
  }
  
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(bindPort, 0);
  
  return Buffer.concat([
    Buffer.from([SOCKS_VERSION, replyCode, 0x00]),
    addressBuffer,
    portBuffer,
  ]);
}

function handleConnection(clientSocket: Socket, httpProxyPort: number): void {
  let state = ConnectionState.AWAITING_GREETING;
  let targetSocket: Socket | null = null;
  
  // Data buffer for partial reads
  let buffer = Buffer.alloc(0);
  
  clientSocket.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    
    switch (state) {
      case ConnectionState.AWAITING_GREETING:
        handleGreeting();
        break;
      case ConnectionState.AWAITING_REQUEST:
        handleRequest();
        break;
      case ConnectionState.CONNECTED:
        // Should not happen - data should go directly to target
        if (targetSocket && !targetSocket.destroyed) {
          targetSocket.write(data);
        }
        break;
    }
  });
  
  function handleGreeting() {
    // Minimum greeting: version(1) + nmethods(1) + methods(1+)
    if (buffer.length < 3) return;
    
    const version = buffer[0];
    const nmethods = buffer[1];
    
    if (version !== SOCKS_VERSION) {
      console.error(`❌ Invalid SOCKS version: ${version}`);
      clientSocket.end();
      return;
    }
    
    if (buffer.length < 2 + nmethods) return;
    
    const methods = buffer.subarray(2, 2 + nmethods);
    
    // Check if NO_AUTH is supported
    if (methods.includes(AUTH_NO_AUTH)) {
      // Accept no authentication
      clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_AUTH]));
      state = ConnectionState.AWAITING_REQUEST;
    } else {
      // No acceptable methods
      clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_ACCEPTABLE]));
      clientSocket.end();
      return;
    }
    
    // Clear buffer
    buffer = buffer.subarray(2 + nmethods);
  }
  
  function handleRequest() {
    // Minimum request: version(1) + cmd(1) + rsv(1) + atyp(1) + addr(min 1) + port(2)
    if (buffer.length < 7) return;
    
    const version = buffer[0];
    const command = buffer[1];
    // const reserved = buffer[2];
    
    if (version !== SOCKS_VERSION) {
      clientSocket.write(createReply(REPLY_GENERAL_FAILURE));
      clientSocket.end();
      return;
    }
    
    // Only support CONNECT command
    if (command !== CMD_CONNECT) {
      clientSocket.write(createReply(REPLY_COMMAND_NOT_SUPPORTED));
      clientSocket.end();
      return;
    }
    
    const address = parseAddress(buffer, 3);
    if (!address) {
      // Need more data or invalid address
      if (buffer.length > 300) {
        // Too much data, probably garbage
        clientSocket.write(createReply(REPLY_ADDRESS_TYPE_NOT_SUPPORTED));
        clientSocket.end();
      }
      return;
    }
    
    console.log(`🔌 SOCKS5 CONNECT: ${address.host}:${address.port}`);
    
    // For HTTP/HTTPS traffic, we route through our HTTP proxy
    // This allows us to intercept and transform the content
    const isHttp = address.port === 80;
    const isHttps = address.port === 443;
    
    if (isHttp || isHttps) {
      // Connect to our local HTTP proxy
      targetSocket = connect(httpProxyPort, '127.0.0.1', () => {
        console.log(`✅ Connected to HTTP proxy for ${address.host}:${address.port}`);
        
        // Send success reply
        clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
        state = ConnectionState.CONNECTED;
        
        // Clear buffer and pipe remaining data
        buffer = Buffer.alloc(0);
        
        // Pipe data between client and target
        clientSocket.pipe(targetSocket!);
        targetSocket!.pipe(clientSocket);
      });
    } else {
      // For non-HTTP traffic, connect directly
      targetSocket = connect(address.port, address.host, () => {
        console.log(`✅ Direct connection to ${address.host}:${address.port}`);
        
        // Send success reply
        clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
        state = ConnectionState.CONNECTED;
        
        // Clear buffer
        buffer = Buffer.alloc(0);
        
        // Pipe data between client and target
        clientSocket.pipe(targetSocket!);
        targetSocket!.pipe(clientSocket);
      });
    }
    
    targetSocket.on('error', (err) => {
      console.error(`❌ Target socket error: ${err.message}`);
      if (state === ConnectionState.AWAITING_REQUEST) {
        clientSocket.write(createReply(REPLY_NETWORK_UNREACHABLE));
      }
      clientSocket.end();
    });
    
    targetSocket.on('close', () => {
      clientSocket.end();
    });
  }
  
  clientSocket.on('error', (err) => {
    console.error(`❌ Client socket error: ${err.message}`);
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });
  
  clientSocket.on('close', () => {
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });
}

/**
 * Create and start the SOCKS5 proxy server
 */
export function createSocks5Proxy(port: number, httpProxyPort: number): Server {
  const server = createServer((socket) => {
    handleConnection(socket, httpProxyPort);
  });
  
  server.on('error', (err) => {
    console.error(`❌ SOCKS5 server error: ${err.message}`);
  });
  
  server.listen(port, () => {
    console.log(`🧦 SOCKS5 Proxy listening on port ${port}`);
  });
  
  return server;
}
