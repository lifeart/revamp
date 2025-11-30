import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mock HTTP/HTTPS server for e2e tests
 * Serves test pages to avoid external domain dependencies in CI
 */

// HTML pages for different test scenarios
const pages = {
  // Main test page - general purpose
  '/': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock Test Page</title>
  <link rel="stylesheet" href="/styles.css">
  <style>
    .grid-container { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .grid-item { padding: 20px; background: #f0f0f0; }
  </style>
</head>
<body>
  <header>
    <h1>Revamp Test Page</h1>
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
    </nav>
  </header>
  <main>
    <section class="search-section">
      <form action="/search" method="get">
        <input type="search" name="q" placeholder="Search..." aria-label="Search">
        <button type="submit">Search</button>
      </form>
    </section>
    <section class="content">
      <h2>Welcome to the Test Page</h2>
      <p>This is a mock page for testing the Revamp proxy.</p>
      <p>It includes various elements to test transformation capabilities.</p>
      <div class="grid-container">
        <div class="grid-item">Grid Item 1</div>
        <div class="grid-item">Grid Item 2</div>
        <div class="grid-item">Grid Item 3</div>
        <div class="grid-item">Grid Item 4</div>
      </div>
    </section>
    <section class="images">
      <img src="/test-image.png" alt="Test Image" width="100" height="100">
    </section>
  </main>
  <script src="/app.js"></script>
  <script>
    // Inline modern JavaScript for transformation testing
    const testArrow = () => console.log('Arrow function works');
    const testSpread = [...[1, 2, 3]];
    const testTemplate = \`Template literal: \${testSpread.join(', ')}\`;
    class TestClass {
      #privateField = 'private';
      constructor() {
        console.log('Class instantiated');
      }
      async asyncMethod() {
        return await Promise.resolve('async works');
      }
    }
    new TestClass();
    testArrow();
  </script>
</body>
</html>`,

  '/about': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>About - Mock Test Page</title>
</head>
<body>
  <h1>About Page</h1>
  <p>This is the about page for testing navigation.</p>
  <a href="/">Back to Home</a>
</body>
</html>`,

  '/search': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Search Results - Mock Test Page</title>
</head>
<body>
  <h1>Search Results</h1>
  <p>Search functionality test page.</p>
</body>
</html>`,

  '/styles.css': `/* CSS for testing transformation */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 0;
  padding: 20px;
  background-color: #fff;
  color: #333;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #eee;
}

nav a {
  margin-left: 20px;
  text-decoration: none;
  color: #0066cc;
}

.search-section {
  margin: 20px 0;
}

.search-section input {
  padding: 10px;
  width: 300px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.search-section button {
  padding: 10px 20px;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* CSS Grid for polyfill testing */
.grid-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 20px 0;
}

.grid-item {
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px;
  text-align: center;
}

/* Flexbox */
.flex-container {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* Modern CSS features */
main {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .content {
    font-size: 1.1em;
  }
}
`,

  '/app.js': `// External JavaScript file for testing
(function() {
  'use strict';

  // Modern JS features for transformation testing
  const config = {
    debug: true,
    version: '1.0.0'
  };

  // Optional chaining and nullish coalescing
  const getValue = (obj) => obj?.nested?.value ?? 'default';

  // Array methods that need polyfills
  const arr = [1, 2, [3, 4]];
  const flattened = arr.flat();
  const includes = flattened.includes(3);

  // Object methods
  const entries = Object.entries(config);
  const fromEntries = Object.fromEntries(entries);

  // Promise and async
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function init() {
    await delay(100);
    console.log('App initialized');

    // Test fetch
    try {
      const response = await fetch('/__revamp__/config');
      const data = await response.json();
      console.log('Config loaded:', data);
    } catch (e) {
      console.log('Config fetch skipped');
    }
  }

  // Class with modern features
  class App {
    static instance = null;
    #state = {};

    constructor() {
      if (App.instance) return App.instance;
      App.instance = this;
    }

    setState(key, value) {
      this.#state[key] = value;
    }

    getState(key) {
      return this.#state[key];
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for testing
  window.TestApp = App;
})();
`,

  '/test-image.png': 'BINARY_IMAGE_PLACEHOLDER', // Will be handled specially

  // =============================================================================
  // ES Module Test Pages
  // =============================================================================

  // Page with ES modules for testing bundling
  '/esm-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ES Module Test Page</title>
</head>
<body>
  <h1>ES Module Test</h1>
  <div id="result">Loading...</div>
  <div id="nested-result">Nested: Loading...</div>
  <div id="math-result">Math: Loading...</div>

  <!-- External ES Module -->
  <script type="module" src="/modules/main.js"></script>
</body>
</html>`,

  // Page with inline ES module
  '/esm-inline-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Inline ES Module Test</title>
</head>
<body>
  <h1>Inline ES Module Test</h1>
  <div id="inline-result">Loading...</div>

  <script type="module">
    // Inline ES module code
    const message = 'Hello from inline module!';
    const result = document.getElementById('inline-result');
    if (result) {
      result.textContent = message;
      result.dataset.loaded = 'true';
    }
    console.log('[ESM Test] Inline module executed:', message);
    window.__inlineModuleExecuted = true;
  </script>
</body>
</html>`,

  // Main entry module
  '/modules/main.js': `// Main ES Module - imports nested modules
import { greet } from './utils/greeting.js';
import { add, multiply } from './utils/math.js';

console.log('[ESM Test] Main module loading...');

// Use the imported functions
const greeting = greet('World');
const sum = add(10, 20);
const product = multiply(5, 6);

// Update the DOM
document.addEventListener('DOMContentLoaded', () => {
  const resultEl = document.getElementById('result');
  const nestedEl = document.getElementById('nested-result');
  const mathEl = document.getElementById('math-result');

  if (resultEl) {
    resultEl.textContent = greeting;
    resultEl.dataset.loaded = 'true';
  }

  if (nestedEl) {
    nestedEl.textContent = 'Nested import works!';
    nestedEl.dataset.loaded = 'true';
  }

  if (mathEl) {
    mathEl.textContent = 'Sum: ' + sum + ', Product: ' + product;
    mathEl.dataset.loaded = 'true';
  }

  console.log('[ESM Test] DOM updated with:', { greeting, sum, product });
});

// Export for verification
window.__esmTestData = {
  greeting,
  sum,
  product,
  loaded: true
};

console.log('[ESM Test] Main module initialized');
`,

  // Nested utility module - greeting
  '/modules/utils/greeting.js': `// Greeting utility module - uses another nested import
import { capitalize } from './string-helpers.js';

console.log('[ESM Test] Greeting module loading...');

export function greet(name) {
  const capitalizedName = capitalize(name);
  return 'Hello, ' + capitalizedName + '!';
}

export function farewell(name) {
  return 'Goodbye, ' + capitalize(name) + '!';
}

console.log('[ESM Test] Greeting module loaded');
`,

  // Nested utility module - math operations
  '/modules/utils/math.js': `// Math utility module
console.log('[ESM Test] Math module loading...');

export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export function multiply(a, b) {
  return a * b;
}

export function divide(a, b) {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

console.log('[ESM Test] Math module loaded');
`,

  // Deeply nested module - string helpers (third level)
  '/modules/utils/string-helpers.js': `// String helper utilities - third level nesting
console.log('[ESM Test] String helpers module loading...');

export function capitalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function lowercase(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase();
}

export function uppercase(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toUpperCase();
}

console.log('[ESM Test] String helpers module loaded');
`,
};

// Generate a simple PNG image (1x1 transparent pixel for testing)
function generateTestPNG(): Buffer {
  // Minimal PNG: 1x1 transparent pixel
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x06, // bit depth = 8, color type = 6 (RGBA)
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x1f, 0x15, 0xc4, 0x89, // IHDR CRC
    0x00, 0x00, 0x00, 0x0a, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
    0x0d, 0x0a, 0x2d, 0xb4, // IDAT CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82, // IEND CRC
  ]);
}

function getContentType(path: string): string {
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/html; charset=utf-8';
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`[Mock Server] ${req.method} ${pathname}`);

  // Handle test image
  if (pathname === '/test-image.png') {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(generateTestPNG());
    return;
  }

  // Handle known pages
  const content = pages[pathname as keyof typeof pages];
  if (content && content !== 'BINARY_IMAGE_PLACEHOLDER') {
    res.writeHead(200, {
      'Content-Type': getContentType(pathname),
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return;
  }

  // 404 for unknown paths
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body>
<h1>404 Not Found</h1>
<p>The requested URL ${pathname} was not found.</p>
</body>
</html>`);
}

export interface MockServerOptions {
  httpPort?: number;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
}

export interface MockServer {
  httpServer: http.Server;
  httpsServer?: https.Server;
  httpPort: number;
  httpsPort?: number;
  close: () => Promise<void>;
}

export async function startMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const httpPort = options.httpPort || 9080;
  const httpsPort = options.httpsPort || 9443;

  // Create HTTP server
  const httpServer = http.createServer(handleRequest);

  // Try to create HTTPS server if certs are available
  let httpsServer: https.Server | undefined;

  const certPath = options.certPath || path.join(process.cwd(), '.certs', 'rootCA.pem');
  const keyPath = options.keyPath || path.join(process.cwd(), '.certs', 'rootCA-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      httpsServer = https.createServer({ cert, key }, handleRequest);
    } catch (e) {
      console.log('[Mock Server] HTTPS disabled - could not load certificates');
    }
  }

  // Start servers
  await new Promise<void>((resolve) => {
    httpServer.listen(httpPort, '127.0.0.1', () => {
      console.log(`[Mock Server] HTTP listening on http://127.0.0.1:${httpPort}`);
      resolve();
    });
  });

  if (httpsServer) {
    await new Promise<void>((resolve) => {
      httpsServer!.listen(httpsPort, '127.0.0.1', () => {
        console.log(`[Mock Server] HTTPS listening on https://127.0.0.1:${httpsPort}`);
        resolve();
      });
    });
  }

  return {
    httpServer,
    httpsServer,
    httpPort,
    httpsPort: httpsServer ? httpsPort : undefined,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      if (httpsServer) {
        await new Promise<void>((resolve) => httpsServer!.close(() => resolve()));
      }
    },
  };
}

// CLI entry point for running standalone
import { fileURLToPath } from 'url';

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const httpPort = parseInt(process.env.MOCK_HTTP_PORT || '9080', 10);
  const httpsPort = parseInt(process.env.MOCK_HTTPS_PORT || '9443', 10);

  startMockServer({ httpPort, httpsPort }).then((server) => {
    console.log(`[Mock Server] Started`);
    console.log(`  HTTP:  http://127.0.0.1:${server.httpPort}`);
    if (server.httpsPort) {
      console.log(`  HTTPS: https://127.0.0.1:${server.httpsPort}`);
    }

    process.on('SIGINT', async () => {
      console.log('\n[Mock Server] Shutting down...');
      await server.close();
      process.exit(0);
    });
  });
}
