# Example Plugins

Sample plugins demonstrating the Revamp plugin APIs. Each directory contains
a `plugin.json` manifest, a dependency-free ESM `index.js`, a vitest spec
(`index.test.ts`), and a README explaining what it demonstrates.

| Plugin | APIs demonstrated | What it does |
| --- | --- | --- |
| [`com.revamp.json-ad-filter`](./com-revamp-json-ad-filter/) | `registerTransformer` (text lane), `unregisterTransformer`, live plugin config | Strips ad/tracking entries out of JSON API responses via configurable rules; byte-identical passthrough when nothing matches |
| [`com.revamp.request-timer`](./com-revamp-request-timer/) | shared per-request plugin data (`request:pre` → `response:post`), `recordMetric`, `registerEndpoint`, `getActivePlugins` / `isPluginActive` | Times every proxied request and serves `{count, avgMs, maxMs}` stats from a custom API endpoint |
| [`com.revamp.tracking-param-stripper`](./com-revamp-tracking-param-stripper/) | `request:pre` URL rewriting via the hook result value | Removes tracking query params (`utm_*`, `fbclid`, `gclid`, …) from request URLs before they go upstream |
| [`com.revamp.hello-world`](./com-revamp-hello-world/) | `registerHook('response:post')`, plugin config | Minimal starter plugin: adds an `x-revamp-hello` response header |

## Running the examples

The server loads plugins on boot from the directory named in `plugins.json`,
which lives in the data dir — `<dirname(cacheDir)>/.revamp-data/plugins.json`
(with the default `cacheDir: './.revamp-cache'` that is
`./.revamp-data/plugins.json` next to where you start the server).

To run the examples straight out of this repo, point `pluginsDir` here and
enable the plugins you want:

```json
{
  "enabled": true,
  "hotReload": false,
  "pluginsDir": "examples/plugins",
  "plugins": {
    "com.revamp.json-ad-filter": {
      "enabled": true,
      "config": {
        "rules": [
          {
            "path": "items[*]",
            "when": { "field": "type", "equals": "ad" },
            "action": "remove"
          }
        ]
      }
    },
    "com.revamp.request-timer": { "enabled": true, "config": {} },
    "com.revamp.tracking-param-stripper": { "enabled": true, "config": {} },
    "com.revamp.hello-world": { "enabled": true, "config": {} }
  }
}
```

`pluginsDir` is resolved relative to the server's working directory (absolute
paths work too). Per-plugin `config` objects are validated against the
`configSchema` in each manifest when updated through the plugin API.

> **Directory naming**: the loader locates a plugin's directory by its id
> with dots replaced by dashes (`com.revamp.json-ad-filter` →
> `com-revamp-json-ad-filter/`). Keep that convention when copying these
> examples into your own plugins directory, or the plugin will be discovered
> but fail to load.

## Tests

```bash
# All example plugin specs + the real-loader smoke test
pnpm exec vitest run examples
```

`loader-smoke.test.ts` drives the actual `PluginLoader` (the same code path
the server uses on boot) against this directory with all three sample
plugins enabled, then exercises real flows through the production transformer
registry, hook executor, and plugin endpoint router.
