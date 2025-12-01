import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import nextScript from './mocks/next-scipt';

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

  // Page with import map for testing bare specifier resolution
  '/esm-importmap-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Import Map Test</title>

  <!-- Import Map to resolve bare specifiers -->
  <script type="importmap">
  {
    "imports": {
      "my-greeting": "/modules/utils/greeting.js",
      "my-math": "/modules/utils/math.js",
      "utils/": "/modules/utils/"
    }
  }
  </script>
</head>
<body>
  <h1>Import Map Test</h1>
  <div id="greeting-result">Greeting: Loading...</div>
  <div id="math-result">Math: Loading...</div>

  <script type="module">
    // Use bare specifiers that should be resolved via import map
    import { greet } from 'my-greeting';
    import { add, multiply } from 'my-math';

    console.log('[Import Map Test] Module loaded with bare specifiers');

    const greeting = greet('Import Map');
    const sum = add(100, 200);
    const product = multiply(10, 20);

    document.getElementById('greeting-result').textContent = 'Greeting: ' + greeting;
    document.getElementById('greeting-result').dataset.loaded = 'true';

    document.getElementById('math-result').textContent = 'Math: Sum=' + sum + ', Product=' + product;
    document.getElementById('math-result').dataset.loaded = 'true';

    window.__importMapTestData = { greeting, sum, product, loaded: true };
    console.log('[Import Map Test] Results:', { greeting, sum, product });
  </script>
</body>
</html>`,

  // =============================================================================
  // CSS Module Test Pages
  // =============================================================================

  // Page with CSS module import
  '/esm-css-module-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CSS Module Test</title>
</head>
<body>
  <h1>CSS Module Test</h1>
  <div id="styled-box" class="test-box">This box should be styled</div>
  <div id="result">Loading...</div>

  <script type="module">
    // Import CSS module - should inject styles into the page
    import './modules/styles.css';

    console.log('[CSS Module Test] CSS module imported');

    document.getElementById('result').textContent = 'CSS module loaded!';
    document.getElementById('result').dataset.loaded = 'true';

    // Check if styles were applied
    const box = document.getElementById('styled-box');
    const computedStyle = window.getComputedStyle(box);
    window.__cssModuleTestData = {
      loaded: true,
      backgroundColor: computedStyle.backgroundColor
    };
    console.log('[CSS Module Test] Computed style:', computedStyle.backgroundColor);
  </script>
</body>
</html>`,

  // CSS module file
  '/modules/styles.css': `/* Test CSS Module */
.test-box {
  background-color: rgb(0, 128, 255);
  color: white;
  padding: 20px;
  border-radius: 8px;
  margin: 10px 0;
}

.test-box:hover {
  background-color: rgb(0, 100, 200);
}
`,

  // =============================================================================
  // Dynamic Import Test Pages
  // =============================================================================

  // Page with dynamic import
  '/esm-dynamic-import-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dynamic Import Test</title>
</head>
<body>
  <h1>Dynamic Import Test</h1>
  <div id="result">Loading...</div>
  <button id="load-btn">Load Module Dynamically</button>

  <script type="module">
    console.log('[Dynamic Import Test] Main module loaded');

    const resultEl = document.getElementById('result');
    const button = document.getElementById('load-btn');

    // Mark initial load
    window.__dynamicImportTestData = { mainLoaded: true, dynamicLoaded: false };

    button.addEventListener('click', async function() {
      console.log('[Dynamic Import Test] Button clicked, loading dynamic module...');
      resultEl.textContent = 'Loading dynamic module...';

      try {
        // Dynamic import - should be handled by runtime loader
        const module = await import('./modules/dynamic-module.js');
        console.log('[Dynamic Import Test] Dynamic module loaded:', module);

        resultEl.textContent = 'Dynamic module loaded: ' + (module.message || module.default?.message || 'success');
        resultEl.dataset.loaded = 'true';
        window.__dynamicImportTestData.dynamicLoaded = true;
        window.__dynamicImportTestData.moduleContent = module;
      } catch (e) {
        console.error('[Dynamic Import Test] Failed:', e);
        resultEl.textContent = 'Failed: ' + e.message;
        window.__dynamicImportTestData.error = e.message;
      }
    });

    resultEl.textContent = 'Ready - click button to load';
  </script>
</body>
</html>`,

  // Dynamic module that gets loaded at runtime
  '/modules/dynamic-module.js': `// This module is loaded dynamically
console.log('[Dynamic Module] I was loaded dynamically!');

export const message = 'Hello from dynamic module!';
export const timestamp = Date.now();

export default {
  message: 'Default export from dynamic module',
  loaded: true
};
`,

  // =============================================================================
  // Top-Level Await Test Pages
  // =============================================================================

  // Page with top-level await
  '/esm-top-level-await-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Top-Level Await Test</title>
</head>
<body>
  <h1>Top-Level Await Test</h1>
  <div id="result">Loading...</div>

  <script type="module">
    console.log('[TLA Test] Starting top-level await test...');

    // Simulate async operation with top-level await
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    console.log('[TLA Test] Before await');
    await delay(100);
    console.log('[TLA Test] After first await');

    const data = await Promise.resolve({ message: 'TLA works!', value: 42 });
    console.log('[TLA Test] After second await, data:', data);

    document.getElementById('result').textContent = 'TLA Result: ' + data.message;
    document.getElementById('result').dataset.loaded = 'true';

    window.__tlaTestData = {
      loaded: true,
      message: data.message,
      value: data.value
    };

    console.log('[TLA Test] Module complete');
  </script>
</body>
</html>`,

  // =============================================================================
  // Service Worker Test Pages
  // =============================================================================

  // Basic SW registration test page
  '/sw-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Worker Test</title>
</head>
<body>
  <h1>Service Worker Test</h1>
  <div id="result">Registering Service Worker...</div>
  <div id="status">Status: pending</div>

  <script>
    // Test basic SW registration
    window.__swTestData = {
      registered: false,
      scope: null,
      error: null
    };

    async function testSwRegistration() {
      var resultEl = document.getElementById('result');
      var statusEl = document.getElementById('status');

      try {
        console.log('[SW Test] Attempting to register service worker...');

        var registration = await navigator.serviceWorker.register('/sw/simple-sw.js', {
          scope: '/'
        });

        console.log('[SW Test] Registration successful:', registration);

        window.__swTestData.registered = true;
        window.__swTestData.scope = registration.scope;

        resultEl.textContent = 'Service Worker registered! Scope: ' + registration.scope;
        resultEl.dataset.swRegistered = 'true';
        statusEl.textContent = 'Status: registered';

      } catch (error) {
        console.log('[SW Test] Registration failed:', error.message);

        window.__swTestData.error = error.message;
        window.__swTestData.registered = false;

        resultEl.textContent = 'Registration result: ' + error.message;
        resultEl.dataset.swRegistered = 'false';
        statusEl.textContent = 'Status: ' + error.name;
      }
    }

    testSwRegistration();
  </script>
</body>
</html>`,

  // SW test page with imports
  '/sw-imports-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Service Worker with Imports Test</title>
</head>
<body>
  <h1>Service Worker with Imports</h1>
  <div id="result">Loading...</div>

  <script>
    window.__swImportsTestData = {
      registered: false,
      scope: null,
      error: null
    };

    async function testSwWithImports() {
      var resultEl = document.getElementById('result');

      try {
        console.log('[SW Imports Test] Registering SW with imports...');

        var registration = await navigator.serviceWorker.register('/sw/sw-with-imports.js', {
          scope: '/app/'
        });

        console.log('[SW Imports Test] Registration successful');

        window.__swImportsTestData.registered = true;
        window.__swImportsTestData.scope = registration.scope;

        resultEl.textContent = 'SW with imports registered! Scope: ' + registration.scope;
        resultEl.dataset.loaded = 'true';

      } catch (error) {
        console.log('[SW Imports Test] Registration failed:', error.message);
        window.__swImportsTestData.error = error.message;
        resultEl.textContent = 'Error: ' + error.message;
        resultEl.dataset.loaded = 'false';
      }
    }

    testSwWithImports();
  </script>
</body>
</html>`,

  // Test with invalid SW URL
  '/sw-invalid-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invalid Service Worker Test</title>
</head>
<body>
  <h1>Invalid Service Worker URL Test</h1>
  <div id="result">Testing...</div>

  <script>
    window.__swInvalidTestData = {
      registered: false,
      error: null
    };

    async function testInvalidSw() {
      var resultEl = document.getElementById('result');

      try {
        // Try to register a non-existent SW
        var registration = await navigator.serviceWorker.register('/sw/non-existent-sw.js');

        window.__swInvalidTestData.registered = true;
        resultEl.textContent = 'Unexpectedly registered: ' + registration.scope;

      } catch (error) {
        window.__swInvalidTestData.error = error.message;
        resultEl.textContent = 'Expected error: ' + error.message;
      }
    }

    testInvalidSw();
  </script>
</body>
</html>`,

  // Simple Service Worker script
  '/sw/simple-sw.js': `// Simple Service Worker for testing
console.log('[Simple SW] Service Worker loaded');

self.addEventListener('install', function(event) {
  console.log('[Simple SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Simple SW] Activated');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  console.log('[Simple SW] Fetch:', event.request.url);
  // Pass through - don't intercept
});

console.log('[Simple SW] Script evaluated');
`,

  // Service Worker with imports
  '/sw/sw-with-imports.js': `// Service Worker with module imports
import { cacheFirst, networkFirst } from './sw-strategies.js';
import { CACHE_NAME, STATIC_ASSETS } from './sw-config.js';

console.log('[SW with Imports] Loading with cache name:', CACHE_NAME);

self.addEventListener('install', function(event) {
  console.log('[SW with Imports] Installing, caching assets:', STATIC_ASSETS);
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[SW with Imports] Activated');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});
`,

  // SW strategies module
  '/sw/sw-strategies.js': `// Caching strategies for Service Worker
export function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) {
      console.log('[SW Strategies] Cache hit:', request.url);
      return cached;
    }
    return fetch(request);
  });
}

export function networkFirst(request) {
  return fetch(request).catch(function() {
    return caches.match(request);
  });
}

export function staleWhileRevalidate(request) {
  return caches.match(request).then(function(cached) {
    var fetchPromise = fetch(request).then(function(response) {
      return caches.open('dynamic').then(function(cache) {
        cache.put(request, response.clone());
        return response;
      });
    });
    return cached || fetchPromise;
  });
}
`,

  // SW config module
  '/sw/sw-config.js': `// Configuration for Service Worker
export const CACHE_NAME = 'revamp-test-v1';
export const CACHE_VERSION = 1;

export const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/test-image.png'
];

export const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
`,

  // Test page for inline SW (blob URL)
  '/sw-inline-blob-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Inline Service Worker (Blob) Test</title>
</head>
<body>
  <h1>Inline Service Worker - Blob URL</h1>
  <div id="result">Loading...</div>

  <script>
    window.__swInlineBlobTestData = {
      registered: false,
      scope: null,
      error: null
    };

    async function testInlineBlobSw() {
      var resultEl = document.getElementById('result');

      // Create SW code as a blob
      var swCode = \`
        // Inline Service Worker (Blob)
        console.log('[Inline Blob SW] Service Worker loaded');

        self.addEventListener('install', function(event) {
          console.log('[Inline Blob SW] Installing...');
          self.skipWaiting();
        });

        self.addEventListener('activate', function(event) {
          console.log('[Inline Blob SW] Activated');
          event.waitUntil(self.clients.claim());
        });

        self.addEventListener('fetch', function(event) {
          console.log('[Inline Blob SW] Fetch:', event.request.url);
        });

        console.log('[Inline Blob SW] Script evaluated');
      \`;

      try {
        console.log('[SW Inline Blob Test] Creating blob URL...');

        var blob = new Blob([swCode], { type: 'application/javascript' });
        var blobUrl = URL.createObjectURL(blob);

        console.log('[SW Inline Blob Test] Registering blob SW:', blobUrl.substring(0, 50) + '...');

        var registration = await navigator.serviceWorker.register(blobUrl, {
          scope: '/inline-blob/'
        });

        console.log('[SW Inline Blob Test] Registration successful');

        window.__swInlineBlobTestData.registered = true;
        window.__swInlineBlobTestData.scope = registration.scope;

        resultEl.textContent = 'Blob SW registered! Scope: ' + registration.scope;
        resultEl.dataset.swRegistered = 'true';

        // Clean up blob URL
        URL.revokeObjectURL(blobUrl);

      } catch (error) {
        console.log('[SW Inline Blob Test] Registration failed:', error.message);
        window.__swInlineBlobTestData.error = error.message;
        resultEl.textContent = 'Error: ' + error.message;
        resultEl.dataset.swRegistered = 'false';
      }
    }

    testInlineBlobSw();
  </script>
</body>
</html>`,

  // Test page for inline SW (data URL)
  '/sw-inline-data-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Inline Service Worker (Data URL) Test</title>
</head>
<body>
  <h1>Inline Service Worker - Data URL</h1>
  <div id="result">Loading...</div>

  <script>
    window.__swInlineDataTestData = {
      registered: false,
      scope: null,
      error: null
    };

    async function testInlineDataSw() {
      var resultEl = document.getElementById('result');

      // Create SW code as a data URL
      var swCode = \`
        // Inline Service Worker (Data URL)
        console.log('[Inline Data SW] Service Worker loaded');

        self.addEventListener('install', function(event) {
          console.log('[Inline Data SW] Installing...');
          self.skipWaiting();
        });

        self.addEventListener('activate', function(event) {
          console.log('[Inline Data SW] Activated');
          event.waitUntil(self.clients.claim());
        });

        self.addEventListener('fetch', function(event) {
          console.log('[Inline Data SW] Fetch:', event.request.url);
        });

        console.log('[Inline Data SW] Script evaluated');
      \`;

      try {
        console.log('[SW Inline Data Test] Creating data URL...');

        // Encode as data URL
        var dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(swCode);

        console.log('[SW Inline Data Test] Registering data URL SW');

        var registration = await navigator.serviceWorker.register(dataUrl, {
          scope: '/inline-data/'
        });

        console.log('[SW Inline Data Test] Registration successful');

        window.__swInlineDataTestData.registered = true;
        window.__swInlineDataTestData.scope = registration.scope;

        resultEl.textContent = 'Data URL SW registered! Scope: ' + registration.scope;
        resultEl.dataset.swRegistered = 'true';

      } catch (error) {
        console.log('[SW Inline Data Test] Registration failed:', error.message);
        window.__swInlineDataTestData.error = error.message;
        resultEl.textContent = 'Error: ' + error.message;
        resultEl.dataset.swRegistered = 'false';
      }
    }

    testInlineDataSw();
  </script>
</body>
</html>`,

  // Test page for inline SW with modern syntax
  '/sw-inline-modern-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Inline Service Worker (Modern Syntax) Test</title>
</head>
<body>
  <h1>Inline Service Worker - Modern Syntax</h1>
  <div id="result">Loading...</div>

  <script>
    window.__swInlineModernTestData = {
      registered: false,
      scope: null,
      error: null
    };

    async function testInlineModernSw() {
      var resultEl = document.getElementById('result');

      // Create SW code with modern syntax (arrow functions, async/await, etc.)
      var swCode = \`
        // Inline Service Worker with modern syntax
        const SW_VERSION = '1.0.0';
        const CACHE_NAME = \\\`inline-cache-\\\${SW_VERSION}\\\`;

        const log = (...args) => console.log('[Inline Modern SW]', ...args);

        self.addEventListener('install', event => {
          log('Installing, version:', SW_VERSION);
          event.waitUntil(self.skipWaiting());
        });

        self.addEventListener('activate', async event => {
          log('Activated');
          await self.clients.claim();
        });

        self.addEventListener('fetch', event => {
          const { request } = event;
          log('Fetch:', request.url);
        });

        log('Script evaluated with modern syntax');
      \`;

      try {
        console.log('[SW Inline Modern Test] Creating blob URL...');

        var blob = new Blob([swCode], { type: 'application/javascript' });
        var blobUrl = URL.createObjectURL(blob);

        console.log('[SW Inline Modern Test] Registering SW with modern syntax');

        var registration = await navigator.serviceWorker.register(blobUrl, {
          scope: '/inline-modern/'
        });

        console.log('[SW Inline Modern Test] Registration successful');

        window.__swInlineModernTestData.registered = true;
        window.__swInlineModernTestData.scope = registration.scope;

        resultEl.textContent = 'Modern syntax SW registered! Scope: ' + registration.scope;
        resultEl.dataset.swRegistered = 'true';

        URL.revokeObjectURL(blobUrl);

      } catch (error) {
        console.log('[SW Inline Modern Test] Registration failed:', error.message);
        window.__swInlineModernTestData.error = error.message;
        resultEl.textContent = 'Error: ' + error.message;
        resultEl.dataset.swRegistered = 'false';
      }
    }

    testInlineModernSw();
  </script>
</body>
</html>`,

  // =============================================================================
  // Next.js Script Test Page
  // =============================================================================

  // Test page with Next.js self.__next_f.push() pattern
  '/nextjs-script-test': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Next.js Script Test</title>
</head>
<body>
  <h1>Next.js Script Test</h1>
  <div id="result">Loading...</div>
  <div id="parsed-data">Parsed: Loading...</div>
  <div id="error-output"></div>

  <script>
    // Initialize Next.js flight data array and test data
    window.__next_f = [];
    window.__nextjsTestData = {
      pushCalled: false,
      pushData: null,
      parseSuccess: false,
      parsedJson: null,
      errors: []
    };

    // Track errors
    window.onerror = function(msg, source, line, col, error) {
      window.__nextjsTestData.errors.push({
        message: msg,
        source: source,
        line: line,
        col: col,
        error: error ? error.toString() : null
      });
      document.getElementById('error-output').textContent = 'Error: ' + msg;
      return false;
    };

    // Override push to capture data
    var originalPush = Array.prototype.push;
    window.__next_f.push = function() {
      var args = Array.prototype.slice.call(arguments);
      window.__nextjsTestData.pushCalled = true;
      window.__nextjsTestData.pushData = args;

      // Try to parse the second element (JSON string) from the first argument
      if (args.length > 0 && Array.isArray(args[0]) && args[0].length > 1) {
        var jsonString = args[0][1];
        try {
          // The JSON string has a prefix like "1a:" before the actual JSON
          var colonIndex = jsonString.indexOf(':');
          if (colonIndex !== -1) {
            var actualJson = jsonString.substring(colonIndex + 1);
            var parsed = JSON.parse(actualJson);
            window.__nextjsTestData.parseSuccess = true;
            window.__nextjsTestData.parsedJson = parsed;
            document.getElementById('parsed-data').textContent = 'Parsed: Success - ' + (parsed[0] || 'data received');
            document.getElementById('parsed-data').dataset.loaded = 'true';
          }
        } catch (e) {
          window.__nextjsTestData.parseError = e.message;
          document.getElementById('parsed-data').textContent = 'Parse Error: ' + e.message;
        }
      }

      document.getElementById('result').textContent = 'Push called with ' + args.length + ' argument(s)';
      document.getElementById('result').dataset.loaded = 'true';

      return originalPush.apply(this, args);
    };
  </script>

  <!-- Next.js flight data script - this is the pattern used by Next.js RSC -->
  <script>
    ${nextScript}
  </script>
</body>
</html>`,
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
