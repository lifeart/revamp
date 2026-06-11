/**
 * Tracking Param Stripper example plugin.
 *
 * Demonstrates `request:pre` URL rewriting: strips configurable tracking
 * query parameters (utm_*, fbclid, gclid, ...) from request URLs before they
 * go upstream. The rewritten URL is returned through the hook result value
 * (`{ continue: true, value: { url } }`); the hook executor merges it into
 * the request context so downstream hooks — and the upstream fetch — see the
 * cleaned URL (see the `request:pre` propagation in
 * `src/plugins/hook-executor.ts`).
 *
 * Matching is case-insensitive. URLs without a query string (and URLs where
 * nothing matches) are left completely untouched — no `value` is returned at
 * all, so the original URL string is never re-serialized.
 */

const DEFAULT_PARAMS = ['utm_*', 'fbclid', 'gclid', 'yclid', '_ga'];

/**
 * Split the configured param list into exact names and prefix wildcards
 * (`utm_*` → prefix 'utm_'). Invalid entries are skipped.
 */
function compileMatchers(params) {
  const exact = new Set();
  const prefixes = [];
  for (const entry of params) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (entry.endsWith('*')) {
      const prefix = entry.slice(0, -1).toLowerCase();
      if (prefix.length > 0) prefixes.push(prefix);
    } else {
      exact.add(entry.toLowerCase());
    }
  }
  return { exact, prefixes };
}

function shouldStrip(name, matchers) {
  const lower = name.toLowerCase();
  if (matchers.exact.has(lower)) return true;
  return matchers.prefixes.some((prefix) => lower.startsWith(prefix));
}

export default {
  async activate(context) {
    context.registerHook(
      'request:pre',
      async (request) => {
        // No query string → nothing to do; leave the URL byte-identical.
        if (!request.url.includes('?')) {
          return { continue: true };
        }

        let parsed;
        try {
          parsed = new URL(request.url);
        } catch (err) {
          context.log('debug', 'Unparsable request URL; leaving it untouched', request.url, err);
          return { continue: true };
        }

        const config = context.getPluginConfig();
        const params = Array.isArray(config.params) ? config.params : DEFAULT_PARAMS;
        const matchers = compileMatchers(params);

        // Collect first, then delete — deleting while iterating the live
        // searchParams view would skip keys.
        const toStrip = new Set();
        for (const name of parsed.searchParams.keys()) {
          if (shouldStrip(name, matchers)) {
            toStrip.add(name);
          }
        }
        if (toStrip.size === 0) {
          // Nothing matched: return no value so the original URL string is
          // not replaced by a re-serialized (potentially normalized) one.
          return { continue: true };
        }

        for (const name of toStrip) {
          parsed.searchParams.delete(name);
        }

        const rewritten = parsed.toString();
        context.log(
          'debug',
          `Stripped ${toStrip.size} tracking param(s): ${request.url} -> ${rewritten}`,
        );

        return { continue: true, value: { url: rewritten } };
      },
      0,
    );
  },

  async deactivate(context) {
    context.unregisterHook('request:pre');
  },
};
