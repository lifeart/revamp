# Re:Vamp 

[![CI](https://github.com/lifeart/revamp/actions/workflows/ci.yml/badge.svg)](https://github.com/lifeart/revamp/actions/workflows/ci.yml) [![Docker](https://github.com/lifeart/revamp/actions/workflows/docker.yml/badge.svg)](https://github.com/lifeart/revamp/actions/workflows/docker.yml)
[![codecov](https://codecov.io/gh/lifeart/revamp/branch/master/graph/badge.svg)](https://codecov.io/gh/lifeart/revamp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io%2Flifeart%2Frevamp-blue)](https://ghcr.io/lifeart/revamp)

<img align="right" width="95" height="95"
     alt="ReVamp logo"
     src="public/revamp-logo.png">

**Legacy Browser Compatibility Proxy** — Transform modern web content for older devices like iPads and iPods running iOS 9+.

Give your old iPad 2, iPad Mini, or iPod Touch a second life by making modern websites work again!

## ✨ Features

### Core Proxy Features

- **🔧 JavaScript Transpilation** — Babel transforms modern JS (optional chaining, nullish coalescing, async/await) to ES5/ES6
- **🎨 CSS Transformation** — PostCSS adds vendor prefixes and transforms modern CSS features
- **📄 HTML Modification** — Injects polyfills and can remove ads/tracking scripts
- **🖼️ Image Optimization** — Converts WebP/AVIF to JPEG/PNG for legacy browser support
- **📦 ES Module Bundling** — esbuild-based bundler converts ES modules to legacy-compatible bundles
- **🔒 HTTPS Interception** — Transparent SSL/TLS interception with auto-generated certificates
- **🧦 SOCKS5 Proxy** — Device-wide traffic routing (recommended for iOS)
- **🌐 HTTP Proxy** — Alternative proxy method
- **💾 Smart Caching** — Memory + disk caching for faster repeat visits
- **🎭 User-Agent Spoofing** — Bypass browser detection (optional)
- **🚫 Ad & Tracking Removal** — Block common ad networks and trackers
- **📱 Easy Setup** — Built-in captive portal for certificate installation
- **🔄 Remote Service Workers** — Bridge server for Service Worker emulation on legacy devices
- **📱 Multi-Device Support** — Per-client configuration with IP-based settings
- **🎯 Domain Profiles** — Per-domain filtering rules with pattern matching (exact, wildcard, regex)

### Polyfills for Legacy Browsers (30+)

- **Promise.finally, Promise.allSettled** — Modern Promise methods
- **fetch API** — Full fetch/Headers/Response polyfill
- **IntersectionObserver** — Lazy loading support
- **ResizeObserver** — Element resize detection
- **MutationObserver** — DOM mutation detection (enhanced)
- **WeakMap/WeakSet** — Weak reference collections
- **Web Components** — Custom Elements v1 and basic Shadow DOM
- **Intl API** — Basic DateTimeFormat and NumberFormat
- **Service Worker Bypass** — Disables SW registration for compatibility
- **Lazy Loading** — Polyfill for `loading="lazy"` attribute
- **AbortController** — Request cancellation support
- **Array methods** — flat, flatMap, from, includes, and more
- **Object methods** — entries, values, fromEntries
- **String methods** — padStart, padEnd, replaceAll
- **CustomEvent** — Custom event creation and dispatch

### CSS Enhancements

- **CSS Grid → Flexbox Fallback** — Auto-generate flexbox fallbacks for CSS Grid
- **Dark Mode Stripping** — Remove `prefers-color-scheme` media queries
- **Vendor Prefixes** — Automatic -webkit- prefixes for Safari 9

### DevOps & Monitoring

- **🎛️ Admin Panel** — Full-featured web UI at `/__revamp__/admin` for managing profiles and configuration
- **📊 Metrics Dashboard** — Real-time web UI at `/__revamp__/metrics`
- **🐳 Docker Support** — Production and development Dockerfiles
- **📋 PAC File Generation** — Auto-generate proxy config files
- **⚙️ External Config** — JSON config for blocked domains
- **🔌 Plugin System** — Extensible architecture with hooks for request/response lifecycle, transforms, and filtering

### Performance Optimizations

- **🧵 Babel Worker Pool** — JavaScript transforms run in parallel worker threads via [tinypool](https://github.com/tinylibs/tinypool)
- **⚡ Async Compression** — Non-blocking gzip compression/decompression
- **🎚️ Configurable Compression** — Adjustable gzip level (1-9) for speed vs size tradeoff
- **📈 Up to 9x speedup** — Parallel compression achieves significant performance gains

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/lifeart/revamp.git
cd revamp

# Install dependencies (pnpm recommended)
pnpm install

# Start the proxy
pnpm start

# Or in development mode (auto-reload)
pnpm dev
```

### Docker Installation

```bash
# Build and run with Docker
docker build -t revamp .
docker run -p 1080:1080 -p 8080:8080 -p 8888:8888 revamp

# Or use Docker Compose
docker-compose up -d

# Development mode with hot-reload
docker-compose --profile dev up revamp-dev
```

### Device Setup

1. **Start Revamp** on your computer
2. **Find your local IP**: After `pnpm start`, look at the terminal for `🌐 Your Local IP Address(es): 192.168.x.x`. Use that IP on your iPad.
3. **Open the setup page** on your legacy device by navigating to `http://<that IP>:8888`
4. **Install the certificate** and enable trust (see detailed instructions below)
5. **Configure proxy** in Wi-Fi settings

## 📱 Detailed Setup

### Installing the CA Certificate

When you start Revamp, a CA certificate is generated at `.revamp-certs/ca.crt`.

**On iOS:**

The captive portal sniffs your User-Agent and renders the right copy automatically. The two paths:

_iOS 9 / 10.0–10.2 (e.g. iPad 2):_

1. Open `http://<your IP>:8888` in Safari
2. Tap "Download Certificate"
3. Go to **Settings → General → Profile**
4. Tap on **Revamp Proxy CA** and tap **Install**

(There is no Trust Settings step on these versions — installing the profile grants trust outright.)

_iOS 10.3+ (including iOS 12.2 hardening):_

1. Open `http://<your IP>:8888` in Safari
2. Tap "Download Certificate"
3. Go to **Settings → General → VPN & Device Management** (older iOS: **Settings → General → Profile**)
4. Install the downloaded profile
5. Go to **Settings → General → About → Certificate Trust Settings**
6. Enable full trust for **Revamp Proxy CA**

**On macOS:**

1. Open the `.revamp-certs/ca.crt` file
2. Add to Keychain Access
3. Find "Revamp Proxy CA", double-click, expand Trust
4. Set "When using this certificate" to "Always Trust"

### Configuring the Proxy

**SOCKS5 (Recommended for iOS):**

- **Settings → Wi-Fi → [Your Network] → Configure Proxy**
- Select **Manual**
- Server: your IP, see the `🌐 Your Local IP Address(es)` banner printed by `pnpm start` (also covered in [Device Setup](#device-setup))
- Port: `1080`

**HTTP Proxy (Alternative):**

- Server: your IP, see the `🌐 Your Local IP Address(es)` banner printed by `pnpm start` (also covered in [Device Setup](#device-setup))
- Port: `8080`

## ⚙️ Configuration

Edit `src/config/index.ts` or pass options when creating the server:

```typescript
import { createRevampServer } from "revamp";

const server = createRevampServer({
  // Server ports
  socks5Port: 1080,
  httpProxyPort: 8080,
  captivePortalPort: 8888,

  // Target browsers (Browserslist format)
  targets: ["safari 9", "ios 9"],

  // Feature toggles
  transformJs: true, // Babel transpilation
  transformCss: true, // PostCSS transformation
  transformHtml: true, // HTML polyfill injection
  bundleEsModules: true, // Bundle ES modules for legacy browsers
  emulateServiceWorkers: true, // Service Worker bypass/emulation
  remoteServiceWorkers: true, // Remote Service Worker bridge
  removeAds: true, // Block ad domains
  removeTracking: true, // Block tracking domains
  injectPolyfills: true, // Add polyfills for missing APIs
  spoofUserAgent: true, // Send modern User-Agent to servers
  spoofUserAgentInJs: true, // Override navigator.userAgent

  // Cache settings
  cacheEnabled: true,
  cacheTTL: 3600, // seconds

  // Performance tuning
  compressionLevel: 4, // gzip level 1-9 (1=fastest, 9=smallest)

  // TLS / upstream certificate validation (T8). Default: validate upstream
  // TLS certs and surface failures as a 502. Set this to `true` ONLY if you
  // knowingly need to talk to self-signed dev/staging servers — Revamp
  // re-signs upstream traffic with its own CA, so accepting an invalid
  // upstream cert silently launders any Wi-Fi MITM into a green padlock on
  // the iPad.
  allowInsecureUpstream: false,
});

server.start();
```

### Runtime Configuration API

You can change settings at runtime via the config API:

```javascript
// From your legacy device's browser console or code:
fetch("http://any-proxied-site/__revamp__/config", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    transformJs: false, // Disable JS transformation
    removeAds: false, // Allow ads
  }),
});
```

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Legacy Device  │────▶│  SOCKS5 Proxy   │────▶│  Target Server  │
│   (iOS 9+)      │     │   (port 1080)   │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────────────────────────────┐
                        │         Transformation Pipeline         │
                        ├─────────────────────────────────────────┤
                        │  1. Intercept request                   │
                        │  2. Check cache                         │
                        │  3. Fetch from origin server            │
                        │  4. Transform content:                  │
                        │     • JS → Babel (ES5/ES6)              │
                        │     • CSS → PostCSS (prefixes)          │
                        │     • HTML → Cheerio (polyfills)        │
                        │  5. Cache transformed result            │
                        │  6. Return to client                    │
                        └─────────────────────────────────────────┘
```

### Request Flow (Admin Panel vs Proxied Content)

```
                              ┌─────────────────────┐
                              │   Incoming Request  │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │ Is /__revamp__/* ?  │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │ YES                │                    │ NO
                    ▼                    │                    ▼
       ┌────────────────────┐            │       ┌────────────────────┐
       │   Revamp API       │            │       │   Normal Proxy     │
       │   (Direct serve)   │            │       │   Pipeline         │
       ├────────────────────┤            │       ├────────────────────┤
       │ • Admin panel      │            │       │ • Domain blocking  │
       │ • Config API       │            │       │ • URL filtering    │
       │ • Domain API       │            │       │ • JS transform     │
       │ • Metrics          │            │       │ • CSS transform    │
       │ • PAC files        │            │       │ • HTML transform   │
       │ • SW endpoints     │            │       │ • Image convert    │
       ├────────────────────┤            │       │ • Caching          │
       │ NO transformations │            │       │ • Compression      │
       │ NO caching         │            │       └────────────────────┘
       │ NO filtering       │            │
       └────────────────────┘            │
```

This design ensures the admin panel always works correctly, even when aggressive filtering or transformation options are enabled.

## 📁 Project Structure

```
src/
├── index.ts              # Main entry point
├── config/               # Configuration management
│   ├── index.ts          # Config defaults and getters
│   ├── client-options.ts # Single source of truth for client options
│   ├── domain-rules.ts   # Domain profile types
│   ├── domain-manager.ts # Profile CRUD and matching
│   └── storage.ts        # File persistence utilities
├── filters/              # Modular filtering system
│   └── index.ts          # Ad/tracking pattern management
├── plugins/              # Plugin system
│   ├── index.ts          # Public API exports
│   ├── types.ts          # Core types (PluginManifest, RevampPlugin, etc.)
│   ├── hooks.ts          # Hook type definitions
│   ├── registry.ts       # Plugin registry (singleton)
│   ├── loader.ts         # Plugin discovery & lifecycle
│   ├── context.ts        # Sandboxed plugin context API
│   ├── hook-executor.ts  # Interceptor chain execution
│   ├── validation.ts     # Manifest validation
│   └── api.ts            # REST endpoints for plugin management
├── proxy/                # Proxy servers
│   ├── http-proxy.ts     # HTTP/HTTPS proxy
│   ├── socks5.ts         # SOCKS5 proxy
│   ├── socks5-protocol.ts # SOCKS5 protocol implementation
│   ├── http-client.ts    # HTTP request utilities
│   ├── shared.ts         # Shared utilities
│   ├── revamp-api.ts     # API endpoint handler
│   ├── domain-rules-api.ts # Domain profiles REST API
│   ├── remote-sw-server.ts # Remote Service Worker bridge
│   └── types.ts          # Type definitions
├── transformers/         # Content transformation
│   ├── js.ts             # JavaScript (Babel worker pool)
│   ├── js-worker.ts      # Babel worker thread
│   ├── css.ts            # CSS (PostCSS)
│   ├── css-grid-fallback.ts # CSS Grid → Flexbox
│   ├── dark-mode-strip.ts # Dark mode CSS removal
│   ├── html.ts           # HTML (Cheerio)
│   ├── image.ts          # Image optimization
│   ├── esm-bundler.ts    # ES module bundler
│   ├── sw-bundler.ts     # Service Worker bundler
│   └── polyfills/        # 30+ polyfill scripts
├── metrics/              # Metrics collection
├── pac/                  # PAC file generation
├── cache/                # Caching system
├── certs/                # Certificate generation
├── portal/               # Captive portal
└── benchmarks/           # Performance benchmarks

public/
├── revamp-logo.png       # Logo asset
└── admin/                # Admin panel web UI
    ├── index.html        # Dashboard
    ├── domains.html      # Domain profiles management
    ├── config.html       # Configuration page
    ├── plugins.html      # Plugin management
    ├── sw.html           # Service Workers status
    ├── css/admin.css     # Shared styles
    └── js/               # JavaScript modules

.revamp-plugins/          # Plugin installation directory
├── plugins.json          # Global plugin config
└── com-example-plugin/   # Individual plugin
    ├── plugin.json       # Plugin manifest
    └── index.js          # Entry point

tests/                    # E2E tests (Playwright)
config/                   # External configuration (blocked domains)
```

## 🌐 API Endpoints

All API endpoints are available on any proxied domain at `/__revamp__/*`:

| Endpoint                          | Description                           |
| --------------------------------- | ------------------------------------- |
| `/__revamp__/admin`               | Admin panel web UI                    |
| `/__revamp__/config`              | GET/POST/DELETE proxy configuration   |
| `/__revamp__/domains`             | GET/POST domain profiles              |
| `/__revamp__/domains/:id`         | GET/PUT/DELETE specific profile       |
| `/__revamp__/domains/match/:host` | GET test which profile matches a host |
| `/__revamp__/metrics`             | HTML metrics dashboard                |
| `/__revamp__/metrics/json`        | JSON metrics data                     |
| `/__revamp__/pac/socks5`          | SOCKS5 PAC file download              |
| `/__revamp__/pac/http`            | HTTP PAC file download                |
| `/__revamp__/pac/combined`        | Combined PAC file download            |
| `/__revamp__/sw/bundle`           | GET Service Worker bundling (URL-based) |
| `/__revamp__/sw/inline`           | POST Service Worker transformation    |
| `/__revamp__/sw/remote`           | WebSocket for remote SW execution     |
| `/__revamp__/sw/remote/status`    | GET remote SW server status           |
| `/__revamp__/plugins`             | GET all plugins, POST load all        |
| `/__revamp__/plugins/discover`    | GET available plugins in directory    |
| `/__revamp__/plugins/load-all`    | POST load and activate all plugins    |
| `/__revamp__/plugins/:id`         | GET plugin info, DELETE unload        |
| `/__revamp__/plugins/:id/activate`| POST activate a plugin                |
| `/__revamp__/plugins/:id/deactivate`| POST deactivate a plugin            |
| `/__revamp__/plugins/:id/reload`  | POST reload a plugin                  |
| `/__revamp__/plugins/:id/config`  | PUT update plugin configuration       |
| `/__revamp__/plugins/metrics`     | GET all plugin metrics, DELETE reset  |
| `/__revamp__/plugins/:id/metrics` | GET/DELETE plugin-specific metrics    |

### Admin Panel

Access the full-featured admin panel at `http://any-proxied-site/__revamp__/admin`:

- **Dashboard** - System status, metrics overview, and quick actions
- **Domain Profiles** - Create, edit, and delete domain-specific filtering rules
- **Configuration** - Toggle transformation and filtering options
- **Service Workers** - Monitor remote SW server status

The admin panel is designed to work on legacy browsers (Safari 9+, iOS 9+) with vanilla JavaScript.

**Bypass Guarantees**: All `/__revamp__/*` endpoints (including the admin panel) are handled **before** the proxy transformation pipeline runs. This ensures:

| Feature | Admin Panel Status |
|---------|-------------------|
| JavaScript transpilation (Babel) | Bypassed |
| CSS transformation (PostCSS) | Bypassed |
| HTML modification (polyfills) | Bypassed |
| Ad blocking | Bypassed |
| Tracking removal | Bypassed |
| Proxy-level caching | Bypassed |
| User-Agent spoofing | Bypassed |

The admin panel files are served directly from disk without any modifications, ensuring the UI always works correctly regardless of proxy configuration.

### Metrics Dashboard

Access real-time statistics at `http://any-proxied-site/__revamp__/metrics`:

- Uptime and connection stats
- Cache hit rate
- Transformation counts (JS/CSS/HTML/Images)
- Bandwidth usage
- Blocked requests count

### PAC Files

PAC (Proxy Auto-Config) files make device setup easier:

```bash
# Get PAC file URL for iOS configuration (replace <your IP> with the
# address from the `🌐 Your Local IP Address(es)` banner printed by
# `pnpm start` — see Device Setup above).
http://<your IP>:8888/__revamp__/pac/socks5
```

Configure iOS: **Settings → Wi-Fi → [Network] → Configure Proxy → Automatic** → Enter PAC URL

### Domain Profiles

Domain profiles allow per-domain configuration of filtering rules and transformations. This enables fine-grained control over ad blocking, tracking removal, and content transformation for specific websites.

**Create a profile:**

```bash
curl -X POST http://any-proxied-site/__revamp__/domains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "YouTube Optimization",
    "patterns": [
      { "type": "suffix", "pattern": "*.youtube.com" },
      { "type": "suffix", "pattern": "*.googlevideo.com" }
    ],
    "priority": 100,
    "transforms": {
      "transformJs": true,
      "bundleEsModules": true
    },
    "removeAds": true,
    "removeTracking": true,
    "customAdPatterns": ["ad_break", "adPlacements"],
    "customAdSelectors": [".video-ads", ".ytp-ad-module"],
    "enabled": true
  }'
```

**Pattern types:**

- `exact` - Exact domain match (e.g., `example.com`)
- `suffix` - Wildcard suffix match (e.g., `*.google.com` matches `www.google.com`, `mail.google.com`)
- `regex` - Regular expression match (e.g., `^.*\.example\.(com|org)$`)

**List all profiles:**

```bash
curl http://any-proxied-site/__revamp__/domains
```

**Get a specific profile:**

```bash
curl http://any-proxied-site/__revamp__/domains/youtube-profile-id
```

**Update a profile:**

```bash
curl -X PUT http://any-proxied-site/__revamp__/domains/youtube-profile-id \
  -H "Content-Type: application/json" \
  -d '{ "removeAds": false }'
```

**Delete a profile:**

```bash
curl -X DELETE http://any-proxied-site/__revamp__/domains/youtube-profile-id
```

**Test which profile matches a domain:**

```bash
curl http://any-proxied-site/__revamp__/domains/match/www.youtube.com
```

**Example profiles:**

<details>
<summary>Social Media (Facebook, Twitter, Instagram)</summary>

```bash
curl -X POST http://any-proxied-site/__revamp__/domains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Social Media",
    "patterns": [
      { "type": "suffix", "pattern": "*.facebook.com" },
      { "type": "suffix", "pattern": "*.twitter.com" },
      { "type": "suffix", "pattern": "*.x.com" },
      { "type": "suffix", "pattern": "*.instagram.com" }
    ],
    "priority": 90,
    "transforms": {
      "transformJs": true,
      "transformCss": true
    },
    "removeAds": true,
    "removeTracking": true,
    "customAdSelectors": [
      "[data-testid=\"placementTracking\"]",
      "[data-ad-preview]",
      ".sponsored-post"
    ],
    "enabled": true
  }'
```
</details>

<details>
<summary>News Sites (lightweight mode)</summary>

```bash
curl -X POST http://any-proxied-site/__revamp__/domains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "News Sites",
    "patterns": [
      { "type": "suffix", "pattern": "*.cnn.com" },
      { "type": "suffix", "pattern": "*.bbc.com" },
      { "type": "suffix", "pattern": "*.nytimes.com" }
    ],
    "priority": 80,
    "transforms": {
      "transformJs": true,
      "transformCss": true,
      "transformHtml": true
    },
    "removeAds": true,
    "removeTracking": true,
    "customAdSelectors": [
      ".ad-container",
      ".advertisement",
      "[data-ad-unit]"
    ],
    "enabled": true
  }'
```
</details>

<details>
<summary>Disable transformations for specific site</summary>

```bash
curl -X POST http://any-proxied-site/__revamp__/domains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Banking (no transforms)",
    "patterns": [
      { "type": "suffix", "pattern": "*.mybank.com" }
    ],
    "priority": 200,
    "transforms": {
      "transformJs": false,
      "transformCss": false,
      "transformHtml": false
    },
    "removeAds": false,
    "removeTracking": false,
    "enabled": true
  }'
```
</details>

**Configuration hierarchy:**

```
Domain Profile (highest priority)
       ↓
Client Defaults (per-IP settings)
       ↓
Global Defaults (server-wide fallback)
```

**Profile fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable profile name |
| `patterns` | array | Domain matching patterns |
| `priority` | number | Higher = matched first (default: 0) |
| `transforms` | object | Override transform settings |
| `removeAds` | boolean | Enable ad blocking for this domain |
| `removeTracking` | boolean | Enable tracking removal |
| `customAdPatterns` | array | Additional script patterns to block |
| `customAdSelectors` | array | CSS selectors for ad containers |
| `customTrackingPatterns` | array | Additional tracking script patterns |
| `customTrackingSelectors` | array | CSS selectors for tracking elements |
| `corsAllowOrigins` | array | Origins to receive `Access-Control-Allow-Origin` (T9, opt-in) |
| `corsAllowCredentials` | boolean | Whether to emit `Access-Control-Allow-Credentials: true` (T9) |
| `enabled` | boolean | Enable/disable this profile |

#### Per-domain CORS injection (opt-in)

By default Revamp does not inject any `Access-Control-Allow-*` headers into proxied responses. Earlier builds added a permissive `Access-Control-Allow-Origin: <client origin>` plus `Access-Control-Allow-Credentials: true` to every response, which made every proxied site cross-origin readable by every other proxied site (T9). To restore that behaviour for a specific domain — for example so a site under your control can fetch resources from another site you proxy — set `corsAllowOrigins` (and optionally `corsAllowCredentials: true`) on a domain profile. Use the literal `"*"` to allow any origin; otherwise list exact client origins. Origin matches are compared verbatim — `corsAllowOrigins: ["https://example.com"]` matches that origin only and does not cover subdomains such as `https://api.example.com`. Requests whose `Origin` does not match the list receive no CORS headers, so the browser correctly blocks the cross-origin read.

> Note: `corsAllowOrigins: ["*"]` cannot be combined with `corsAllowCredentials: true`. The combination is rejected by browsers per the Fetch spec; Re:Vamp will refuse to inject CORS headers in that case to avoid a credential leak.

```bash
curl -X POST http://any-proxied-site/__revamp__/domains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example with CORS",
    "patterns": [{ "type": "exact", "pattern": "api.example.com" }],
    "priority": 10,
    "corsAllowOrigins": ["https://app.example.com"],
    "corsAllowCredentials": true,
    "enabled": true
  }'
```

### Multi-Device Support

Revamp supports multiple devices connecting simultaneously, each with their own configuration:

**Per-client settings** are automatically managed based on the device's IP address. Each device can have different transformation and filtering settings.

**View current client config:**

```bash
curl http://any-proxied-site/__revamp__/config
```

**Update settings for current device:**

```bash
curl -X POST http://any-proxied-site/__revamp__/config \
  -H "Content-Type: application/json" \
  -d '{
    "transformJs": true,
    "removeAds": true,
    "spoofUserAgent": false
  }'
```

**Reset to defaults:**

```bash
curl -X DELETE http://any-proxied-site/__revamp__/config
```

### Plugin System

Revamp includes a powerful plugin system that allows you to extend functionality through hooks into the request/response lifecycle.

**Plugin Directory:**

Plugins are installed in the `.revamp-plugins/` directory. Each plugin has its own subdirectory containing a `plugin.json` manifest and entry point.

```
.revamp-plugins/
├── plugins.json              # Global plugin configuration
└── com-example-my-plugin/
    ├── plugin.json           # Plugin manifest
    └── index.js              # Entry point
```

**Plugin Manifest (plugin.json):**

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample plugin",
  "author": "Your Name",
  "revampVersion": "1.0.0",
  "main": "index.js",
  "hooks": ["request:pre", "response:post"],
  "permissions": ["request:read", "request:modify", "storage:read", "storage:write"]
}
```

**Available Hooks:**

| Hook | Purpose | Can Modify | Required Permission |
|------|---------|------------|---------------------|
| `request:pre` | Before upstream request | URL, headers, block | `request:modify` |
| `response:post` | After response received | Body, headers, status | `response:modify` |
| `transform:pre` | Before content transform | Content, skip transform | `response:modify` |
| `transform:post` | After content transform | Transformed content | `response:modify` |
| `filter:decision` | Custom blocking logic | Block decision | `request:modify` |
| `config:resolution` | Inject config overrides | Config values | `config:read` |
| `domain:lifecycle` | Profile CRUD events | (notify only) | `config:read` |
| `cache:get` | Custom cache backend | Cached data | `cache:read` |
| `cache:set` | Custom cache backend | (notify only) | `cache:write` |
| `metrics:record` | Custom metrics | (notify only) | `metrics:write` |

> **Note (T15):** `context.registerHook(name, …)` now throws if the plugin's
> manifest does not declare the permission required for `name`. This is a
> breaking change for plugins that previously omitted the corresponding
> permission. Add the required permission to your `plugin.json` `permissions`
> array — e.g. a plugin that registers `response:post` must declare
> `response:modify`. See CHANGELOG for the full migration note.

**Available Permissions:**

| Permission | Description |
|------------|-------------|
| `request:read` | Read request data |
| `request:modify` | Modify requests |
| `response:read` | Read response data |
| `response:modify` | Modify responses |
| `config:read` | Read configuration |
| `config:write` | Write configuration |
| `cache:read` | Read from cache |
| `cache:write` | Write to cache |
| `metrics:read` | Read metrics |
| `metrics:write` | Record metrics |
| `network:fetch` | Make network requests |
| `storage:read` | Read plugin storage |
| `storage:write` | Write plugin storage |
| `api:register` | Register API endpoints |

**Plugin Entry Point (index.js):**

Revamp is an ESM project. Plugins must use `export default`; the loader at
`src/plugins/loader.ts` accepts either a default-exported object or a default-
exported factory function returning a plugin object.

```javascript
export default {
  async initialize(context) {
    context.log('info', 'Plugin initializing...');
  },

  async activate(context) {
    context.registerHook('request:pre', async (request) => {
      if (request.hostname.includes('blocked.com')) {
        return {
          continue: false,
          value: { blocked: true, reason: 'Custom block' },
        };
      }
      return { continue: true };
    }, 100);

    context.registerHook('response:post', async (response) => {
      return {
        continue: true,
        value: {
          headers: {
            ...response.responseHeaders,
            'x-plugin-processed': 'true',
          },
        },
      };
    });
  },

  async deactivate(context) {
    context.unregisterHook('request:pre');
    context.unregisterHook('response:post');
  },

  async shutdown(context) {
    context.log('info', 'Plugin shutting down...');
  },
};
```

A runnable copy of this pattern lives at `examples/plugins/hello-world/`.

**Plugin Context API:**

The `context` object provides a sandboxed API for plugins:

```typescript
interface PluginContext {
  // Hook registration
  registerHook(hookName, handler, priority?): void;
  unregisterHook(hookName): void;

  // Configuration (requires permissions)
  getConfig(): Readonly<RevampConfig>;
  getEffectiveConfig(clientIp?, domain?): Readonly<RevampConfig>;
  getPluginConfig<T>(): T;
  updatePluginConfig(updates): Promise<void>;

  // Storage (sandboxed per-plugin)
  readStorage<T>(key): Promise<T | null>;
  writeStorage<T>(key, data): Promise<void>;

  // Cache
  getCached(url, contentType, clientIp?): Promise<Buffer | null>;
  setCache(url, contentType, data, clientIp?): Promise<void>;

  // Metrics
  getMetrics(): Metrics;
  recordMetric(name, value, tags?): void;

  // Network
  fetch(url, options?): Promise<Response>;

  // API endpoints (at /__revamp__/plugins/{pluginId}/{path})
  registerEndpoint(path, handler): void;
  unregisterEndpoint(path): void;

  // Logging
  log(level, message, ...args): void;
}
```

**Managing Plugins via API:**

```bash
# List all plugins
curl http://any-proxied-site/__revamp__/plugins

# Discover available plugins
curl http://any-proxied-site/__revamp__/plugins/discover

# Load all plugins
curl -X POST http://any-proxied-site/__revamp__/plugins/load-all

# Activate a plugin
curl -X POST http://any-proxied-site/__revamp__/plugins/my-plugin-id/activate

# Deactivate a plugin
curl -X POST http://any-proxied-site/__revamp__/plugins/my-plugin-id/deactivate

# Update plugin configuration
curl -X PUT http://any-proxied-site/__revamp__/plugins/my-plugin-id/config \
  -H "Content-Type: application/json" \
  -d '{ "customSetting": "value" }'

# Unload a plugin
curl -X DELETE http://any-proxied-site/__revamp__/plugins/my-plugin-id
```

**Plugin Metrics & Observability:**

Revamp tracks per-plugin execution statistics for monitoring and debugging:

```bash
# Get metrics for all plugins
curl http://any-proxied-site/__revamp__/plugins/metrics

# Get metrics for a specific plugin
curl http://any-proxied-site/__revamp__/plugins/my-plugin-id/metrics

# Reset metrics for all plugins
curl -X DELETE http://any-proxied-site/__revamp__/plugins/metrics

# Reset metrics for a specific plugin
curl -X DELETE http://any-proxied-site/__revamp__/plugins/my-plugin-id/metrics
```

Metrics include:
- Total hook executions, successes, failures, and timeouts
- Average execution time per plugin and per hook
- Last execution timestamp
- Per-hook breakdown (e.g., `request:pre` vs `response:post`)

**Configuration Schema Validation:**

Plugins can define a JSON Schema for their configuration to ensure type safety:

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "configSchema": {
    "type": "object",
    "required": ["apiKey"],
    "properties": {
      "apiKey": {
        "type": "string",
        "minLength": 10,
        "description": "API key for external service"
      },
      "timeout": {
        "type": "integer",
        "minimum": 0,
        "maximum": 60000,
        "default": 5000
      },
      "enableFeature": {
        "type": "boolean",
        "default": true
      },
      "allowedDomains": {
        "type": "array",
        "items": { "type": "string" },
        "uniqueItems": true
      }
    }
  }
}
```

When `updatePluginConfig()` is called, the configuration is validated against the schema. Invalid configurations will throw an error with details about which fields failed validation.

Supported JSON Schema features:
- Types: `string`, `number`, `integer`, `boolean`, `array`, `object`, `null`
- String constraints: `minLength`, `maxLength`, `pattern`
- Number constraints: `minimum`, `maximum`
- Array constraints: `minItems`, `maxItems`, `uniqueItems`, `items`
- Object constraints: `required`, `properties`, `additionalProperties`
- Composition: `oneOf`, `anyOf`, `allOf`
- Enums: `enum`

**Hook Execution Modes:**

Hooks can be executed in different modes:

- **Sequential** (default): Hooks execute one after another in priority order. Earlier hooks can stop the chain.
- **Parallel**: All hooks execute concurrently. Results are collected from all plugins.

The hook executor automatically uses sequential mode for modifying hooks (`request:pre`, `response:post`, etc.) and parallel mode for notification hooks (`domain:lifecycle`, `cache:set`, `metrics:record`).

**Hook Result Types:**

```typescript
// Continue to next hook
{ continue: true, value?: T }

// Stop the chain and return this value
{ continue: false, value: T }

// Stop the chain with an error
{ continue: false, error: Error }
```

**Plugin Testing Framework:**

Revamp provides testing utilities for plugin developers:

```typescript
import {
  createTestContext,
  createMockRequest,
  createMockResponse,
  createTestPlugin,
  runPluginLifecycle,
  assertContinues,
  assertStops,
} from 'revamp/plugin';

// Create a test context with mocked dependencies
const context = createTestContext({
  pluginId: 'com.test.my-plugin',
  config: { mySetting: 'value' },
});

// Create realistic request/response contexts
const request = createMockRequest({
  url: 'https://example.com/api',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
});

const response = createMockResponse({
  statusCode: 200,
  body: Buffer.from('{"success": true}'),
});

// Test hook behavior
const result = await myHook(request);
assertContinues(result); // Passes if hook returns { continue: true }
assertStops(result);     // Passes if hook returns { continue: false }
```

**Plugin Lifecycle:**

```
unloaded → loaded → initializing → initialized → activating → active
                                                       ↓
                                            deactivating → deactivated
```

**Configuration Hierarchy (with plugins):**

```
Plugin Hooks (highest priority)
       ↓
Domain Profile
       ↓
Client Config
       ↓
Global Defaults (lowest)
```

**Available client options:**

| Option | Default | Description |
|--------|---------|-------------|
| `transformJs` | true | Babel JS transpilation |
| `transformCss` | true | PostCSS CSS transformation |
| `transformHtml` | true | HTML polyfill injection |
| `bundleEsModules` | true | Bundle ES modules |
| `emulateServiceWorkers` | true | SW bypass/emulation |
| `remoteServiceWorkers` | true | Remote SW bridge |
| `removeAds` | true | Block ad domains |
| `removeTracking` | true | Block tracking domains |
| `injectPolyfills` | true | Add polyfills |
| `spoofUserAgent` | true | Spoof User-Agent header |
| `spoofUserAgentInJs` | true | Override navigator.userAgent |
| `maxRequestBodyBytes` | 52428800 | Maximum upstream request body size in bytes (default 50 MB). Requests exceeding this are rejected with 413. |
| `maxResponseBodyBytes` | 52428800 | Maximum upstream response body size in bytes (default 50 MB). Responses exceeding this are returned as 502. |
| `allowInsecureUpstream` | false | Skip upstream TLS certificate validation. Default `false`. Set to `true` only for development against self-signed upstreams; production proxies should leave this off. |

## 🧪 Testing

```bash
# Unit tests
pnpm test:unit        # Watch mode
pnpm test:unit:run    # Single run

# E2E tests
pnpm test             # Run all
pnpm test:headed      # With browser
pnpm test:ui          # Interactive mode

# Type checking
pnpm typecheck

# Performance benchmarks
pnpm build && pnpm tsx src/benchmarks/parallel-transform.ts
```

### Benchmark Results

On a typical machine (8-core CPU), parallel performance improvements:

| Operation       | Sequential | Parallel | Speedup   |
| --------------- | ---------- | -------- | --------- |
| JS Transform    | ~42ms      | ~40ms    | 1.05x     |
| CSS Transform   | ~5ms       | ~4ms     | 1.37x     |
| Gzip Compress   | ~0.4ms     | ~0.04ms  | **9.36x** |
| Gzip Decompress | ~0.06ms    | ~0.04ms  | 1.52x     |

The worker pool's main benefit is **keeping the main event loop responsive** during heavy concurrent load, preventing request queuing and latency spikes.

## 🔧 Troubleshooting

### Certificate Issues

**"Not Trusted" warning:**

- Ensure you've enabled trust in **Settings → General → About → Certificate Trust Settings**
- Try regenerating certificates: delete `.revamp-certs/` and restart

**Certificate won't install:**

- Make sure you're using Safari (not Chrome) on iOS
- The certificate must be downloaded via HTTP, not HTTPS

### Connection Issues

**Can't connect to proxy:**

- Verify your computer's IP address
- Check firewall settings (ports 1080, 8080, 8888)
- Ensure both devices are on the same network

**Websites not loading:**

- Check the Revamp console for errors
- Some sites may have additional protections
- Try disabling transformations to isolate issues

### Performance Issues

**Slow page loads:**

- Enable caching if disabled
- Consider disabling transformations for specific sites
- Check available disk space for cache

### Sharp Install Issues

`Cannot find module '@img/sharp-...'` means the platform-specific sharp binary is missing. Quick fixes:

- **macOS Apple Silicon**: run `pnpm rebuild sharp` after install.
- **Alpine**: ensure `libvips` is available (`apk add vips-dev`) before installing.
- **Linux glibc/musl mismatch**: reinstall with the right libc, e.g. `pnpm install --config.platform=linux --config.libc=musl`.

For other platforms see sharp's [install matrix](https://sharp.pixelplumbing.com/install).

## 📦 Dependencies

| Package       | Purpose                                    |
| ------------- | ------------------------------------------ |
| `@babel/core` | JavaScript transpilation                   |
| `postcss`     | CSS transformation                         |
| `cheerio`     | HTML parsing/manipulation                  |
| `node-forge`  | Certificate generation                     |
| `sharp`       | Image optimization                         |
| `esbuild`     | ES module bundling for legacy browsers     |
| `tinypool`    | Worker thread pool for parallel transforms |
| `ws`          | WebSocket for Remote Service Worker bridge |

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## 📄 License

[MIT](LICENSE) © Alex Kanunnikov

## 🙏 Acknowledgments

- Babel team for the amazing transpiler
- PostCSS team for CSS tooling
- node-forge for certificate generation
- All contributors and users!

---

**Give your old devices new life! 🔄**
