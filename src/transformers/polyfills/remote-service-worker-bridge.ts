/**
 * Remote Service Worker Bridge for Legacy Browsers
 *
 * This polyfill enables Service Workers to execute remotely in a modern browser
 * (Playwright Chromium) while the legacy device (e.g., iPad 2 with iOS 9) acts
 * as the client. The bridge intercepts SW registration, connects to the remote
 * SW server via WebSocket, and forwards fetch events between the device and
 * the remote SW execution context.
 *
 * Architecture:
 * 1. Legacy Device (client) intercepts navigator.serviceWorker.register()
 * 2. Device connects to Remote SW Server via WebSocket
 * 3. Remote SW Server runs the actual SW in Playwright Chromium
 * 4. Fetch events from the SW are forwarded to the device via WebSocket
 * 5. Device makes the actual network request and sends response back
 * 6. Remote SW sends the processed response back to the page
 *
 * This allows modern Service Workers with complex APIs to work on legacy devices
 * that cannot natively support them.
 */

export const remoteServiceWorkerBridgePolyfill = `
  // [Revamp] Remote Service Worker Bridge - Executes SWs in remote Playwright instance
  (function() {
    'use strict';

    var REMOTE_SW_WS_PATH = '/__revamp__/sw/remote';
    var DEBUG = window.__REVAMP_DEBUG__ || window.__REVAMP_REMOTE_SW_DEBUG__ || false;
    var RECONNECT_DELAY = 3000;
    var MAX_RECONNECT_ATTEMPTS = 5;
    var REQUEST_TIMEOUT = 30000; // 30 seconds

    // Generate a unique client ID for this page
    var clientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    function log() {
      if (DEBUG) {
        var args = ['[Revamp Remote SW Bridge]'].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
      }
    }

    function warn() {
      var args = ['[Revamp Remote SW Bridge]'].concat(Array.prototype.slice.call(arguments));
      console.warn.apply(console, args);
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
        // Handle non-string inputs
        if (typeof url !== 'string') {
          if (url && typeof url.toString === 'function') {
            url = url.toString();
          } else {
            return '';
          }
        }
        return new URL(url, window.location.href).href;
      } catch (e) {
        return url;
      }
    }

    // Check if URL is a blob or data URL (inline script)
    function isInlineScript(url) {
      if (typeof url !== 'string') {
        return false;
      }
      return url.indexOf('blob:') === 0 || url.indexOf('data:') === 0;
    }

    // Extract code from a data URL
    function extractDataUrlContent(dataUrl) {
      try {
        var commaIndex = dataUrl.indexOf(',');
        if (commaIndex === -1) return null;

        var header = dataUrl.substring(5, commaIndex);
        var data = dataUrl.substring(commaIndex + 1);

        if (header.indexOf('base64') !== -1) {
          return atob(data);
        } else {
          return decodeURIComponent(data);
        }
      } catch (e) {
        log('Failed to extract data URL content:', e);
        return null;
      }
    }

    // Fetch blob URL content
    function fetchBlobContent(blobUrl) {
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', blobUrl, true);
        xhr.onload = function() {
          if (xhr.status === 200) {
            resolve(xhr.responseText);
          } else {
            reject(new Error('Failed to fetch blob: ' + xhr.status));
          }
        };
        xhr.onerror = function() {
          reject(new Error('Network error fetching blob'));
        };
        xhr.send();
      });
    }

    // =========================================================================
    // WebSocket Connection Management
    // =========================================================================

    var wsConnection = null;
    var wsConnected = false;
    var wsReconnectAttempts = 0;
    var pendingRequests = {};
    var requestIdCounter = 0;
    var registeredScopes = {};
    var registrationPromises = {};
    var messageQueue = [];
    var connectionReadyCallbacks = [];
    var isInitialized = false;

    function getWebSocketUrl() {
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return protocol + '//' + window.location.host + REMOTE_SW_WS_PATH;
    }

    function connectWebSocket() {
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN && isInitialized) {
        log('WebSocket already connected');
        return Promise.resolve(wsConnection);
      }

      if (wsConnection && wsConnection.readyState === WebSocket.CONNECTING) {
        log('WebSocket connection in progress, waiting...');
        return new Promise(function(resolve) {
          connectionReadyCallbacks.push(resolve);
        });
      }

      return new Promise(function(resolve, reject) {
        var wsUrl = getWebSocketUrl();
        log('Connecting to Remote SW Server:', wsUrl);

        try {
          wsConnection = new WebSocket(wsUrl);
        } catch (e) {
          warn('Failed to create WebSocket:', e.message);
          reject(e);
          return;
        }

        var initTimeout = setTimeout(function() {
          if (!isInitialized) {
            warn('WebSocket initialization timeout');
            reject(new Error('WebSocket initialization timeout'));
          }
        }, 5000);

        wsConnection.onopen = function() {
          log('WebSocket connected');
          wsConnected = true;
          wsReconnectAttempts = 0;

          // Send client identification
          sendMessage({
            type: 'client_init',
            clientId: clientId,
            origin: window.location.origin,
            userAgent: navigator.userAgent
          });
        };

        wsConnection.onmessage = function(event) {
          try {
            var message = JSON.parse(event.data);

            // Mark as initialized when we receive init_ack
            if (message.type === 'init_ack') {
              clearTimeout(initTimeout);
              isInitialized = true;
              log('WebSocket initialized, processing queued messages');

              // Process queued messages
              while (messageQueue.length > 0) {
                var queuedMsg = messageQueue.shift();
                sendMessage(queuedMsg);
              }

              // Resolve waiting connection promises
              var callbacks = connectionReadyCallbacks.slice();
              connectionReadyCallbacks = [];
              callbacks.forEach(function(callback) {
                callback(wsConnection);
              });

              resolve(wsConnection);
            }

            handleMessage(message);
          } catch (e) {
            warn('Failed to parse WebSocket message:', e);
          }
        };

        wsConnection.onclose = function(event) {
          log('WebSocket closed:', event.code, event.reason);
          wsConnected = false;
          isInitialized = false;
          wsConnection = null;

          // Reject any waiting connection promises
          var callbacks = connectionReadyCallbacks.slice();
          connectionReadyCallbacks = [];
          callbacks.forEach(function(callback) {
            callback(null);
          });

          // Attempt to reconnect
          if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            wsReconnectAttempts++;
            log('Attempting to reconnect (' + wsReconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')...');
            setTimeout(function() {
              connectWebSocket().catch(function(e) {
                warn('Reconnection failed:', e);
              });
            }, RECONNECT_DELAY);
          } else {
            warn('Max reconnection attempts reached');
          }
        };

        wsConnection.onerror = function(error) {
          warn('WebSocket error:', error);
          reject(error);
        };
      });
    }

    function sendMessage(message) {
      if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        warn('WebSocket not connected, queueing message');
        messageQueue.push(message);
        return false;
      }

      if (!isInitialized && message.type !== 'client_init') {
        log('WebSocket not initialized yet, queueing message');
        messageQueue.push(message);
        return false;
      }

      try {
        wsConnection.send(JSON.stringify(message));
        return true;
      } catch (e) {
        warn('Failed to send message:', e);
        return false;
      }
    }

    function sendRequest(message) {
      return new Promise(function(resolve, reject) {
        var requestId = 'req_' + (++requestIdCounter);
        message.requestId = requestId;

        var timeoutId = setTimeout(function() {
          if (pendingRequests[requestId]) {
            delete pendingRequests[requestId];
            reject(new Error('Request timeout - no response received'));
          }
        }, REQUEST_TIMEOUT);

        pendingRequests[requestId] = {
          resolve: resolve,
          reject: reject,
          timestamp: Date.now(),
          timeoutId: timeoutId
        };

        // If not initialized, the message will be queued and sent later
        // Don't reject immediately - wait for initialization
        if (!sendMessage(message)) {
          log('Request queued, waiting for WebSocket initialization');
          // The message is now in the queue and will be sent when initialized
          // Keep the pending request alive
        }
      });
    }

    // =========================================================================
    // Message Handling
    // =========================================================================

    function handleMessage(message) {
      log('Received message:', message.type);

      switch (message.type) {
        case 'response':
          handleResponse(message);
          break;

        case 'fetch_request':
          handleFetchRequest(message);
          break;

        case 'sw_registered':
          handleSwRegistered(message);
          break;

        case 'sw_error':
          handleSwError(message);
          break;

        case 'sw_message':
          handleSwMessage(message);
          break;

        case 'ping':
          sendMessage({ type: 'pong', timestamp: Date.now() });
          break;

        default:
          log('Unknown message type:', message.type);
      }
    }

    function handleResponse(message) {
      var pending = pendingRequests[message.requestId];
      if (pending) {
        clearTimeout(pending.timeoutId);
        delete pendingRequests[message.requestId];
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.data);
        }
      }
    }

    // Headers that are forbidden or typically cause CORS issues
    var FORBIDDEN_HEADERS = [
      'user-agent',
      'host',
      'connection',
      'content-length',
      'accept-encoding',
      'accept-language',
      'origin',
      'referer',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-fetch-user',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'upgrade-insecure-requests'
    ];

    function filterHeaders(headers, targetUrl) {
      if (!headers || typeof headers !== 'object') {
        return {};
      }

      var filtered = {};
      var isCrossOrigin = false;

      try {
        var targetOrigin = new URL(targetUrl).origin;
        isCrossOrigin = targetOrigin !== window.location.origin;
      } catch (e) {
        isCrossOrigin = true;
      }

      for (var key in headers) {
        if (headers.hasOwnProperty(key)) {
          var lowerKey = key.toLowerCase();
          // For cross-origin requests, filter out problematic headers
          if (isCrossOrigin && FORBIDDEN_HEADERS.indexOf(lowerKey) !== -1) {
            log('Filtering header for CORS:', key);
            continue;
          }
          filtered[key] = headers[key];
        }
      }

      return filtered;
    }

    function handleFetchRequest(message) {
      // Remote SW is requesting a fetch - execute it locally and send back the result
      log('Handling fetch request from remote SW:', message.url);

      var isCrossOrigin = false;
      try {
        var targetOrigin = new URL(message.url).origin;
        isCrossOrigin = targetOrigin !== window.location.origin;
      } catch (e) {
        isCrossOrigin = true;
      }

      var fetchOptions = {
        method: message.method || 'GET',
        headers: filterHeaders(message.headers, message.url),
        // Use 'cors' for cross-origin, 'same-origin' for same-origin
        mode: isCrossOrigin ? 'cors' : 'same-origin',
        // For cross-origin, use 'omit' to avoid sending credentials which can cause CORS issues
        credentials: isCrossOrigin ? 'omit' : (message.credentials || 'same-origin')
      };

      if (message.body && message.method !== 'GET' && message.method !== 'HEAD') {
        fetchOptions.body = message.body;
      }

      log('Fetch options:', JSON.stringify({ url: message.url, method: fetchOptions.method, mode: fetchOptions.mode, credentials: fetchOptions.credentials }));

      fetch(message.url, fetchOptions)
        .then(function(response) {
          return response.arrayBuffer().then(function(buffer) {
            // Convert ArrayBuffer to base64 for transmission
            var bytes = new Uint8Array(buffer);
            var binary = '';
            for (var i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            var base64Body = btoa(binary);

            // Extract headers
            var responseHeaders = {};
            response.headers.forEach(function(value, key) {
              responseHeaders[key] = value;
            });

            return {
              status: response.status,
              statusText: response.statusText,
              headers: responseHeaders,
              body: base64Body,
              bodyEncoding: 'base64'
            };
          });
        })
        .then(function(responseData) {
          sendMessage({
            type: 'fetch_response',
            requestId: message.requestId,
            scope: message.scope,
            response: responseData
          });
        })
        .catch(function(error) {
          sendMessage({
            type: 'fetch_response',
            requestId: message.requestId,
            scope: message.scope,
            error: error.message
          });
        });
    }

    function handleSwRegistered(message) {
      log('Remote SW registered:', message.scope);
      registeredScopes[message.scope] = {
        scriptURL: message.scriptURL,
        registrationId: message.registrationId
      };
    }

    function handleSwError(message) {
      warn('Remote SW error:', message.error);
      var pending = pendingRequests[message.requestId];
      if (pending) {
        delete pendingRequests[message.requestId];
        pending.reject(new Error(message.error));
      }
    }

    function handleSwMessage(message) {
      // Dispatch a message event to the page
      log('Received message from remote SW:', message.data);

      try {
        var event = new MessageEvent('message', {
          data: message.data,
          origin: window.location.origin
        });

        if (navigator.serviceWorker.onmessage) {
          navigator.serviceWorker.onmessage(event);
        }
        navigator.serviceWorker.dispatchEvent(event);
      } catch (e) {
        warn('Failed to dispatch SW message:', e);
      }
    }

    // =========================================================================
    // Service Worker Registration Bridge
    // =========================================================================

    // Check if the browser natively supports Service Workers
    var hasNativeServiceWorker = 'serviceWorker' in navigator &&
      typeof navigator.serviceWorker.register === 'function';

    // Store original methods if available (for potential fallback)
    var originalRegister = hasNativeServiceWorker ?
      navigator.serviceWorker.register.bind(navigator.serviceWorker) : null;

    // Track registrations
    var registrations = {};

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
          return sendRequest({
            type: 'sw_update',
            scope: scope
          }).then(function() {
            return registration;
          });
        },
        unregister: function() {
          log('Unregister requested for:', scriptURL);
          return sendRequest({
            type: 'sw_unregister',
            scope: scope
          }).then(function() {
            delete registrations[scope];
            delete registeredScopes[scope];
            return true;
          });
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
        __revampScriptURL: scriptURL,
        __revampRemote: true
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
          log('postMessage to remote SW:', message);
          sendMessage({
            type: 'sw_postmessage',
            scope: scriptURL,
            message: message
          });
        },
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
      };
    }

    // The bridged register function for remote SWs
    function remoteRegister(scriptURL, options) {
      // Validate and normalize scriptURL
      if (scriptURL && typeof scriptURL !== 'string') {
        // Handle URL objects or other types
        if (typeof scriptURL.toString === 'function') {
          scriptURL = scriptURL.toString();
        } else if (scriptURL.href) {
          scriptURL = scriptURL.href;
        } else {
          return Promise.reject(createDOMException('Invalid scriptURL', 'TypeError'));
        }
      }
      
      if (!scriptURL) {
        return Promise.reject(createDOMException('scriptURL is required', 'TypeError'));
      }

      options = options || {};
      var scope = options.scope || '/';
      var absoluteScriptUrl = resolveUrl(scriptURL);

      log('Intercepted SW registration for remote execution:', absoluteScriptUrl, 'scope:', scope);

      // Check if already registered
      if (registrationPromises[scope]) {
        log('Returning existing registration promise for scope:', scope);
        return registrationPromises[scope];
      }

      // Ensure WebSocket is connected
      var registrationPromise = connectWebSocket()
        .then(function() {
          // Get script content for inline scripts
          if (isInlineScript(scriptURL)) {
            if (scriptURL.indexOf('data:') === 0) {
              var code = extractDataUrlContent(scriptURL);
              if (!code) {
                return Promise.reject(new Error('Failed to extract data URL content'));
              }
              return sendRequest({
                type: 'sw_register',
                scope: scope,
                scriptType: 'inline',
                scriptCode: code,
                options: {
                  type: options.type || 'classic',
                  updateViaCache: options.updateViaCache || 'imports'
                }
              });
            } else if (scriptURL.indexOf('blob:') === 0) {
              return fetchBlobContent(scriptURL).then(function(code) {
                return sendRequest({
                  type: 'sw_register',
                  scope: scope,
                  scriptType: 'inline',
                  scriptCode: code,
                  options: {
                    type: options.type || 'classic',
                    updateViaCache: options.updateViaCache || 'imports'
                  }
                });
              });
            }
          }

          // Regular URL - send to remote server
          return sendRequest({
            type: 'sw_register',
            scope: scope,
            scriptURL: absoluteScriptUrl,
            scriptType: 'url',
            options: {
              type: options.type || 'classic',
              updateViaCache: options.updateViaCache || 'imports'
            }
          });
        })
        .then(function(result) {
          log('Remote SW registration successful:', result);

          var registration = createMockRegistration(absoluteScriptUrl, scope);
          registration.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
          registrations[scope] = registration;

          return registration;
        })
        .catch(function(error) {
          warn('Remote SW registration failed:', error.message);

          // Create a mock registration anyway so the page doesn't break
          var mockReg = createMockRegistration(absoluteScriptUrl, scope);
          mockReg.active = createMockServiceWorker(absoluteScriptUrl, 'activated');
          registrations[scope] = mockReg;

          return mockReg;
        });

      registrationPromises[scope] = registrationPromise;
      return registrationPromise;
    }

    // Bridge getRegistration
    function remoteGetRegistration(clientURL) {
      var scope = clientURL || window.location.href;

      // Try to find matching registration
      for (var regScope in registrations) {
        if (scope.indexOf(regScope) === 0 || regScope === '/') {
          return Promise.resolve(registrations[regScope]);
        }
      }

      return Promise.resolve(undefined);
    }

    // Bridge getRegistrations
    function remoteGetRegistrations() {
      var regs = [];
      for (var scope in registrations) {
        regs.push(registrations[scope]);
      }
      return Promise.resolve(regs);
    }

    // =========================================================================
    // Install the Bridge
    // =========================================================================

    if (hasNativeServiceWorker) {
      // Override the register method to use remote execution
      navigator.serviceWorker.register = remoteRegister;
      navigator.serviceWorker.getRegistration = remoteGetRegistration;
      navigator.serviceWorker.getRegistrations = remoteGetRegistrations;

      log('Remote Service Worker bridge installed (native SW available, using remote)');
    } else {
      // Create a complete mock serviceWorker object
      var mockServiceWorkerContainer = {
        controller: null,
        ready: Promise.resolve(createMockRegistration('', '/')),
        register: remoteRegister,
        getRegistration: remoteGetRegistration,
        getRegistrations: remoteGetRegistrations,
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
        log('Remote Service Worker bridge installed (mock SW container)');
      } catch (e) {
        warn('Could not install Remote SW bridge:', e);
      }
    }

    // Initialize WebSocket connection proactively
    connectWebSocket().catch(function(e) {
      warn('Initial WebSocket connection failed:', e.message);
    });

    console.log('[Revamp] Remote Service Worker bridge ready');
  })();
`;
