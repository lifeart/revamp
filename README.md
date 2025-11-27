# Revamp 🔄

**Legacy Browser Compatibility Proxy**

Transform modern web content for older devices like iPads and iPods running iOS 11.

## What it does

Revamp is a SOCKS5/HTTP proxy that intercepts web traffic and transforms it for legacy browser compatibility:

- **JavaScript**: Uses Babel to transpile modern JS (optional chaining, nullish coalescing, etc.) to ES6
- **CSS**: Uses PostCSS to add vendor prefixes and transform modern CSS features
- **HTML**: Injects polyfills and removes ads/tracking scripts
- **HTTPS**: Transparent SSL interception with auto-generated certificates

## Features

✅ SOCKS5 proxy for device-wide traffic routing  
✅ HTTP proxy as alternative  
✅ Babel transformation targeting iOS 11 Safari  
✅ PostCSS with autoprefixer  
✅ Polyfill injection for missing APIs  
✅ Ad and tracking script removal  
✅ Content caching (memory + disk)  
✅ Auto-generated SSL certificates for HTTPS interception  

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the proxy
pnpm start

# Or in development mode (auto-reload)
pnpm dev
```

## Device Setup

### 1. Install the CA Certificate

After starting Revamp, a CA certificate will be generated at `.revamp-certs/ca.crt`.

**On iOS:**
1. Transfer the certificate to your device (AirDrop, email, etc.)
2. Open the file and tap "Install Profile"
3. Go to Settings → General → About → Certificate Trust Settings
4. Enable full trust for "Revamp Proxy CA"

### 2. Configure the Proxy

**SOCKS5 (recommended):**
- Go to Settings → Wi-Fi → Your Network → Configure Proxy
- Select "Manual"
- Server: Your computer's IP address
- Port: `1080`

**HTTP Proxy:**
- Server: Your computer's IP address
- Port: `8080`

## Configuration

Edit `src/config/index.ts` to customize:

```typescript
{
  // Server ports
  socks5Port: 1080,
  httpProxyPort: 8080,
  
  // Target browsers (Browserslist format)
  targets: ['safari 11', 'ios 11'],
  
  // Feature toggles
  transformJs: true,
  transformCss: true,
  transformHtml: true,
  removeAds: true,
  removeTracking: true,
  injectPolyfills: true,
  
  // Cache settings
  cacheEnabled: true,
  cacheTTL: 3600, // seconds
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Legacy Device  │────▶│  SOCKS5 Proxy   │────▶│   HTTP Proxy    │
│   (iOS 11)      │     │   (port 1080)   │     │   (port 8080)   │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                        ┌─────────────────────────────────────────┐
                        │            Content Pipeline             │
                        ├─────────────────────────────────────────┤
                        │  1. Fetch from origin                   │
                        │  2. Check cache                         │
                        │  3. Transform (Babel/PostCSS/Cheerio)   │
                        │  4. Cache result                        │
                        │  5. Return to client                    │
                        └─────────────────────────────────────────┘
```

## Dependencies

- **@babel/core** + **@babel/preset-env**: JavaScript transpilation
- **postcss** + **postcss-preset-env**: CSS transformation
- **cheerio**: HTML parsing and manipulation
- **node-forge**: Certificate generation

## License

ISC
