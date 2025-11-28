/**
 * Revamp API Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  REVAMP_API_BASE,
  ENDPOINTS,
  isRevampEndpoint,
  handleRevampRequest,
  buildRawApiResponse,
  type ApiResult,
} from './revamp-api.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { resetMetrics } from '../metrics/index.js';

describe('REVAMP_API_BASE', () => {
  it('should be /__revamp__', () => {
    expect(REVAMP_API_BASE).toBe('/__revamp__');
  });
});

describe('ENDPOINTS', () => {
  it('should have config endpoint', () => {
    expect(ENDPOINTS.config).toBe('/__revamp__/config');
  });

  it('should have metrics endpoint', () => {
    expect(ENDPOINTS.metrics).toBe('/__revamp__/metrics');
  });

  it('should have metricsJson endpoint', () => {
    expect(ENDPOINTS.metricsJson).toBe('/__revamp__/metrics/json');
  });

  it('should have metricsDashboard endpoint', () => {
    expect(ENDPOINTS.metricsDashboard).toBe('/__revamp__/metrics/dashboard');
  });

  it('should have PAC endpoints', () => {
    expect(ENDPOINTS.pacSocks5).toBe('/__revamp__/pac/socks5');
    expect(ENDPOINTS.pacHttp).toBe('/__revamp__/pac/http');
    expect(ENDPOINTS.pacCombined).toBe('/__revamp__/pac/combined');
  });
});

describe('isRevampEndpoint', () => {
  it('should return true for revamp API paths', () => {
    expect(isRevampEndpoint('/__revamp__/config')).toBe(true);
    expect(isRevampEndpoint('/__revamp__/metrics')).toBe(true);
    expect(isRevampEndpoint('/__revamp__/pac/socks5')).toBe(true);
    expect(isRevampEndpoint('/__revamp__/anything')).toBe(true);
  });

  it('should return false for non-revamp paths', () => {
    expect(isRevampEndpoint('/api/v1/config')).toBe(false);
    expect(isRevampEndpoint('/metrics')).toBe(false);
    expect(isRevampEndpoint('/')).toBe(false);
    expect(isRevampEndpoint('/revamp')).toBe(false);
  });
});

describe('handleRevampRequest', () => {
  beforeEach(() => {
    resetConfig();
    resetMetrics();
  });

  afterEach(() => {
    resetConfig();
    resetMetrics();
  });

  describe('OPTIONS requests (CORS preflight)', () => {
    it('should return 204 for OPTIONS on any endpoint', () => {
      const result = handleRevampRequest('/__revamp__/config', 'OPTIONS');
      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
    });

    it('should include CORS headers', () => {
      const result = handleRevampRequest('/__revamp__/config', 'OPTIONS');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Access-Control-Allow-Methods']).toBeDefined();
      expect(result.headers['Access-Control-Allow-Headers']).toBeDefined();
    });
  });

  describe('config endpoint', () => {
    it('should handle GET request', () => {
      const result = handleRevampRequest('/__revamp__/config', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toContain('application/json');
      const parsed = JSON.parse(result.body);
      expect(parsed).toHaveProperty('success');
      expect(parsed).toHaveProperty('config');
      expect(parsed.config).toHaveProperty('transformJs');
    });

    it('should handle POST request with valid JSON', () => {
      const result = handleRevampRequest('/__revamp__/config', 'POST', '{"transformJs": false}');
      expect(result.statusCode).toBe(200);
    });

    it('should handle DELETE request', () => {
      const result = handleRevampRequest('/__revamp__/config', 'DELETE');
      expect(result.statusCode).toBe(200);
    });
  });

  describe('metrics JSON endpoint', () => {
    it('should return JSON metrics at /metrics/json', () => {
      const result = handleRevampRequest('/__revamp__/metrics/json', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(result.body);
      expect(parsed).toHaveProperty('uptime');
      expect(parsed).toHaveProperty('requests');
    });

    it('should return JSON metrics with trailing slash', () => {
      const result = handleRevampRequest('/__revamp__/metrics/json/', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should include no-store cache header', () => {
      const result = handleRevampRequest('/__revamp__/metrics/json', 'GET');
      expect(result.headers['Cache-Control']).toBe('no-store');
    });
  });

  describe('metrics dashboard endpoint', () => {
    it('should return HTML at /metrics', () => {
      const result = handleRevampRequest('/__revamp__/metrics', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toContain('text/html');
      expect(result.body).toContain('<!DOCTYPE html>');
    });

    it('should return HTML with trailing slash', () => {
      const result = handleRevampRequest('/__revamp__/metrics/', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toContain('text/html');
    });

    it('should return HTML at /metrics/dashboard', () => {
      const result = handleRevampRequest('/__revamp__/metrics/dashboard', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toContain('text/html');
    });

    it('should return HTML at /metrics/dashboard/', () => {
      const result = handleRevampRequest('/__revamp__/metrics/dashboard/', 'GET');
      expect(result.statusCode).toBe(200);
    });
  });

  describe('PAC file endpoints', () => {
    it('should return SOCKS5 PAC file', () => {
      const result = handleRevampRequest('/__revamp__/pac/socks5', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/x-ns-proxy-autoconfig');
      expect(result.headers['Content-Disposition']).toContain('revamp-socks5.pac');
      expect(result.body).toContain('FindProxyForURL');
    });

    it('should return SOCKS5 PAC file with trailing slash', () => {
      const result = handleRevampRequest('/__revamp__/pac/socks5/', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('FindProxyForURL');
    });

    it('should return HTTP PAC file', () => {
      const result = handleRevampRequest('/__revamp__/pac/http', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/x-ns-proxy-autoconfig');
      expect(result.headers['Content-Disposition']).toContain('revamp-http.pac');
      expect(result.body).toContain('FindProxyForURL');
    });

    it('should return HTTP PAC file with trailing slash', () => {
      const result = handleRevampRequest('/__revamp__/pac/http/', 'GET');
      expect(result.statusCode).toBe(200);
    });

    it('should return combined PAC file', () => {
      const result = handleRevampRequest('/__revamp__/pac/combined', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/x-ns-proxy-autoconfig');
      expect(result.headers['Content-Disposition']).toContain('revamp-combined.pac');
      expect(result.body).toContain('FindProxyForURL');
    });

    it('should return combined PAC file with trailing slash', () => {
      const result = handleRevampRequest('/__revamp__/pac/combined/', 'GET');
      expect(result.statusCode).toBe(200);
    });
  });

  describe('unknown endpoint', () => {
    it('should return API info for unknown paths', () => {
      const result = handleRevampRequest('/__revamp__/unknown', 'GET');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(result.body);
      expect(parsed.name).toBe('Revamp API');
      expect(parsed.endpoints).toBeDefined();
    });

    it('should list available endpoints in response', () => {
      const result = handleRevampRequest('/__revamp__/', 'GET');
      const parsed = JSON.parse(result.body);
      expect(parsed.endpoints.config).toBeDefined();
      expect(parsed.endpoints.metrics).toBeDefined();
      expect(parsed.endpoints.pac).toBeDefined();
    });
  });
});

describe('buildRawApiResponse', () => {
  it('should build HTTP/1.1 response', () => {
    const result: ApiResult = {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Hello',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 200 OK');
  });

  it('should include all headers', () => {
    const result: ApiResult = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom': 'value',
      },
      body: '{}',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('Content-Type: application/json');
    expect(raw).toContain('X-Custom: value');
  });

  it('should include Content-Length header', () => {
    const result: ApiResult = {
      statusCode: 200,
      headers: {},
      body: 'Hello World',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('Content-Length: 11');
  });

  it('should include Connection: close header', () => {
    const result: ApiResult = {
      statusCode: 200,
      headers: {},
      body: '',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('Connection: close');
  });

  it('should include body after double CRLF', () => {
    const result: ApiResult = {
      statusCode: 200,
      headers: {},
      body: 'Test body',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('\r\n\r\nTest body');
  });

  it('should handle 204 No Content', () => {
    const result: ApiResult = {
      statusCode: 204,
      headers: {},
      body: '',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 204 No Content');
  });

  it('should handle 400 Bad Request', () => {
    const result: ApiResult = {
      statusCode: 400,
      headers: {},
      body: 'Bad Request',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 400 Bad Request');
  });

  it('should handle 404 Not Found', () => {
    const result: ApiResult = {
      statusCode: 404,
      headers: {},
      body: 'Not Found',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 404 Not Found');
  });

  it('should handle 405 Method Not Allowed', () => {
    const result: ApiResult = {
      statusCode: 405,
      headers: {},
      body: 'Method Not Allowed',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 405 Method Not Allowed');
  });

  it('should default to OK for unknown status codes', () => {
    const result: ApiResult = {
      statusCode: 201,
      headers: {},
      body: 'Created',
    };
    const raw = buildRawApiResponse(result);
    expect(raw).toContain('HTTP/1.1 201 OK');
  });
});
