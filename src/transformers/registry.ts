/**
 * Content Transformer Registry
 *
 * Replaces the hard-coded content-type switch that used to live inside
 * `transformContent` with an ordered registry of transformers. Two lanes
 * exist because the real input shapes differ:
 *
 * - Text lane (`kind: 'text'`): js/css/html transformers that take a decoded
 *   string and return a string. Dispatched from the transform pipeline.
 * - Binary lane (`kind: 'binary'`): the image transformer (and any plugin
 *   peers) that take a raw Buffer and return data + content type. Dispatched
 *   from `processProxiedResponse` before the text pipeline runs.
 *
 * Dispatch semantics (must stay byte-identical to the old switch):
 * - Plugin-registered transformers run before built-ins, in registration
 *   order among plugins.
 * - First matching transformer wins.
 * - A throwing (or throwing-in-`matches`) plugin transformer is logged and
 *   skipped — built-ins still run, the response is never broken.
 * - A throwing built-in propagates, exactly as the old inline calls did.
 * - When nothing matches, the content falls through untransformed.
 *
 * @module transformers/registry
 */

import type { RevampConfig } from '../config/index.js';
import { log } from '../logger/log.js';
import type { DomainProfile } from '../config/domain-rules.js';
import type { ContentType } from '../proxy/types.js';
import { transformJs } from './js.js';
import { transformCss } from './css.js';
import { transformHtml, isHtmlDocument } from './html.js';
import { transformImage, needsImageTransform } from './image.js';

/**
 * Context handed to `matches()` / `transform()` of every registered
 * transformer. Carries the request facts a transformer needs to decide
 * whether (and how) to act, without reaching into globals.
 */
export interface TransformDispatchContext {
  /** Full URL of the content being transformed */
  url: string;
  /** Detected coarse content type ('js' | 'css' | 'html' | 'other') */
  contentType: ContentType;
  /**
   * Raw Content-Type header value (e.g. 'image/webp; charset=binary').
   * Binary-lane matchers need this — the coarse `contentType` collapses all
   * binary types to 'other'.
   */
  rawContentType: string;
  /** Effective configuration for this request */
  config: RevampConfig;
  /** Matched domain profile, threaded from the request entry point */
  profile: DomainProfile | null;
  /** Client IP for per-client handling */
  clientIp?: string;
}

/**
 * Text-lane transformer: string in, string out. Built-in js/css/html
 * transformers and most plugin transformers live here.
 */
export interface TextContentTransformer {
  kind: 'text';
  /** Unique name across the whole registry (used for unregistration) */
  name: string;
  /** Whether this transformer wants to handle the content */
  matches(ctx: TransformDispatchContext): boolean;
  /** Transform the decoded content; return it unchanged to no-op */
  transform(input: string, ctx: TransformDispatchContext): Promise<string>;
}

/**
 * Result of a binary-lane transform. Mirrors `ImageTransformResult` so the
 * built-in image transformer adapts without conversion.
 */
export interface BinaryTransformResult {
  /** Whether transformation was applied */
  transformed: boolean;
  /** Transformed data (or original if not transformed) */
  data: Buffer;
  /** Content-Type of the result */
  contentType: string;
}

/**
 * Binary-lane transformer: Buffer in, Buffer (+ content type) out. The
 * built-in image transformer lives here.
 */
export interface BinaryContentTransformer {
  kind: 'binary';
  /** Unique name across the whole registry (used for unregistration) */
  name: string;
  /** Whether this transformer wants to handle the content */
  matches(ctx: TransformDispatchContext): boolean;
  /** Transform the raw bytes */
  transform(input: Buffer, ctx: TransformDispatchContext): Promise<BinaryTransformResult>;
}

/** A registered content transformer (either lane). */
export type ContentTransformer = TextContentTransformer | BinaryContentTransformer;

/** Internal registry entry; `pluginId` is set for plugin-registered entries. */
interface RegistryEntry {
  transformer: ContentTransformer;
  /** Owning plugin id, or null for built-ins */
  pluginId: string | null;
}

/** Plugin-registered transformers, in registration order (run first). */
const pluginEntries: RegistryEntry[] = [];

/** Built-in transformers, in registration order (run after plugins). */
const builtinEntries: RegistryEntry[] = [];

function findEntry(name: string): RegistryEntry | undefined {
  return (
    pluginEntries.find((e) => e.transformer.name === name) ??
    builtinEntries.find((e) => e.transformer.name === name)
  );
}

/**
 * Register a transformer. Plugin-registered transformers (those with a
 * `pluginId`) run before built-ins, in registration order among plugins.
 *
 * @throws when the name is already taken (names are the unregistration key,
 *   so they must be unique across both lanes and both origins)
 */
export function registerTransformer(
  transformer: ContentTransformer,
  pluginId: string | null = null
): void {
  if (!transformer.name) {
    throw new Error('Transformer must have a non-empty name');
  }
  if (findEntry(transformer.name)) {
    throw new Error(`Transformer "${transformer.name}" is already registered`);
  }
  const entry: RegistryEntry = { transformer, pluginId };
  if (pluginId) {
    pluginEntries.push(entry);
  } else {
    builtinEntries.push(entry);
  }
}

/**
 * Unregister a transformer by name.
 *
 * @param name - Transformer name
 * @param pluginId - When provided, only removes the transformer if it is
 *   owned by that plugin (sandboxing: a plugin can never unregister
 *   built-ins or another plugin's transformers through its context).
 * @returns true when a transformer was removed
 */
export function unregisterTransformer(name: string, pluginId?: string): boolean {
  const lists = pluginId ? [pluginEntries] : [pluginEntries, builtinEntries];
  for (const list of lists) {
    const idx = list.findIndex(
      (e) =>
        e.transformer.name === name &&
        (pluginId === undefined || e.pluginId === pluginId)
    );
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
  }
  return false;
}

/**
 * Remove every transformer a plugin registered. Called on plugin
 * deactivation/unload (mirrors how registered endpoints are cleaned up).
 */
export function unregisterTransformersForPlugin(pluginId: string): void {
  for (let i = pluginEntries.length - 1; i >= 0; i--) {
    if (pluginEntries[i].pluginId === pluginId) {
      pluginEntries.splice(i, 1);
    }
  }
}

/** Names of all registered transformers, dispatch order (plugins first). */
export function getRegisteredTransformerNames(): string[] {
  return [...pluginEntries, ...builtinEntries].map((e) => e.transformer.name);
}

/**
 * Plugin-safe `matches()` invocation: a throwing plugin matcher is logged
 * and treated as a non-match so it can never break the response. Built-in
 * matchers are trusted (they are plain content-type checks) but go through
 * the same path for uniformity — they don't throw in practice.
 */
function entryMatches(entry: RegistryEntry, ctx: TransformDispatchContext): boolean {
  try {
    return entry.transformer.matches(ctx);
  } catch (err) {
    log.warn(
      `[transformers] matches() of "${entry.transformer.name}"${entry.pluginId ? ` (plugin ${entry.pluginId})` : ''} threw; treating as non-match`,
      err
    );
    return false;
  }
}

/**
 * Cheap pre-dispatch probe: would any registered TEXT transformer act on
 * this content? The proxy gates use this so coarse-'other' content (JSON
 * APIs etc.) only enters the text pipeline when a transformer actually
 * wants it — built-ins never match 'other', so with no plugin registered
 * the gates short-circuit before any charset decode or cache lookup.
 *
 * `matches()` calls go through the same exception-safe wrapper as dispatch:
 * a throwing plugin matcher is logged and treated as a non-match.
 */
export function hasTextTransformerFor(ctx: TransformDispatchContext): boolean {
  for (const entry of [...pluginEntries, ...builtinEntries]) {
    if (entry.transformer.kind !== 'text') continue;
    if (entryMatches(entry, ctx)) return true;
  }
  return false;
}

/**
 * Dispatch the text lane: first matching transformer wins. A throwing
 * plugin transformer is logged and skipped (fall back to the next match,
 * ultimately the built-ins); a throwing built-in propagates exactly like
 * the old inline `transformJs`/`transformCss`/`transformHtml` calls did.
 *
 * @returns the transformed content, or `input` unchanged when nothing
 *   matched (the old switch's fall-through behaviour)
 */
export async function dispatchTextTransform(
  input: string,
  ctx: TransformDispatchContext
): Promise<string> {
  for (const entry of [...pluginEntries, ...builtinEntries]) {
    if (entry.transformer.kind !== 'text') continue;
    if (!entryMatches(entry, ctx)) continue;

    if (entry.pluginId) {
      try {
        return await entry.transformer.transform(input, ctx);
      } catch (err) {
        log.warn(
          `[transformers] plugin transformer "${entry.transformer.name}" (plugin ${entry.pluginId}) failed; falling back to next transformer`,
          err
        );
        continue;
      }
    }

    // Built-in: errors propagate to the caller, preserving the old
    // inline-call semantics.
    return entry.transformer.transform(input, ctx);
  }

  return input;
}

/**
 * Dispatch the binary lane: first matching transformer wins. Returns `null`
 * when no binary transformer matched, in which case the caller falls
 * through to the text pipeline (the old `needsImageTransform` else-branch).
 */
export async function dispatchBinaryTransform(
  input: Buffer,
  ctx: TransformDispatchContext
): Promise<BinaryTransformResult | null> {
  for (const entry of [...pluginEntries, ...builtinEntries]) {
    if (entry.transformer.kind !== 'binary') continue;
    if (!entryMatches(entry, ctx)) continue;

    if (entry.pluginId) {
      try {
        return await entry.transformer.transform(input, ctx);
      } catch (err) {
        log.warn(
          `[transformers] plugin transformer "${entry.transformer.name}" (plugin ${entry.pluginId}) failed; falling back to next transformer`,
          err
        );
        continue;
      }
    }

    return entry.transformer.transform(input, ctx);
  }

  return null;
}

// =============================================================================
// Built-in transformers
// =============================================================================
//
// Thin adapters over the existing transform functions. The config-flag and
// document checks live in `transform()` (not `matches()`) so that a disabled
// transform still "wins" the dispatch and returns the content untouched —
// exactly what the old switch did (it fell into the case, then skipped the
// call and continued to post-hooks/caching with the unmodified text).

registerTransformer({
  kind: 'text',
  name: 'js',
  matches: (ctx) => ctx.contentType === 'js',
  async transform(input, ctx) {
    if (ctx.config.transformJs) {
      log.debug(`🔧 Transforming JS: ${ctx.url}`);
      return transformJs(input, ctx.url, ctx.config);
    }
    return input;
  },
});

registerTransformer({
  kind: 'text',
  name: 'css',
  matches: (ctx) => ctx.contentType === 'css',
  async transform(input, ctx) {
    if (ctx.config.transformCss) {
      log.debug(`🎨 Transforming CSS: ${ctx.url}`);
      return transformCss(input, ctx.url, ctx.config);
    }
    return input;
  },
});

registerTransformer({
  kind: 'text',
  name: 'html',
  matches: (ctx) => ctx.contentType === 'html',
  async transform(input, ctx) {
    if (ctx.config.transformHtml && isHtmlDocument(input)) {
      log.debug(`📄 Transforming HTML: ${ctx.url}`);
      return transformHtml(input, ctx.url, ctx.config);
    }
    return input;
  },
});

registerTransformer({
  kind: 'binary',
  name: 'image',
  // `needsImageTransform` consults the global config targets internally —
  // do not duplicate that logic here (the function is the source of truth).
  matches: (ctx) => needsImageTransform(ctx.rawContentType, ctx.url),
  transform: (input, ctx) => transformImage(input, ctx.rawContentType, ctx.url),
});
