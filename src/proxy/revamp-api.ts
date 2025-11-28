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
 */

import { handleConfigRequest, CONFIG_ENDPOINT, type ConfigEndpointResult } from './config-endpoint.js';
import { generateDashboardHtml, generateMetricsJson } from '../metrics/dashboard.js';
import { generateSocks5Pac, generateHttpPac, generateCombinedPac } from '../pac/generator.js';

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
export function handleRevampRequest(path: string, method: string, body: string = '', clientIp?: string): ApiResult {
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
      },
    }, null, 2),
  };
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
