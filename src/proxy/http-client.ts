/**
 * HTTP Request Utilities
 *
 * Shared HTTP/HTTPS request functions for proxy implementations. Both the
 * SOCKS5 path (via `makeHttpsRequest` / `makeHttpRequest`) and the direct
 * HTTP proxy (via `processProxiedResponse`) consume the helpers here so that
 * plugin hooks, decompression, transformation, and JSON logging behave
 * identically on both stacks (T12).
 */

import { request as httpRequest, type IncomingMessage, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getConfig, getEffectiveConfigForRequestAsync } from '../config/index.js';
import type { DomainProfile } from '../config/domain-rules.js';
import { markAsRedirect, isRedirectStatus } from '../cache/index.js';
import {
  dispatchBinaryTransform,
  hasTextTransformerFor,
  type TransformDispatchContext,
} from '../transformers/registry.js';
import {
  recordTransform,
  recordBandwidth,
  recordHostTransform,
} from '../metrics/index.js';
import { getCharset } from './charset.js';
import { getContentType } from './content-type.js';
import { decompressBody } from './compression.js';
import { transformContent } from './transform-pipeline.js';
import { SPOOFED_USER_AGENT } from './user-agent.js';
import type { ContentType, HttpResponse, RequestHeaders } from './types.js';
import {
  shouldLogJsonRequest,
  logJsonRequest,
} from '../logger/json-request-logger.js';
import {
  applyPreRequestHooks,
  applyPostResponseHooks,
  buildRequestContext,
  buildResponseContext,
  newRequestId,
  type PreRequestOutcome,
  type PostResponseOutcome,
} from './proxy-hooks.js';

/**
 * Raw HTTP response captured from upstream before any processing. Returned
 * by `requestWithBody` and consumed by `processProxiedResponse`.
 */
export interface RawProxyResponse {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Inputs for `processProxiedResponse`. The fields here are the bits both
 * proxy stacks have at the point an upstream response arrives: the raw
 * body, the upstream headers, and the request-side context needed to make
 * caching, JSON logging, and plugin-hook decisions.
 */
export interface ProcessProxiedResponseInput {
  rawBody: Buffer;
  upstreamHeaders: IncomingHttpHeaders;
  upstreamStatusCode: number;
  upstreamStatusMessage: string;
  url: string;
  method: string;
  clientIp?: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
  requestBody?: Buffer;
  /**
   * Whether to invoke `response:post` plugin hooks. The HTTP proxy passes
   * the request context separately (it builds richer pre-hook state); the
   * SOCKS5 path runs hooks directly here.
   */
  runPostResponseHook?: boolean;
  /**
   * Pre-built request context for `response:post` hooks. Only consulted
   * when `runPostResponseHook` is `true`.
   */
  requestContext?: import('../plugins/hooks.js').RequestContext;
  /**
   * Matched domain profile, threaded from the request entry point
   * (http-proxy `prepareRequest` / socks5 `handleHttpRequestSocks5`) so the
   * transform pipeline never has to re-fetch it.
   */
  profile?: DomainProfile | null;
}

/**
 * Processed proxied response after decompression, transformation, and
 * (optionally) `response:post` plugin hooks. Callers send these bytes to
 * the client; compression and CORS are layered on top by the caller.
 */
export interface ProcessedProxyResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** Detected content type after transformation. */
  contentType: ContentType;
  /** Body size before transformation (for bandwidth/metrics). */
  originalSize: number;
}

/**
 * Internal helper: decompress + (optionally) transform an upstream response,
 * then return normalised headers/body. Shared by both proxy stacks (T12).
 */
export async function processProxiedResponse(
  input: ProcessProxiedResponseInput
): Promise<ProcessedProxyResponse> {
  const {
    rawBody,
    upstreamHeaders,
    upstreamStatusCode,
    upstreamStatusMessage,
    url,
    method,
    clientIp,
    requestHeaders,
    requestBody,
    runPostResponseHook,
    requestContext,
    profile,
  } = input;

  // Decompress upstream body if encoded.
  const encoding = upstreamHeaders['content-encoding'];
  const encodingStr = Array.isArray(encoding) ? encoding[0] : encoding;
  let body: Buffer = await decompressBody(rawBody, encodingStr);
  const wasDecompressed = body !== rawBody;

  const headers: Record<string, string | string[] | undefined> = { ...upstreamHeaders };
  if (wasDecompressed) {
    delete headers['content-encoding'];
  }

  const isRedirect = isRedirectStatus(upstreamStatusCode);
  if (isRedirect) {
    markAsRedirect(url);
  }

  const rawContentType = upstreamHeaders['content-type'] || '';
  const contentTypeValue = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;

  // JSON request logging — must observe pre-transform body so cached
  // payloads aren't corrupted by the legacy-browser rewrites.
  if (clientIp && requestHeaders && shouldLogJsonRequest(headers)) {
    void logJsonRequest(
      clientIp,
      url,
      requestHeaders,
      headers,
      body,
      requestBody
    );
  }

  let detectedContentType: ContentType = 'other';
  const originalSize = body.length;

  if (!isRedirect && body.length > 0) {
    // Registry dispatch context shared by both lanes. The coarse content
    // type is computed once here (it is a pure function of headers + URL);
    // `detectedContentType` is only committed on the text path below, as
    // before.
    const coarseContentType = getContentType(
      upstreamHeaders as Record<string, string | string[] | undefined>,
      url
    );
    const dispatchContext: TransformDispatchContext = {
      url,
      contentType: coarseContentType,
      rawContentType: contentTypeValue,
      config: getConfig(),
      profile: profile ?? null,
      clientIp,
    };

    // Binary lane first (built-in: WebP/AVIF → JPEG image transform). When
    // a binary transformer matches, the text pipeline is skipped — exactly
    // the old `needsImageTransform` if/else.
    const binaryResult = await dispatchBinaryTransform(body, dispatchContext);
    if (binaryResult) {
      if (binaryResult.transformed) {
        body = Buffer.from(binaryResult.data);
        headers['content-type'] = binaryResult.contentType;
        recordTransform('images');
        recordHostTransform(url, 'images');
      }
    } else {
      const charset = getCharset(contentTypeValue);
      detectedContentType = coarseContentType;

      // Text pipeline gate: js/css/html always enter; coarse-'other'
      // (JSON APIs etc.) only when a registered text transformer wants it
      // (plugins matching on rawContentType). Built-ins never match
      // 'other', so the short-circuit keeps the no-plugin path free of any
      // decode/cache work — byte-identical to the old `!== 'other'` skip.
      if (detectedContentType !== 'other' || hasTextTransformerFor(dispatchContext)) {
        body = Buffer.from(await transformContent(
          body,
          detectedContentType,
          url,
          charset,
          undefined,
          clientIp,
          method,
          requestHeaders,
          upstreamHeaders as Record<string, string | string[] | undefined>,
          profile ?? null
        ));
        if (detectedContentType !== 'other') {
          // Metrics only track the built-in lanes (js/css/html/images);
          // plugin-transformed 'other' content is not counted.
          recordTransform(detectedContentType);
          recordHostTransform(url, detectedContentType);
        }

        // The pipeline re-encodes its output as UTF-8, so advertise that
        // (for 'other' this only happens when a transformer matched).
        const ct = headers['content-type'];
        if (ct) {
          const ctStr = Array.isArray(ct) ? ct[0] : ct;
          headers['content-type'] = ctStr.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
        }
      }
    }
  }

  let finalStatus = upstreamStatusCode;

  // Run response:post hooks when the caller opted in. The HTTP proxy
  // path drives hooks itself; the SOCKS5 path delegates to us so plugins
  // run on both stacks.
  if (runPostResponseHook && requestContext) {
    const responseContext = buildResponseContext({
      requestContext,
      statusCode: finalStatus,
      responseHeaders: headers,
      body,
      contentType: detectedContentType,
      originalSize,
    });
    const hookOutcome: PostResponseOutcome = await applyPostResponseHooks(responseContext);
    body = hookOutcome.body;
    Object.assign(headers, hookOutcome.headers);
    finalStatus = hookOutcome.statusCode;
  }

  recordBandwidth(rawBody.length, body.length);

  return {
    statusCode: finalStatus,
    statusMessage: upstreamStatusMessage,
    headers,
    body,
    contentType: detectedContentType,
    originalSize,
  };
}

/**
 * Thrown when the upstream response body exceeds the configured
 * `maxResponseBodyBytes`. Callers translate this into a `502 Bad Gateway`
 * client response (P1-3).
 */
export class ResponseBodyTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Response body exceeds max (${limitBytes} bytes)`);
    this.name = 'ResponseBodyTooLargeError';
  }
}

/** Default cap on upstream response body size when config doesn't specify. */
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 50 * 1024 * 1024;

/**
 * Buffer a Node `IncomingMessage` to a single `Buffer`, resolving when the
 * stream ends.
 *
 * P1-3: previously concatenated every chunk with no cap — a malicious or
 * mis-configured upstream serving 1 GB would OOM the iPad-class host. We
 * now enforce `maxResponseBodyBytes` (default 50 MB, separately tunable from
 * the request-side limit so a host that legitimately receives big PDFs but
 * never accepts big uploads can lift one without the other).
 */
function readResponseBody(res: IncomingMessage): Promise<Buffer> {
  const maxBytes = getConfig().maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new ResponseBodyTooLargeError(maxBytes);
        // Destroy the upstream stream so we stop pulling bytes we'll never
        // use; without this Node keeps buffering until `end`.
        res.destroy(err);
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

/**
 * Options for `requestWithBody`. Mirrors the subset of Node `RequestOptions`
 * that both proxy paths actually populate, plus the `secure` flag picking
 * between `http:` and `https:`.
 */
export interface RequestWithBodyOptions {
  hostname: string;
  port: number | string;
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  rejectUnauthorized?: boolean;
  secure: boolean;
}

/**
 * Issue a single HTTP/HTTPS request against an upstream host and return
 * the raw response (status + headers + buffered body) as a Promise. T17
 * uses this to replace nested `request(...callback)` callbacks with a
 * linear `await` flow inside `proxyRequest`.
 */
export function requestWithBody(
  options: RequestWithBodyOptions,
  body: Buffer | null
): Promise<RawProxyResponse> {
  const { secure, ...rest } = options;
  const fn = secure ? httpsRequest : httpRequest;

  return new Promise<RawProxyResponse>((resolve, reject) => {
    const req = fn(rest, (res) => {
      readResponseBody(res)
        .then((rawBody) => {
          resolve({
            statusCode: res.statusCode || 200,
            statusMessage: res.statusMessage || 'OK',
            headers: res.headers,
            body: rawBody,
          });
        })
        .catch(reject);
    });

    req.on('error', reject);

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Run `request:pre` hooks for a SOCKS5-style request. Returns the outcome
 * so the caller can decide whether to short-circuit (blocked) or continue
 * with possibly-rewritten URL / headers.
 */
export async function runPreHooksForSocksRequest(
  url: string,
  method: string,
  hostname: string,
  headers: Record<string, string | string[] | undefined>,
  clientIp: string,
  isHttps: boolean
): Promise<{ outcome: PreRequestOutcome; requestContext: import('../plugins/hooks.js').RequestContext }> {
  const { config, profile } = await getEffectiveConfigForRequestAsync(hostname, clientIp);
  const requestContext = buildRequestContext({
    url,
    method,
    headers,
    clientIp,
    hostname,
    config,
    profile,
    isHttps,
    requestId: newRequestId(),
    startTime: Date.now(),
  });
  const outcome = await applyPreRequestHooks(requestContext);
  return { outcome, requestContext };
}

/**
 * Make an HTTPS request to a remote server with transformation support.
 *
 * Plugin hooks: `request:pre` and `response:post` fire on the SOCKS5 path
 * via this helper (T12). Pass `clientIp` to opt into hooks; without it we
 * skip hook execution to keep direct-call test cases simple.
 *
 * @param profile - Matched domain profile, threaded from the SOCKS5 entry
 *   point so the transform pipeline doesn't re-fetch it. When omitted, the
 *   profile already resolved by the `request:pre` hook context is reused
 *   (no extra lookup); direct callers without hooks get `null`.
 */
export async function makeHttpsRequest(
  method: string,
  hostname: string,
  path: string,
  headers: RequestHeaders,
  body: Buffer,
  clientIp?: string,
  profile?: DomainProfile | null
): Promise<HttpResponse> {
  const config = getConfig();

  // Note: User-Agent spoofing is applied AFTER `request:pre` hooks have run
  // (Round 1 review fix). Reading `config.spoofUserAgent` from the global
  // singleton here would ignore per-domain / plugin-overridden values that
  // `config:resolution` injects into the per-request config.
  const requestHeaders: Record<string, string | string[] | undefined> = { ...headers };

  // Strip cache validation headers for JS/CSS files to ensure we always get
  // the full response body for transformation. Without this, the server may
  // return 304 Not Modified and the browser uses its cached (untransformed) version.
  const pathLower = path.toLowerCase();
  if (pathLower.includes('/js/') || pathLower.includes('/_/js/') ||
      pathLower.endsWith('.js') || pathLower.endsWith('.css') ||
      pathLower.includes('/css/') || pathLower.includes('/_/css/')) {
    delete requestHeaders['if-none-match'];
    delete requestHeaders['if-modified-since'];
  }

  // Remove Origin header to prevent upstream CORS issues.
  delete requestHeaders['origin'];

  let url = `https://${hostname}${path}`;
  let effectiveHeaders = requestHeaders;
  let requestContext: import('../plugins/hooks.js').RequestContext | undefined;

  if (clientIp) {
    const pre = await runPreHooksForSocksRequest(
      url,
      method,
      hostname,
      requestHeaders,
      clientIp,
      true
    );
    requestContext = pre.requestContext;

    if (pre.outcome.blocked) {
      const blocked = pre.outcome.blockedResponse;
      const blockedBody = Buffer.from(blocked?.body ?? '', 'utf-8');
      return {
        statusCode: blocked?.statusCode ?? 204,
        statusMessage: 'No Content',
        headers: (blocked?.headers ?? {}) as Record<string, string | string[] | undefined>,
        body: blockedBody,
      };
    }

    url = pre.outcome.url;
    effectiveHeaders = pre.outcome.headers;
  }

  // Apply UA spoof using the per-request resolved config (post-hooks). When
  // `clientIp` is supplied, `request:pre` ran and `config:resolution` may
  // have flipped `spoofUserAgent`; the per-request config in
  // `requestContext.config` reflects those overrides. Without a clientIp
  // there are no hooks, so fall back to global config.
  const effectiveSpoofConfig = requestContext
    ? requestContext.config
    : config;
  if (effectiveSpoofConfig.spoofUserAgent && effectiveHeaders['user-agent']) {
    // Mutate `effectiveHeaders` rather than allocating a new object so the
    // hook outcome's reference remains the canonical headers map.
    effectiveHeaders['user-agent'] = SPOOFED_USER_AGENT;
  }

  const raw = await requestWithBody(
    {
      hostname,
      port: 443,
      path,
      method,
      headers: {
        ...effectiveHeaders,
        // Don't request brotli — simpler to handle gzip/deflate.
        'accept-encoding': 'gzip, deflate',
      },
      rejectUnauthorized: config.allowInsecureUpstream !== true,
      secure: true,
    },
    body
  );

  const processed = await processProxiedResponse({
    rawBody: raw.body,
    upstreamHeaders: raw.headers,
    upstreamStatusCode: raw.statusCode,
    upstreamStatusMessage: raw.statusMessage,
    url,
    method,
    clientIp,
    requestHeaders: effectiveHeaders,
    requestBody: body,
    runPostResponseHook: !!requestContext,
    requestContext,
    profile: profile !== undefined ? profile : (requestContext?.profile ?? null),
  });

  return {
    statusCode: processed.statusCode,
    statusMessage: processed.statusMessage,
    headers: processed.headers,
    body: processed.body,
  };
}

/**
 * Make an HTTP request to a remote server with transformation support.
 *
 * Mirrors `makeHttpsRequest` for plugin-hook semantics on the SOCKS5 path
 * (including the threaded `profile` parameter).
 */
export async function makeHttpRequest(
  method: string,
  hostname: string,
  port: number,
  path: string,
  headers: RequestHeaders,
  body: Buffer,
  clientIp?: string,
  profile?: DomainProfile | null
): Promise<HttpResponse> {
  const requestHeaders: Record<string, string | string[] | undefined> = { ...headers };

  const pathLower = path.toLowerCase();
  if (pathLower.includes('/js/') || pathLower.includes('/_/js/') ||
      pathLower.endsWith('.js') || pathLower.endsWith('.css') ||
      pathLower.includes('/css/') || pathLower.includes('/_/css/')) {
    delete requestHeaders['if-none-match'];
    delete requestHeaders['if-modified-since'];
  }

  delete requestHeaders['origin'];

  let url = `http://${hostname}${path}`;
  let effectiveHeaders = requestHeaders;
  let requestContext: import('../plugins/hooks.js').RequestContext | undefined;

  if (clientIp) {
    const pre = await runPreHooksForSocksRequest(
      url,
      method,
      hostname,
      requestHeaders,
      clientIp,
      false
    );
    requestContext = pre.requestContext;

    if (pre.outcome.blocked) {
      const blocked = pre.outcome.blockedResponse;
      const blockedBody = Buffer.from(blocked?.body ?? '', 'utf-8');
      return {
        statusCode: blocked?.statusCode ?? 204,
        statusMessage: 'No Content',
        headers: (blocked?.headers ?? {}) as Record<string, string | string[] | undefined>,
        body: blockedBody,
      };
    }

    url = pre.outcome.url;
    effectiveHeaders = pre.outcome.headers;
  }

  // Round 1 review fix: apply UA spoof on the SOCKS5 HTTP path too. Was
  // missing entirely — `makeHttpsRequest` had it but cleartext HTTP requests
  // through SOCKS5 left the client UA intact. Read `spoofUserAgent` from the
  // per-request resolved config so plugin overrides via `config:resolution`
  // apply.
  const effectiveSpoofConfig = requestContext
    ? requestContext.config
    : getConfig();
  if (effectiveSpoofConfig.spoofUserAgent && effectiveHeaders['user-agent']) {
    effectiveHeaders['user-agent'] = SPOOFED_USER_AGENT;
  }

  const raw = await requestWithBody(
    {
      hostname,
      port,
      path,
      method,
      headers: {
        ...effectiveHeaders,
        'accept-encoding': 'gzip, deflate',
      },
      secure: false,
    },
    body
  );

  const processed = await processProxiedResponse({
    rawBody: raw.body,
    upstreamHeaders: raw.headers,
    upstreamStatusCode: raw.statusCode,
    upstreamStatusMessage: raw.statusMessage,
    url,
    method,
    clientIp,
    requestHeaders: effectiveHeaders,
    requestBody: body,
    runPostResponseHook: !!requestContext,
    requestContext,
    profile: profile !== undefined ? profile : (requestContext?.profile ?? null),
  });

  return {
    statusCode: processed.statusCode,
    statusMessage: processed.statusMessage,
    headers: processed.headers,
    body: processed.body,
  };
}
