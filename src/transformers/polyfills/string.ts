/**
 * String polyfills for Safari 9
 */
export const stringPolyfill = `
  // String.prototype.includes polyfill
  if (!String.prototype.includes) {
    String.prototype.includes = function(search, start) {
      return this.indexOf(search, start) !== -1;
    };
  }
  
  // String.prototype.startsWith polyfill
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(search, pos) {
      pos = pos || 0;
      return this.substr(pos, search.length) === search;
    };
  }
  
  // String.prototype.endsWith polyfill
  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(search, length) {
      if (length === undefined || length > this.length) length = this.length;
      return this.substring(length - search.length, length) === search;
    };
  }
  
  // String.prototype.repeat polyfill
  if (!String.prototype.repeat) {
    String.prototype.repeat = function(count) {
      if (count < 0 || count === Infinity) throw new RangeError('Invalid count value');
      count = Math.floor(count);
      if (this.length === 0 || count === 0) return '';
      var str = String(this);
      var result = '';
      while (count > 0) {
        if (count & 1) result += str;
        count >>= 1;
        if (count) str += str;
      }
      return result;
    };
  }
  
  // String.prototype.padStart polyfill
  if (!String.prototype.padStart) {
    String.prototype.padStart = function(targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(padString !== undefined ? padString : ' ');
      if (this.length >= targetLength || padString.length === 0) return String(this);
      var pad = '';
      var len = targetLength - this.length;
      while (pad.length < len) pad += padString;
      return pad.slice(0, len) + this;
    };
  }
  
  // String.prototype.padEnd polyfill
  if (!String.prototype.padEnd) {
    String.prototype.padEnd = function(targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(padString !== undefined ? padString : ' ');
      if (this.length >= targetLength || padString.length === 0) return String(this);
      var pad = '';
      var len = targetLength - this.length;
      while (pad.length < len) pad += padString;
      return this + pad.slice(0, len);
    };
  }
  
  // String.prototype.trimStart/trimEnd polyfill
  if (!String.prototype.trimStart) {
    String.prototype.trimStart = String.prototype.trimLeft || function() {
      return this.replace(/^\\s+/, '');
    };
  }
  if (!String.prototype.trimEnd) {
    String.prototype.trimEnd = String.prototype.trimRight || function() {
      return this.replace(/\\s+$/, '');
    };
  }
`;
