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

See the [Architecture](README.md#%EF%B8%8F-architecture) and [Project Structure](README.md#-project-structure) sections of the README for the full module map. The short version:

- `src/proxy/` — HTTP + SOCKS5 stacks, TLS interception, the shared `/__revamp__/*` API router (`api-router.ts`), and focused helpers (cors, compression, charset, content-type, blocking, transform-pipeline, user-agent, client-ip). `shared.ts` is only a compatibility facade — put new code in the focused module it belongs to.
- `src/transformers/` — the transformer registry (`registry.ts`), js/css/html/image transformers, the Babel and PostCSS worker pools, the ESM bundler (`esm/`), and 30+ polyfills.
- `src/plugins/` — plugin manifests, loader, registry, sandboxed context, hook executor, and the plugin REST API.
- `src/config/`, `src/cache/`, `src/certs/`, `src/logger/`, `src/metrics/`, `src/pac/`, `src/portal/`, `src/filters/` — see the README module map.

Unit tests live alongside source files (`*.test.ts`); E2E tests live in `tests/`; runnable example plugins live in `examples/plugins/`.

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
chore: update dependencies
perf: optimize cache lookup
```

### Branch Naming

Use descriptive branch names:

```
feat/websocket-support
fix/empty-response-handling
docs/config-options
test/css-transformation
refactor/socks5-protocol
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
pnpm test:unit       # Single run (alias: pnpm test:unit:run)
pnpm exec vitest     # Watch mode
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

Content transformation is dispatched through the registry in `src/transformers/registry.ts` (text and binary lanes; first match wins). Supporting a new content type means registering a new transformer entry there; tweaking an existing transform means editing the transformer it dispatches to:

### JavaScript (Babel)

Edit `src/transformers/js-worker.ts` (the worker thread holds the Babel options; `js.ts` owns the pool):
- Add new Babel plugins/presets in the options
- Test with various JS syntax features

### CSS (PostCSS)

Edit `src/transformers/css-worker.ts` (the worker thread holds the PostCSS pipeline; `css.ts` owns the pool):
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
