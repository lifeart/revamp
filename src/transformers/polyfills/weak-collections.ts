/**
 * WeakMap and WeakSet polyfills for Safari 9
 * Safari 9 has these but this provides fallback for edge cases
 */
export const weakCollectionsPolyfill = `
  // WeakMap polyfill
  (function() {
    'use strict';

    if (typeof WeakMap !== 'undefined' && typeof WeakSet !== 'undefined') {
      // Already supported
      return;
    }

    var counter = Date.now() % 1e9;

    // WeakMap polyfill using hidden property
    if (typeof WeakMap === 'undefined') {
      var WeakMapPolyfill = function() {
        this._id = '_wm_' + (counter++) + '_' + Math.random().toString(36).slice(2);
      };

      WeakMapPolyfill.prototype.set = function(key, value) {
        if (key === null || (typeof key !== 'object' && typeof key !== 'function')) {
          throw new TypeError('Invalid value used as weak map key');
        }
        var entry = key[this._id];
        if (entry && entry[0] === key) {
          entry[1] = value;
        } else {
          Object.defineProperty(key, this._id, {
            value: [key, value],
            writable: true,
            configurable: true
          });
        }
        return this;
      };

      WeakMapPolyfill.prototype.get = function(key) {
        if (key === null || (typeof key !== 'object' && typeof key !== 'function')) {
          return undefined;
        }
        var entry = key[this._id];
        if (entry && entry[0] === key) {
          return entry[1];
        }
        return undefined;
      };

      WeakMapPolyfill.prototype.has = function(key) {
        if (key === null || (typeof key !== 'object' && typeof key !== 'function')) {
          return false;
        }
        var entry = key[this._id];
        return !!(entry && entry[0] === key);
      };

      WeakMapPolyfill.prototype.delete = function(key) {
        if (key === null || (typeof key !== 'object' && typeof key !== 'function')) {
          return false;
        }
        var entry = key[this._id];
        if (!entry || entry[0] !== key) {
          return false;
        }
        delete key[this._id];
        return true;
      };

      window.WeakMap = WeakMapPolyfill;
    }

    // WeakSet polyfill using WeakMap
    if (typeof WeakSet === 'undefined') {
      var WeakSetPolyfill = function() {
        this._map = new WeakMap();
      };

      WeakSetPolyfill.prototype.add = function(value) {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          throw new TypeError('Invalid value used in weak set');
        }
        this._map.set(value, true);
        return this;
      };

      WeakSetPolyfill.prototype.has = function(value) {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          return false;
        }
        return this._map.has(value);
      };

      WeakSetPolyfill.prototype.delete = function(value) {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          return false;
        }
        return this._map.delete(value);
      };

      window.WeakSet = WeakSetPolyfill;
    }
  })();
`;
