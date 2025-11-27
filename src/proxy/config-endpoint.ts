/**
 * Config Endpoint Handler
 * 
 * Handles the /__revamp__/config API endpoint for both HTTP and SOCKS5 proxies.
 * Allows clients to read and update proxy configuration at runtime.
 */

import { getClientConfig, setClientConfig, resetClientConfig, type ClientConfig } from '../config/index.js';

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
 * @returns ConfigEndpointResult with status, headers, and body
 */
export function handleConfigRequest(method: string, body: string = ''): ConfigEndpointResult {
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
    const config = getClientConfig();
    console.log(`⚙️ Config GET - returning:`, JSON.stringify(config));
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
      console.log(`⚙️ Config POST - saving:`, JSON.stringify(newConfig));
      setClientConfig(newConfig);
      const responseBody = JSON.stringify({ success: true, config: getClientConfig() });
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
    console.log(`⚙️ Config DELETE - resetting`);
    resetClientConfig();
    const responseBody = JSON.stringify({ success: true, config: getClientConfig() });
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
