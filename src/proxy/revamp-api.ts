/**
 * Revamp API Endpoint Handler
 *
 * Handles all /__revamp__/* API endpoints:
 * - /__revamp__/config - Proxy configuration
 * - /__revamp__/metrics - JSON metrics
 * - /__revamp__/metrics/dashboard - HTML metrics dashboard
 * - /__revamp__/pac/socks5 - SOCKS5 PAC file
 * - /__revamp__/pac/http - HTTP PAC file
 * - /__revamp__/pac/combined - Combined PAC file
 * - /__revamp__/sw/bundle - Service Worker bundling endpoint (URL-based)
 * - /__revamp__/sw/inline - Service Worker inline transformation (code-based)
 */

import { handleConfigRequest, CONFIG_ENDPOINT, type ConfigEndpointResult } from './config-endpoint.js';
import { generateDashboardHtml, generateMetricsJson } from '../metrics/dashboard.js';
import { generateSocks5Pac, generateHttpPac, generateCombinedPac } from '../pac/generator.js';
import { bundleServiceWorker, transformInlineServiceWorker } from '../transformers/sw-bundler.js';

/** Base path for all Revamp API endpoints */
export const REVAMP_API_BASE = '/__revamp__';

/** API endpoint paths */
export const ENDPOINTS = {
  config: `${REVAMP_API_BASE}/config`,
  metrics: `${REVAMP_API_BASE}/metrics`,
  metricsJson: `${REVAMP_API_BASE}/metrics/json`,
  metricsDashboard: `${REVAMP_API_BASE}/metrics/dashboard`,
  pacSocks5: `${REVAMP_API_BASE}/pac/socks5`,
  pacHttp: `${REVAMP_API_BASE}/pac/http`,
  pacCombined: `${REVAMP_API_BASE}/pac/combined`,
  swBundle: `${REVAMP_API_BASE}/sw/bundle`,
  swInline: `${REVAMP_API_BASE}/sw/inline`,
} as const;

/**
 * API response result
 */
export interface ApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Standard CORS headers */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Check if a path is a Revamp API endpoint
 */
export function isRevampEndpoint(path: string): boolean {
  return path.startsWith(REVAMP_API_BASE);
}

/**
 * Handle a Revamp API request
 * @param path - API path
 * @param method - HTTP method
 * @param body - Request body
 * @param clientIp - Optional client IP for per-client config
 */
export async function handleRevampRequest(path: string, method: string, body: string = '', clientIp?: string): Promise<ApiResult> {
  // Handle CORS preflight for all endpoints
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'Content-Length': '0',
      },
      body: '',
    };
  }

  // Service Worker inline transformation endpoint (POST)
  if (path.startsWith(ENDPOINTS.swInline)) {
    return handleSwInlineRequest(method, body);
  }

  // Service Worker bundle endpoint
  if (path.startsWith(ENDPOINTS.swBundle)) {
    return handleSwBundleRequest(path, method);
  }

  // Config endpoint
  if (path.startsWith(ENDPOINTS.config)) {
    return handleConfigRequest(method, body, clientIp);
  }

  // Metrics JSON endpoint
  if (path === ENDPOINTS.metricsJson || path === `${ENDPOINTS.metricsJson}/`) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: generateMetricsJson(),
    };
  }

  // Metrics Dashboard endpoint (or just /metrics)
  if (path === ENDPOINTS.metrics ||
      path === `${ENDPOINTS.metrics}/` ||
      path === ENDPOINTS.metricsDashboard ||
      path === `${ENDPOINTS.metricsDashboard}/`) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: generateDashboardHtml(),
    };
  }

  // PAC file endpoints
  if (path === ENDPOINTS.pacSocks5 || path === `${ENDPOINTS.pacSocks5}/`) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/x-ns-proxy-autoconfig',
        'Content-Disposition': 'attachment; filename="revamp-socks5.pac"',
      },
      body: generateSocks5Pac(),
    };
  }

  if (path === ENDPOINTS.pacHttp || path === `${ENDPOINTS.pacHttp}/`) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/x-ns-proxy-autoconfig',
        'Content-Disposition': 'attachment; filename="revamp-http.pac"',
      },
      body: generateHttpPac(),
    };
  }

  if (path === ENDPOINTS.pacCombined || path === `${ENDPOINTS.pacCombined}/`) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/x-ns-proxy-autoconfig',
        'Content-Disposition': 'attachment; filename="revamp-combined.pac"',
      },
      body: generateCombinedPac(),
    };
  }

  // Unknown endpoint - return list of available endpoints
  return {
    statusCode: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Revamp API',
      endpoints: {
        config: ENDPOINTS.config,
        metrics: {
          dashboard: ENDPOINTS.metrics,
          json: ENDPOINTS.metricsJson,
        },
        pac: {
          socks5: ENDPOINTS.pacSocks5,
          http: ENDPOINTS.pacHttp,
          combined: ENDPOINTS.pacCombined,
        },
        sw: {
          bundle: ENDPOINTS.swBundle,
          inline: ENDPOINTS.swInline,
        },
      },
    }, null, 2),
  };
}

/**
 * Handle Service Worker bundle requests
 * URL format: /__revamp__/sw/bundle?url=<encoded-sw-url>&scope=<encoded-scope>
 */
async function handleSwBundleRequest(path: string, method: string): Promise<ApiResult> {
  if (method !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Allow': 'GET',
      },
      body: JSON.stringify({ error: 'Method not allowed. Use GET.' }),
    };
  }

  // Parse query parameters from path
  const queryStart = path.indexOf('?');
  if (queryStart === -1) {
    return {
      statusCode: 400,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Missing required parameter: url',
        usage: `${ENDPOINTS.swBundle}?url=<encoded-sw-url>&scope=<encoded-scope>`,
      }),
    };
  }

  const queryString = path.slice(queryStart + 1);
  const params = new URLSearchParams(queryString);
  const swUrl = params.get('url');
  const scope = params.get('scope') || '/';

  if (!swUrl) {
    return {
      statusCode: 400,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Missing required parameter: url',
        usage: `${ENDPOINTS.swBundle}?url=<encoded-sw-url>&scope=<encoded-scope>`,
      }),
    };
  }

  console.log(`📦 SW Bundle request: ${swUrl} (scope: ${scope})`);

  try {
    const result = await bundleServiceWorker(swUrl, scope);

    if (result.success) {
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-Revamp-SW-Original': swUrl,
          'X-Revamp-SW-Scope': scope,
          // Service Worker specific header
          'Service-Worker-Allowed': scope,
        },
        body: result.code,
      };
    } else {
      console.warn(`⚠️ SW bundling failed for ${swUrl}: ${result.error}`);
      // Still return the fallback code with 200 to allow SW registration
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Revamp-SW-Original': swUrl,
          'X-Revamp-SW-Error': result.error || 'Unknown error',
          'Service-Worker-Allowed': scope,
        },
        body: result.code,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ SW bundle error: ${message}`);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Service Worker bundling failed',
        details: message,
        originalUrl: swUrl,
      }),
    };
  }
}

/**
 * Build a raw HTTP response string from ApiResult
 * Used by SOCKS5 proxy which sends raw HTTP responses
 */
export function buildRawApiResponse(result: ApiResult): string {
  const statusMessages: Record<number, string> = {
    200: 'OK',
    204: 'No Content',
    400: 'Bad Request',
    404: 'Not Found',
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
 * Handle inline Service Worker transformation requests
 * POST body format: { code: string, scope?: string }
 */
async function handleSwInlineRequest(method: string, body: string): Promise<ApiResult> {
  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Allow': 'POST',
      },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
    };
  }

  if (!body || body.trim() === '') {
    return {
      statusCode: 400,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Missing request body',
        usage: 'POST with JSON body: { "code": "<sw-code>", "scope": "/" }',
      }),
    };
  }

  let code: string;
  let scope: string = '/';

  try {
    const parsed = JSON.parse(body);
    code = parsed.code;
    scope = parsed.scope || '/';

    if (!code || typeof code !== 'string') {
      return {
        statusCode: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Missing or invalid "code" field',
          usage: 'POST with JSON body: { "code": "<sw-code>", "scope": "/" }',
        }),
      };
    }
  } catch {
    return {
      statusCode: 400,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Invalid JSON body',
        usage: 'POST with JSON body: { "code": "<sw-code>", "scope": "/" }',
      }),
    };
  }

  console.log(`📦 SW Inline transform request: ${code.length} bytes (scope: ${scope})`);

  try {
    const result = await transformInlineServiceWorker(code, scope);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Revamp-SW-Type': 'inline',
        'X-Revamp-SW-Scope': scope,
        'Service-Worker-Allowed': scope,
      },
      body: result.code,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ SW inline transform error: ${message}`);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Service Worker transformation failed',
        details: message,
      }),
    };
  }
}
