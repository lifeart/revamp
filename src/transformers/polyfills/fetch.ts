/**
 * Fetch API polyfill for Safari 9
 */
export const fetchPolyfill = `
  // fetch polyfill (Safari 9 doesn't have fetch)
  // Always install to ensure proper functionality and pass browser checks
  (function() {
    // Check if native fetch is truly functional
    var needsPolyfill = typeof fetch === 'undefined' || typeof window.fetch === 'undefined';

    // Also polyfill if Headers/Request/Response are missing (incomplete implementation)
    if (!needsPolyfill) {
      try {
        new Headers();
        new Request('');
        new Response();
      } catch (e) {
        needsPolyfill = true;
      }
    }

    if (!needsPolyfill) {
      return;
    }

    // Headers class polyfill
    function HeadersPolyfill(init) {
      this._headers = {};
      if (init instanceof HeadersPolyfill) {
        var self = this;
        init.forEach(function(value, name) {
          self.append(name, value);
        });
      } else if (init) {
        var keys = Object.keys(init);
        for (var i = 0; i < keys.length; i++) {
          this.append(keys[i], init[keys[i]]);
        }
      }
    }
    HeadersPolyfill.prototype.append = function(name, value) {
      name = name.toLowerCase();
      if (!this._headers[name]) {
        this._headers[name] = [];
      }
      this._headers[name].push(String(value));
    };
    HeadersPolyfill.prototype['delete'] = function(name) {
      delete this._headers[name.toLowerCase()];
    };
    HeadersPolyfill.prototype.get = function(name) {
      var values = this._headers[name.toLowerCase()];
      return values ? values.join(', ') : null;
    };
    HeadersPolyfill.prototype.has = function(name) {
      return name.toLowerCase() in this._headers;
    };
    HeadersPolyfill.prototype.set = function(name, value) {
      this._headers[name.toLowerCase()] = [String(value)];
    };
    HeadersPolyfill.prototype.forEach = function(callback, thisArg) {
      var self = this;
      var keys = Object.keys(this._headers);
      for (var i = 0; i < keys.length; i++) {
        var name = keys[i];
        var values = self._headers[name];
        for (var j = 0; j < values.length; j++) {
          callback.call(thisArg, values[j], name, self);
        }
      }
    };
    HeadersPolyfill.prototype.keys = function() {
      return Object.keys(this._headers);
    };
    HeadersPolyfill.prototype.values = function() {
      var values = [];
      this.forEach(function(value) { values.push(value); });
      return values;
    };
    HeadersPolyfill.prototype.entries = function() {
      var entries = [];
      this.forEach(function(value, name) { entries.push([name, value]); });
      return entries;
    };

    // Response class polyfill
    function ResponsePolyfill(body, init) {
      init = init || {};
      this.type = 'default';
      this.status = init.status !== undefined ? init.status : 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.statusText = init.statusText || 'OK';
      this.headers = new HeadersPolyfill(init.headers);
      this.url = init.url || '';
      this._body = body;
      this.bodyUsed = false;
    }
    ResponsePolyfill.prototype.clone = function() {
      return new ResponsePolyfill(this._body, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
        url: this.url
      });
    };
    ResponsePolyfill.prototype.text = function() {
      var self = this;
      if (this.bodyUsed) {
        return Promise.reject(new TypeError('Body already consumed'));
      }
      this.bodyUsed = true;
      return new Promise(function(resolve) {
        if (typeof self._body === 'string') {
          resolve(self._body);
        } else if (self._body instanceof Blob) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.readAsText(self._body);
        } else {
          resolve(String(self._body || ''));
        }
      });
    };
    ResponsePolyfill.prototype.json = function() {
      return this.text().then(JSON.parse);
    };
    ResponsePolyfill.prototype.blob = function() {
      var self = this;
      if (this.bodyUsed) {
        return Promise.reject(new TypeError('Body already consumed'));
      }
      this.bodyUsed = true;
      return new Promise(function(resolve) {
        if (self._body instanceof Blob) {
          resolve(self._body);
        } else {
          resolve(new Blob([self._body || '']));
        }
      });
    };
    ResponsePolyfill.prototype.arrayBuffer = function() {
      return this.blob().then(function(blob) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { reject(reader.error); };
          reader.readAsArrayBuffer(blob);
        });
      });
    };
    ResponsePolyfill.prototype.formData = function() {
      return this.text().then(function(text) {
        var formData = new FormData();
        text.trim().split('&').forEach(function(pair) {
          if (pair) {
            var split = pair.split('=');
            formData.append(decodeURIComponent(split[0]), decodeURIComponent(split[1] || ''));
          }
        });
        return formData;
      });
    };
    ResponsePolyfill.error = function() {
      var response = new ResponsePolyfill(null, { status: 0, statusText: '' });
      response.type = 'error';
      return response;
    };
    ResponsePolyfill.redirect = function(url, status) {
      if ([301, 302, 303, 307, 308].indexOf(status) === -1) {
        throw new RangeError('Invalid status code');
      }
      return new ResponsePolyfill(null, { status: status, headers: { Location: url } });
    };

    // Request class polyfill
    function RequestPolyfill(input, init) {
      init = init || {};
      var url = typeof input === 'string' ? input : input.url;
      this.url = url;
      this.method = (init.method || (input && input.method) || 'GET').toUpperCase();
      this.headers = new HeadersPolyfill(init.headers || (input && input.headers));
      this.mode = init.mode || 'cors';
      this.credentials = init.credentials || 'same-origin';
      this.cache = init.cache || 'default';
      this.redirect = init.redirect || 'follow';
      this.referrer = init.referrer || 'about:client';
      this.integrity = init.integrity || '';
      this._body = init.body !== undefined ? init.body : (input && input._body);
      this.bodyUsed = false;
    }
    RequestPolyfill.prototype.clone = function() {
      return new RequestPolyfill(this, { body: this._body });
    };
    RequestPolyfill.prototype.text = ResponsePolyfill.prototype.text;
    RequestPolyfill.prototype.json = ResponsePolyfill.prototype.json;
    RequestPolyfill.prototype.blob = ResponsePolyfill.prototype.blob;
    RequestPolyfill.prototype.arrayBuffer = ResponsePolyfill.prototype.arrayBuffer;
    RequestPolyfill.prototype.formData = ResponsePolyfill.prototype.formData;

    // fetch function polyfill
    function fetchPolyfill(input, init) {
      return new Promise(function(resolve, reject) {
        var request = new RequestPolyfill(input, init);
        var xhr = new XMLHttpRequest();

        xhr.onload = function() {
          var headers = {};
          var headerStr = xhr.getAllResponseHeaders();
          if (headerStr) {
            headerStr.split('\\r\\n').forEach(function(line) {
              var parts = line.split(': ');
              var key = parts.shift();
              if (key) {
                headers[key.toLowerCase()] = parts.join(': ');
              }
            });
          }

          var options = {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: headers,
            url: xhr.responseURL || request.url
          };

          var body = xhr.responseType === 'blob' ? xhr.response : xhr.responseText;
          resolve(new ResponsePolyfill(body, options));
        };

        xhr.onerror = function() {
          reject(new TypeError('Network request failed'));
        };

        xhr.ontimeout = function() {
          reject(new TypeError('Network request timeout'));
        };

        xhr.onabort = function() {
          reject(new DOMException('Aborted', 'AbortError'));
        };

        xhr.open(request.method, request.url, true);

        // Set request headers
        request.headers.forEach(function(value, name) {
          xhr.setRequestHeader(name, value);
        });

        // Handle credentials
        if (request.credentials === 'include') {
          xhr.withCredentials = true;
        } else if (request.credentials === 'omit') {
          xhr.withCredentials = false;
        }

        // Handle abort signal if present (from AbortController polyfill)
        if (init && init.signal) {
          var signal = init.signal;
          if (signal.aborted) {
            xhr.abort();
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', function() {
            xhr.abort();
          });
        }

        // Determine body to send
        var body = request._body;
        if (body && typeof body === 'object' && !(body instanceof Blob) &&
            !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
          // Plain object, convert to JSON
          body = JSON.stringify(body);
          if (!request.headers.has('content-type')) {
            xhr.setRequestHeader('Content-Type', 'application/json');
          }
        }

        xhr.send(body || null);
      });
    }

    // Install polyfills globally
    window.Headers = HeadersPolyfill;
    window.Response = ResponsePolyfill;
    window.Request = RequestPolyfill;
    window.fetch = fetchPolyfill;

    // Make fetch look like a native function to pass detection
    if (Object.defineProperty) {
      try {
        Object.defineProperty(window.fetch, 'toString', {
          value: function() { return 'function fetch() { [native code] }'; }
        });
        Object.defineProperty(window.fetch, 'name', {
          value: 'fetch',
          configurable: true
        });
      } catch (e) {}
    }

    console.log('[Revamp] fetch API polyfill loaded');
  })();
`;
