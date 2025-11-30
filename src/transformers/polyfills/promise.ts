/**
 * Promise polyfills for Safari 9/iOS 11+
 */
export const promisePolyfill = `
  // Promise.finally polyfill
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function(callback) {
      var P = this.constructor;
      return this.then(
        function(value) { return P.resolve(callback()).then(function() { return value; }); },
        function(reason) { return P.resolve(callback()).then(function() { throw reason; }); }
      );
    };
  }

  // Promise.allSettled polyfill
  if (typeof Promise !== 'undefined' && !Promise.allSettled) {
    Promise.allSettled = function(promises) {
      return Promise.all(Array.from(promises).map(function(p) {
        return Promise.resolve(p).then(
          function(value) { return { status: 'fulfilled', value: value }; },
          function(reason) { return { status: 'rejected', reason: reason }; }
        );
      }));
    };
  }

  // queueMicrotask polyfill (Safari 9/10 doesn't have it)
  if (typeof queueMicrotask === 'undefined') {
    window.queueMicrotask = function(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('queueMicrotask requires a callback function');
      }
      // Use Promise.resolve().then() to queue a microtask
      // This is the standard way to polyfill queueMicrotask
      Promise.resolve().then(callback).catch(function(err) {
        // Re-throw errors asynchronously to avoid swallowing them
        setTimeout(function() { throw err; }, 0);
      });
    };
  }
`;
