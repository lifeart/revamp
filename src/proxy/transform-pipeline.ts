/**
 * Content Transform Pipeline
 *
 * Orchestrates the response-body transformation flow shared by both proxy
 * stacks: binary safety check → cache lookup → charset decode →
 * `transform:pre` plugin hooks → transformer-registry dispatch →
 * `transform:post` plugin hooks → cache store.
 *
 * Decompression/compression are layered by the callers (`http-client`'s
 * `processProxiedResponse` and the proxy servers); this module owns only
 * the text transformation orchestration.
 *
 * @module proxy/transform-pipeline
 */

import { getConfig, type RevampConfig } from '../config/index.js';
import { log } from '../logger/log.js';
import type { DomainProfile } from '../config/domain-rules.js';
import { getCached, setCache } from '../cache/index.js';
import { recordCacheHit } from '../metrics/index.js';
import type { ContentType } from './types.js';
import { isBinaryContent } from './content-type.js';
import { decodeBufferToString } from './charset.js';
import {
  dispatchTextTransform,
  hasTextTransformerFor,
  type TransformDispatchContext,
} from '../transformers/registry.js';
import {
  runPreTransformHooks,
  runPostTransformHooks,
} from '../plugins/hook-executor.js';
import type { TransformContext as PluginTransformContext } from '../plugins/hooks.js';

/**
 * Transform content (JS, CSS, HTML) based on type and config
 * @param body - The content body to transform
 * @param contentType - The type of content (js, css, html, other)
 * @param url - The URL of the content
 * @param charset - The charset to use for decoding (defaults to 'utf-8')
 * @param config - Optional config override
 * @param clientIp - Optional client IP for per-client cache separation
 * @param method - HTTP method (folded into cache key so non-GET requests
 *   never share a bucket with a GET response)
 * @param requestHeaders - Original request headers; Cookie/Authorization names
 *   are folded into the cache key to prevent NAT'd cross-user data leaks
 * @param responseHeaders - Upstream response headers; used to skip caching
 *   when origin marks the response Set-Cookie / no-store / private
 * @param profile - Matched domain profile, threaded from the request entry
 *   point (http-proxy `prepareRequest` / socks5 `handleHttpRequestSocks5`).
 *   The pipeline never re-fetches it; callers that genuinely have none
 *   (direct unit-test invocations) leave it null.
 */
export async function transformContent(
  body: Buffer,
  contentType: ContentType,
  url: string,
  charset: string = 'utf-8',
  config?: RevampConfig,
  clientIp?: string,
  method: string = 'GET',
  requestHeaders?: Record<string, string | string[] | undefined>,
  responseHeaders?: Record<string, string | string[] | undefined>,
  profile: DomainProfile | null = null
): Promise<Buffer> {
  const effectiveConfig = config || getConfig();

  // Registry dispatch context: consulted by the 'other' gate below and by
  // `dispatchTextTransform` further down.
  const dispatchContext: TransformDispatchContext = {
    url,
    contentType,
    rawContentType: extractRawContentType(responseHeaders),
    config: effectiveConfig,
    profile,
    clientIp,
  };

  // Coarse-'other' content (JSON APIs, XML feeds, ...) only enters the text
  // pipeline when a registered text transformer wants it (plugins matching
  // on rawContentType). Built-ins never match 'other', so without such a
  // plugin this returns before any cache lookup or charset decode — the
  // old switch's `default` branch, byte-identical and just as cheap.
  if (contentType === 'other' && !hasTextTransformerFor(dispatchContext)) {
    return body;
  }

  // Safety check: don't transform binary content even if content-type was wrong
  if (isBinaryContent(body)) {
    log.debug(`⏭️ Skipping binary content: ${url}`);
    return body;
  }

  // Check cache first (only if cache is enabled in config)
  if (effectiveConfig.cacheEnabled) {
    const cached = await getCached(url, contentType, clientIp, method, requestHeaders);
    if (cached) {
      log.debug(`📦 Cache hit: ${url}${clientIp ? ` (client: ${clientIp})` : ''}`);
      recordCacheHit();
      return cached;
    }
  }

  let text = decodeBufferToString(body, charset);

  // Execute transform:pre hooks. The plugin TransformContext type only
  // models 'js' | 'css' | 'html', so 'other' content (reached here solely
  // because a registered text transformer matched it) skips the hook
  // chains and goes straight to registry dispatch.
  if (contentType !== 'other') {
    const transformContext: PluginTransformContext = {
      content: text,
      url,
      type: contentType,
      config: effectiveConfig,
      clientIp,
      profile,
    };

    const preTransformResult = await runPreTransformHooks(transformContext);
    if (preTransformResult) {
      // Check if plugins want to skip transformation
      if (preTransformResult.value.skipTransform) {
        log.debug(`🔌 Transform skipped by plugin: ${preTransformResult.stoppedBy || 'unknown'}`);
        return body;
      }
      // Apply content modifications from plugins
      if (preTransformResult.value.content) {
        text = preTransformResult.value.content;
      }
    }
  }

  // Registry dispatch: plugin transformers first, then built-ins; first
  // match wins; nothing matching falls through untransformed.
  let transformed = await dispatchTextTransform(text, dispatchContext);

  // Execute transform:post hooks (same 'js' | 'css' | 'html' scoping as
  // transform:pre above).
  if (contentType !== 'other') {
    const postTransformContext: PluginTransformContext & { transformed: string } = {
      content: text,
      url,
      type: contentType,
      config: effectiveConfig,
      clientIp,
      profile,
      transformed,
    };

    const postTransformResult = await runPostTransformHooks(postTransformContext);
    if (postTransformResult && postTransformResult.value.content) {
      transformed = postTransformResult.value.content;
    }
  }

  const result = Buffer.from(transformed, 'utf-8');

  // Cache the result (only if cache is enabled)
  if (effectiveConfig.cacheEnabled) {
    await setCache(url, contentType, result, clientIp, method, requestHeaders, responseHeaders);
  }

  return result;
}

/** Pull the raw Content-Type header value out of optional response headers. */
function extractRawContentType(
  responseHeaders?: Record<string, string | string[] | undefined>
): string {
  const raw = responseHeaders?.['content-type'];
  return (Array.isArray(raw) ? raw[0] : raw) || '';
}
