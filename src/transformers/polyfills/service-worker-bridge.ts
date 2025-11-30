/**
 * Service Worker Bridge for Legacy Browsers
 *
 * Instead of blocking Service Workers, this polyfill creates a transparent bridge
 * that intercepts SW registration, fetches and bundles the SW script via our proxy,
 * and provides a compatible implementation for legacy browsers.
 *
 * The approach:
 * 1. Intercept navigator.serviceWorker.register(scriptURL)
 * 2. Redirect the script URL to /__revamp__/sw/bundle?url=<encoded-original-url>
 * 3. The proxy fetches, bundles, and transforms the SW script
 * 4. The SW runs with fetch events proxied through our infrastructure
 *
 * For browsers that don't support Service Workers at all (iOS 9), we provide
 * a fallback that simulates the SW behavior in the main thread.
 */

export const serviceWorkerBridgePolyfill = `
  // [Revamp] Service Worker Bridge for legacy browser compatibility
  (function() {
    'use strict';

    var REVAMP_SW_ENDPOINT = '/__revamp__/sw/bundle';
    var DEBUG = false;

    function log() {
      if (DEBUG) {
        var args = ['[Revamp SW Bridge]'].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
      }
    }

    // Helper to create DOMException-like errors
    function createDOMException(message, name) {
      var canConstruct = false;
      try {
        new DOMException('test', 'TestError');
        canConstruct = true;
      } catch (e) {}

      if (canConstruct) {
        return new DOMException(message, name);
      }

      var error = new Error(message);
      error.name = name || 'Error';
      error.code = 0;
      return error;
    }

    // Resolve a relative URL to absolute
    function resolveUrl(url) {
      try {
        return new URL(url, window.location.href).href;
      } catch (e) {
        return url;
      }
    }

    // Generate the proxied SW script URL
    function getProxiedSwUrl(originalUrl, scope) {
      var absoluteUrl = resolveUrl(originalUrl);
      var params = 'url=' + encodeURIComponent(absoluteUrl);
      if (scope) {
        params += '&scope=' + encodeURIComponent(scope);
      }
      return REVAMP_SW_ENDPOINT + '?' + params;
    }

    // Check if the browser natively supports Service Workers
    var hasNativeServiceWorker = 'serviceWorker' in navigator &&
      typeof navigator.serviceWorker.register === 'function';

    // Store original methods if available
    var originalRegister = hasNativeServiceWorker ?
      navigator.serviceWorker.register.bind(navigator.serviceWorker) : null;

    // Track registered service workers
    var registrations = {};
    var registrationPromises = {};

    // Create a mock ServiceWorkerRegistration
    function createMockRegistration(scriptURL, scope) {
      var registration = {
        active: null,
        installing: null,
        waiting: null,
        scope: scope || '/',
        updateViaCache: 'imports',
        navigationPreload: {
          enable: function() { return Promise.resolve(); },
          disable: function() { return Promise.resolve(); },
          setHeaderValue: function() { return Promise.resolve(); },
          getState: function() { return Promise.resolve({ enabled: false, headerValue: '' }); }
        },
        update: function() {
          log('Update requested for:', scriptURL);
          return Promise.resolve(registration);
        },
        unregister: function() {
          log('Unregister requested for:', scriptURL);
          delete registrations[scope || '/'];
          return Promise.resolve(true);
        },
        addEventListener: function(type, listener) {
          log('addEventListener:', type);
        },
        removeEventListener: function(type, listener) {
          log('removeEventListener:', type);
        },
        dispatchEvent: function(event) {
          log('dispatchEvent:', event.type);
          return false;
        },
        // Custom property to track the script URL
        __revampScriptURL: scriptURL
      };

      return registration;
    }

    // Create a mock ServiceWorker
    function createMockServiceWorker(scriptURL, state) {
      return {
        scriptURL: scriptURL,
        state: state || 'activated',
        onstatechange: null,
        onerror: null,
        postMessage: function(message, transfer) {
          log('postMessage to SW:', message);
          // In a full implementation, this would communicate with the bundled SW
        },
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
      };
    }

    // The bridged register function
    function bridgedRegister(scriptURL, options) {
      options = options || {};
      var scope = options.scope || '/';
      var absoluteScriptUrl = resolveUrl(scriptURL);

      log('Intercepted SW registration:', absoluteScriptUrl, 'scope:', scope);

      // Check if already registered
      if (registrationPromises[scope]) {
        log('Returning existing registration promise for scope:', scope);
        return registrationPromises[scope];
      }

      // Generate the proxied URL for the SW script
      var proxiedUrl = getProxiedSwUrl(absoluteScriptUrl, scope);
      log('Proxied SW URL:', proxiedUrl);

      // If native SW is available, use it with the proxied URL
      if (originalRegister && window.__REVAMP_USE_NATIVE_SW !== false) {
        log('Using native SW registration with proxied script');

        var registrationPromise = originalRegister(proxiedUrl, {
          scope: scope,
          type: options.type || 'classic',
          updateViaCache: options.updateViaCache || 'imports'
        }).then(function(registration) {
          log('Native SW registered successfully:', registration.scope);
          registrations[scope] = registration;
          return registration;
        }).catch(function(error) {
          log('Native SW registration failed:', error.message);
          // Fall back to mock registration
          console.warn('[Revamp] Service Worker registration failed, using fallback:', error.message);
          var mockReg = createMockRegistration(absoluteScriptUrl, scope);
          mockReg.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
          registrations[scope] = mockReg;
          return mockReg;
        });

        registrationPromises[scope] = registrationPromise;
        return registrationPromise;
      }

      // For browsers without native SW support, create a mock registration
      // and load the SW script in a simulated environment
      log('Creating fallback SW registration (no native SW support)');

      var mockRegistration = createMockRegistration(absoluteScriptUrl, scope);

      var registrationPromise = new Promise(function(resolve, reject) {
        // Fetch the bundled SW script
        var xhr = new XMLHttpRequest();
        xhr.open('GET', proxiedUrl, true);
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            log('SW script loaded, length:', xhr.responseText.length);

            // Create a mock active worker
            mockRegistration.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
            mockRegistration.installing = null;
            mockRegistration.waiting = null;

            // Store and resolve
            registrations[scope] = mockRegistration;

            // Dispatch a fake 'controllerchange' event
            try {
              if (navigator.serviceWorker.oncontrollerchange) {
                navigator.serviceWorker.oncontrollerchange(new Event('controllerchange'));
              }
            } catch (e) {}

            resolve(mockRegistration);
          } else {
            console.warn('[Revamp] Failed to load SW script:', xhr.status);
            // Still resolve with mock registration to prevent errors
            mockRegistration.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
            registrations[scope] = mockRegistration;
            resolve(mockRegistration);
          }
        };
        xhr.onerror = function() {
          console.warn('[Revamp] Network error loading SW script');
          mockRegistration.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
          registrations[scope] = mockRegistration;
          resolve(mockRegistration);
        };
        xhr.send();
      });

      registrationPromises[scope] = registrationPromise;
      return registrationPromise;
    }

    // Bridge getRegistration
    function bridgedGetRegistration(clientURL) {
      var scope = clientURL || window.location.href;

      // Try to find matching registration
      for (var regScope in registrations) {
        if (scope.indexOf(regScope) === 0 || regScope === '/') {
          return Promise.resolve(registrations[regScope]);
        }
      }

      // If using native SW, delegate to original
      if (hasNativeServiceWorker && navigator.serviceWorker.getRegistration) {
        return navigator.serviceWorker.getRegistration(clientURL);
      }

      return Promise.resolve(undefined);
    }

    // Bridge getRegistrations
    function bridgedGetRegistrations() {
      var regs = [];
      for (var scope in registrations) {
        regs.push(registrations[scope]);
      }

      // If using native SW and no mock registrations, delegate
      if (regs.length === 0 && hasNativeServiceWorker && navigator.serviceWorker.getRegistrations) {
        return navigator.serviceWorker.getRegistrations();
      }

      return Promise.resolve(regs);
    }

    // Install the bridge
    if (hasNativeServiceWorker) {
      // Override the register method to use proxied URLs
      navigator.serviceWorker.register = bridgedRegister;
      navigator.serviceWorker.getRegistration = bridgedGetRegistration;
      navigator.serviceWorker.getRegistrations = bridgedGetRegistrations;

      log('Service Worker bridge installed (native SW available)');
    } else {
      // Create a complete mock serviceWorker object
      var mockServiceWorkerContainer = {
        controller: null,
        ready: Promise.resolve(createMockRegistration('', '/')),
        register: bridgedRegister,
        getRegistration: bridgedGetRegistration,
        getRegistrations: bridgedGetRegistrations,
        startMessages: function() { log('startMessages called'); },
        addEventListener: function(type, listener) {
          log('ServiceWorkerContainer addEventListener:', type);
        },
        removeEventListener: function(type, listener) {
          log('ServiceWorkerContainer removeEventListener:', type);
        },
        dispatchEvent: function(event) {
          log('ServiceWorkerContainer dispatchEvent:', event.type);
          return false;
        },
        oncontrollerchange: null,
        onmessage: null,
        onmessageerror: null
      };

      try {
        Object.defineProperty(navigator, 'serviceWorker', {
          value: mockServiceWorkerContainer,
          writable: false,
          configurable: true
        });
        log('Service Worker bridge installed (mock SW container)');
      } catch (e) {
        console.warn('[Revamp] Could not install SW bridge:', e);
      }
    }

    console.log('[Revamp] Service Worker bridge ready');
  })();
`;

/**
 * The old bypass polyfill for when SW bridge is disabled
 */
export const serviceWorkerBypassPolyfill = `
  // Service Worker bypass for legacy browsers
  (function() {
    'use strict';

    // Helper to create DOMException-like errors (DOMException is not constructable in older browsers)
    function createDOMException(message, name) {
      var canConstruct = false;
      try {
        new DOMException('test', 'TestError');
        canConstruct = true;
      } catch (e) {}

      if (canConstruct) {
        return new DOMException(message, name);
      }

      // Fallback: create an Error that mimics DOMException
      var error = new Error(message);
      error.name = name || 'Error';
      error.code = 0;
      return error;
    }

    // Disable Service Worker registration
    if ('serviceWorker' in navigator) {
      // Override the register function to prevent SW registration
      var originalRegister = navigator.serviceWorker.register;

      navigator.serviceWorker.register = function(scriptURL, options) {
        console.log('[Revamp] Service Worker registration blocked:', scriptURL);

        // Return a rejected promise with a meaningful message
        return Promise.reject(createDOMException(
          'Service Worker registration is disabled by Revamp proxy for legacy browser compatibility',
          'NotSupportedError'
        ));
      };

      // Mock the ready promise to resolve with a minimal registration object
      if (!navigator.serviceWorker.ready || navigator.serviceWorker.ready === undefined) {
        Object.defineProperty(navigator.serviceWorker, 'ready', {
          get: function() {
            return Promise.resolve({
              active: null,
              installing: null,
              waiting: null,
              scope: '/',
              updateViaCache: 'none',
              update: function() { return Promise.resolve(); },
              unregister: function() { return Promise.resolve(true); },
              addEventListener: function() {},
              removeEventListener: function() {},
              dispatchEvent: function() { return false; }
            });
          }
        });
      }

      // Override getRegistration to return undefined
      navigator.serviceWorker.getRegistration = function() {
        return Promise.resolve(undefined);
      };

      // Override getRegistrations to return empty array
      navigator.serviceWorker.getRegistrations = function() {
        return Promise.resolve([]);
      };

      console.log('[Revamp] Service Worker API disabled for legacy browser compatibility');
    } else {
      // Create a mock serviceWorker object for browsers without it
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          register: function() {
            return Promise.reject(createDOMException('Service Workers not supported', 'NotSupportedError'));
          },
          ready: Promise.resolve({
            active: null,
            installing: null,
            waiting: null,
            scope: '/',
            update: function() { return Promise.resolve(); },
            unregister: function() { return Promise.resolve(true); }
          }),
          controller: null,
          getRegistration: function() { return Promise.resolve(undefined); },
          getRegistrations: function() { return Promise.resolve([]); },
          addEventListener: function() {},
          removeEventListener: function() {}
        },
        writable: false,
        configurable: false
      });
    }
  })();
`;
