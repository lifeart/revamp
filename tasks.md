# Re:Vamp — Improvement Tasks

Synthesized from 4 parallel audits (Architecture, UX, DX, Accuracy). Each task lists files, evidence, and the concrete change.

Status legend: `[ ]` pending · `[~]` in progress · `[i]` impl done, awaiting review · `[r1]` review 1 done · `[r2]` review 2 done · `[x]` complete

---

## P0 — Correctness (the value prop is broken on real iPads)

### T1. [ ] Add `regenerator-runtime` so async functions actually run on iOS 9
- **Files**: `src/transformers/js-worker.ts:97`, `src/transformers/polyfills/index.ts`, `package.json:84-95`
- **Evidence**: Babel preset-env targets `safari 9` with `useBuiltIns: false`. No `@babel/runtime`/`regenerator-runtime`/`core-js` in deps. Every `async function` Babel transpiles emits `regeneratorRuntime` references → `ReferenceError` on real iOS 9.
- **Change**: Add `regenerator-runtime` (and `core-js@3` if going `useBuiltIns: 'usage'`) to deps. Inject `regenerator-runtime/runtime` source at the top of the polyfill bundle, OR switch worker to `useBuiltIns: 'usage'` with explicit `corejs: 3`. Verify with a fixture: an `async function f(){await Promise.resolve()}` source compiles+runs without `regeneratorRuntime is not defined`.

### T2. [ ] Replace placeholder `Symbol` polyfill (or stop UA-spoofing as Chrome 120 for Symbol-using sites)
- **Files**: `src/transformers/polyfills/symbol.ts:7-10`
- **Evidence**: Current "polyfill" is `'__symbol_<random>'` — a string. Breaks `typeof x === 'symbol'`, `Symbol.iterator`, every `for..of` over Map/Set, `Object.getOwnPropertySymbols`. UA spoof tells servers to ship modern code that uses Symbols → silent semantic failure.
- **Change**: Bring in `core-js/es/symbol` shim (closest fidelity), or remove the fake Symbol and let original Safari 9 absence error naturally — better than corrupt iteration semantics. Add unit test exercising `for..of` over a Map.

### T3. [ ] Ship missing string polyfills (`replaceAll`, `matchAll`)
- **Files**: `README.md:53`, `src/transformers/polyfills/string.ts`
- **Evidence**: README claims them; grep shows neither implemented.
- **Change**: Add both with a unit test each. Keep them as small inline polyfills consistent with existing style.

### T4. [ ] Fix cache cross-user data leak (cookies / Vary / method / `Cache-Control: private`)
- **Files**: `src/cache/index.ts:135-175` (`getCacheKey`), `src/cache/index.ts:284-331` (`setCache`)
- **Evidence**: Key = `clientIp + profileHash + configHash + url + contentType`. No cookies, no Vary, no method, no respect for `Cache-Control: no-store/private`. NAT'd users sharing one IP see each other's logged-in HTML.
- **Change**: (a) skip `setCache` when response carries `Set-Cookie` or `Cache-Control: no-store|private`; (b) when request carries `Cookie` or `Authorization`, exclude from cache OR include a sha256 of cookie names in the key; (c) include HTTP method in key. Add a vitest covering the leak repro.

### T5. [ ] CSS Grid → Flexbox: stop assuming Bootstrap 12-column
- **Files**: `src/transformers/css-grid-fallback.ts:117-134, 177`
- **Evidence**: Hardcoded `/12 * 100` for column widths; `hasGridProperties` regex matches `gap:` outside grid context, prepends duplicate `display: flex` on flex containers using `gap`.
- **Change**: Parse `grid-template-columns`. Handle at minimum `repeat(N, 1fr)` and explicit lists; fall back to no-op when shape isn't recognized (don't emit wrong widths). Tighten `hasGridProperties` to grid-specific properties only. Add fixtures for `repeat(3,1fr)`, `200px 1fr 200px`, and `display:flex; gap:8px;` (must be untouched).

### T6. [ ] Fix top-level-await rewrite that silently drops named exports
- **File**: `src/transformers/esm-bundler.ts:386-430` (regex at :393-404)
- **Evidence**: `export const x = await fetch(...)` becomes `const x = await fetch(...)` with no re-export — exports are lost.
- **Change**: Use Babel AST traversal (already imported in same file at :329-372) to wrap TLA bindings, preserving export semantics via async-IIFE + later `export { … }`. Add a fixture covering named, default, and re-exported TLA bindings.

---

## P0 — Security

### T7. [ ] Chmod CA private key to 0600
- **File**: `src/certs/index.ts:127`
- **Evidence**: `writeFileSync(caKeyPath, keyPem)` — default umask leaves the MITM root key world-readable. Same for per-domain `.key` files.
- **Change**: Pass `{ mode: 0o600 }` to all key writes; on Linux/macOS verify mode after write.

### T8. [ ] Default upstream cert validation to ON; surface failures honestly
- **Files**: `src/proxy/http-proxy.ts:627`, `src/proxy/http-client.ts:84`, `src/proxy/socks5.ts:517`, `src/transformers/esm-bundler.ts:171`, `src/transformers/sw-bundler.ts:105`
- **Evidence**: `rejectUnauthorized: false` everywhere. Revamp resigns under its trusted CA, so Wi-Fi MITM is laundered into a green padlock on the iPad.
- **Change**: Default `rejectUnauthorized: true`. On upstream cert failure, return a 502 HTML page explaining "upstream certificate failed validation" with the original hostname. Add an opt-in config flag `allowInsecureUpstream` (default false) for users who knowingly need it.

### T9. [ ] Stop injecting permissive CORS on every response
- **Files**: `src/proxy/shared.ts:692-700`, `src/proxy/http-proxy.ts:728`
- **Evidence**: `Access-Control-Allow-Origin: <client origin>` + `Access-Control-Allow-Credentials: true` on every response → every proxied site cross-origin readable by every other proxied site.
- **Change**: Remove the blanket injection. Add per-domain-profile opt-in CORS. Document the change.

### T10. [ ] Replace `eval(wrappedCode)` in module shim
- **File**: `src/transformers/esm-bundler.ts:886`
- **Evidence**: Direct `eval` of upstream JS. Combined with T8 = RCE on the iPad.
- **Change**: Replace with `new Function(...)` in a constrained scope, or generate a real concatenated bundle. Verify the existing fixtures pass.

### T11. [ ] Bound the per-SNI cert cache + rate-limit cert minting
- **File**: `src/certs/index.ts:30, 152-205`
- **Evidence**: `Map<sni, cert>` grows forever; trivial DoS via random subdomain CONNECTs.
- **Change**: LRU cap (start ≤500, 10-min TTL). Per-IP rate limit on cert minting (e.g. 30/min). Test with a stress fixture.

---

## P1 — Architecture

### T12. [ ] Unify the two HTTP request stacks; wire plugin hooks into both
- **Files**: `src/proxy/http-proxy.ts:539-786` and `src/proxy/http-client.ts:41-196, 209+`
- **Evidence**: SOCKS5 path (`http-client.ts`) never invokes `request:pre`/`response:post`. Bug fixes have to be applied twice.
- **Change**: Extract `processProxiedResponse(rawBody, headers, url, ctx)` and `runHooks(...)` helpers consumed by both. Add an integration test exercising a sample plugin via SOCKS5.

### T13. [ ] Wire `config:resolution` into the hot path
- **Files**: `src/proxy/http-proxy.ts:556`, `src/config/index.ts:336-361`
- **Evidence**: Hot path uses sync `getEffectiveConfig`, never `…Async` — the documented `config:resolution` hook is dead.
- **Change**: Switch to `await getEffectiveConfigForRequestAsync(parsedUrl.hostname, effectiveClientIp)` on both HTTP and SOCKS5 paths. Cover with a plugin test that overrides config via this hook.

### T14. [ ] Propagate response body between hooks
- **File**: `src/plugins/hook-executor.ts:436`
- **Evidence**: Multi-plugin response pipelines silently drop intermediate edits.
- **Change**: After merging `result.value`, mutate `(context as ResponseContext).body = currentValue.body ?? context.body` so subsequent hooks observe upstream edits. Add a 2-plugin chain test.

### T15. [ ] Enforce permissions on `registerHook`
- **File**: `src/plugins/context.ts:396-405`
- **Evidence**: Plugins with zero declared permissions can register `response:post` and rewrite bodies.
- **Change**: Map hook name → required permission (e.g. `response:post` → `response:modify`); reject `registerHook` on mismatch. Add a test asserting rejection.

### T16. [ ] Eliminate silent `catch {}` blocks
- **Files**: `src/cache/index.ts` (lines 80, 101, 114, 130, 143, 190, 277, 328, 361); `src/proxy/shared.ts:297, 647`; `src/logger/json-request-logger.ts:168, 183`; `src/proxy/remote-sw-server.ts` (~10 sites); `src/filters/index.ts:177, 386, 403`; `src/plugins/api.ts:395`
- **Evidence**: 30+ silent catches. Violates CLAUDE.md "no silent error swallowing." Cache write failures are invisible.
- **Change**: Replace each with `catch (err) { console.warn('[area] context', err); recordError(); }`. Where re-throwing is appropriate, do that instead. Each module: at minimum log.

### T17. [ ] Linearize `proxyRequest`
- **File**: `src/proxy/http-proxy.ts:539-786, 511-520, 832-840`
- **Evidence**: 247-line function with nested callbacks, dual try/catch, duplicate AggregateError flatten.
- **Change**: Extract `requestWithBody(opts, body): Promise<…>`; split into `prepareRequest` / `executeUpstream` / `transformResponseBody` (exists) / `applyPostHooks` / `sendResponse`. Single shared `flattenError` util.

### T18. [ ] Invalidate CSS processor cache when targets change
- **File**: `src/transformers/css.ts:13, 83-128, 244`
- **Evidence**: `getProcessor()` caches with `config.targets` baked in; `resetCssProcessor` exists but isn't called from `updateConfig`.
- **Change**: Call `resetCssProcessor()` from `updateConfig` when `targets` differs.

### T19. [ ] Tighten `shouldBlockUrl` matching to avoid false positives
- **File**: `src/proxy/shared.ts:611`
- **Evidence**: Substring match means `/stat/` matches `/architect/` and `/hit/` matches `/health-status/`.
- **Change**: `path === pattern || path.startsWith(pattern + '/') || path.endsWith('/' + pattern)`.

---

## P1 — UX

### T20. [ ] Replace silent 204/403/502 with explanatory HTML for navigation requests
- **Files**: `src/proxy/http-proxy.ts:333, 341, 523, 590, 812`
- **Evidence**: Blocked navigations look identical to network failures on iOS Safari. User has no signal.
- **Change**: When `Accept: text/html`, return small HTML with hostname, reason, and a deep link to `/__revamp__/admin/domains.html`. Keep machine-friendly statuses for non-HTML.

### T21. [ ] iOS-version-aware certificate trust instructions
- **Files**: `src/portal/index.ts:233-243`, `README.md:131`
- **Evidence**: README and portal use iOS 13+ wording ("VPN & Device Management"), but iOS 9 (the target!) just has Settings → General → Profile and trust is implicit.
- **Change**: UA-sniff and emit appropriate copy: iOS 9–11 → "Settings → General → Profile → Revamp Proxy CA → Install"; iOS 12.2+ → also point to Trust Settings. README mirrors the same.

### T22. [ ] Promote PAC URL above manual SOCKS5 in the captive portal
- **File**: `src/portal/index.ts:246-265`
- **Evidence**: PAC config is materially easier on iOS but is not in the portal.
- **Change**: Tabbed UI: "Easy (PAC)" first with a copy-button URL `http://${localIP}:8888/__revamp__/pac/socks5`; "Manual (SOCKS5)" second.

### T23. [ ] Mount admin panel on the captive portal port
- **Files**: `src/portal/index.ts:283`, `src/proxy/revamp-api.ts`
- **Evidence**: Admin panel is only reachable through a working proxy → catch-22 when setup is broken.
- **Change**: Reuse the admin handlers behind a route on the portal HTTP server too.

### T24. [ ] Convert metrics dashboard from `location.reload()` to fetch+patch; fix cache-hit-rate scale mismatch
- **Files**: `src/metrics/dashboard.ts:246-251`, `public/admin/js/dashboard.js:50`
- **Evidence**: Hard reload every 5s on iPad 2 Safari kills scroll. `dashboard.js` multiplies cacheHitRate by 100; metrics-dashboard server already returns it as a percent.
- **Change**: Port to fetch+patch DOM (mirror the admin pattern at `dashboard.js:97-108`). Single canonical scale (0..100 in API, render as-is). Add a unit test for the scale.

### T25. [ ] Add per-host transform/block counters and recent-URL list to admin
- **Files**: `src/metrics/index.ts`, admin `domains.html`
- **Evidence**: Today users have only global counters → no way to debug "why is youtube blank on my iPad."
- **Change**: Per-host Map of `{ blocked, transformedJs, transformedCss, errors, lastUrls[20] }`; render in domain panel.

### T26. [ ] README — point users to the IP printed by the banner
- **File**: `README.md:113-117`
- **Evidence**: Placeholder `YOUR_COMPUTER_IP` with no pointer to terminal output that already prints it.
- **Change**: Replace placeholder paragraph with: "After `pnpm start`, look at the terminal for `🌐 Your Local IP Address(es): 192.168.x.x`. Use that on your iPad."

---

## P2 — DX

### T27. [ ] Ship a runnable example plugin
- **Files**: new `examples/plugins/hello-world/` (manifest + `index.js` + vitest test using `createTestContext`)
- **Evidence**: zero `plugin.json` in repo despite "sample plugin system" commit.
- **Change**: Add a working plugin (e.g., header injector) with manifest, ESM `export default definePlugin(...)`, and a vitest covering its hooks via `createTestContext`. Add a tiny README in the folder.

### T28. [ ] Fix README plugin API drift (`getGlobalConfig` → `getConfig`; CJS → ESM)
- **Files**: `README.md:696-732, 746`
- **Evidence**: Sample uses `module.exports` in an ESM project; documented method name does not exist.
- **Change**: Rewrite the README block to ESM `export default …` and the real `ctx.getConfig()` API. Add a doc-test/script that imports each documented symbol so future drift fails CI.

### T29. [ ] Add `revamp/plugin` subpath export
- **File**: `package.json:7-13`
- **Evidence**: Plugin authors must depend on whole package or copy types.
- **Change**: Add `"./plugin": { "types": "./dist/plugins/index.d.ts", "import": "./dist/plugins/index.js" }` to `exports`. Verify a sample external project resolves it.

### T30. [ ] Stop forcing full `tsc` rebuild before unit tests
- **File**: `vitest.setup.ts:10-15`
- **Evidence**: Single-test loop ~20s. Setup shells `pnpm build` if a single worker file is missing.
- **Change**: Build only `src/transformers/js-worker.ts` (and any other worker files) on-demand: `tsc --project tsconfig.workers.json` (new minimal config), or load via `tsx` in tests.

### T31. [ ] Add ESLint with the rules that catch present bugs
- **Files**: new `.eslintrc.cjs`, `package.json` scripts, `.github/workflows/ci.yml`
- **Evidence**: `package.json:45` is a placeholder. There's an unused `err` at `src/plugins/api.ts:395` and a floating promise at `src/plugins/loader.ts:606-615`.
- **Change**: ESLint with `@typescript-eslint/recommended-type-checked` plus `no-unused-vars` (error on `err`), `no-floating-promises`, `no-misused-promises`, `no-empty-function`. `pnpm lint` script; CI step.

### T32. [ ] Pin pnpm via `packageManager` and use corepack everywhere
- **Files**: `package.json`, `Dockerfile:10`, `Dockerfile.dev`, `.github/workflows/ci.yml:18`
- **Evidence**: Three different pnpm versions across environments.
- **Change**: `"packageManager": "pnpm@9.15.9"` + `corepack enable` in Dockerfiles + CI uses `pnpm/action-setup@v3` honoring packageManager.

### T33. [ ] Speed up the local Playwright loop
- **File**: `playwright.config.ts:6-8, 50, 60`
- **Evidence**: `reuseExistingServer: false` rebuilds the proxy on every spec.
- **Change**: `reuseExistingServer: !process.env.CI`. Optionally allow workers > 1 locally.

### T34. [ ] Set vitest coverage thresholds
- **File**: `vitest.config.ts:12-27`
- **Evidence**: No threshold → silent regressions.
- **Change**: `thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 }` (tune to current numbers minus 5%).

---

## Execution plan (manager notes)

Implementation grouping (one agent per group), each followed by **two review rounds**:

- **Batch A — Polyfills & JS transform** (T1, T2, T3, T6)
- **Batch B — Cache correctness** (T4, T18, T19)
- **Batch C — Cert & TLS security** (T7, T8, T11)
- **Batch D — Plugin system fixes** (T13, T14, T15)
- **Batch E — Proxy unification & error handling** (T12, T16, T17)
- **Batch F — UX surface** (T20, T21, T22, T23, T24, T25, T26)
- **Batch G — Security non-cert** (T9, T10)
- **Batch H — DX & tooling** (T27, T28, T29, T30, T31, T32, T33, T34)

Order: A, B, C, H run in parallel first (low cross-coupling). E (proxy unification) is the foundation for D and G — runs second. D and F run after E. G runs last (touches proxy code that E refactored).

---

## Status as of seam verification (2026-05-07)

Final cross-batch SEAM verification per the CLAUDE.md "Multi-Agent Integration Rule". All eight batches landed; the seams listed below were exercised end-to-end via the unit suite (1084 passing) and spot-checked by reading caller↔handler signatures.

### Batches done
- **A** — Polyfills (T1, T2, T3, T6): `regenerator-runtime` injected, `Symbol`/`replaceAll`/`matchAll` shipped, TLA AST rewrite preserves named exports.
- **B** — Cache (T4, T18, T19): cookie/method/Cache-Control isolation in `getCacheKey`/`setCache`; `resetCssProcessor()` invoked from `updateConfig`; `pathMatchesBlocklistPattern` shared by both `shouldBlockUrl` and `shouldBlockUrlWithProfile`.
- **C** — Cert/TLS (T7, T8, T11): `KEY_FILE_MODE = 0o600` enforced via `writeKeyFileSecure`; `rejectUnauthorized` defaults to `!allowInsecureUpstream` in all 7 upstream call sites; per-SNI LRU + per-IP rate-limit (30/min) in `generateDomainCert`; `__testing.ts` excluded from `dist/`.
- **D** — Plugin system (T13, T14, T15): `config:resolution` wired via `getEffectiveConfigForRequestAsync` on both HTTP and SOCKS5 hot paths; `executeChain` propagates `body`/`headers`/`statusCode` for `response:post` and `content` for `transform:pre|post`; `registerHook` enforces `HOOK_PERMISSION_REQUIREMENTS`.
- **E** — Proxy unification (T12, T16, T17): `processProxiedResponse`/`requestWithBody` shared by HTTP and SOCKS5 paths; `proxyRequest` linearised into `prepareRequest` → `executeUpstream` → `sendProcessedResponse`; silent catches replaced with logged warns; body-size limits (`maxRequestBodyBytes` / `maxResponseBodyBytes`) wired to 413/502 responses.
- **F** — UX (T20–T26): HTML error pages (`buildBlockedNavigationPage`, `buildUpstreamCertFailurePage`, `buildUpstreamErrorPage`) honoured via `clientAcceptsHtml`; iOS-version copy in portal; PAC tab; admin panel mounted on portal; metrics dashboard moved to fetch+patch; per-host LRU metrics via `recordHostBlocked|Transform|Error`.
- **G** — Security non-cert (T9, T10): default-OFF CORS injection; `resolveCorsAllowOrigin` collapses `*` + credentials to no-injection; `eval` replaced with `new Function` in module shim.
- **H** — DX (T27–T34): example plugin `examples/plugins/hello-world/` with manifest declaring `response:modify` permission for `response:post`; ESLint at 0 errors; `packageManager: "pnpm@9.15.9"`; `tsconfig.workers.json` for vitest worker build; `revamp/plugin` subpath export present and resolves to `dist/plugins/index.{js,d.ts}`.

### Seams verified clean
- `transformContent(body, contentType, url, charset, config?, clientIp?, method, requestHeaders?, responseHeaders?)` — single canonical signature consumed by `processProxiedResponse` (http-client.ts:172) and tests (shared.test.ts).
- `getCached(url, contentType, clientIp?, method, requestHeaders?)` and `setCache(url, contentType, data, clientIp?, method, requestHeaders?, responseHeaders?)` — plugin context wraps both with full arg propagation (context.ts:550, :563).
- `generateDomainCert(domain, clientIp?)` — both CONNECT call sites pass `clientIp` (http-proxy.ts:1131 via `resolveBucketClientIp`, socks5.ts:599); `CertRateLimitError` translated to 429 (HTTP) and SOCKS5 general-failure reply.
- `getEffectiveConfigForRequestAsync` awaited on both HTTP (http-proxy.ts:732) and SOCKS5 (http-client.ts:338 via `runPreHooksForSocksRequest`) hot paths; `config:resolution` is no longer dead.
- `HOOK_PERMISSION_REQUIREMENTS` is the single source of truth (hooks.ts:26); production `createPluginContext` and the test harness both import it.
- Hook-chain body propagation in `executeChain` mutates `ResponseContext.body|responseHeaders|statusCode` and `TransformContext.content` between hops (hook-executor.ts:438–472).
- Error path consistency: 429 for cert rate-limit, 500 for cert mint generic, 502 HTML/plain for upstream cert (sendUpstreamCertFailure), 413 for request body too large, 502 with "exceeds" message for response body too large, 200 HTML for blocked navigations on `Accept: text/html`. All paths log via `console.warn|error` and call `recordError()`/`recordHostError()` — no silent swallows.
- Config schema: `allowInsecureUpstream`, `maxRequestBodyBytes`, `maxResponseBodyBytes` present in `RevampConfig` (config/index.ts:47, :65–66); `corsAllowOrigins`, `corsAllowCredentials` present in `DomainProfile` (config/domain-rules.ts:89, :96).
- Build artefacts: `dist/certs/__testing*` absent; `dist/plugins/index.{js,d.ts}` present.

### Open follow-ups (P2; not blocking)
- T2 baseline: a fully spec-correct `Symbol` polyfill is still out of scope for the iOS 9 baseline. The current shim covers `for..of`/iteration semantics for proxied modern bundles but is not a drop-in `core-js/es/symbol`. Tracked alongside T2.
- README does not document `maxRequestBodyBytes` / `maxResponseBodyBytes` (Batch E added them to the schema). Recommend a short paragraph next to the existing CORS section.
- SOCKS5 `parseHttpRequest` (socks5.ts:177) does not bound the inbound body via `maxRequestBodyBytes`; the cap currently only applies on the HTTP-proxy path. A malicious client speaking SOCKS5 could still upload an unbounded body. Low priority — same client could DoS via sheer connection volume — but worth a follow-up to call `maxRequestBodyBytes` here too.
- `shouldBlockDomain` / `shouldBlockUrl` at SOCKS5 CONNECT time (socks5.ts:352, :869) and HTTP CONNECT time (http-proxy.ts:1109) consult the *global* config rather than per-domain profile/per-IP overrides. Acceptable today (only `hostname:port` is known at CONNECT) but worth documenting.
- Lint baseline: 413 warnings (mostly `no-unsafe-*` in `transformers/esm-bundler.ts` and unused-imports in tests). Zero errors. Reducing the warning count is a separate quality pass.

---

## Batch I — Independent-review follow-ups (2026-05-07)

After 8 batches landed and the seam pass passed, four independent opus reviewers (security, correctness, architecture, DX) re-audited with fresh eyes and found 12 P0/P1 issues the per-batch reviewers missed. Batch I addresses all of them.

### Sub-batches

- **I-1 — ESM bundler corrections**
  - **T35** `for await` not detected as TLA → ships raw to iOS 9 → `SyntaxError`. `src/transformers/esm-bundler.ts:340-360` `detectTopLevelAwait` only visits `AwaitExpression`; Babel emits `for await` as `ForOfStatement` with `await: true`. **Fix**: add `ForOfStatement(path) { if (path.node.await) hasTopLevelAwait = true; }` with the function-parent guard. Move `for await` body into the IIFE in `wrapTopLevelAwait`.
  - **T36** `class Foo extends Base` where `Base = await ...` → `ReferenceError` at module top because `Base` lives inside the IIFE while the `class` was hoisted to top-level by the specifier-only export branch. `src/transformers/esm-bundler.ts:639-646`. **Fix**: when a class is referenced by a specifier-only export AND its `superClass`/decorators reference any IIFE-local binding, leave the class IN the IIFE; emit `let Foo;` at top + `Foo = class extends Base {}` inside the IIFE; export goes through hoist-and-assign.

- **I-2 — T5 (CSS Grid → Flexbox fallback)** — *was never assigned to any of A–H; surfaced in original audit, lost during batching*
  - `src/transformers/css-grid-fallback.ts:117-134` hardcodes `/12 * 100` for column widths.
  - `:177` `hasGridProperties` regex matches `gap:` outside grid context, prepending duplicate `display: flex` on flex-with-gap rules.
  - **Fix**: parse `grid-template-columns`; handle `repeat(N, 1fr)` and explicit lists; bail out (no-op) when shape isn't recognised. Tighten `hasGridProperties` to grid-only properties (`grid`, `grid-template`, `grid-area`, etc. — exclude `gap` standalone). Add fixtures: `repeat(3, 1fr)`, `200px 1fr 200px`, `display:flex; gap:8px;` (must be untouched).

- **I-3 — Plugin/security/correctness hardening**
  - **T37** Plugin permission bypass via direct `pluginRegistry.registerHook`. `src/plugins/index.ts:81` re-exports `pluginRegistry`; `package.json#exports` exposes it via `revamp/plugin`. **Fix**: stop re-exporting `pluginRegistry` from the public surface (or add the same `HOOK_PERMISSION_REQUIREMENTS` check inside `pluginRegistry.registerHook` for defence-in-depth).
  - **T38** SOCKS5 `parseHttpRequest` body unbounded. `src/proxy/socks5.ts:177-206`. **Fix**: enforce `maxRequestBodyBytes` like `bufferRequestBody`; reject `Content-Length > limit` early; cap the read loop at `min(contentLength, limit)`; respond 413 to the SOCKS5 client.
  - **T39** Plugin `fetch` SSRF gaps. `src/plugins/context.ts:42-111` `isUrlSafeToFetch` is host-string only. **Fix**: post-resolve DNS check; pin lookup so check IP == fetch IP; explicitly block `::ffff:0:0/96`, `fc00::/7`, `fe80::/10`; consider blocking decimal/octal IPv4 forms.
  - **T40** `request:pre` body/url propagation missing in hook chain. `src/plugins/hook-executor.ts:443-472`. **Fix**: extend the propagation block to mutate `RequestContext.url`/`headers` when `result.value` includes them.
  - **T41** Cache key has no `Vary`. `src/cache/index.ts:192-241`. **Fix**: parse upstream `Vary`; for each varied header hash the request value into the cache key; treat `Vary: *` as uncacheable.

- **I-4 — Docs & config drift**
  - **T42** README plugin testing import path doesn't resolve. `README.md:970` says `from 'revamp/plugins/testing'` but only `.` and `./plugin` are exported. **Fix**: either add a `./plugins/testing` subpath export OR update the README to `from 'revamp/plugin'`.
  - **T43** CHANGELOG missing T1, T2, T3, T4, T6, T17, T20–T26. **Fix**: add entries under Added/Fixed/Breaking. T4 needs an explicit "requests with `Cookie`/`Authorization` are no longer cached" Breaking note.
  - **T44** `Dockerfile:5` and `Dockerfile.dev:4` pin `node:25-alpine`; `engines` says `>=20`; CI matrix is 20/22/23/24. **Fix**: pin Dockerfile to `node:24-alpine` so it stays inside the supported / tested range.
  - **T45** README options table missing `maxRequestBodyBytes`, `maxResponseBodyBytes`, `allowInsecureUpstream`. **Fix**: add rows with defaults and one-line descriptions.
  - **T46** Sharp install troubleshooting missing. **Fix**: add a "Troubleshooting" stanza referencing `pnpm rebuild sharp`.
  - **T47** `examples/plugins/hello-world/README.md:27` run command wrong (`pnpm test:unit examples/...` won't pass the path through). **Fix**: replace with `pnpm exec vitest run examples/plugins/hello-world/index.test.ts`.

### Order

I-1, I-2, I-3, I-4 are file-disjoint and can run in parallel. Each gets one implementer + 2 review rounds. After all four complete, a final spec-completeness check confirms every tasks.md `T#` is assigned to a batch (this should have been done before A; absent, T5 fell through).
