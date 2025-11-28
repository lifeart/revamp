/**
 * SOCKS5 Proxy Server
 *
 * Implements SOCKS5 protocol for legacy device connections.
 * Provides TLS interception for HTTPS traffic with content transformation.
 *
 * @module proxy/socks5
 */

import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import { TLSSocket, connect as tlsConnect } from 'node:tls';
import { generateDomainCert } from '../certs/index.js';
import {
  // SOCKS5 Protocol
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
import {
  // HTTP Client
  makeHttpRequest,
  makeHttpsRequest,
} from './http-client.js';
import {
  // Config Endpoint
  isConfigEndpoint,
  handleConfigRequest,
  buildRawHttpResponse,
} from './config-endpoint.js';
import {
  // Revamp API
  isRevampEndpoint,
  handleRevampRequest,
  buildRawApiResponse,
} from './revamp-api.js';
import {
  // Shared Utilities
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
  // Metrics
  recordRequest,
  recordBlocked,
  recordCacheHit,
  recordTransform,
  recordBandwidth,
  recordError,
  updateConnections,
} from '../metrics/index.js';

// =============================================================================
// Local Helper for Revamp API in SOCKS5 Context
// =============================================================================

/**
 * Handle Revamp API endpoint request in SOCKS5 context
 * Wraps the shared handleRevampRequest to return raw HTTP response string
 *
 * @param method - HTTP method
 * @param path - URL path
 * @param body - Request body
 * @returns Raw HTTP response string or null if not a Revamp endpoint
 */
function handleRevampApiSocks5(method: string, path: string, body: string): string | null {
  if (!isRevampEndpoint(path)) {
    return null;
  }

  console.log(`🔧 Revamp API: ${method} ${path}`);
  const result = handleRevampRequest(path, method, body);
  return buildRawApiResponse(result);
}

// =============================================================================
// Connection Handler
// =============================================================================

function handleConnection(clientSocket: Socket, httpProxyPort: number): void {
  let state = ConnectionState.AWAITING_GREETING;
  let targetSocket: Socket | TLSSocket | null = null;

  // Track connection for metrics
  updateConnections(1);

  // Extract client IP for per-client cache separation
  const rawClientIp = clientSocket.remoteAddress || '';
  // Normalize IPv6 localhost to IPv4 for consistency
  const clientIp = rawClientIp === '::1' || rawClientIp === '::ffff:127.0.0.1'
    ? '127.0.0.1'
    : rawClientIp.replace(/^::ffff:/, '');

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

    // Detect HTTP requests sent to SOCKS port by mistake
    // HTTP methods start with: GET (71), POST (80), PUT (80), HEAD (72),
    // DELETE (68), CONNECT (67), OPTIONS (79), PATCH (80)
    // ASCII: C=67, G=71, P=80, H=72, D=68, O=79
    const httpMethodChars = [67, 68, 71, 72, 79, 80]; // C, D, G, H, O, P
    if (httpMethodChars.includes(version)) {
      // This is likely an HTTP request, not SOCKS5
      // Silently close - don't spam logs
      clientSocket.end();
      return;
    }

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

    // Check if domain should be blocked
    if (shouldBlockDomain(address.host)) {
      console.log(`🚫 Blocked: ${address.host}`);
      clientSocket.write(createReply(REPLY_SUCCESS, address.addressType));
      clientSocket.end();
      return;
    }

    const isHttp = address.port === 80;
    const isHttps = address.port === 443;

    if (isHttps) {
      // For HTTPS: We need to do TLS interception
      // 1. Tell client connection is established
      // 2. Perform TLS handshake with client using our cert
      // 3. Connect to real server with TLS
      // 4. Intercept and transform data
      handleHttpsConnection(clientSocket, address.host, address.addressType);
    } else if (isHttp) {
      // For HTTP: Connect to target and intercept
      handleHttpConnection(clientSocket, address.host, address.port, address.addressType);
    } else {
      // For non-HTTP traffic, connect directly (no interception)
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
  }

  // Handle HTTPS with TLS interception
  function handleHttpsConnection(clientSocket: Socket, hostname: string, addressType: number): void {
    console.log(`🔒 Starting TLS interception for ${hostname}`);
    // First, tell the client the connection is established
    clientSocket.write(createReply(REPLY_SUCCESS, addressType));

    // Generate certificate for this domain
    const certPair = generateDomainCert(hostname);

    // Create a TLS server to handle the client connection
    const tlsOptions = {
      key: certPair.key,
      cert: certPair.cert,
      isServer: true,
    };

    // Upgrade client socket to TLS using TLSSocket
    const tlsServer = new TLSSocket(clientSocket, tlsOptions);

    tlsServer.on('secure', () => {
      console.log(`🔐 TLS handshake complete with client for ${hostname}`);
    });

    // Buffer for incoming HTTP request
    let requestBuffer = Buffer.alloc(0);
    let requestComplete = false;

    tlsServer.on('data', async (data: Buffer) => {
      if (requestComplete) return;

      requestBuffer = Buffer.concat([requestBuffer, data]);

      // Check if we have complete HTTP headers
      const headerEnd = requestBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      requestComplete = true;

      // Parse the HTTP request
      const headerStr = requestBuffer.subarray(0, headerEnd).toString('utf-8');
      const bodyStart = headerEnd + 4;
      const lines = headerStr.split('\r\n');
      const requestLine = lines[0];
      const [method, path] = requestLine.split(' ');

      // Parse headers
      const headers: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
          const key = lines[i].substring(0, colonIdx).toLowerCase();
          const value = lines[i].substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }

      // Get content length for body
      const contentLength = parseInt(headers['content-length'] || '0', 10);
      let requestBody = requestBuffer.subarray(bodyStart);

      // Wait for full body if needed
      while (requestBody.length < contentLength) {
        const moreData = await new Promise<Buffer>((resolve) => {
          tlsServer.once('data', resolve);
        });
        requestBody = Buffer.concat([requestBody, moreData]);
      }

      const targetUrl = `https://${hostname}${path}`;
      console.log(`🔐 HTTPS: ${method} ${targetUrl}`);

      // Record request for metrics
      recordRequest();

      // Check for Revamp API endpoints FIRST (before any blocking or external requests)
      const apiResponse = handleRevampApiSocks5(method, path, requestBody.toString('utf-8'));
      if (apiResponse) {
        tlsServer.write(apiResponse);
        tlsServer.end();
        return;
      }

      // Block tracking URLs by pattern
      if (shouldBlockUrl(targetUrl)) {
        console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
        recordBlocked();
        const blockedResponse =
          'HTTP/1.1 204 No Content\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        tlsServer.write(blockedResponse);
        tlsServer.end();
        return;
      }

      // Check for WebSocket upgrade request
      const upgradeHeader = headers['upgrade']?.toLowerCase();
      if (upgradeHeader === 'websocket') {
        console.log(`🔌 WebSocket upgrade request: ${targetUrl}`);
        handleWebSocketUpgrade(tlsServer, hostname, path, headers, requestBuffer);
        return;
      }

      // Handle CORS preflight requests
      // Use the Origin header for CORS to support credentials
      const requestOrigin = headers['origin'] || '*';

      if (method === 'OPTIONS') {
        const corsResponse = buildCorsPreflightResponse(requestOrigin);
        tlsServer.write(corsResponse);
        tlsServer.end();
        return;
      }

      // Make request to real server
      try {
        console.log(`📤 Fetching: ${method} ${targetUrl}`);
        const response = await makeHttpsRequest(method, hostname, path, headers, requestBody, clientIp);
        console.log(`📥 Response: ${response.statusCode} for ${targetUrl} (${response.body.length} bytes)`);

        // Apply gzip compression for text-based content if client supports it
        let responseBody = response.body;
        const responseContentType = response.headers['content-type'];
        const contentTypeStr = Array.isArray(responseContentType) ? responseContentType[0] : (responseContentType || '');
        const clientAcceptsGzip = acceptsGzip(headers['accept-encoding']);
        let isGzipped = false;

        if (clientAcceptsGzip && shouldCompress(contentTypeStr) && responseBody.length > 1024) {
          responseBody = await compressGzip(responseBody);
          isGzipped = true;
        }

        // Send response back to client
        let responseHeaders = `HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'OK'}\r\n`;
        for (const [key, value] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (!SKIP_RESPONSE_HEADERS.has(lowerKey)) {
            if (Array.isArray(value)) {
              responseHeaders += `${key}: ${value.join(', ')}\r\n`;
            } else if (value !== undefined && value !== null) {
              responseHeaders += `${key}: ${value}\r\n`;
            }
          }
        }
        responseHeaders += `Content-Length: ${responseBody.length}\r\n`;
        if (isGzipped) {
          responseHeaders += `Content-Encoding: gzip\r\n`;
          responseHeaders += `Vary: Accept-Encoding\r\n`;
        }
        responseHeaders += `Connection: close\r\n`;
        // Add CORS headers to allow cross-origin requests (use Origin for credentials support)
        responseHeaders += buildCorsHeadersString(requestOrigin);
        responseHeaders += '\r\n';

        tlsServer.write(responseHeaders);
        tlsServer.write(responseBody);
        tlsServer.end();
      } catch (err) {
        const error = err as Error;
        console.error(`❌ HTTPS request error for ${targetUrl}:`, error.message);
        recordError();
        const errorResponse =
          'HTTP/1.1 502 Bad Gateway\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 11\r\n' +
          'Connection: close\r\n' +
          '\r\n' +
          'Bad Gateway';
        tlsServer.write(errorResponse);
        tlsServer.end();
      }
    });

    tlsServer.on('error', (err: Error) => {
      // Suppress common expected errors
      if (err.message.includes('ECONNRESET') ||
          err.message.includes('unknown ca') ||
          err.message.includes('certificate') ||
          err.message.includes('handshake') ||
          err.message.includes('write after end')) {
        // These are expected when client hasn't installed CA cert or connection was closed
        return;
      }
      console.error(`❌ TLS server error for ${hostname}: ${err.message}`);
    });

    tlsServer.on('close', () => {
      clientSocket.destroy();
    });
  }

  // Handle WebSocket upgrade requests - proxy directly without transformation
  function handleWebSocketUpgrade(
    tlsClient: TLSSocket,
    hostname: string,
    path: string,
    headers: Record<string, string>,
    initialRequest: Buffer
  ): void {
    console.log(`🌐 Establishing WebSocket connection to ${hostname}`);

    // Connect to the real server via TLS
    const tlsServer = tlsConnect({
      host: hostname,
      port: 443,
      rejectUnauthorized: false,
    });

    tlsServer.on('secureConnect', () => {
      console.log(`🔗 WebSocket TLS connection established to ${hostname}`);

      // Forward the original upgrade request to the server
      tlsServer.write(initialRequest);

      // Set up bidirectional piping
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

  // Handle HTTP connections with interception
  function handleHttpConnection(clientSocket: Socket, hostname: string, port: number, addressType: number): void {
    // Tell client connection is established
    clientSocket.write(createReply(REPLY_SUCCESS, addressType));
    state = ConnectionState.CONNECTED;

    let requestBuffer = Buffer.alloc(0);

    clientSocket.on('data', async (data: Buffer) => {
      requestBuffer = Buffer.concat([requestBuffer, data]);

      // Check for complete headers
      const headerEnd = requestBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      // Parse request
      const headerStr = requestBuffer.subarray(0, headerEnd).toString('utf-8');
      const bodyStart = headerEnd + 4;
      const lines = headerStr.split('\r\n');
      const requestLine = lines[0];
      const [method, path] = requestLine.split(' ');

      const headers: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
          const key = lines[i].substring(0, colonIdx).toLowerCase();
          const value = lines[i].substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }

      const contentLength = parseInt(headers['content-length'] || '0', 10);
      let requestBody = requestBuffer.subarray(bodyStart);

      while (requestBody.length < contentLength) {
        const moreData = await new Promise<Buffer>((resolve) => {
          clientSocket.once('data', resolve);
        });
        requestBody = Buffer.concat([requestBody, moreData]);
      }

      const targetUrl = `http://${hostname}${path}`;
      console.log(`📡 HTTP: ${method} ${targetUrl}`);

      // Record request for metrics
      recordRequest();

      // Check for Revamp API endpoints FIRST (before any blocking or external requests)
      const apiResponse = handleRevampApiSocks5(method, path, requestBody.toString('utf-8'));
      if (apiResponse) {
        clientSocket.write(apiResponse);
        requestBuffer = Buffer.alloc(0);
        return;
      }

      // Block tracking URLs by pattern
      if (shouldBlockUrl(targetUrl)) {
        console.log(`🚫 Blocked tracking URL: ${targetUrl}`);
        recordBlocked();
        const blockedResponse =
          'HTTP/1.1 204 No Content\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        clientSocket.write(blockedResponse);
        requestBuffer = Buffer.alloc(0);
        return;
      }

      // Use the Origin header for CORS to support credentials
      const requestOrigin = headers['origin'] || '*';

      // Handle CORS preflight requests
      if (method === 'OPTIONS') {
        const corsResponse = buildCorsPreflightResponse(requestOrigin);
        clientSocket.write(corsResponse);
        requestBuffer = Buffer.alloc(0);
        return;
      }

      try {
        const response = await makeHttpRequest(method, hostname, port, path, headers, requestBody, clientIp);

        let responseHeaders = `HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'OK'}\r\n`;

        // Apply gzip compression for text-based content if client supports it
        let responseBody = response.body;
        const responseContentType = response.headers['content-type'];
        const contentTypeStr = Array.isArray(responseContentType) ? responseContentType[0] : (responseContentType || '');
        const clientAcceptsGzip = acceptsGzip(headers['accept-encoding']);
        let isGzipped = false;

        if (clientAcceptsGzip && shouldCompress(contentTypeStr) && responseBody.length > 1024) {
          responseBody = await compressGzip(responseBody);
          isGzipped = true;
        }

        for (const [key, value] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (!SKIP_RESPONSE_HEADERS.has(lowerKey)) {
            if (Array.isArray(value)) {
              responseHeaders += `${key}: ${value.join(', ')}\r\n`;
            } else if (value !== undefined && value !== null) {
              responseHeaders += `${key}: ${value}\r\n`;
            }
          }
        }
        responseHeaders += `Content-Length: ${responseBody.length}\r\n`;
        if (isGzipped) {
          responseHeaders += `Content-Encoding: gzip\r\n`;
          responseHeaders += `Vary: Accept-Encoding\r\n`;
        }
        responseHeaders += `Connection: close\r\n`;
        // Add CORS headers to allow cross-origin requests (use Origin for credentials support)
        responseHeaders += buildCorsHeadersString(requestOrigin);
        responseHeaders += '\r\n';

        clientSocket.write(responseHeaders);
        clientSocket.write(responseBody);

        // Reset for next request
        requestBuffer = Buffer.alloc(0);
      } catch (err) {
        console.error(`❌ HTTP request error:`, err);
        const errorResponse =
          'HTTP/1.1 502 Bad Gateway\r\n' +
          `Access-Control-Allow-Origin: ${requestOrigin}\r\n` +
          'Access-Control-Allow-Credentials: true\r\n' +
          'Content-Length: 11\r\n' +
          '\r\n' +
          'Bad Gateway';
        clientSocket.write(errorResponse);
      }
    });
  }

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
// SOCKS5 Proxy Server Factory
// =============================================================================

/**
 * Create and start the SOCKS5 proxy server
 *
 * @param port - Port to listen on (default: 1080)
 * @param httpProxyPort - HTTP proxy port for fallback routing
 * @param bindAddress - Address to bind to (default: 0.0.0.0 for all interfaces)
 * @returns Node.js Server instance
 */
export function createSocks5Proxy(port: number, httpProxyPort: number, bindAddress: string = '0.0.0.0'): Server {
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
