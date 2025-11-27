/**
 * Fetch API polyfill for Safari 9
 */
export const fetchPolyfill = `
  // fetch polyfill (Safari 9 doesn't have fetch)
  if (typeof fetch === 'undefined') {
    // Headers class polyfill
    window.Headers = function Headers(init) {
      this._headers = {};
      if (init instanceof Headers) {
        var self = this;
        init.forEach(function(value, name) {
          self.append(name, value);
        });
      } else if (init) {
        Object.keys(init).forEach(function(name) {
          this.append(name, init[name]);
        }, this);
      }
    };
    Headers.prototype.append = function(name, value) {
      name = name.toLowerCase();
      if (!this._headers[name]) {
        this._headers[name] = [];
      }
      this._headers[name].push(String(value));
    };
    Headers.prototype.delete = function(name) {
      delete this._headers[name.toLowerCase()];
    };
    Headers.prototype.get = function(name) {
      var values = this._headers[name.toLowerCase()];
      return values ? values.join(', ') : null;
    };
    Headers.prototype.has = function(name) {
      return name.toLowerCase() in this._headers;
    };
    Headers.prototype.set = function(name, value) {
      this._headers[name.toLowerCase()] = [String(value)];
    };
    Headers.prototype.forEach = function(callback, thisArg) {
      var self = this;
      Object.keys(this._headers).forEach(function(name) {
        self._headers[name].forEach(function(value) {
          callback.call(thisArg, value, name, self);
        });
      });
    };
    Headers.prototype.keys = function() {
      return Object.keys(this._headers)[Symbol.iterator] ? 
        Object.keys(this._headers)[Symbol.iterator]() : 
        Object.keys(this._headers);
    };
    Headers.prototype.values = function() {
      var values = [];
      this.forEach(function(value) { values.push(value); });
      return values;
    };
    Headers.prototype.entries = function() {
      var entries = [];
      this.forEach(function(value, name) { entries.push([name, value]); });
      return entries;
    };

    // Response class polyfill
    window.Response = function Response(body, init) {
      init = init || {};
      this.type = 'default';
      this.status = init.status !== undefined ? init.status : 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.statusText = init.statusText || 'OK';
      this.headers = new Headers(init.headers);
      this.url = init.url || '';
      this._body = body;
      this.bodyUsed = false;
    };
    Response.prototype.clone = function() {
      return new Response(this._body, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
        url: this.url
      });
    };
    Response.prototype.text = function() {
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
    Response.prototype.json = function() {
      return this.text().then(JSON.parse);
    };
    Response.prototype.blob = function() {
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
    Response.prototype.arrayBuffer = function() {
      return this.blob().then(function(blob) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { reject(reader.error); };
          reader.readAsArrayBuffer(blob);
        });
      });
    };
    Response.prototype.formData = function() {
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
    Response.error = function() {
      var response = new Response(null, { status: 0, statusText: '' });
      response.type = 'error';
      return response;
    };
    Response.redirect = function(url, status) {
      if ([301, 302, 303, 307, 308].indexOf(status) === -1) {
        throw new RangeError('Invalid status code');
      }
      return new Response(null, { status: status, headers: { Location: url } });
    };

    // Request class polyfill
    window.Request = function Request(input, init) {
      init = init || {};
      var url = typeof input === 'string' ? input : input.url;
      this.url = url;
      this.method = (init.method || (input && input.method) || 'GET').toUpperCase();
      this.headers = new Headers(init.headers || (input && input.headers));
      this.mode = init.mode || 'cors';
      this.credentials = init.credentials || 'same-origin';
      this.cache = init.cache || 'default';
      this.redirect = init.redirect || 'follow';
      this.referrer = init.referrer || 'about:client';
      this.integrity = init.integrity || '';
      this._body = init.body !== undefined ? init.body : (input && input._body);
      this.bodyUsed = false;
    };
    Request.prototype.clone = function() {
      return new Request(this, { body: this._body });
    };
    Request.prototype.text = Response.prototype.text;
    Request.prototype.json = Response.prototype.json;
    Request.prototype.blob = Response.prototype.blob;
    Request.prototype.arrayBuffer = Response.prototype.arrayBuffer;
    Request.prototype.formData = Response.prototype.formData;

    // fetch function polyfill
    window.fetch = function(input, init) {
      return new Promise(function(resolve, reject) {
        var request = new Request(input, init);
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
          resolve(new Response(body, options));
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
    };
    
    console.log('[Revamp] fetch API polyfill loaded');
  }
`;
