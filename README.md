# Revamp 🔄

[![CI](https://github.com/lifeart/revamp/actions/workflows/ci.yml/badge.svg)](https://github.com/lifeart/revamp/actions/workflows/ci.yml)
[![Docker](https://github.com/lifeart/revamp/actions/workflows/docker.yml/badge.svg)](https://github.com/lifeart/revamp/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io%2Flifeart%2Frevamp-blue)](https://ghcr.io/lifeart/revamp)

**Legacy Browser Compatibility Proxy** — Transform modern web content for older devices like iPads and iPods running iOS 9+.

Give your old iPad 2, iPad Mini, or iPod Touch a second life by making modern websites work again!

## ✨ Features

### Core Proxy Features
- **🔧 JavaScript Transpilation** — Babel transforms modern JS (optional chaining, nullish coalescing, async/await) to ES5/ES6
- **🎨 CSS Transformation** — PostCSS adds vendor prefixes and transforms modern CSS features
- **📄 HTML Modification** — Injects polyfills and can remove ads/tracking scripts
- **🔒 HTTPS Interception** — Transparent SSL/TLS interception with auto-generated certificates
- **🧦 SOCKS5 Proxy** — Device-wide traffic routing (recommended for iOS)
- **🌐 HTTP Proxy** — Alternative proxy method
- **📦 Smart Caching** — Memory + disk caching for faster repeat visits
- **🎭 User-Agent Spoofing** — Bypass browser detection (optional)
- **🚫 Ad & Tracking Removal** — Block common ad networks and trackers
- **📱 Easy Setup** — Built-in captive portal for certificate installation

### Polyfills for Legacy Browsers
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

### CSS Enhancements
- **CSS Grid → Flexbox Fallback** — Auto-generate flexbox fallbacks for CSS Grid
- **Dark Mode Stripping** — Remove `prefers-color-scheme` media queries
- **Vendor Prefixes** — Automatic -webkit- prefixes for Safari 9

### DevOps & Monitoring
- **📊 Metrics Dashboard** — Real-time web UI at `/__revamp__/metrics`
- **🐳 Docker Support** — Production and development Dockerfiles
- **📋 PAC File Generation** — Auto-generate proxy config files
- **⚙️ External Config** — JSON config for blocked domains

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
2. **Open the setup page** on your legacy device:
   - Navigate to `http://YOUR_COMPUTER_IP:8888`
3. **Install the certificate** and enable trust (see detailed instructions below)
4. **Configure proxy** in Wi-Fi settings

## 📱 Detailed Setup

### Installing the CA Certificate

When you start Revamp, a CA certificate is generated at `.revamp-certs/ca.crt`.

**On iOS:**
1. Open `http://YOUR_COMPUTER_IP:8888` in Safari
2. Tap "Download Certificate"
3. Go to **Settings → General → VPN & Device Management**
4. Install the downloaded profile
5. Go to **Settings → General → About → Certificate Trust Settings**
6. Enable full trust for "Revamp Proxy CA"

**On macOS:**
1. Open the `.revamp-certs/ca.crt` file
2. Add to Keychain Access
3. Find "Revamp Proxy CA", double-click, expand Trust
4. Set "When using this certificate" to "Always Trust"

### Configuring the Proxy

**SOCKS5 (Recommended for iOS):**
- **Settings → Wi-Fi → [Your Network] → Configure Proxy**
- Select **Manual**
- Server: `YOUR_COMPUTER_IP`
- Port: `1080`

**HTTP Proxy (Alternative):**
- Server: `YOUR_COMPUTER_IP`
- Port: `8080`

## ⚙️ Configuration

Edit `src/config/index.ts` or pass options when creating the server:

```typescript
import { createRevampServer } from 'revamp';

const server = createRevampServer({
  // Server ports
  socks5Port: 1080,
  httpProxyPort: 8080,
  captivePortalPort: 8888,
  
  // Target browsers (Browserslist format)
  targets: ['safari 9', 'ios 9'],
  
  // Feature toggles
  transformJs: true,      // Babel transpilation
  transformCss: true,     // PostCSS transformation
  transformHtml: true,    // HTML polyfill injection
  removeAds: true,        // Block ad domains
  removeTracking: true,   // Block tracking domains
  injectPolyfills: true,  // Add polyfills for missing APIs
  spoofUserAgent: true,   // Send modern User-Agent to servers
  spoofUserAgentInJs: true, // Override navigator.userAgent
  
  // Cache settings
  cacheEnabled: true,
  cacheTTL: 3600, // seconds
  
  // Performance tuning
  compressionLevel: 4, // gzip level 1-9 (1=fastest, 9=smallest)
});

server.start();
```

### Runtime Configuration API

You can change settings at runtime via the config API:

```javascript
// From your legacy device's browser console or code:
fetch('http://any-proxied-site/__revamp__/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transformJs: false,  // Disable JS transformation
    removeAds: false,    // Allow ads
  })
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

## 📁 Project Structure

```
src/
├── index.ts              # Main entry point
├── config/               # Configuration management
├── proxy/                # Proxy servers
│   ├── http-proxy.ts     # HTTP/HTTPS proxy
│   ├── socks5.ts         # SOCKS5 proxy
│   ├── socks5-protocol.ts # SOCKS5 protocol implementation
│   ├── http-client.ts    # HTTP request utilities
│   ├── shared.ts         # Shared utilities
│   ├── revamp-api.ts     # API endpoint handler
│   └── types.ts          # Type definitions
├── transformers/         # Content transformation
│   ├── js.ts             # JavaScript (Babel worker pool)
│   ├── js-worker.ts      # Babel worker thread
│   ├── css.ts            # CSS (PostCSS)
│   ├── css-grid-fallback.ts # CSS Grid → Flexbox
│   ├── dark-mode-strip.ts # Dark mode CSS removal
│   ├── html.ts           # HTML (Cheerio)
│   ├── image.ts          # Image optimization
│   └── polyfills/        # 25+ polyfill scripts
├── metrics/              # Metrics collection
├── pac/                  # PAC file generation
├── cache/                # Caching system
├── certs/                # Certificate generation
├── portal/               # Captive portal
└── benchmarks/           # Performance benchmarks
```

## 🌐 API Endpoints

All API endpoints are available on any proxied domain at `/__revamp__/*`:

| Endpoint | Description |
|----------|-------------|
| `/__revamp__/config` | GET/POST/DELETE proxy configuration |
| `/__revamp__/metrics` | HTML metrics dashboard |
| `/__revamp__/metrics/json` | JSON metrics data |
| `/__revamp__/pac/socks5` | SOCKS5 PAC file download |
| `/__revamp__/pac/http` | HTTP PAC file download |
| `/__revamp__/pac/combined` | Combined PAC file download |

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
# Get PAC file URL for iOS configuration
http://YOUR_COMPUTER_IP:8888/__revamp__/pac/socks5
```

Configure iOS: **Settings → Wi-Fi → [Network] → Configure Proxy → Automatic** → Enter PAC URL

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

| Operation | Sequential | Parallel | Speedup |
|-----------|------------|----------|---------|
| JS Transform | ~42ms | ~40ms | 1.05x |
| CSS Transform | ~5ms | ~4ms | 1.37x |
| Gzip Compress | ~0.4ms | ~0.04ms | **9.36x** |
| Gzip Decompress | ~0.06ms | ~0.04ms | 1.52x |

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

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `@babel/core` | JavaScript transpilation |
| `postcss` | CSS transformation |
| `cheerio` | HTML parsing/manipulation |
| `node-forge` | Certificate generation |
| `sharp` | Image optimization |
| `tinypool` | Worker thread pool for parallel transforms |

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
