# JSON Ad Filter Plugin

The flagship example for the **`registerTransformer` API (text lane)**: a
content transformer that matches JSON responses and strips ad/tracking
entries out of them before they reach the client.

## What it demonstrates

- `context.registerTransformer({ kind: 'text', ... })` — joining the
  transform pipeline alongside the built-in js/css/html transformers.
  Plugin transformers run *before* built-ins; first match wins; a throwing
  plugin transformer is logged and skipped, never breaking the response.
- Matching on `rawContentType` from the dispatch context. The coarse
  `contentType` field collapses JSON to `'other'`, so JSON matchers must key
  off the raw `Content-Type` header value (`application/json`, `text/json`,
  and any `+json` suffix type are accepted, parameters like `; charset=utf-8`
  are ignored).
- `context.unregisterTransformer(name)` on deactivate.
- Reading live plugin config (`context.getPluginConfig()`) at transform time.

## Correctness contract

- **Byte-identical passthrough**: when no rule matches (or no rule changes
  anything), the original string is returned untouched. The response is only
  re-serialized when something actually changed — this preserves formatting
  and 64-bit integer IDs (`id > Number.MAX_SAFE_INTEGER`) that a needless
  `JSON.parse` → `JSON.stringify` round-trip would corrupt.
- **Malformed JSON** is logged at debug level and passed through untouched.
- When a rule *does* change the document, the whole document is re-serialized
  compactly — big-int values elsewhere in that document are then subject to
  normal `JSON.parse` precision limits. Scope your `urlPattern`s accordingly.

## Config options

```json
{
  "rules": [
    {
      "urlPattern": "*example.com/api/*",
      "path": "items[*]",
      "when": { "field": "type", "equals": "ad" },
      "action": "remove"
    },
    { "path": "data.sections[*].tracking", "action": "remove" },
    { "path": "promo", "when": { "field": "label", "contains": "Sponsored" }, "action": "empty" }
  ]
}
```

- `urlPattern` — substring matched against the full URL, or a `*` wildcard
  pattern whose literal parts must appear in order. Omit (or use `"*"`) to
  match every URL.
- `path` — dotted path from the JSON root. A `[*]` suffix on a segment fans
  out over array elements and may appear mid-path (`sections[*].tracking`)
  or as the final segment (`items[*]`).
- `when` *(optional)* — predicate evaluated on each matched node:
  - `field` — dotted path inside the node;
  - `equals` — strict equality, or
  - `contains` — substring (string fields) / membership (array fields);
  - `field` alone — the field merely has to exist.
  Without `when`, every matched node is acted on.
- `action`:
  - `remove` — delete the array item / object key,
  - `null` — replace the node with `null`,
  - `empty` — replace with `[]` / `{}` / `""` by node type (`null` otherwise).

The config is validated against the JSON Schema in `plugin.json`
(`configSchema`) whenever it is updated through the plugin API.

## Files

- `plugin.json` — manifest; permissions: `response:modify` (the permission
  gating `registerTransformer`), hooks: none
- `index.js` — ESM module with the default-exported plugin object
- `index.test.ts` — vitest spec exercising the transformer via `createTestContext`

## Enable it

See [`examples/plugins/README.md`](../README.md) for the `plugins.json`
config that enables the example plugins. This plugin's entry:

```json
"com.revamp.json-ad-filter": {
  "enabled": true,
  "config": { "rules": [ { "path": "items[*]", "when": { "field": "type", "equals": "ad" }, "action": "remove" } ] }
}
```

## Run the tests

```bash
pnpm exec vitest run examples/plugins/com-revamp-json-ad-filter/index.test.ts
```
