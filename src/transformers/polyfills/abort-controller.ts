/**
 * AbortController polyfill for Safari 9/10
 */
export const abortControllerPolyfill = `
  // AbortController polyfill (Safari 9/10 doesn't have it)
  if (typeof AbortController === 'undefined') {
    window.AbortSignal = function AbortSignal() {
      this.aborted = false;
      this.onabort = null;
      this._listeners = [];
    };
    AbortSignal.prototype.addEventListener = function(type, listener) {
      if (type === 'abort') {
        this._listeners.push(listener);
      }
    };
    AbortSignal.prototype.removeEventListener = function(type, listener) {
      if (type === 'abort') {
        var idx = this._listeners.indexOf(listener);
        if (idx !== -1) this._listeners.splice(idx, 1);
      }
    };
    AbortSignal.prototype.dispatchEvent = function(event) {
      if (event.type === 'abort') {
        this.aborted = true;
        if (typeof this.onabort === 'function') {
          this.onabort(event);
        }
        for (var i = 0; i < this._listeners.length; i++) {
          this._listeners[i].call(this, event);
        }
      }
      return true;
    };
    // AbortSignal.abort() static method
    AbortSignal.abort = function(reason) {
      var signal = new AbortSignal();
      signal.aborted = true;
      signal.reason = reason !== undefined ? reason : new DOMException('signal is aborted without reason', 'AbortError');
      return signal;
    };
    // AbortSignal.timeout() static method
    AbortSignal.timeout = function(milliseconds) {
      var signal = new AbortSignal();
      setTimeout(function() {
        signal.reason = new DOMException('signal timed out', 'TimeoutError');
        signal.dispatchEvent({ type: 'abort' });
      }, milliseconds);
      return signal;
    };
    
    window.AbortController = function AbortController() {
      this.signal = new AbortSignal();
    };
    AbortController.prototype.abort = function(reason) {
      if (!this.signal.aborted) {
        this.signal.reason = reason !== undefined ? reason : new DOMException('signal is aborted without reason', 'AbortError');
        this.signal.dispatchEvent({ type: 'abort' });
      }
    };
    
    // DOMException polyfill if not present
    if (typeof DOMException === 'undefined') {
      window.DOMException = function DOMException(message, name) {
        this.message = message || '';
        this.name = name || 'Error';
      };
      DOMException.prototype = Object.create(Error.prototype);
      DOMException.prototype.constructor = DOMException;
    }
    
    // Patch fetch to support AbortController signal
    if (window.fetch) {
      var originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (init && init.signal) {
          var signal = init.signal;
          if (signal.aborted) {
            return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
          }
          
          return new Promise(function(resolve, reject) {
            var abortHandler = function() {
              reject(new DOMException('The user aborted a request.', 'AbortError'));
            };
            signal.addEventListener('abort', abortHandler);
            
            originalFetch(input, init).then(function(response) {
              signal.removeEventListener('abort', abortHandler);
              resolve(response);
            }).catch(function(err) {
              signal.removeEventListener('abort', abortHandler);
              reject(err);
            });
          });
        }
        return originalFetch(input, init);
      };
    }
  }
`;
