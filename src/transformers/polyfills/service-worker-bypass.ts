/**
 * Service Worker bypass for legacy browsers
 * Prevents Service Worker registration which doesn't work on iOS 9
 */
export const serviceWorkerBypassPolyfill = `
  // Service Worker bypass for legacy browsers
  (function() {
    'use strict';

    // Disable Service Worker registration
    if ('serviceWorker' in navigator) {
      // Override the register function to prevent SW registration
      var originalRegister = navigator.serviceWorker.register;

      navigator.serviceWorker.register = function(scriptURL, options) {
        console.log('[Revamp] Service Worker registration blocked:', scriptURL);

        // Return a rejected promise with a meaningful message
        return Promise.reject(new DOMException(
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
            return Promise.reject(new DOMException('Service Workers not supported', 'NotSupportedError'));
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
