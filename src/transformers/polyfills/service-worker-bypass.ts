/**
 * Service Worker bypass for legacy browsers
 * Prevents Service Worker registration which doesn't work on iOS 9
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
