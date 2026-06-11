# Tracking Param Stripper Plugin

An example Revamp plugin that strips tracking query parameters from request
URLs before they go upstream. It is the reference example for **`request:pre`
URL rewriting**.

## What it demonstrates

- Returning a rewritten URL through the hook result value:
  `{ continue: true, value: { url } }`. The hook executor merges the value
  into the request context (see the `request:pre` propagation in
  `src/plugins/hook-executor.ts`), so downstream plugins and the upstream
  fetch observe the cleaned URL.
- Conservative no-op behavior: when the URL has no query string, or no listed
  parameter is present, the hook returns **no value at all** — the original
  URL string is never replaced by a re-serialized (potentially normalized)
  copy.
- Defensive parsing: an unparsable URL is logged at debug level and left
  untouched; the plugin never breaks a request.

## Config options

```json
{
  "params": ["utm_*", "fbclid", "gclid", "yclid", "_ga"]
}
```

- `params` — list of query parameter names to strip. Entries are either
  exact names (`fbclid`) or prefix wildcards (`utm_*` strips every parameter
  starting with `utm_`). Matching is case-insensitive. Setting `params`
  **replaces** the default list shown above.

The config is validated against the JSON Schema in `plugin.json`
(`configSchema`) whenever it is updated through the plugin API.

## Files

- `plugin.json` — manifest; permissions: `request:modify` (the permission
  gating the `request:pre` hook), hooks: `request:pre`
- `index.js` — ESM module with the default-exported plugin object
- `index.test.ts` — vitest spec exercising stripping, wildcards, and the
  untouched-URL guarantees

## Enable it

See [`examples/plugins/README.md`](../README.md) for the `plugins.json`
config that enables the example plugins. This plugin's entry:

```json
"com.revamp.tracking-param-stripper": { "enabled": true, "config": {} }
```

## Run the tests

```bash
pnpm exec vitest run examples/plugins/com-revamp-tracking-param-stripper/index.test.ts
```
