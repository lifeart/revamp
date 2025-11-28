/**
 * SOCKS5 Proxy Server
 *
 * Implements SOCKS5 protocol (RFC 1928) for legacy device connections.
 * Provides TLS interception for HTTPS traffic with content transformation.
 *
 * Architecture:
 * - SOCKS5 handshake and connection establishment
 * - HTTP/HTTPS traffic interception and transformation
 * - WebSocket passthrough (no transformation)
 * - Direct passthrough for non-HTTP traffic
 *
 * @module proxy/socks5
 */

import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import { TLSSocket, connect as tlsConnect } from 'node:tls';
import { generateDomainCert } from '../certs/index.js';
import {
  SOCKS_VERSION,
  AUTH_NO_AUTH,
  AUTH_NO_ACCEPTABLE,
  CMD_CONNECT,
  REPLY_SUCCESS,
  REPLY_GENERAL_FAILURE,
  REPLY_NETWORK_UNREACHABLE,
  REPLY_COMMAND_NOT_SUPPORTED,
  REPLY_ADDRESS_TYPE_NOT_SUPPORTED,
  ConnectionState,
  parseAddress,
  createReply,
} from './socks5-protocol.js';
import { makeHttpRequest, makeHttpsRequest } from './http-client.js';
import { isRevampEndpoint, handleRevampRequest, buildRawApiResponse } from './revamp-api.js';
import {
  shouldCompress,
  acceptsGzip,
  compressGzip,
  shouldBlockDomain,
  shouldBlockUrl,
  SKIP_RESPONSE_HEADERS,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
} from './shared.js';
import {
  recordRequest,
  recordBlocked,
  recordError,
  updateConnections,
} from '../metrics/index.js';

// =============================================================================
// Types
// =============================================================================

/** Parsed HTTP request from buffer */
interface ParsedHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}

/** HTTP response from upstream */
interface HttpResponse {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

// =============================================================================
// Constants
// =============================================================================

/** HTTP method first bytes (for detecting HTTP requests on SOCKS port) */
const HTTP_METHOD_FIRST_BYTES = [67, 68, 71, 72, 79, 80] as const; // C, D, G, H, O, P

/** Minimum compression threshold (bytes) */
const COMPRESSION_THRESHOLD = 1024;

/** Suppressed TLS error patterns (expected errors) */
const SUPPRESSED_TLS_ERRORS = [
  'ECONNRESET',
  'unknown ca',
  'certificate',
  'handshake',
  'write after end',
] as const;

// =============================================================================
// IP Address Utilities
// =============================================================================

/**
 * Normalize IP address for consistency.
 * Converts IPv6 localhost to IPv4 and removes IPv6 prefix.
 *
 * @param ip - Raw IP address
 * @returns Normalized IP address
 */
function normalizeIpAddress(ip: string): string {
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  return ip.replace(/^::ffff:/, '');
}

// =============================================================================
// Revamp API Handler
// =============================================================================

/**
 * Handle Revamp API endpoint request in SOCKS5 context.
 *
 * @param method - HTTP method
 * @param path - URL path
 * @param body - Request body
 * @param clientIp - Client IP for per-client config
 * @returns Raw HTTP response string or null if not a Revamp endpoint
 */
function handleRevampApiSocks5(
  method: string,
  path: string,
  body: string,
  clientIp: string
): string | null {
  if (!isRevampEndpoint(path)) {
    return null;
  }

  console.log(`🔧 Revamp API: ${method} ${path} (client: ${clientIp})`);
  const result = handleRevampRequest(path, method, body, clientIp);
  return buildRawApiResponse(result);
}

// =============================================================================
// HTTP Parsing Utilities
// =============================================================================

/**
 * Parse HTTP headers from header string.
 *
 * @param headerLines - Array of header lines (excluding request line)
 * @returns Parsed headers object
 */
function parseHeaders(headerLines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Parse HTTP request from buffer.
 *
 * @param buffer - Request buffer
 * @param socket - Socket to read additional body data from
 * @returns Parsed request or null if incomplete
 */
async function parseHttpRequest(
  buffer: Buffer,
  socket: Socket | TLSSocket
): Promise<ParsedHttpRequest | null> {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return null;
  }

  const headerStr = buffer.subarray(0, headerEnd).toString('utf-8');
  const bodyStart = headerEnd + 4;
  const lines = headerStr.split('\r\n');
  const requestLine = lines[0];
  const [method, path] = requestLine.split(' ');

  const headers = parseHeaders(lines.slice(1));
  const contentLength = parseInt(headers['content-length'] || '0', 10);

  let body = buffer.subarray(bodyStart);

  // Wait for full body if needed
  while (body.length < contentLength) {
    const moreData = await new Promise<Buffer>((resolve) => {
      socket.once('data', resolve);
    });
    body = Buffer.concat([body, moreData]);
  }

  return { method, path, headers, body };
}

// =============================================================================
// Response Building Utilities
// =============================================================================

/**
 * Build HTTP response headers string.
 *
 * @param statusCode - HTTP status code
 * @param statusMessage - Status message
 * @param headers - Response headers
 * @param bodyLength - Body length for Content-Length header
 * @param isGzipped - Whether body is gzip compressed
 * @param corsOrigin - Origin for CORS headers
 * @returns Headers string
 */
function buildResponseHeaders(
  statusCode: number,
  statusMessage: string,
  headers: Record<string, string | string[] | undefined>,
  bodyLength: number,
  isGzipped: boolean,
  corsOrigin: string
): string {
  let responseHeaders = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (!SKIP_RESPONSE_HEADERS.has(lowerKey)) {
      if (Array.isArray(value)) {
        responseHeaders += `${key}: ${value.join(', ')}\r\n`;
      } else if (value !== undefined && value !== null) {
        responseHeaders += `${key}: ${value}\r\n`;
      }
    }
  }

  responseHeaders += `Content-Length: ${bodyLength}\r\n`;

  if (isGzipped) {
    responseHeaders += `Content-Encoding: gzip\r\n`;
    responseHeaders += `Vary: Accept-Encoding\r\n`;
  }

  responseHeaders += `Connection: close\r\n`;
  responseHeaders += buildCorsHeadersString(corsOrigin);
  responseHeaders += '\r\n';

  return responseHeaders;
}

/**
 * Build blocked response.
 *
 * @returns HTTP 204 response string
 */
function buildBlockedResponse(): string {
  return (
    'HTTP/1.1 204 No Content\r\n' +
    'Connection: close\r\n' +
    '\r\n'
  );
}

/**
 * Build error response.
 *
 * @param statusCode - HTTP status code
 * @param message - Error message
 * @param corsOrigin - Origin for CORS headers
 * @returns HTTP error response string
 */
function buildErrorResponse(
  statusCode: number,
  message: string,
  corsOrigin: string
): string {
  return (
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
    `Access-Control-Allow-Origin: ${corsOrigin}\r\n` +
    'Access-Control-Allow-Credentials: true\r\n' +
    'Content-Type: text/plain\r\n' +
    `Content-Length: ${message.length}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    message
  );
}

// =============================================================================
// Compression Utilities
// =============================================================================

/**
 * Apply gzip compression if appropriate.
 *
 * @param body - Response body
 * @param contentType - Content-Type header value
 * @param acceptEncoding - Client's Accept-Encoding header
 * @returns Object with body and whether it was compressed
 */
async function maybeCompress(
  body: Buffer,
  contentType: string,
  acceptEncoding: string | undefined
): Promise<{ body: Buffer; isGzipped: boolean }> {
  const contentTypeStr = Array.isArray(contentType) ? contentType : (contentType || '');
  const clientAcceptsGzip = acceptsGzip(acceptEncoding);

  if (clientAcceptsGzip && shouldCompress(contentTypeStr) && body.length > COMPRESSION_THRESHOLD) {
    return { body: await compressGzip(body), isGzipped: true };
  }

  return { body, isGzipped: false };
}

// =============================================================================
// Request Handlers
// =============================================================================

/**
 * Check and handle blocked URLs.
 *
 * @param targetUrl - Target URL to check
 * @param socket - Socket to write response to
 * @returns true if URL was blocked
 */
function checkAndBlockUrl(targetUrl: string, socket: Socket | TLSSocket): boolean {
  if (shouldBlockUrl(targetUrl)) {
    console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
    recordBlocked();
    socket.write(buildBlockedResponse());
    return true;
  }
  return false;
}

/**
 * Handle HTTP request through SOCKS5.
 *
 * @param request - Parsed HTTP request
 * @param socket - Client socket
 * @param hostname - Target hostname
 * @param port - Target port
 * @param clientIp - Client IP address
 * @param makeRequest - Function to make the HTTP request
 */
async function handleHttpRequestSocks5(
  request: ParsedHttpRequest,
  socket: Socket | TLSSocket,
  hostname: string,
  port: number | undefined,
  clientIp: string,
  makeRequest: (
    method: string,
    hostname: string,
    port: number | undefined,
    path: string,
    headers: Record<string, string>,
    body: Buffer,
    clientIp: string
  ) => Promise<HttpResponse>
): Promise<void> {
  const { method, path, headers, body: requestBody } = request;
  const isHttps = port === 443 || port === undefined;
  const targetUrl = `${isHttps ? 'https' : 'http'}://${hostname}${path}`;

  console.log(`${isHttps ? '🔐 HTTPS' : '📡 HTTP'}: ${method} ${targetUrl}`);
  recordRequest();

  // Check for Revamp API endpoints
  const apiResponse = handleRevampApiSocks5(method, path, requestBody.toString('utf-8'), clientIp);
  if (apiResponse) {
    socket.write(apiResponse);
    if (socket instanceof TLSSocket) {
      socket.end();
    }
    return;
  }

  // Check URL blocking
  if (checkAndBlockUrl(targetUrl, socket)) {
    if (socket instanceof TLSSocket) {
      socket.end();
    }
    return;
  }

  const requestOrigin = headers['origin'] || '*';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    socket.write(buildCorsPreflightResponse(requestOrigin));
    if (socket instanceof TLSSocket) {
      socket.end();
    }
    return;
  }

  try {
    console.log(`📤 Fetching: ${method} ${targetUrl}`);
    const response = await makeRequest(method, hostname, port as number, path, headers, requestBody, clientIp);
    console.log(`📥 Response: ${response.statusCode} for ${targetUrl} (${response.body.length} bytes)`);

    // Apply compression
    const responseContentType = response.headers['content-type'];
    const contentTypeStr = Array.isArray(responseContentType) ? responseContentType[0] : (responseContentType || '');
    const { body: responseBody, isGzipped } = await maybeCompress(
      response.body,
      contentTypeStr,
      headers['accept-encoding']
    );

    // Build and send response
    const responseHeaders = buildResponseHeaders(
      response.statusCode,
      response.statusMessage || 'OK',
      response.headers,
      responseBody.length,
      isGzipped,
      requestOrigin
    );

    socket.write(responseHeaders);
    socket.write(responseBody);

    if (socket instanceof TLSSocket) {
      socket.end();
    }
  } catch (err) {
    const error = err as Error;
    console.error(`❌ Request error for ${targetUrl}:`, error.message);
    recordError();
    socket.write(buildErrorResponse(502, 'Bad Gateway', requestOrigin));
    if (socket instanceof TLSSocket) {
      socket.end();
    }
  }
}

// =============================================================================
// WebSocket Handler
// =============================================================================

/**
 * Handle WebSocket upgrade requests - proxy directly without transformation.
 *
 * @param tlsClient - TLS socket to client
 * @param hostname - Target hostname
 * @param initialRequest - Initial upgrade request buffer
 */
function handleWebSocketUpgrade(
  tlsClient: TLSSocket,
  hostname: string,
  initialRequest: Buffer
): void {
  console.log(`🌐 Establishing WebSocket connection to ${hostname}`);

  const tlsServer = tlsConnect({
    host: hostname,
    port: 443,
    rejectUnauthorized: false,
  });

  tlsServer.on('secureConnect', () => {
    console.log(`🔗 WebSocket TLS connection established to ${hostname}`);
    tlsServer.write(initialRequest);
    tlsClient.pipe(tlsServer);
    tlsServer.pipe(tlsClient);
  });

  tlsServer.on('error', (err: Error) => {
    console.error(`❌ WebSocket server connection error for ${hostname}: ${err.message}`);
    tlsClient.end();
  });

  tlsServer.on('close', () => {
    console.log(`🔌 WebSocket connection closed for ${hostname}`);
    tlsClient.end();
  });

  tlsClient.on('error', (err: Error) => {
    if (!err.message.includes('ECONNRESET')) {
      console.error(`❌ WebSocket client error for ${hostname}: ${err.message}`);
    }
    tlsServer.end();
  });

  tlsClient.on('close', () => {
    tlsServer.end();
  });
}

// =============================================================================
// HTTPS Connection Handler
// =============================================================================

/**
 * Handle HTTPS connections with TLS interception.
 *
 * @param clientSocket - Client socket
 * @param hostname - Target hostname
 * @param addressType - SOCKS address type
 * @param clientIp - Client IP address
 */
function handleHttpsConnection(
  clientSocket: Socket,
  hostname: string,
  addressType: number,
  clientIp: string
): void {
  console.log(`🔒 Starting TLS interception for ${hostname}`);

  // Tell client connection is established
  clientSocket.write(createReply(REPLY_SUCCESS, addressType));

  // Generate certificate for this domain
  const certPair = generateDomainCert(hostname);

  // Upgrade to TLS
  const tlsServer = new TLSSocket(clientSocket, {
    key: certPair.key,
    cert: certPair.cert,
    isServer: true,
  });

  tlsServer.on('secure', () => {
    console.log(`🔐 TLS handshake complete with client for ${hostname}`);
  });

  let requestBuffer = Buffer.alloc(0);
  let requestComplete = false;

  tlsServer.on('data', async (data: Buffer) => {
    if (requestComplete) return;

    requestBuffer = Buffer.concat([requestBuffer, data]);

    const request = await parseHttpRequest(requestBuffer, tlsServer);
    if (!request) return;

    requestComplete = true;

    // Check for WebSocket upgrade
    if (request.headers['upgrade']?.toLowerCase() === 'websocket') {
      console.log(`🔌 WebSocket upgrade request: https://${hostname}${request.path}`);
      handleWebSocketUpgrade(tlsServer, hostname, requestBuffer);
      return;
    }

    // Handle regular HTTPS request
    await handleHttpRequestSocks5(
      request,
      tlsServer,
      hostname,
      443,
      clientIp,
      async (method, host, _port, path, headers, body, ip) =>
        makeHttpsRequest(method, host, path, headers, body, ip)
    );
  });

  tlsServer.on('error', (err: Error) => {
    // Suppress expected errors
    const isExpectedError = SUPPRESSED_TLS_ERRORS.some(pattern =>
      err.message.includes(pattern)
    );
    if (!isExpectedError) {
      console.error(`❌ TLS server error for ${hostname}: ${err.message}`);
    }
  });

  tlsServer.on('close', () => {
    clientSocket.destroy();
  });
}

// =============================================================================
// HTTP Connection Handler
// =============================================================================

/**
 * Handle HTTP connections with interception.
 *
 * @param clientSocket - Client socket
 * @param hostname - Target hostname
 * @param port - Target port
 * @param addressType - SOCKS address type
 * @param clientIp - Client IP address
 */
function handleHttpConnection(
  clientSocket: Socket,
  hostname: string,
  port: number,
  addressType: number,
  clientIp: string
): void {
  // Tell client connection is established
  clientSocket.write(createReply(REPLY_SUCCESS, addressType));

  let requestBuffer = Buffer.alloc(0);

  clientSocket.on('data', async (data: Buffer) => {
    requestBuffer = Buffer.concat([requestBuffer, data]);

    const request = await parseHttpRequest(requestBuffer, clientSocket);
    if (!request) return;

    await handleHttpRequestSocks5(
      request,
      clientSocket,
      hostname,
      port,
      clientIp,
      makeHttpRequest
    );

    // Reset for next request
    requestBuffer = Buffer.alloc(0);
  });
}

// =============================================================================
// Direct Connection Handler
// =============================================================================

/**
 * Handle direct (non-HTTP) connections - passthrough without transformation.
 *
 * @param clientSocket - Client socket
 * @param hostname - Target hostname
 * @param port - Target port
 * @param addressType - SOCKS address type
 * @returns Target socket
 */
function handleDirectConnection(
  clientSocket: Socket,
  hostname: string,
  port: number,
  addressType: number
): Socket {
  const targetSocket = connect(port, hostname, () => {
    console.log(`✅ Direct connection to ${hostname}:${port}`);
    clientSocket.write(createReply(REPLY_SUCCESS, addressType));
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  targetSocket.on('error', (err) => {
    console.error(`❌ Target socket error: ${err.message}`);
    clientSocket.write(createReply(REPLY_NETWORK_UNREACHABLE));
    clientSocket.end();
  });

  targetSocket.on('close', () => {
    clientSocket.end();
  });

  return targetSocket;
}

// =============================================================================
// SOCKS5 Protocol Handlers
// =============================================================================

/**
 * Check if data looks like an HTTP request (sent to SOCKS port by mistake).
 *
 * @param firstByte - First byte of data
 * @returns true if this looks like HTTP
 */
function looksLikeHttpRequest(firstByte: number): boolean {
  return HTTP_METHOD_FIRST_BYTES.includes(firstByte as typeof HTTP_METHOD_FIRST_BYTES[number]);
}

/**
 * Handle SOCKS5 greeting phase.
 *
 * @param buffer - Data buffer
 * @param clientSocket - Client socket
 * @returns Object with new state and remaining buffer, or null if incomplete
 */
function handleGreeting(
  buffer: Buffer,
  clientSocket: Socket
): { state: ConnectionState; buffer: Buffer } | null {
  if (buffer.length < 3) return null;

  const version = buffer[0];
  const nmethods = buffer[1];

  // Detect HTTP requests sent to SOCKS port
  if (looksLikeHttpRequest(version)) {
    clientSocket.end();
    return { state: ConnectionState.CONNECTED, buffer: Buffer.alloc(0) };
  }

  if (version !== SOCKS_VERSION) {
    console.error(`❌ Invalid SOCKS version: ${version}`);
    clientSocket.end();
    return { state: ConnectionState.CONNECTED, buffer: Buffer.alloc(0) };
  }

  if (buffer.length < 2 + nmethods) return null;

  const methods = buffer.subarray(2, 2 + nmethods);

  if (methods.includes(AUTH_NO_AUTH)) {
    clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_AUTH]));
    return {
      state: ConnectionState.AWAITING_REQUEST,
      buffer: buffer.subarray(2 + nmethods),
    };
  }

  clientSocket.write(Buffer.from([SOCKS_VERSION, AUTH_NO_ACCEPTABLE]));
  clientSocket.end();
  return { state: ConnectionState.CONNECTED, buffer: Buffer.alloc(0) };
}

/**
 * Handle SOCKS5 request phase.
 *
 * @param buffer - Data buffer
 * @param clientSocket - Client socket
 * @param clientIp - Client IP address
 * @returns Target socket if direct connection, or null
 */
function handleRequest(
  buffer: Buffer,
  clientSocket: Socket,
  clientIp: string
): Socket | null {
  if (buffer.length < 7) return null;

  const version = buffer[0];
  const command = buffer[1];

  if (version !== SOCKS_VERSION) {
    clientSocket.write(createReply(REPLY_GENERAL_FAILURE));
    clientSocket.end();
    return null;
  }

  if (command !== CMD_CONNECT) {
    clientSocket.write(createReply(REPLY_COMMAND_NOT_SUPPORTED));
    clientSocket.end();
    return null;
  }

  const address = parseAddress(buffer, 3);
  if (!address) {
    if (buffer.length > 300) {
      clientSocket.write(createReply(REPLY_ADDRESS_TYPE_NOT_SUPPORTED));
      clientSocket.end();
    }
    return null;
  }

  console.log(`🔌 SOCKS5 CONNECT: ${address.host}:${address.port}`);

  // Check domain blocking
  if (shouldBlockDomain(address.host)) {
    console.log(`🚫 Blocked: ${address.host}`);
    clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
    clientSocket.end();
    return null;
  }

  // Route based on port
  if (address.port === 443) {
    handleHttpsConnection(clientSocket, address.host, address.addressType, clientIp);
    return null;
  } else if (address.port === 80) {
    handleHttpConnection(clientSocket, address.host, address.port, address.addressType, clientIp);
    return null;
  } else {
    return handleDirectConnection(clientSocket, address.host, address.port, address.addressType);
  }
}

// =============================================================================
// Main Connection Handler
// =============================================================================

/**
 * Handle incoming SOCKS5 connection.
 *
 * @param clientSocket - Client socket
 * @param httpProxyPort - HTTP proxy port (unused, for compatibility)
 */
function handleConnection(clientSocket: Socket, httpProxyPort: number): void {
  let state = ConnectionState.AWAITING_GREETING;
  let targetSocket: Socket | TLSSocket | null = null;
  let buffer = Buffer.alloc(0);

  updateConnections(1);

  const clientIp = normalizeIpAddress(clientSocket.remoteAddress || '');

  clientSocket.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);

    switch (state) {
      case ConnectionState.AWAITING_GREETING: {
        const result = handleGreeting(buffer, clientSocket);
        if (result) {
          state = result.state;
          buffer = result.buffer;
        }
        break;
      }

      case ConnectionState.AWAITING_REQUEST: {
        const socket = handleRequest(buffer, clientSocket, clientIp);
        if (socket) {
          targetSocket = socket;
          state = ConnectionState.CONNECTED;
          buffer = Buffer.alloc(0);
        }
        break;
      }

      case ConnectionState.CONNECTED:
        if (targetSocket && !targetSocket.destroyed) {
          targetSocket.write(data);
        }
        break;
    }
  });

  clientSocket.on('error', (err) => {
    if (!err.message.includes('ECONNRESET') && !err.message.includes('write after end')) {
      console.error(`❌ Client socket error: ${err.message}`);
    }
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });

  clientSocket.on('close', () => {
    updateConnections(-1);
    if (targetSocket && !targetSocket.destroyed) {
      targetSocket.end();
    }
  });
}

// =============================================================================
// Server Factory
// =============================================================================

/**
 * Create and start the SOCKS5 proxy server.
 *
 * @param port - Port to listen on (default: 1080)
 * @param httpProxyPort - HTTP proxy port for fallback routing
 * @param bindAddress - Address to bind to (default: all interfaces)
 * @returns Node.js Server instance
 */
export function createSocks5Proxy(
  port: number,
  httpProxyPort: number,
  bindAddress: string = '0.0.0.0'
): Server {
  const server = createServer((socket) => {
    handleConnection(socket, httpProxyPort);
  });

  server.on('error', (err) => {
    console.error(`❌ SOCKS5 server error: ${err.message}`);
  });

  server.listen(port, bindAddress, () => {
    console.log(`🧦 SOCKS5 Proxy listening on ${bindAddress}:${port}`);
  });

  return server;
}
