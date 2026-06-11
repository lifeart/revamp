import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSE_HEADERS,
  SKIP_RESPONSE_HEADERS,
  buildCorsHeaders,
  buildCorsPreflightResponse,
  buildCorsHeadersString,
  removeCorsHeaders,
  resolveCorsAllowOrigin,
  buildScopedCorsHeaders,
  buildScopedCorsHeadersString,
  buildScopedCorsPreflightResponse,
  filterResponseHeaders,
} from './cors.js';

describe('CORS Constants', () => {
  it('should have correct allowed methods', () => {
    expect(CORS_ALLOWED_METHODS).toContain('GET');
    expect(CORS_ALLOWED_METHODS).toContain('POST');
    expect(CORS_ALLOWED_METHODS).toContain('PUT');
    expect(CORS_ALLOWED_METHODS).toContain('DELETE');
    expect(CORS_ALLOWED_METHODS).toContain('OPTIONS');
    expect(CORS_ALLOWED_METHODS).toContain('HEAD');
    expect(CORS_ALLOWED_METHODS).toContain('PATCH');
  });

  it('should have common headers in allowed headers', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('Content-Type');
    expect(CORS_ALLOWED_HEADERS).toContain('Authorization');
    expect(CORS_ALLOWED_HEADERS).toContain('X-Requested-With');
  });

  it('should expose common response headers', () => {
    expect(CORS_EXPOSE_HEADERS).toContain('Content-Type');
    expect(CORS_EXPOSE_HEADERS).toContain('Content-Length');
    expect(CORS_EXPOSE_HEADERS).toContain('Cache-Control');
  });
});

describe('SKIP_RESPONSE_HEADERS', () => {
  it('should skip hop-by-hop headers', () => {
    expect(SKIP_RESPONSE_HEADERS.has('transfer-encoding')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('connection')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('keep-alive')).toBe(true);
  });

  it('should skip CORS headers (we replace them)', () => {
    expect(SKIP_RESPONSE_HEADERS.has('access-control-allow-origin')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('access-control-allow-methods')).toBe(true);
  });

  it('should skip CSP headers', () => {
    expect(SKIP_RESPONSE_HEADERS.has('content-security-policy')).toBe(true);
    expect(SKIP_RESPONSE_HEADERS.has('x-content-security-policy')).toBe(true);
  });
});

describe('buildCorsHeaders', () => {
  it('should return CORS headers with default origin', () => {
    const headers = buildCorsHeaders();

    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(headers['access-control-allow-methods']).toBe(CORS_ALLOWED_METHODS);
    expect(headers['access-control-allow-headers']).toBe(CORS_ALLOWED_HEADERS);
    expect(headers['access-control-expose-headers']).toBe(CORS_EXPOSE_HEADERS);
  });

  it('should use custom origin', () => {
    const headers = buildCorsHeaders('https://example.com');

    expect(headers['access-control-allow-origin']).toBe('https://example.com');
  });
});

describe('buildCorsPreflightResponse', () => {
  it('should build a 204 No Content response', () => {
    const response = buildCorsPreflightResponse();

    expect(response).toContain('HTTP/1.1 204 No Content\r\n');
    expect(response).toContain('Access-Control-Allow-Origin: *\r\n');
    expect(response).toContain('Access-Control-Max-Age: 86400\r\n');
    expect(response).toContain('Content-Length: 0\r\n');
    expect(response).toContain('\r\n\r\n');
  });

  it('should use custom origin', () => {
    const response = buildCorsPreflightResponse('https://example.com');

    expect(response).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
  });
});

describe('buildCorsHeadersString', () => {
  it('should build CORS headers as string', () => {
    const headers = buildCorsHeadersString();

    expect(headers).toContain('Access-Control-Allow-Origin: *\r\n');
    expect(headers).toContain('Access-Control-Allow-Credentials: true\r\n');
    expect(headers).toContain(`Access-Control-Allow-Methods: ${CORS_ALLOWED_METHODS}\r\n`);
  });
});

describe('removeCorsHeaders', () => {
  it('should remove all CORS headers from object', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'access-control-allow-origin': 'https://example.com',
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'Content-Type',
      'access-control-expose-headers': 'X-Custom',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400',
    };

    removeCorsHeaders(headers);

    expect(headers['content-type']).toBe('text/html');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['access-control-allow-headers']).toBeUndefined();
    expect(headers['access-control-expose-headers']).toBeUndefined();
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(headers['access-control-max-age']).toBeUndefined();
  });
});

describe('resolveCorsAllowOrigin (T9)', () => {
  it('returns null when profile is null (default off)', () => {
    expect(resolveCorsAllowOrigin(null, 'https://example.com')).toBeNull();
  });

  it('returns null when profile lacks corsAllowOrigins', () => {
    expect(resolveCorsAllowOrigin({}, 'https://example.com')).toBeNull();
  });

  it('returns null when corsAllowOrigins is empty', () => {
    expect(resolveCorsAllowOrigin({ corsAllowOrigins: [] }, 'https://example.com')).toBeNull();
  });

  it('returns origin when explicitly listed', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['https://example.com'] },
        'https://example.com'
      )
    ).toBe('https://example.com');
  });

  it('returns null when origin is not in allow list', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['https://allowed.example'] },
        'https://attacker.example'
      )
    ).toBeNull();
  });

  it('reflects request origin when allow list contains "*"', () => {
    expect(
      resolveCorsAllowOrigin(
        { corsAllowOrigins: ['*'] },
        'https://anything.example'
      )
    ).toBe('https://anything.example');
  });

  it('returns "*" when allow list contains "*" and request has no origin', () => {
    expect(resolveCorsAllowOrigin({ corsAllowOrigins: ['*'] }, undefined)).toBe('*');
  });

  it('returns null when no request origin and allow list does not include "*"', () => {
    expect(
      resolveCorsAllowOrigin({ corsAllowOrigins: ['https://example.com'] }, undefined)
    ).toBeNull();
  });
});

describe('buildScopedCorsHeaders (T9)', () => {
  it('returns empty object by default (profile null)', () => {
    expect(buildScopedCorsHeaders(null, 'https://example.com')).toEqual({});
  });

  it('returns empty object when corsAllowOrigins is absent', () => {
    expect(buildScopedCorsHeaders({}, 'https://example.com')).toEqual({});
  });

  it('emits ACAO when origin matches profile allow list', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headers['access-control-allow-origin']).toBe('https://example.com');
    expect(headers['access-control-allow-methods']).toBe(CORS_ALLOWED_METHODS);
    expect(headers['access-control-allow-headers']).toBe(CORS_ALLOWED_HEADERS);
    expect(headers['access-control-expose-headers']).toBe(CORS_EXPOSE_HEADERS);
  });

  it('does not emit headers when origin does not match', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://attacker.example'
    );
    expect(headers).toEqual({});
  });

  it('does not emit credentials unless explicitly opted in', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('emits credentials only when corsAllowCredentials is true', () => {
    const headers = buildScopedCorsHeaders(
      {
        corsAllowOrigins: ['https://example.com'],
        corsAllowCredentials: true,
      },
      'https://example.com'
    );
    expect(headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('buildScopedCorsHeadersString (T9)', () => {
  it('returns empty string by default', () => {
    expect(buildScopedCorsHeadersString(null, 'https://example.com')).toBe('');
  });

  it('emits headers when origin matches', () => {
    const headersStr = buildScopedCorsHeadersString(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(headersStr).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
    expect(headersStr).not.toContain('Access-Control-Allow-Credentials');
  });

  it('opts in credentials when configured', () => {
    const headersStr = buildScopedCorsHeadersString(
      {
        corsAllowOrigins: ['https://example.com'],
        corsAllowCredentials: true,
      },
      'https://example.com'
    );
    expect(headersStr).toContain('Access-Control-Allow-Credentials: true\r\n');
  });
});

describe('buildScopedCorsPreflightResponse (T9)', () => {
  it('returns null when profile has not opted in', () => {
    expect(buildScopedCorsPreflightResponse(null, 'https://example.com')).toBeNull();
  });

  it('returns 204 preflight when origin matches', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(response).not.toBeNull();
    expect(response).toContain('HTTP/1.1 204 No Content\r\n');
    expect(response).toContain('Access-Control-Allow-Origin: https://example.com\r\n');
    expect(response).toContain('Access-Control-Max-Age: 86400\r\n');
  });

  it('omits credentials in preflight unless explicitly opted in', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['https://example.com'] },
      'https://example.com'
    );
    expect(response).not.toContain('Access-Control-Allow-Credentials');
  });
});

describe('CORS wildcard + credentials misconfig collapses to OFF (T9 P1-G1)', () => {
  const originalWarn = console.warn;
  let warnCalls: unknown[][] = [];

  beforeEach(() => {
    warnCalls = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('resolveCorsAllowOrigin returns null when "*" + credentials and warns', () => {
    const result = resolveCorsAllowOrigin(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(result).toBeNull();
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0]?.[0]).toContain('[cors]');
  });

  it('resolveCorsAllowOrigin still returns null on misconfig when no request origin', () => {
    const result = resolveCorsAllowOrigin(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      undefined
    );
    expect(result).toBeNull();
  });

  it('buildScopedCorsHeaders emits NO Access-Control-Allow-* headers under misconfig', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(headers).toEqual({});
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['access-control-allow-headers']).toBeUndefined();
    expect(headers['access-control-expose-headers']).toBeUndefined();
  });

  it('buildScopedCorsHeadersString emits NO Access-Control-Allow-* under misconfig', () => {
    const result = buildScopedCorsHeadersString(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(result).toBe('');
    expect(result).not.toContain('Access-Control-Allow-Origin');
    expect(result).not.toContain('Access-Control-Allow-Credentials');
    expect(result).not.toContain('Access-Control-Allow-Methods');
    expect(result).not.toContain('Access-Control-Allow-Headers');
  });

  it('buildScopedCorsPreflightResponse returns null under misconfig (no permissive preflight)', () => {
    const response = buildScopedCorsPreflightResponse(
      { corsAllowOrigins: ['*'], corsAllowCredentials: true },
      'https://attacker.example'
    );
    expect(response).toBeNull();
  });

  it('still works correctly when "*" is used without credentials', () => {
    const headers = buildScopedCorsHeaders(
      { corsAllowOrigins: ['*'], corsAllowCredentials: false },
      'https://anything.example'
    );
    expect(headers['access-control-allow-origin']).toBe('https://anything.example');
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(warnCalls.length).toBe(0);
  });

  it('still works correctly with explicit origin + credentials (no wildcard)', () => {
    const headers = buildScopedCorsHeaders(
      {
        corsAllowOrigins: ['https://app.example.com'],
        corsAllowCredentials: true,
      },
      'https://app.example.com'
    );
    expect(headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(warnCalls.length).toBe(0);
  });
});

describe('filterResponseHeaders', () => {
  it('should filter out skip headers', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'transfer-encoding': 'chunked',
      'content-encoding': 'gzip',
      'connection': 'keep-alive',
      'x-custom': 'value',
    };

    const filtered = filterResponseHeaders(headers);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-custom']).toBe('value');
    expect(filtered['transfer-encoding']).toBeUndefined();
    expect(filtered['content-encoding']).toBeUndefined();
    expect(filtered['connection']).toBeUndefined();
  });

  it('should normalize header names to lowercase', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'Content-Type': 'text/html',
      'X-Custom-Header': 'value',
    };

    const filtered = filterResponseHeaders(headers);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-custom-header']).toBe('value');
  });

  it('should use custom skip set', () => {
    const customSkip = new Set(['x-skip-me']);
    const headers: Record<string, string | string[] | undefined> = {
      'content-type': 'text/html',
      'x-skip-me': 'should be skipped',
      'x-keep-me': 'should be kept',
    };

    const filtered = filterResponseHeaders(headers, customSkip);

    expect(filtered['content-type']).toBe('text/html');
    expect(filtered['x-keep-me']).toBe('should be kept');
    expect(filtered['x-skip-me']).toBeUndefined();
  });
});
