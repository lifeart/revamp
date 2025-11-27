import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CONFIG_ENDPOINT,
  handleConfigRequest,
  buildRawHttpResponse,
  isConfigEndpoint,
  type ConfigEndpointResult,
} from './config-endpoint.js';

// Mock the config module
vi.mock('../config/index.js', () => {
  let clientConfig = {
    transformJs: true,
    transformCss: true,
    transformHtml: true,
    removeAds: true,
    removeTracking: true,
  };

  return {
    getClientConfig: vi.fn(() => ({ ...clientConfig })),
    setClientConfig: vi.fn((newConfig: Record<string, unknown>) => {
      clientConfig = { ...clientConfig, ...newConfig };
    }),
    resetClientConfig: vi.fn(() => {
      clientConfig = {
        transformJs: true,
        transformCss: true,
        transformHtml: true,
        removeAds: true,
        removeTracking: true,
      };
    }),
  };
});

describe('CONFIG_ENDPOINT', () => {
  it('should be the correct path', () => {
    expect(CONFIG_ENDPOINT).toBe('/__revamp__/config');
  });
});

describe('isConfigEndpoint', () => {
  it('should match exact config endpoint path', () => {
    expect(isConfigEndpoint('/__revamp__/config')).toBe(true);
  });

  it('should match config endpoint with trailing slash', () => {
    expect(isConfigEndpoint('/__revamp__/config/')).toBe(true);
  });

  it('should match config endpoint with query string', () => {
    expect(isConfigEndpoint('/__revamp__/config?foo=bar')).toBe(true);
  });

  it('should not match other paths', () => {
    expect(isConfigEndpoint('/')).toBe(false);
    expect(isConfigEndpoint('/api/config')).toBe(false);
    expect(isConfigEndpoint('/__revamp__')).toBe(false);
    expect(isConfigEndpoint('/other/__revamp__/config')).toBe(false);
  });
});

describe('handleConfigRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OPTIONS request (CORS preflight)', () => {
    it('should return 204 with CORS headers', () => {
      const result = handleConfigRequest('OPTIONS');
      
      expect(result.statusCode).toBe(204);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(result.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(result.headers['Access-Control-Allow-Methods']).toContain('DELETE');
      expect(result.body).toBe('');
    });
  });

  describe('GET request', () => {
    it('should return current config', () => {
      const result = handleConfigRequest('GET');
      
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.config).toBeDefined();
    });

    it('should have cache-control headers to prevent caching', () => {
      const result = handleConfigRequest('GET');
      
      expect(result.headers['Cache-Control']).toContain('no-store');
      expect(result.headers['Cache-Control']).toContain('no-cache');
    });
  });

  describe('POST request', () => {
    it('should update config with valid JSON', () => {
      const newConfig = JSON.stringify({ transformJs: false });
      const result = handleConfigRequest('POST', newConfig);
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
    });

    it('should return 400 for invalid JSON', () => {
      const result = handleConfigRequest('POST', 'not valid json');
      
      expect(result.statusCode).toBe(400);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid JSON');
    });
  });

  describe('DELETE request', () => {
    it('should reset config and return 200', () => {
      const result = handleConfigRequest('DELETE');
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.config).toBeDefined();
    });
  });

  describe('Unsupported methods', () => {
    it('should return 405 for PUT', () => {
      const result = handleConfigRequest('PUT');
      
      expect(result.statusCode).toBe(405);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Method not allowed');
    });

    it('should return 405 for PATCH', () => {
      const result = handleConfigRequest('PATCH');
      
      expect(result.statusCode).toBe(405);
    });
  });
});

describe('buildRawHttpResponse', () => {
  it('should build correct HTTP/1.1 response for 200 OK', () => {
    const result: ConfigEndpointResult = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"success":true}',
    };
    
    const response = buildRawHttpResponse(result);
    
    expect(response).toContain('HTTP/1.1 200 OK\r\n');
    expect(response).toContain('Content-Type: application/json\r\n');
    expect(response).toContain('Content-Length: 16\r\n');
    expect(response).toContain('Connection: close\r\n');
    expect(response).toContain('\r\n\r\n');
    expect(response).toContain('{"success":true}');
  });

  it('should build correct response for 204 No Content', () => {
    const result: ConfigEndpointResult = {
      statusCode: 204,
      headers: {},
      body: '',
    };
    
    const response = buildRawHttpResponse(result);
    
    expect(response).toContain('HTTP/1.1 204 No Content\r\n');
  });

  it('should build correct response for 400 Bad Request', () => {
    const result: ConfigEndpointResult = {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: '{"error":"bad"}',
    };
    
    const response = buildRawHttpResponse(result);
    
    expect(response).toContain('HTTP/1.1 400 Bad Request\r\n');
  });

  it('should build correct response for 405 Method Not Allowed', () => {
    const result: ConfigEndpointResult = {
      statusCode: 405,
      headers: {},
      body: '{"error":"not allowed"}',
    };
    
    const response = buildRawHttpResponse(result);
    
    expect(response).toContain('HTTP/1.1 405 Method Not Allowed\r\n');
  });

  it('should handle unknown status codes with OK', () => {
    const result: ConfigEndpointResult = {
      statusCode: 599,
      headers: {},
      body: '',
    };
    
    const response = buildRawHttpResponse(result);
    
    expect(response).toContain('HTTP/1.1 599 OK\r\n');
  });

  it('should correctly calculate Content-Length for UTF-8 body', () => {
    const result: ConfigEndpointResult = {
      statusCode: 200,
      headers: {},
      body: '{"message":"Привет"}', // Cyrillic characters
    };
    
    const response = buildRawHttpResponse(result);
    const bodyByteLength = Buffer.byteLength(result.body);
    
    expect(response).toContain(`Content-Length: ${bodyByteLength}\r\n`);
  });
});
