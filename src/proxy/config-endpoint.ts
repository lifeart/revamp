/**
 * Config Endpoint Handler
 *
 * Handles the /__revamp__/config API endpoint for both HTTP and SOCKS5 proxies.
 * Allows clients to read and update proxy configuration at runtime.
 */

import { getClientConfig, setClientConfig, resetClientConfig, type ClientConfig } from '../config/index.js';
import { log } from '../logger/log.js';
import type { ApiRouter, ApiRequest } from './api-router.js';

/** Config API endpoint path */
export const CONFIG_ENDPOINT = '/__revamp__/config';

/** Standard config endpoint headers */
const CONFIG_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

/**
 * Result of handling a config endpoint request
 */
export interface ConfigEndpointResult {
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body (JSON string) */
  body: string;
}

/**
 * Handle a config API request
 *
 * Supports:
 * - GET: Returns current config
 * - POST: Updates config with provided values
 * - DELETE: Resets config to defaults
 * - OPTIONS: CORS preflight
 *
 * @param method - HTTP method
 * @param body - Request body (for POST requests)
 * @param clientIp - Optional client IP for per-client config
 * @returns ConfigEndpointResult with status, headers, and body
 */
export function handleConfigRequest(method: string, body: string = '', clientIp?: string): ConfigEndpointResult {
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CONFIG_HEADERS,
        'Content-Length': '0',
      },
      body: '',
    };
  }

  // GET - return current config
  if (method === 'GET') {
    const config = getClientConfig(clientIp);
    // Pass the config object to the logger rather than pre-stringifying it:
    // `log.debug` is filtered out at the default level, and the backend
    // (console.log) only formats the object lazily when the level is enabled,
    // so JSON.stringify no longer runs unconditionally on this cold path.
    log.debug(`⚙️ Config GET${clientIp ? ` (client: ${clientIp})` : ''} - returning:`, config);
    const responseBody = JSON.stringify({ success: true, config });
    return {
      statusCode: 200,
      headers: CONFIG_HEADERS,
      body: responseBody,
    };
  }

  // POST - update config
  if (method === 'POST') {
    try {
      const newConfig = JSON.parse(body) as ClientConfig;
      log.info(`⚙️ Config POST${clientIp ? ` (client: ${clientIp})` : ''} - saving:`, JSON.stringify(newConfig));
      setClientConfig(newConfig, clientIp);
      const responseBody = JSON.stringify({ success: true, config: getClientConfig(clientIp) });
      return {
        statusCode: 200,
        headers: CONFIG_HEADERS,
        body: responseBody,
      };
    } catch (err) {
      const responseBody = JSON.stringify({ success: false, error: 'Invalid JSON' });
      return {
        statusCode: 400,
        headers: CONFIG_HEADERS,
        body: responseBody,
      };
    }
  }

  // DELETE - reset config
  if (method === 'DELETE') {
    log.info(`⚙️ Config DELETE${clientIp ? ` (client: ${clientIp})` : ''} - resetting`);
    resetClientConfig(clientIp);
    const responseBody = JSON.stringify({ success: true, config: getClientConfig(clientIp) });
    return {
      statusCode: 200,
      headers: CONFIG_HEADERS,
      body: responseBody,
    };
  }

  // Method not allowed
  const responseBody = JSON.stringify({ success: false, error: 'Method not allowed' });
  return {
    statusCode: 405,
    headers: CONFIG_HEADERS,
    body: responseBody,
  };
}

/**
 * Register the config endpoint on the shared API router.
 * Adding a future config route means adding exactly one line here.
 *
 * `handleConfigRequest` switches on the method itself (GET/POST/DELETE,
 * with its historical 405 for everything else), so the routes register with
 * method '*'. The `/*` pattern preserves the previous `startsWith` matching
 * for sub-paths like `/__revamp__/config/`.
 */
export function registerConfigRoutes(router: ApiRouter): void {
  const handle = (req: ApiRequest): ConfigEndpointResult =>
    handleConfigRequest(req.method, req.body, req.clientIp);

  router.register('*', CONFIG_ENDPOINT, handle);
  router.register('*', `${CONFIG_ENDPOINT}/`, handle);
  router.register('*', `${CONFIG_ENDPOINT}/*`, handle);
}

/**
 * Build a raw HTTP response string from ConfigEndpointResult
 * Used by SOCKS5 proxy which sends raw HTTP responses
 *
 * @param result - Config endpoint result
 * @returns Raw HTTP response string
 */
export function buildRawHttpResponse(result: ConfigEndpointResult): string {
  const statusMessages: Record<number, string> = {
    200: 'OK',
    204: 'No Content',
    400: 'Bad Request',
    405: 'Method Not Allowed',
  };

  const statusMessage = statusMessages[result.statusCode] || 'OK';
  let response = `HTTP/1.1 ${result.statusCode} ${statusMessage}\r\n`;

  for (const [key, value] of Object.entries(result.headers)) {
    response += `${key}: ${value}\r\n`;
  }

  if (result.body) {
    response += `Content-Length: ${Buffer.byteLength(result.body)}\r\n`;
  }
  response += 'Connection: close\r\n';
  response += '\r\n';
  response += result.body;

  return response;
}

/**
 * Check if a URL path matches the config endpoint
 *
 * @param path - URL path to check
 * @returns true if path starts with CONFIG_ENDPOINT
 */
export function isConfigEndpoint(path: string): boolean {
  return path.startsWith(CONFIG_ENDPOINT);
}
