# Hello World Plugin

A minimal example Revamp plugin that adds an `x-revamp-hello` header to every
response that flows through the proxy.

## Files

- `plugin.json` — plugin manifest (id, version, permissions, entry point)
- `index.js` — ESM module with the default-exported plugin object
- `index.test.ts` — vitest spec exercising the plugin via `createTestContext`

## Try it

Drop this folder into the proxy's plugins directory (default
`.revamp-plugins/`) and Revamp will pick it up on the next start. The default
header value is `world`; override it through the plugin's config:

```json
{
  "headerValue": "greetings"
}
```

## Run the test

```bash
pnpm exec vitest run examples/plugins/com-revamp-hello-world/index.test.ts
```
