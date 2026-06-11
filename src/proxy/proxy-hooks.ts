/**
 * Proxy Hook Helpers
 *
 * Shared plugin-hook plumbing used by both the HTTP proxy (`http-proxy.ts`)
 * and the SOCKS5 path (`http-client.ts` / `socks5.ts`). Centralising the
 * `request:pre` / `response:post` invocation here is required for T12: prior
 * to this module the SOCKS5 path silently bypassed both hooks, so plugins
 * that worked on HTTP requests went dark when an iPad was using SOCKS5.
 *
 * @module proxy/proxy-hooks
 */

import type { RevampConfig } from '../config/index.js';
import { log } from '../logger/log.js';
import type { DomainProfile } from '../config/domain-rules.js';
import type {
  RequestContext,
  ResponseContext,
  PreRequestResult,
  PostResponseResult,
} from '../plugins/hooks.js';
import type { ContentType } from './types.js';
import {
  runPreRequestHooks,
  runPostResponseHooks,
  type ChainExecutionResult,
} from '../plugins/hook-executor.js';
import { sanitizeForLog } from '../logger/sanitize.js';

/**
 * Surface plugin hook failures (thrown errors / timeouts captured by the
 * hook executor's fail-safe chain) as structured warnings. Purely
 * observational — control flow and the chain result are untouched.
 */
function logHookChainErrors(
  context: { requestId: string; url: string },
  result: ChainExecutionResult<unknown> | null
): void {
  if (!result || result.errors.length === 0) {
    return;
  }
  for (const failure of result.errors) {
    // Constant format string; tainted values (plugin id from a third-party
    // manifest, request URL, error message) are sanitized arguments.
    log.warn(
      '[proxy-hooks] plugin hook failed (chain continued): plugin=%s hook=%s timedOut=%s requestId=%s url=%s error=%s',
      sanitizeForLog(failure.pluginId),
      failure.hookName,
      failure.timedOut,
      sanitizeForLog(context.requestId),
      sanitizeForLog(context.url),
      sanitizeForLog(failure.error.message)
    );
  }
}

/**
 * Inputs needed to build a `RequestContext`.
 */
export interface BuildRequestContextInput {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  clientIp: string;
  hostname: string;
  config: RevampConfig;
  profile: DomainProfile | null;
  isHttps: boolean;
  /** Caller-supplied request id; pass through so logs across stacks correlate. */
  requestId: string;
  /** Caller-supplied request start timestamp (ms). */
  startTime: number;
}

/**
 * Build a `RequestContext` from the proxied request inputs. Both HTTP and
 * SOCKS5 paths use this so `pluginData` (a fresh `Map`) and other invariants
 * stay consistent.
 */
export function buildRequestContext(
  input: BuildRequestContextInput
): RequestContext {
  return {
    requestId: input.requestId,
    url: input.url,
    method: input.method,
    headers: { ...input.headers },
    clientIp: input.clientIp,
    hostname: input.hostname,
    config: input.config,
    profile: input.profile,
    isHttps: input.isHttps,
    startTime: input.startTime,
    pluginData: new Map(),
  };
}

/**
 * Result of running `request:pre` hooks against a request context.
 *
 * Mirrors the shape consumed by both HTTP and SOCKS5 proxies so each path
 * can apply the same set of modifications before issuing the upstream
 * request.
 */
export interface PreRequestOutcome {
  /** Updated URL (unchanged when no plugin modifies it). */
  url: string;
  /** Updated headers (mutated in place from the input headers). */
  headers: Record<string, string | string[] | undefined>;
  /** Whether a plugin asked to block the request. */
  blocked: boolean;
  /** Custom blocked response payload, if the blocking plugin supplied one. */
  blockedResponse?: PreRequestResult['blockedResponse'];
  /** Plugin that stopped the chain (if any). */
  stoppedBy?: string;
  /** Underlying chain execution result; `null` when no hooks are registered. */
  chainResult: ChainExecutionResult<PreRequestResult> | null;
}

/**
 * Run the `request:pre` hook chain and return a normalised outcome ready
 * for both HTTP and SOCKS5 callers to consume.
 */
export async function applyPreRequestHooks(
  context: RequestContext
): Promise<PreRequestOutcome> {
  const result = await runPreRequestHooks(context);
  logHookChainErrors(context, result);
  const headers = { ...context.headers };
  let url = context.url;
  let blocked = false;
  let blockedResponse: PreRequestResult['blockedResponse'] | undefined;

  if (result) {
    if (result.value.blocked) {
      blocked = true;
      blockedResponse = result.value.blockedResponse;
    }
    if (result.value.url) {
      url = result.value.url;
    }
    if (result.value.headers) {
      Object.assign(headers, result.value.headers);
    }
  }

  return {
    url,
    headers,
    blocked,
    blockedResponse,
    stoppedBy: result?.stoppedBy,
    chainResult: result,
  };
}

/**
 * Inputs for building a `ResponseContext`.
 */
export interface BuildResponseContextInput {
  requestContext: RequestContext;
  statusCode: number;
  responseHeaders: Record<string, string | string[] | undefined>;
  body: Buffer;
  contentType: ContentType;
  originalSize: number;
}

/**
 * Build a `ResponseContext` from the request context plus upstream response
 * data. Centralised so the HTTP and SOCKS5 paths produce identical context
 * shapes.
 */
export function buildResponseContext(
  input: BuildResponseContextInput
): ResponseContext {
  return {
    ...input.requestContext,
    statusCode: input.statusCode,
    responseHeaders: { ...input.responseHeaders },
    body: input.body,
    contentType: input.contentType,
    originalSize: input.originalSize,
    duration: Date.now() - input.requestContext.startTime,
  };
}

/**
 * Outcome of `response:post` hook execution. Each field reflects the merged
 * value across all plugins; callers apply them before sending the response.
 */
export interface PostResponseOutcome {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  chainResult: ChainExecutionResult<PostResponseResult> | null;
}

/**
 * Run the `response:post` hook chain. Returns the final body/headers/status
 * with any plugin modifications applied.
 */
export async function applyPostResponseHooks(
  context: ResponseContext
): Promise<PostResponseOutcome> {
  const result = await runPostResponseHooks(context);
  logHookChainErrors(context, result);
  let body = context.body;
  let headers = { ...context.responseHeaders };
  let statusCode = context.statusCode;

  if (result) {
    if (result.value.body) {
      body = result.value.body;
    }
    if (result.value.headers) {
      headers = { ...headers, ...result.value.headers };
    }
    if (result.value.statusCode !== undefined) {
      statusCode = result.value.statusCode;
    }
  }

  return { body, headers, statusCode, chainResult: result };
}

/**
 * Generate a unique request id for correlating logs across hook executions.
 */
export function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
