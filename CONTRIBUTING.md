# Contributing to Revamp

Thank you for your interest in contributing to Revamp! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to make legacy devices work better with the modern web.

## Getting Started

### Prerequisites

- Node.js 20+ (LTS recommended)
- pnpm (recommended) or npm
- A device running iOS 9+ or other legacy browser for testing

### Development Setup

```bash
# Clone the repository
git clone https://github.com/lifeart/revamp.git
cd revamp

# Install dependencies
pnpm install

# Start in development mode (auto-reload)
pnpm dev

# Run tests
pnpm test:unit      # Unit tests with Vitest
pnpm test           # E2E tests with Playwright
```

## Project Structure

```
src/
├── index.ts           # Main entry point and server creation
├── config/            # Configuration management
├── proxy/             # HTTP and SOCKS5 proxy implementations
│   ├── http-proxy.ts  # HTTP/HTTPS proxy server
│   ├── socks5.ts      # SOCKS5 proxy server
│   ├── shared.ts      # Shared utilities
│   └── types.ts       # Type definitions
├── transformers/      # Content transformation
│   ├── js.ts          # JavaScript transpilation (Babel)
│   ├── css.ts         # CSS transformation (PostCSS)
│   ├── html.ts        # HTML modification (Cheerio)
│   └── polyfills/     # Polyfill scripts
├── cache/             # Caching system
├── certs/             # Certificate generation
└── portal/            # Captive portal for certificate installation
```

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the bug report template
3. Include:
   - Device and iOS/browser version
   - Steps to reproduce
   - Expected vs actual behavior
   - Console logs if available

### Suggesting Features

1. Open an issue with the feature request template
2. Describe the use case and benefits
3. Consider backward compatibility with legacy devices

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Add tests if applicable
5. Run tests: `pnpm test:unit:run`
6. Run build: `pnpm build`
7. Commit with clear messages
8. Push and create a Pull Request

### Commit Messages

Follow conventional commits:

```
feat: add WebSocket proxy support
fix: handle empty response bodies correctly
docs: update README with new config options
test: add tests for CSS transformation
refactor: extract SOCKS5 protocol parsing
```

## Code Style

- TypeScript strict mode is enabled
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and small
- Write tests for new functionality

## Testing

### Unit Tests (Vitest)

Located alongside source files (`*.test.ts`):

```bash
pnpm test:unit       # Watch mode
pnpm test:unit:run   # Single run
```

### E2E Tests (Playwright)

Located in `tests/` directory:

```bash
pnpm test            # Run all E2E tests
pnpm test:headed     # Run with browser UI
pnpm test:ui         # Interactive UI mode
```

## Adding Polyfills

1. Create a new file in `src/transformers/polyfills/`
2. Export a function that returns the polyfill code
3. Add conditions for when it should be injected
4. Update `src/transformers/html.ts` to include it

## Adding Transformations

### JavaScript (Babel)

Edit `src/transformers/js.ts`:
- Add new Babel plugins/presets in the options
- Test with various JS syntax features

### CSS (PostCSS)

Edit `src/transformers/css.ts`:
- Add new PostCSS plugins
- Configure `postcss-preset-env` options

### HTML (Cheerio)

Edit `src/transformers/html.ts`:
- Add new DOM manipulations
- Consider performance impact

## Performance Considerations

- Cache transformed content when possible
- Avoid unnecessary transformations for binary content
- Use streaming where applicable
- Profile memory usage with large responses

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Open an issue or discussion if you have questions about contributing.
