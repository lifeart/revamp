/**
 * API Router Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ApiRouter,
  parseQuery,
  type ApiRequest,
  type ApiResponse,
} from './api-router.js';

function makeRequest(overrides: Partial<Omit<ApiRequest, 'params'>> = {}): Omit<ApiRequest, 'params'> {
  return {
    method: 'GET',
    path: '/__revamp__/test',
    query: {},
    headers: {},
    body: '',
    clientIp: undefined,
    ...overrides,
  };
}

function ok(body: string): ApiResponse {
  return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body };
}

describe('ApiRouter', () => {
  describe('registration and dispatch', () => {
    it('dispatches an exact path + method match', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/test', () => ok('hit'));

      const result = await router.dispatch(makeRequest());
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('hit');
    });

    it('supports async handlers', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/test', async () => ok('async-hit'));

      const result = await router.dispatch(makeRequest());
      expect(result.body).toBe('async-hit');
    });

    it('treats a trailing slash as a distinct pattern', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/test', () => ok('no-slash'));
      router.register('GET', '/__revamp__/test/', () => ok('slash'));

      expect((await router.dispatch(makeRequest({ path: '/__revamp__/test' }))).body).toBe('no-slash');
      expect((await router.dispatch(makeRequest({ path: '/__revamp__/test/' }))).body).toBe('slash');
    });

    it('matches routes in registration order', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/a/specific', () => ok('specific'));
      router.register('GET', '/__revamp__/a/*', () => ok('wildcard'));

      expect((await router.dispatch(makeRequest({ path: '/__revamp__/a/specific' }))).body).toBe('specific');
      expect((await router.dispatch(makeRequest({ path: '/__revamp__/a/other' }))).body).toBe('wildcard');
    });

    it('rejects patterns that do not start with /', () => {
      const router = new ApiRouter();
      expect(() => router.register('GET', 'no-slash', () => ok(''))).toThrow(/must start with/);
    });

    it("rejects '*' in a non-final segment", () => {
      const router = new ApiRouter();
      expect(() => router.register('GET', '/a/*/b', () => ok(''))).toThrow(/final segment/);
    });
  });

  describe('method matching', () => {
    it('does not match a route registered for a different method', async () => {
      const router = new ApiRouter();
      router.register('POST', '/__revamp__/test', () => ok('post'));

      const result = await router.dispatch(makeRequest({ method: 'GET' }));
      expect(result.statusCode).toBe(404);
    });

    it("uses a '*' route as the pattern's method fallback (405 stays module-shaped)", async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/test', () => ok('get'));
      router.register('*', '/__revamp__/test', () => ({
        statusCode: 405,
        headers: { 'Content-Type': 'application/json', 'Allow': 'GET' },
        body: JSON.stringify({ error: 'Method not allowed. Use GET.' }),
      }));

      const getResult = await router.dispatch(makeRequest({ method: 'GET' }));
      expect(getResult.body).toBe('get');

      const postResult = await router.dispatch(makeRequest({ method: 'POST' }));
      expect(postResult.statusCode).toBe(405);
      expect(postResult.headers['Allow']).toBe('GET');
      expect(JSON.parse(postResult.body).error).toBe('Method not allowed. Use GET.');
    });

    it("matches '*' routes for any method", async () => {
      const router = new ApiRouter();
      router.register('*', '/__revamp__/test', () => ok('any'));

      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        const result = await router.dispatch(makeRequest({ method }));
        expect(result.body).toBe('any');
      }
    });
  });

  describe('param segments', () => {
    it('captures a :name segment into params', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/plugins/:id', (req) => ok(`id=${req.params.id}`));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/plugins/my-plugin' }));
      expect(result.body).toBe('id=my-plugin');
    });

    it('supports params followed by literal segments', async () => {
      const router = new ApiRouter();
      router.register('POST', '/__revamp__/plugins/:id/activate', (req) => ok(`activate:${req.params.id}`));

      const result = await router.dispatch(
        makeRequest({ method: 'POST', path: '/__revamp__/plugins/foo/activate' })
      );
      expect(result.body).toBe('activate:foo');
    });

    it('does not match an empty segment', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/plugins/:id', () => ok('matched'));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/plugins/' }));
      expect(result.statusCode).toBe(404);
    });

    it('does not match across slashes', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/plugins/:id', () => ok('matched'));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/plugins/a/b' }));
      expect(result.statusCode).toBe(404);
    });

    it('captures the raw (non-decoded) segment', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/plugins/:id', (req) => ok(req.params.id));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/plugins/a%2Fb' }));
      expect(result.body).toBe('a%2Fb');
    });
  });

  describe('wildcard segments', () => {
    it('captures the rest of the path including slashes', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/admin/*', (req) => ok(req.params['*']));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/admin/css/style.css' }));
      expect(result.body).toBe('css/style.css');
    });

    it('requires a non-empty rest', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/admin/*', () => ok('matched'));

      expect((await router.dispatch(makeRequest({ path: '/__revamp__/admin/' }))).statusCode).toBe(404);
      expect((await router.dispatch(makeRequest({ path: '/__revamp__/admin' }))).statusCode).toBe(404);
    });

    it('combines :param and wildcard segments', async () => {
      const router = new ApiRouter();
      router.register('*', '/__revamp__/plugins/:id/*', (req) =>
        ok(`${req.params.id}:${req.params['*']}`)
      );

      const result = await router.dispatch(
        makeRequest({ method: 'POST', path: '/__revamp__/plugins/foo/custom/deep' })
      );
      expect(result.body).toBe('foo:custom/deep');
    });
  });

  describe('fallback and 404 behavior', () => {
    it('returns a JSON 404 when nothing matches and no fallback is set', async () => {
      const router = new ApiRouter();

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/nope' }));
      expect(result.statusCode).toBe(404);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(result.body)).toEqual({ error: 'Not Found' });
    });

    it('invokes the fallback when nothing matches', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/known', () => ok('known'));
      router.setFallback((req) => ok(`fallback:${req.path}`));

      const result = await router.dispatch(makeRequest({ path: '/__revamp__/unknown' }));
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('fallback:/__revamp__/unknown');
    });
  });

  describe('request passthrough', () => {
    it('hands query, headers, body and clientIp through to the handler', async () => {
      const router = new ApiRouter();
      let seen: ApiRequest | null = null;
      router.register('POST', '/__revamp__/echo', (req) => {
        seen = req;
        return ok('');
      });

      await router.dispatch(makeRequest({
        method: 'POST',
        path: '/__revamp__/echo',
        query: { a: '1' },
        headers: { 'content-type': 'application/json' },
        body: '{"x":true}',
        clientIp: '10.0.0.1',
      }));

      expect(seen).not.toBeNull();
      expect(seen!.query).toEqual({ a: '1' });
      expect(seen!.headers['content-type']).toBe('application/json');
      expect(seen!.body).toBe('{"x":true}');
      expect(seen!.clientIp).toBe('10.0.0.1');
    });

    it('propagates handler errors (modules own their error mapping)', async () => {
      const router = new ApiRouter();
      router.register('GET', '/__revamp__/boom', () => {
        throw new Error('handler exploded');
      });

      await expect(router.dispatch(makeRequest({ path: '/__revamp__/boom' }))).rejects.toThrow('handler exploded');
    });
  });
});

describe('parseQuery', () => {
  it('parses simple key=value pairs', () => {
    expect(parseQuery('a=1&b=two')).toEqual({ a: '1', b: 'two' });
  });

  it('returns an empty record for an empty string', () => {
    expect(parseQuery('')).toEqual({});
  });

  it('URL-decodes keys and values', () => {
    expect(parseQuery('url=https%3A%2F%2Fexample.com%2Fsw.js')).toEqual({
      url: 'https://example.com/sw.js',
    });
  });

  it('keeps the first occurrence of a duplicated key (URLSearchParams.get semantics)', () => {
    expect(parseQuery('a=first&a=second')).toEqual({ a: 'first' });
  });

  it('maps a bare key to an empty string', () => {
    expect(parseQuery('flag')).toEqual({ flag: '' });
  });
});
