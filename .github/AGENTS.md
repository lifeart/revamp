# AI Agent Guidelines for Revamp Project

This document provides guidelines for AI agents working on the Revamp codebase.

## Project Overview

Revamp is a **TypeScript proxy server** designed to make modern websites work on legacy browsers (iOS 9+, Safari 9+). It intercepts HTTP/HTTPS traffic and transforms content for compatibility.

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| HTTP Proxy | `src/proxy/http-proxy.ts` | Intercepts HTTP/HTTPS traffic on port 8080 |
| SOCKS5 Proxy | `src/proxy/socks5.ts` | RFC 1928 SOCKS5 implementation on port 1080 |
| HTML Transformer | `src/transformers/html.ts` | Removes ads/tracking, injects polyfills |
| CSS Transformer | `src/transformers/css.ts` | Transforms modern CSS for legacy browsers |
| JS Transformer | `src/transformers/js.ts` | Transpiles modern JavaScript |
| Certificate Manager | `src/certs/index.ts` | Generates CA and domain certificates |
| Cache | `src/cache/index.ts` | In-memory caching with per-client separation |

## Code Style Guidelines

### TypeScript Best Practices

1. **Explicit Buffer Types**: Always use explicit `Buffer` type annotation when the variable will be reassigned:
   ```typescript
   // ✅ Good - prevents ArrayBuffer vs ArrayBufferLike issues
   let body: Buffer = Buffer.concat(chunks);
   
   // ❌ Bad - can cause type inference issues
   let body = Buffer.concat(chunks);
   ```

2. **Function Organization**: Large files should be organized into clear sections:
   ```typescript
   // =============================================================================
   // Types & Interfaces
   // =============================================================================
   
   // =============================================================================
   // Constants
   // =============================================================================
   
   // =============================================================================
   // Utility Functions
   // =============================================================================
   
   // =============================================================================
   // Main Functions
   // =============================================================================
   ```

3. **Extract Helper Functions**: Break down large functions (>50 lines) into smaller, focused helpers with clear JSDoc comments.

4. **Type Interfaces**: Define interfaces for complex parameter objects:
   ```typescript
   interface RequestOptions {
     method: string;
     hostname: string;
     port: number;
     headers: Record<string, string>;
   }
   ```

### CSS Selector Safety

When writing CSS selectors for ad/tracking removal in `src/transformers/html.ts`:

```typescript
// ✅ Good - specific matching patterns
'[class^="ad-"]'      // starts with "ad-"
'[class$="-ad"]'      // ends with "-ad"
'[class~="ad"]'       // exact word "ad"
'[id^="ad-"]'         // id starts with "ad-"

// ❌ Bad - overly broad patterns that match unintended elements
'[class*="ad"]'       // matches "download", "loading", "upload", etc.
```

**Why?** The substring matcher `*=` can match unintended elements. For example, `[class*="ad-"]` would incorrectly match a `download-btn` class because "download" contains "ad".

## Testing

### Test Structure

- **Unit Tests**: `src/**/*.test.ts` - Run with `npm run test:unit`
- **E2E Tests**: `tests/*.spec.ts` - Run with `npm test`
- **Coverage**: `npm run test:coverage`

### Current Test Counts
- Unit tests: 674 tests across 24 files
- E2E tests: 98 tests (including 23 captive portal tests)

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Specific test file
npm run test:unit -- src/proxy/socks5.test.ts

# With coverage
npm run test:coverage
```

## Common Patterns

### Error Handling in Proxies

```typescript
socket.on('error', (err) => {
  console.error(`❌ Socket error: ${err.message}`);
  socket.destroy();
});

socket.on('close', () => {
  updateConnections(-1);
});
```

### Response Building

```typescript
function buildHttpResponse(
  statusCode: number,
  statusText: string,
  headers: Record<string, string>,
  body: string | Buffer
): Buffer {
  const headerLines = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  
  const head = `HTTP/1.1 ${statusCode} ${statusText}\r\n${headerLines}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head), Buffer.from(body)]);
}
```

### Logging Conventions

```typescript
console.log('📡 HTTP: GET http://example.com/path');      // HTTP request
console.log('🔐 HTTPS: GET https://example.com/path');    // HTTPS request
console.log('📦 Cache hit: http://example.com/path');     // Cache hit
console.log('🔧 Revamp API: GET /__revamp__/config');     // API endpoint
console.log('🚫 Blocked: http://ads.example.com');        // Blocked URL
console.log('❌ Error: Connection failed');               // Error
```

## File Locations Quick Reference

| What | Where |
|------|-------|
| Blocked domains config | `config/blocked-domains.json` |
| PAC file generator | `src/pac/generator.ts` |
| Metrics dashboard | `src/metrics/dashboard.ts` |
| Captive portal | `src/portal/index.ts` |
| Type definitions | `src/types/*.ts` |
| Proxy types | `src/proxy/types.ts` |

## Important Considerations

1. **Legacy Browser Support**: All generated code must work on Safari 9+ / iOS 9+
2. **No External Dependencies in Transforms**: Transformers should be self-contained
3. **Memory Efficiency**: Use streaming where possible for large responses
4. **Certificate Caching**: Domain certs are cached to avoid regeneration overhead
5. **Per-Client Cache**: Cache can be separated by client IP when configured

## Debugging Tips

1. Check proxy logs for request/response flow
2. Use the metrics dashboard at `/__revamp__/metrics`
3. Configuration API at `/__revamp__/config`
4. Certificate download at `/__revamp__/ca.crt`
