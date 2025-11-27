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
`;
