/**
 * Array polyfills for Safari 9
 */
export const arrayPolyfill = `
  // Array.from polyfill (Safari 9 partial support)
  if (!Array.from) {
    Array.from = function(arrayLike, mapFn, thisArg) {
      var arr = [];
      var len = arrayLike.length >>> 0;
      for (var i = 0; i < len; i++) {
        if (i in arrayLike) {
          arr[i] = mapFn ? mapFn.call(thisArg, arrayLike[i], i) : arrayLike[i];
        }
      }
      return arr;
    };
  }
  
  // Array.of polyfill
  if (!Array.of) {
    Array.of = function() {
      return Array.prototype.slice.call(arguments);
    };
  }
  
  // Array.prototype.find polyfill
  if (!Array.prototype.find) {
    Array.prototype.find = function(predicate, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (predicate.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }
  
  // Array.prototype.findIndex polyfill
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function(predicate, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (predicate.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }
  
  // Array.prototype.includes polyfill
  if (!Array.prototype.includes) {
    Array.prototype.includes = function(searchElement, fromIndex) {
      var start = fromIndex || 0;
      if (start < 0) start = Math.max(0, this.length + start);
      for (var i = start; i < this.length; i++) {
        if (this[i] === searchElement || (searchElement !== searchElement && this[i] !== this[i])) {
          return true;
        }
      }
      return false;
    };
  }
  
  // Array.prototype.fill polyfill
  if (!Array.prototype.fill) {
    Array.prototype.fill = function(value, start, end) {
      var len = this.length >>> 0;
      var s = start >> 0;
      var e = end === undefined ? len : end >> 0;
      s = s < 0 ? Math.max(len + s, 0) : Math.min(s, len);
      e = e < 0 ? Math.max(len + e, 0) : Math.min(e, len);
      for (var i = s; i < e; i++) this[i] = value;
      return this;
    };
  }
  
  // Array.prototype.copyWithin polyfill
  if (!Array.prototype.copyWithin) {
    Array.prototype.copyWithin = function(target, start, end) {
      var len = this.length >>> 0;
      var to = target >> 0;
      var from = start >> 0;
      var last = end === undefined ? len : end >> 0;
      if (to < 0) to = Math.max(len + to, 0);
      if (from < 0) from = Math.max(len + from, 0);
      if (last < 0) last = Math.max(len + last, 0);
      var count = Math.min(last - from, len - to);
      var direction = 1;
      if (from < to && to < from + count) {
        direction = -1;
        from += count - 1;
        to += count - 1;
      }
      while (count > 0) {
        if (from in this) this[to] = this[from];
        else delete this[to];
        from += direction;
        to += direction;
        count--;
      }
      return this;
    };
  }
  
  // Array.prototype.flat polyfill
  if (!Array.prototype.flat) {
    Array.prototype.flat = function(depth) {
      depth = depth === undefined ? 1 : Math.floor(depth);
      if (depth < 1) return Array.prototype.slice.call(this);
      return (function flat(arr, d) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && d > 0) {
            result = result.concat(flat(arr[i], d - 1));
          } else {
            result.push(arr[i]);
          }
        }
        return result;
      })(this, depth);
    };
  }
  
  // Array.prototype.flatMap polyfill
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function(callback, thisArg) {
      return Array.prototype.map.call(this, callback, thisArg).flat();
    };
  }
`;
