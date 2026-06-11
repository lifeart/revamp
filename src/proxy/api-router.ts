/**
 * Revamp API Router
 *
 * Small dependency-free router used for all /__revamp__/* endpoints.
 * Both proxy stacks (HTTP proxy and SOCKS5) normalize their requests into an
 * {@link ApiRequest} and dispatch through a single shared router instance
 * (see proxy/revamp-api), so endpoint routing is defined exactly once.
 *
 * Pattern syntax (designed around the routes that exist today — nothing more):
 * - Literal segments match exactly. A trailing `/` in a pattern is a literal
 *   empty segment, so `/x` and `/x/` are distinct patterns (today's endpoints
 *   explicitly allow both forms where applicable, so both get registered).
 * - `:name` matches exactly one non-empty path segment (no `/`), captured
 *   into `req.params[name]` (raw, not URL-decoded — handlers decode where
 *   today's code decodes).
 * - A final `*` segment matches the non-empty remainder of the path
 *   (may contain `/`), captured into `req.params['*']`.
 *
 * Dispatch: first registered route whose method AND pattern match wins.
 * - A route's method is either a concrete uppercase method (`GET`, `POST`,
 *   ...) or `'*'` (any method). Modules register their concrete-method
 *   routes first and then a `'*'` route on the same pattern as that
 *   pattern's fallback — this is how each module preserves its historical
 *   method-not-allowed response shape. Method-agnostic endpoints (metrics,
 *   PAC files) register with `'*'` directly.
 * - If nothing matches, the router-level fallback handler runs (the Revamp
 *   API uses this for its "API listing" response); without a fallback a
 *   plain JSON 404 is returned.
 *
 * Error handling: dispatch intentionally does NOT catch handler errors —
 * each module owns its error mapping (exactly as before the router existed),
 * and unexpected errors keep propagating to the stack adapters.
 *
 * @module proxy/api-router
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Normalized API request — the single handler signature both proxy stacks
 * can provide (the HTTP stack from IncomingMessage, the SOCKS5 stack from
 * its hand-parsed raw HTTP request).
 */
export interface ApiRequest {
  /** HTTP method (uppercase, e.g. 'GET') */
  method: string;
  /** URL pathname only — query string already stripped */
  path: string;
  /** Parsed query parameters (first occurrence wins, like URLSearchParams.get) */
  query: Record<string, string>;
  /** Request headers (lowercased keys; may be empty for stacks that don't forward them) */
  headers: Record<string, string>;
  /** Request body as UTF-8 string ('' when absent) */
  body: string;
  /** Client IP for per-client config (optional) */
  clientIp?: string;
  /** Pattern captures: one entry per `:name` segment, plus `'*'` for a wildcard rest */
  params: Record<string, string>;
}

/** Normalized API response, written back by each stack's thin adapter. */
export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Route handler — receives the normalized request, returns the response. */
export type ApiHandler = (req: ApiRequest) => ApiResponse | Promise<ApiResponse>;

/** Request shape passed into dispatch (params are filled in by the router). */
export type ApiRequestInit = Omit<ApiRequest, 'params'>;

// =============================================================================
// Pattern Compilation
// =============================================================================

interface CompiledPattern {
  /** Pattern segments (literals and ':name' params), excluding a trailing '*' */
  segments: string[];
  /** Whether the pattern ends with a '/*' wildcard segment */
  wildcard: boolean;
}

function compilePattern(pattern: string): CompiledPattern {
  if (!pattern.startsWith('/')) {
    throw new Error(`API route pattern must start with '/': ${pattern}`);
  }

  const segments = pattern.split('/');
  const wildcard = segments[segments.length - 1] === '*';
  if (wildcard) {
    segments.pop();
  }

  // '*' is only supported as the final segment; ':' params must be named.
  for (const segment of segments) {
    if (segment === '*') {
      throw new Error(`'*' is only allowed as the final segment: ${pattern}`);
    }
    if (segment.startsWith(':') && segment.length === 1) {
      throw new Error(`Param segment must have a name: ${pattern}`);
    }
  }

  return { segments, wildcard };
}

/**
 * Match a compiled pattern against a pathname.
 *
 * @returns captured params on match, or null
 */
function matchPattern(compiled: CompiledPattern, path: string): Record<string, string> | null {
  const pathSegments = path.split('/');
  const { segments, wildcard } = compiled;

  if (wildcard) {
    // Wildcard needs at least one extra segment; the rest must be non-empty
    // (empty-rest forms like '/x/' are registered explicitly where today's
    // endpoints allow them).
    if (pathSegments.length < segments.length + 1) return null;
  } else if (pathSegments.length !== segments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < segments.length; i++) {
    const patternSegment = segments[i];
    const pathSegment = pathSegments[i];

    if (patternSegment.startsWith(':')) {
      if (pathSegment === '') return null;
      params[patternSegment.slice(1)] = pathSegment;
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }

  if (wildcard) {
    const rest = pathSegments.slice(segments.length).join('/');
    if (rest === '') return null;
    params['*'] = rest;
  }

  return params;
}

// =============================================================================
// Query Parsing
// =============================================================================

/**
 * Parse a query string into a Record. First occurrence of a key wins,
 * matching the `URLSearchParams.get` semantics the previous hand-rolled
 * handlers relied on.
 *
 * @param search - Query string without the leading '?'
 */
export function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!search) return query;

  for (const [key, value] of new URLSearchParams(search)) {
    if (query[key] === undefined) {
      query[key] = value;
    }
  }

  return query;
}

// =============================================================================
// Router
// =============================================================================

interface RegisteredRoute {
  method: string;
  pattern: string;
  compiled: CompiledPattern;
  handler: ApiHandler;
}

export class ApiRouter {
  private readonly routes: RegisteredRoute[] = [];
  private fallback: ApiHandler | null = null;

  /**
   * Register a route. Routes are matched in registration order, so register
   * concrete-method routes before a pattern's '*' fallback, and specific
   * patterns before overlapping wildcard patterns.
   *
   * @param method - Uppercase HTTP method, or '*' for any method
   * @param pattern - Path pattern (see module docs for syntax)
   * @param handler - Handler invoked on match
   */
  register(method: string, pattern: string, handler: ApiHandler): void {
    this.routes.push({
      method,
      pattern,
      compiled: compilePattern(pattern),
      handler,
    });
  }

  /**
   * Set the handler invoked when no route matches at all.
   * The Revamp API uses this for its historical "API listing" response.
   */
  setFallback(handler: ApiHandler): void {
    this.fallback = handler;
  }

  /**
   * Dispatch a normalized request to the first matching route
   * (registration order); then the fallback (or a JSON 404).
   */
  async dispatch(request: ApiRequestInit): Promise<ApiResponse> {
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== request.method) continue;

      const params = matchPattern(route.compiled, request.path);
      if (params) {
        return route.handler({ ...request, params });
      }
    }

    if (this.fallback) {
      return this.fallback({ ...request, params: {} });
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not Found' }),
    };
  }
}
