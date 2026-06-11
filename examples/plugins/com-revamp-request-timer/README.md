# Request Timer Plugin

An example Revamp plugin that times every proxied request and exposes
aggregate stats on a custom API endpoint. It is the reference example for the
**plugin composition APIs**.

## What it demonstrates

- **Shared per-request plugin data**: `request:pre` stamps `Date.now()` into
  the request's `pluginData` Map; `response:post` of the *same* request reads
  it back (the Map instance is shared across one request's hook chains).
  Entries follow the `<pluginId>:<key>` namespacing convention implemented by
  `setSharedPluginData` / `getSharedPluginData` in `src/plugins/hooks.ts`, so
  *other* plugins can read the stamp with
  `getSharedPluginData(pluginData, 'com.revamp.request-timer', 'startTime')`.
- **Custom metrics**: `context.recordMetric('request_duration_ms', elapsed,
  { hostname })` on every timed response.
- **Custom API endpoints**: `context.registerEndpoint('stats', ...)` —
  reachable at `/__revamp__/plugins/com.revamp.request-timer/stats`, returns:

  ```json
  {
    "count": 42,
    "avgMs": 87.3,
    "maxMs": 412,
    "activePlugins": ["com.revamp.request-timer", "com.revamp.json-ad-filter"],
    "jsonAdFilterActive": true
  }
  ```

- **Plugin introspection**: the stats payload uses
  `context.getActivePlugins()` and
  `context.isPluginActive('com.revamp.json-ad-filter')`.

Stats live in the activation closure and reset when the plugin is
deactivated and reactivated.

## Config options

None — the plugin has no configuration.

## Files

- `plugin.json` — manifest; permissions: `request:modify` (register the
  `request:pre` hook), `response:modify` (register `response:post`),
  `metrics:write` (`recordMetric`), `api:register` (`registerEndpoint`)
- `index.js` — ESM module with the default-exported plugin object
- `index.test.ts` — vitest spec exercising the request → response flow,
  stats accumulation, and the endpoint payload

## Enable it

See [`examples/plugins/README.md`](../README.md) for the `plugins.json`
config that enables the example plugins. This plugin's entry:

```json
"com.revamp.request-timer": { "enabled": true, "config": {} }
```

## Run the tests

```bash
pnpm exec vitest run examples/plugins/com-revamp-request-timer/index.test.ts
```
