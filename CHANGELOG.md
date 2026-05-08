# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Plugin System** - Extensible architecture for custom functionality
  - Hook-based interceptor chain for request/response lifecycle
  - 10 hook types: `request:pre`, `response:post`, `transform:pre`, `transform:post`, `filter:decision`, `config:resolution`, `domain:lifecycle`, `cache:get`, `cache:set`, `metrics:record`
  - 14 permission types for fine-grained access control
  - Plugin lifecycle management (load, initialize, activate, deactivate, shutdown)
  - Sandboxed plugin context API with permission enforcement
  - Hot-reload support for development
  - Dependency resolution with topological sort
  - REST API for plugin management (`/__revamp__/plugins/*`)
  - Admin panel UI for plugin management
  - Plugin storage, caching, metrics, and custom endpoint registration
- Centralized client config options with single source of truth (`src/config/client-options.ts`)
- Dynamic features display in console output
- Generated config overlay script from metadata
- **`regenerator-runtime` is now bundled into the polyfill payload** (T1) so async functions transpiled by Babel run on iOS 9 instead of throwing `regeneratorRuntime is not defined`.
- **String polyfills `String.prototype.replaceAll` and `String.prototype.matchAll`** (T3) — the README claimed them but they were not shipped.
- **Explanatory HTML pages** for blocked navigations, upstream cert failures, and upstream errors (T20). When the request `Accept`s `text/html` the proxy now returns a small page with the hostname, reason, and a link to `/__revamp__/admin/domains.html` instead of an opaque 204/403/502.
- **iOS-version-aware certificate trust copy** in the captive portal and README (T21). iOS 9–11 vs. iOS 12.2+ get the wording that matches their Settings UI.
- **PAC URL tab in the captive portal** (T22) — "Easy (PAC)" is now the first tab with a copy-able `http://${localIP}:8888/__revamp__/pac/socks5`; manual SOCKS5 is the second tab.
- **Admin panel mounted on the captive portal port** (T23) so it is reachable even when the proxy itself isn't yet configured.
- **Per-host metrics** — `{ blocked, transformedJs, transformedCss, errors, lastUrls[20] }` per domain rendered in the admin panel (T25).
- **Example plugin** at `examples/plugins/hello-world/` (T27) with manifest, ESM entry, and a vitest spec exercising hooks via `createTestContext`.
- **`revamp/plugin` subpath export** (T29) so plugin authors can `import { definePlugin, createTestContext, … } from 'revamp/plugin'` without depending on the whole package.
- **ESLint at error level** (T31) with `@typescript-eslint/recommended-type-checked` plus `no-unused-vars`, `no-floating-promises`, `no-misused-promises`, `no-empty-function`. `pnpm lint` runs in CI at 0 errors.
- **`packageManager: pnpm@9.15.9`** in `package.json` (T32) and `corepack enable` in both Dockerfiles + CI so every environment runs the same pnpm version.
- **Body-size limits** `maxRequestBodyBytes` and `maxResponseBodyBytes` (default 50 MB each) wired to 413/502 responses on the HTTP path (T17).
- **`allowInsecureUpstream` config flag** (default `false`) for opting back into the pre-T8 unverified-upstream behaviour when working against self-signed local servers (T8).
- **TLA AST rewrite enhancements** (T35, T36) — `for await` is now detected as top-level await and rewritten into the IIFE alongside `await` expressions, and `class Foo extends Base` where `Base` is awaited keeps the class declaration inside the IIFE so the `extends` reference resolves.

### Changed
- Dashboard config items now dynamically generated from metadata
- Improved npm package publishing with `files`, `exports`, and `bin` fields
- Configuration hierarchy now includes plugin hooks at highest priority

### Fixed
- CI e2e tests now build project before running to compile worker files
- SW bundle endpoint tests now properly disable `remoteServiceWorkers` for testing
- JSON logging integration tests now use polling instead of fixed timeouts for reliability
- **`config:resolution` plugin hook is now wired into the proxy hot path** (T13). Both the HTTP and SOCKS5 paths now resolve the effective configuration via `getEffectiveConfigForRequestAsync(...)`, so plugin-supplied config overrides actually reach the request that runs against them. Previously the hot path used the synchronous `getEffectiveConfig`, which silently bypassed the documented hook.
- **Multi-plugin `response:post` chains now propagate body / header / status edits between hooks** (T14). The hook executor previously left `context.body` pointing at the raw upstream body across the chain, so a second plugin observed the upstream response instead of the first plugin's mutation. Two-plugin pipelines (e.g. wrap-then-decorate) now compose as documented.
- **Placeholder `Symbol` polyfill replaced** (T2) so `for..of` over Map/Set, `Symbol.iterator`, and `typeof x === 'symbol'` behave like a real shim instead of returning the literal string `'__symbol_<random>'`.
- **CSS Grid → Flexbox fallback no longer assumes Bootstrap 12-column** (T5 / I-2). The transformer now parses `grid-template-columns`, handles `repeat(N, 1fr)` and explicit lists, and bails out (no-op) on unrecognized shapes. `hasGridProperties` was tightened to grid-only properties so `display:flex; gap:8px;` is no longer rewritten with a duplicate `display:flex`.
- **TLA rewrite preserves named exports** (T6). `export const x = await foo()` previously became `const x = await foo()` with no re-export; the AST traversal now wraps the binding in an async-IIFE and emits `export { x }` after.
- **`proxyRequest` linearised** into `prepareRequest` → `executeUpstream` → `transformResponseBody` → `applyPostHooks` → `sendResponse` (T17), with a single shared `flattenError` util.
- **CSS processor cache invalidates when `targets` changes** (T18) — `updateConfig` now calls `resetCssProcessor()` so a runtime config change actually takes effect.
- **`shouldBlockUrl` matching tightened** (T19) so `/stat/` no longer matches `/architect/` and `/hit/` no longer matches `/health-status/`. The new matcher is `path === pattern || path.startsWith(pattern + '/') || path.endsWith('/' + pattern)`.
- **README points users to the IP printed by the banner** (T26) — the placeholder `YOUR_COMPUTER_IP` paragraph now references the `🌐 Your Local IP Address(es): …` line printed by `pnpm start`.
- **Plugin `request:pre` hook chain now propagates `url` and `headers` edits between hooks** (T40), matching the existing body/header propagation in `response:post`.
- **Cache key now incorporates the response `Vary` header** (T41). Each varied request header value is hashed into the key and `Vary: *` is treated as uncacheable so two clients sending different `Accept-Language` no longer share the same cache entry.
- **SOCKS5 inbound bodies are now bounded by `maxRequestBodyBytes`** (T38). The `parseHttpRequest` helper rejects `Content-Length > limit` early and caps the read loop, replying 413 to the SOCKS5 client.
- **Plugin `fetch` SSRF post-resolve DNS check** (T39). The plugin context now resolves the URL host, pins the lookup, and blocks `::ffff:0:0/96`, `fc00::/7`, `fe80::/10`, plus decimal/octal IPv4 forms before issuing the request.

### Breaking
- **Requests carrying `Cookie` or `Authorization` are no longer cached** (T4). Previously the cache key was `clientIp + profileHash + configHash + url + contentType`, with no awareness of cookies, `Vary`, HTTP method, or `Cache-Control: private|no-store`. NAT'd users sharing a single egress IP could see each other's logged-in HTML. The cache now (a) skips `setCache` when the response carries `Set-Cookie` or `Cache-Control: no-store|private`, (b) excludes requests that carry `Cookie` or `Authorization` from the cache entirely, and (c) includes the HTTP method in the key. Migration: callers expecting cached responses for authenticated requests must drop that expectation; the proxy intentionally treats those requests as user-private now.
- **Metrics dashboard `cacheHitRate` and `transformRate` are now reported as `0..100` instead of `0..1`** (T24). External consumers of `GET /__revamp__/metrics` (or any caller of `getMetrics()`) that previously multiplied by 100 for display must drop the multiplication; conversely, callers that compared against a `0..1` threshold must scale their threshold by 100. Rationale: the dashboard always rendered as a percentage, so the canonical wire shape is now the percentage to remove a duplicated transform.
- **`pluginRegistry` is no longer publicly exported from `revamp/plugin`** (T37). Direct access to the registry let plugin authors call `pluginRegistry.registerHook(...)` and bypass the per-hook permission checks introduced in T15. Plugins must register hooks via the `PluginContext.registerHook` API exposed during `activate(ctx)`, which enforces `HOOK_PERMISSION_REQUIREMENTS`. Migration: any plugin that imported `pluginRegistry` directly must move its hook registration into the `activate` lifecycle method.
- **Plugins must declare a hook-specific permission to register that hook** (T15). `context.registerHook(name, …)` now throws `Plugin <id> lacks permission <perm> required for hook <name>` when the manifest's `permissions` array is missing the required entry. The mapping is:
  - `request:pre` / `filter:decision` → `request:modify`
  - `response:post` / `transform:pre` / `transform:post` → `response:modify`
  - `config:resolution` / `domain:lifecycle` → `config:read`
  - `cache:get` → `cache:read`
  - `cache:set` → `cache:write`
  - `metrics:record` → `metrics:write`

  Migration: add the required permission to your plugin's `plugin.json` `permissions` array. Without this fix, a plugin with zero declared permissions could register `response:post` and rewrite every proxied response body — the manifest declared one thing while the runtime allowed another. See README's "Available Hooks" table for the full mapping.

### Security
- **CA private key** now written with `0o600` mode and re-tightened on load if drifted (T7).
- **Per-domain certificates** are now ephemeral — they live only in the in-memory LRU cache and never touch disk. The threat model for T7 is "CA private key on disk is sensitive"; per-domain keys are rotated on restart and have zero on-disk footprint.
- **Upstream TLS validation** is now enforced by default for the WebSocket upgrade path through the HTTPS interceptor as well, closing the last `rejectUnauthorized: false` site (T8). Set `allowInsecureUpstream: true` to opt back into the legacy behaviour.
- **Per-IP cert-mint rate limit** map now self-prunes: stale entries are dropped when their newest timestamp falls outside the window, and a periodic GC sweeps every 100 mints to keep the map bounded under sustained traffic (T11).
- **CORS injection is now opt-in per domain profile** (T9). Previously every proxied response carried `Access-Control-Allow-Origin: <client origin>` and `Access-Control-Allow-Credentials: true`, which made every proxied site cross-origin readable by every other proxied site. The default is now "no CORS headers"; set `corsAllowOrigins` (and optionally `corsAllowCredentials`) on a domain profile to restore selective cross-origin reachability for that domain only.
- **Dynamic-import module shim no longer uses `eval`** (T10). The legacy fallback at `src/transformers/esm-bundler.ts` ran upstream JS via `eval(wrappedCode)`, which let the remote module read the surrounding shim's closure. The replacement uses `new Function('module', 'exports', 'require', code)` so the wrapped code only sees the formal parameters and globals, not arbitrary shim state.

## [1.0.0] - 2025-11-28

### Added

- Initial public release
- SOCKS5 proxy server with full protocol support (RFC 1928)
- HTTP/HTTPS proxy server with SSL interception
- JavaScript transformation via Babel (targeting iOS 9+)
- CSS transformation via PostCSS with autoprefixer
- HTML modification via Cheerio for polyfill injection
- Image optimization with Sharp
- Smart caching system (memory + disk)
- Auto-generated CA and per-domain certificates
- Captive portal for easy certificate installation
- Runtime configuration API (`/__revamp__/config`)
- User-Agent spoofing (HTTP headers and JavaScript)
- Ad and tracking domain blocking
- Comprehensive unit tests with Vitest
- E2E tests with Playwright

### Features

- **Proxy Servers**
  - SOCKS5 proxy (port 1080) - recommended for iOS devices
  - HTTP proxy (port 8080) - alternative method
  - Captive portal (port 8888) - certificate download page

- **Content Transformation**
  - JavaScript: ES2023+ to ES5/ES6 via Babel
  - CSS: Modern features to prefixed/fallback versions
  - HTML: Polyfill injection for missing APIs
  - Images: WebP/AVIF to JPEG conversion for legacy browsers

- **Security & Privacy**
  - Automatic HTTPS certificate generation
  - Ad domain blocking
  - Tracking script removal
  - User-Agent spoofing to bypass browser detection

- **Performance**
  - In-memory LRU cache for hot content
  - Disk cache for persistent storage
  - Configurable TTL settings

### Technical Details

- Written in TypeScript with strict mode
- Modular architecture for easy extension
- Comprehensive JSDoc documentation
- Unit tests for protocol parsing and utilities
- E2E tests for proxy functionality

[1.0.0]: https://github.com/lifeart/revamp/releases/tag/v1.0.0
