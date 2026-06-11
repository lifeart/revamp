/**
 * JSON Ad Filter example plugin.
 *
 * Demonstrates the `registerTransformer` API (text lane): a content
 * transformer that matches JSON responses by their raw Content-Type header
 * and removes / nulls / empties nodes selected by configurable rules —
 * the classic "strip the sponsored items out of the feed" use case.
 *
 * Correctness contract (important for API responses):
 * - When NO rule changes anything, the ORIGINAL string is returned untouched
 *   (byte-identical passthrough). This preserves formatting and — crucially —
 *   64-bit integer IDs that would lose precision through a needless
 *   JSON.parse → JSON.stringify round-trip.
 * - Malformed JSON is logged at debug level and passed through untouched;
 *   this plugin never breaks a response.
 */

const TRANSFORMER_NAME = 'json-ad-filter';

// Keys that must never be walked or written through when applying rule
// paths to parsed JSON (guards against prototype-pollution style configs).
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * True when the raw Content-Type header denotes a JSON payload.
 * Note: the coarse dispatch `contentType` collapses JSON to 'other', so the
 * matcher keys off `rawContentType` (e.g. 'application/json; charset=utf-8').
 */
function isJsonContentType(rawContentType) {
  const mime = String(rawContentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!mime) return false;
  return (
    mime === 'application/json' ||
    mime === 'text/json' ||
    mime.endsWith('+json')
  );
}

/**
 * Match a URL against a rule pattern: plain substring, or `*` wildcards that
 * require the literal parts to appear in order. Missing pattern / `*` match
 * every URL.
 */
function urlMatchesPattern(url, pattern) {
  if (pattern === undefined || pattern === null || pattern === '' || pattern === '*') {
    return true;
  }
  const text = String(pattern);
  if (!text.includes('*')) return url.includes(text);

  const parts = text.split('*').filter((part) => part.length > 0);
  let searchFrom = 0;
  for (const part of parts) {
    const found = url.indexOf(part, searchFrom);
    if (found === -1) return false;
    searchFrom = found + part.length;
  }
  return true;
}

/**
 * Parse a rule path like 'data.items[*].ad' into segments:
 * [{key:'data'},{key:'items',wildcard:true},{key:'ad'}].
 * Returns null when the path is malformed or touches unsafe keys.
 */
function parsePath(path) {
  const segments = [];
  for (const piece of String(path).split('.')) {
    const match = /^([^[\]]+)(\[\*\])?$/.exec(piece);
    if (!match || UNSAFE_KEYS.has(match[1])) return null;
    segments.push({ key: match[1], wildcard: Boolean(match[2]) });
  }
  return segments.length > 0 ? segments : null;
}

/** Walk a dotted field path inside a node; undefined when unreachable. */
function getField(node, fieldPath) {
  let current = node;
  for (const key of String(fieldPath).split('.')) {
    if (current === null || typeof current !== 'object' || UNSAFE_KEYS.has(key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Evaluate a rule's `when` predicate against the matched node.
 * - no `when`            → always true
 * - `equals`             → strict equality on the field value
 * - `contains`           → substring (strings) or membership (arrays)
 * - `field` only         → field must exist (not undefined)
 */
function predicateMatches(node, when) {
  if (!when || typeof when !== 'object') return true;
  const value = getField(node, when.field);
  if ('equals' in when) return value === when.equals;
  if ('contains' in when) {
    if (typeof value === 'string') return value.includes(String(when.contains));
    if (Array.isArray(value)) return value.includes(when.contains);
    return false;
  }
  return value !== undefined;
}

/** Type-appropriate "empty" replacement for the `empty` action. */
function emptyValueFor(value) {
  if (Array.isArray(value)) return [];
  if (typeof value === 'string') return '';
  if (value !== null && typeof value === 'object') return {};
  return null;
}

/**
 * Apply one rule to the parsed document. Returns true when anything changed.
 */
function applyRule(root, segments, when, action) {
  let changed = false;

  function applyToProperty(parent, key, value) {
    if (action === 'remove') {
      delete parent[key];
    } else if (action === 'null') {
      parent[key] = null;
    } else {
      parent[key] = emptyValueFor(value);
    }
    changed = true;
  }

  function walk(node, segmentIndex) {
    if (node === null || typeof node !== 'object') return;
    const { key, wildcard } = segments[segmentIndex];
    const isLast = segmentIndex === segments.length - 1;
    const child = node[key];
    if (child === undefined) return;

    if (!wildcard) {
      if (isLast) {
        if (predicateMatches(child, when)) {
          applyToProperty(node, key, child);
        }
      } else {
        walk(child, segmentIndex + 1);
      }
      return;
    }

    // `key[*]`: fan out over array elements.
    if (!Array.isArray(child)) return;
    if (isLast) {
      // Iterate backwards so `remove` splices don't skip elements.
      for (let i = child.length - 1; i >= 0; i--) {
        if (!predicateMatches(child[i], when)) continue;
        if (action === 'remove') {
          child.splice(i, 1);
        } else if (action === 'null') {
          child[i] = null;
        } else {
          child[i] = emptyValueFor(child[i]);
        }
        changed = true;
      }
    } else {
      for (const element of child) {
        walk(element, segmentIndex + 1);
      }
    }
  }

  walk(root, 0);
  return changed;
}

export default {
  async activate(context) {
    context.registerTransformer({
      kind: 'text',
      name: TRANSFORMER_NAME,

      matches(dispatchContext) {
        return isJsonContentType(dispatchContext.rawContentType);
      },

      async transform(input, dispatchContext) {
        const config = context.getPluginConfig();
        const rules = Array.isArray(config.rules) ? config.rules : [];
        if (rules.length === 0) return input;

        // urlPattern gating happens before parsing: when no rule applies to
        // this URL the response is passed through byte-identical.
        const applicable = rules.filter(
          (rule) =>
            rule &&
            typeof rule === 'object' &&
            typeof rule.path === 'string' &&
            urlMatchesPattern(dispatchContext.url, rule.urlPattern)
        );
        if (applicable.length === 0) return input;

        let parsed;
        try {
          parsed = JSON.parse(input);
        } catch (err) {
          context.log(
            'debug',
            `Malformed JSON from ${dispatchContext.url}; passing response through untouched`,
            err
          );
          return input;
        }
        if (parsed === null || typeof parsed !== 'object') return input;

        let changed = false;
        for (const rule of applicable) {
          if (rule.action !== 'remove' && rule.action !== 'null' && rule.action !== 'empty') {
            context.log('debug', `Unknown action "${rule.action}"; skipping rule`, rule.path);
            continue;
          }
          const segments = parsePath(rule.path);
          if (!segments) {
            context.log('debug', `Invalid rule path "${rule.path}"; skipping rule`);
            continue;
          }
          if (applyRule(parsed, segments, rule.when, rule.action)) {
            changed = true;
          }
        }

        // Byte-identical passthrough when nothing changed: preserves
        // formatting and big-int precision (no re-serialization).
        if (!changed) return input;

        context.log('debug', `Filtered JSON response: ${dispatchContext.url}`);
        return JSON.stringify(parsed);
      },
    });
  },

  async deactivate(context) {
    context.unregisterTransformer(TRANSFORMER_NAME);
  },
};
