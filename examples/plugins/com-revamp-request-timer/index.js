/**
 * Request Timer example plugin.
 *
 * Demonstrates the plugin COMPOSITION APIs:
 * - shared per-request data: `request:pre` stamps a start timestamp into
 *   `context.pluginData` (the Map shared by the request and response hook
 *   chains of one proxied request) and `response:post` reads it back;
 * - `context.recordMetric()` — records the elapsed time as a custom metric;
 * - `context.registerEndpoint()` — exposes aggregate stats at
 *   `/__revamp__/plugins/com.revamp.request-timer/stats`;
 * - `context.getActivePlugins()` / `context.isPluginActive()` — the stats
 *   payload reports which plugins are active alongside this one.
 *
 * Entries in the shared `pluginData` Map are namespaced by the WRITING
 * plugin's id using the `<pluginId>:<key>` convention — the same convention
 * the `setSharedPluginData` / `getSharedPluginData` helpers in
 * `src/plugins/hooks.ts` implement. The key is built manually here so the
 * example stays dependency-free, but readers in other plugins can use
 * `getSharedPluginData(pluginData, 'com.revamp.request-timer', 'startTime')`.
 */

const PLUGIN_ID = 'com.revamp.request-timer';

// `<pluginId>:<key>` — see setSharedPluginData() in src/plugins/hooks.ts.
const START_TIME_KEY = `${PLUGIN_ID}:startTime`;

export default {
  async activate(context) {
    // Aggregate stats live in the activation closure; they reset when the
    // plugin is deactivated and reactivated.
    const stats = { count: 0, totalMs: 0, maxMs: 0 };

    context.registerHook(
      'request:pre',
      async (request) => {
        // Plugins run at request time, so Date.now() is the right clock.
        request.pluginData.set(START_TIME_KEY, Date.now());
        return { continue: true };
      },
      0,
    );

    context.registerHook(
      'response:post',
      async (response) => {
        const start = response.pluginData.get(START_TIME_KEY);
        if (typeof start !== 'number') {
          // request:pre never ran for this request (e.g. the plugin was
          // activated mid-flight) — skip timing rather than record garbage.
          context.log('debug', 'No start timestamp for request; skipping timing', response.url);
          return { continue: true };
        }

        const elapsedMs = Date.now() - start;
        stats.count += 1;
        stats.totalMs += elapsedMs;
        if (elapsedMs > stats.maxMs) {
          stats.maxMs = elapsedMs;
        }

        context.recordMetric('request_duration_ms', elapsedMs, {
          hostname: response.hostname,
        });

        return { continue: true };
      },
      0,
    );

    // GET /__revamp__/plugins/com.revamp.request-timer/stats
    context.registerEndpoint('stats', async () => {
      const body = {
        count: stats.count,
        avgMs: stats.count > 0 ? stats.totalMs / stats.count : 0,
        maxMs: stats.maxMs,
        // Composition APIs: report which plugins are active alongside us.
        activePlugins: context.getActivePlugins(),
        jsonAdFilterActive: context.isPluginActive('com.revamp.json-ad-filter'),
      };
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
    });
  },

  async deactivate(context) {
    context.unregisterHook('request:pre');
    context.unregisterHook('response:post');
    context.unregisterEndpoint('stats');
  },
};
