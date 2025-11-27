# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
