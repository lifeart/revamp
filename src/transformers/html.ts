/**
 * HTML Transformer
 * Removes ads, tracking scripts, and injects polyfills
 */

import * as cheerio from 'cheerio';
import { getConfig } from '../config/index.js';

// Core-js polyfills for iOS 9+ (iPad 2) and iOS 11+
const POLYFILL_SCRIPT = `
<!-- Revamp Polyfills for iOS 9+ (iPad 2) and iOS 11+ -->
<script>
(function() {
  // === Safari 9 (iOS 9 / iPad 2) Polyfills ===
  
  // Symbol polyfill (basic, for Safari 9)
  if (typeof Symbol === 'undefined') {
    window.Symbol = function(desc) {
      return '__symbol_' + (desc || '') + '_' + Math.random().toString(36).slice(2);
    };
    Symbol.iterator = Symbol('iterator');
    Symbol.toStringTag = Symbol('toStringTag');
    Symbol.for = function(key) { return '__symbol_for_' + key; };
    Symbol.keyFor = function(sym) { return sym.replace('__symbol_for_', ''); };
  }
  
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
      var result = '';
      while (count > 0) {
        if (count & 1) result += this;
        count >>= 1;
        if (count) this += this;
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
  
  // Object.assign polyfill (Safari 9 has it but just in case)
  if (!Object.assign) {
    Object.assign = function(target) {
      if (target == null) throw new TypeError('Cannot convert undefined or null to object');
      var to = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (source != null) {
          for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              to[key] = source[key];
            }
          }
        }
      }
      return to;
    };
  }
  
  // Object.entries polyfill
  if (!Object.entries) {
    Object.entries = function(obj) {
      var entries = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          entries.push([key, obj[key]]);
        }
      }
      return entries;
    };
  }
  
  // Object.values polyfill
  if (!Object.values) {
    Object.values = function(obj) {
      var values = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          values.push(obj[key]);
        }
      }
      return values;
    };
  }
  
  // Object.getOwnPropertyDescriptors polyfill
  if (!Object.getOwnPropertyDescriptors) {
    Object.getOwnPropertyDescriptors = function(obj) {
      var descriptors = {};
      var keys = Object.getOwnPropertyNames(obj);
      for (var i = 0; i < keys.length; i++) {
        descriptors[keys[i]] = Object.getOwnPropertyDescriptor(obj, keys[i]);
      }
      return descriptors;
    };
  }
  
  // Number.isNaN polyfill
  if (!Number.isNaN) {
    Number.isNaN = function(value) {
      return typeof value === 'number' && value !== value;
    };
  }
  
  // Number.isFinite polyfill
  if (!Number.isFinite) {
    Number.isFinite = function(value) {
      return typeof value === 'number' && isFinite(value);
    };
  }
  
  // Number.isInteger polyfill
  if (!Number.isInteger) {
    Number.isInteger = function(value) {
      return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
    };
  }
  
  // Number.isSafeInteger polyfill
  if (!Number.isSafeInteger) {
    Number.isSafeInteger = function(value) {
      return Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
    };
  }
  
  // Number.EPSILON polyfill
  if (!Number.EPSILON) {
    Number.EPSILON = 2.220446049250313e-16;
  }
  
  // Number.MAX_SAFE_INTEGER polyfill
  if (!Number.MAX_SAFE_INTEGER) {
    Number.MAX_SAFE_INTEGER = 9007199254740991;
  }
  
  // Number.MIN_SAFE_INTEGER polyfill
  if (!Number.MIN_SAFE_INTEGER) {
    Number.MIN_SAFE_INTEGER = -9007199254740991;
  }
  
  // Math.trunc polyfill
  if (!Math.trunc) {
    Math.trunc = function(v) {
      return v < 0 ? Math.ceil(v) : Math.floor(v);
    };
  }
  
  // Math.sign polyfill
  if (!Math.sign) {
    Math.sign = function(x) {
      x = +x;
      if (x === 0 || x !== x) return x;
      return x > 0 ? 1 : -1;
    };
  }
  
  // Math.log2 polyfill
  if (!Math.log2) {
    Math.log2 = function(x) {
      return Math.log(x) / Math.LN2;
    };
  }
  
  // Math.log10 polyfill
  if (!Math.log10) {
    Math.log10 = function(x) {
      return Math.log(x) / Math.LN10;
    };
  }
  
  // === iOS 11+ Polyfills (also needed for iOS 9) ===
  
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
  
  // Object.fromEntries polyfill
  if (!Object.fromEntries) {
    Object.fromEntries = function(iterable) {
      return Array.from(iterable).reduce(function(obj, entry) {
        obj[entry[0]] = entry[1];
        return obj;
      }, {});
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
  
  // globalThis polyfill
  if (typeof globalThis === 'undefined') {
    (function() {
      if (typeof self !== 'undefined') { self.globalThis = self; }
      else if (typeof window !== 'undefined') { window.globalThis = window; }
      else if (typeof global !== 'undefined') { global.globalThis = global; }
    })();
  }
  
  // Element.prototype.matches polyfill (fallback)
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || 
                                Element.prototype.webkitMatchesSelector;
  }
  
  // Element.prototype.closest polyfill
  if (!Element.prototype.closest) {
    Element.prototype.closest = function(s) {
      var el = this;
      do {
        if (Element.prototype.matches.call(el, s)) return el;
        el = el.parentElement || el.parentNode;
      } while (el !== null && el.nodeType === 1);
      return null;
    };
  }
  
  // Element.prototype.remove polyfill (for very old browsers)
  if (!Element.prototype.remove) {
    Element.prototype.remove = function() {
      if (this.parentNode) this.parentNode.removeChild(this);
    };
  }
  
  // Element.prototype.append polyfill
  if (!Element.prototype.append) {
    Element.prototype.append = function() {
      var nodes = arguments;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (typeof node === 'string') {
          this.appendChild(document.createTextNode(node));
        } else {
          this.appendChild(node);
        }
      }
    };
  }
  
  // Element.prototype.prepend polyfill
  if (!Element.prototype.prepend) {
    Element.prototype.prepend = function() {
      var nodes = arguments;
      var firstChild = this.firstChild;
      for (var i = nodes.length - 1; i >= 0; i--) {
        var node = nodes[i];
        if (typeof node === 'string') {
          node = document.createTextNode(node);
        }
        if (firstChild) {
          this.insertBefore(node, firstChild);
        } else {
          this.appendChild(node);
        }
        firstChild = node;
      }
    };
  }
  
  // NodeList.prototype.forEach polyfill
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  
  // HTMLCollection iteration support (for older Safari)
  if (typeof HTMLCollection !== 'undefined' && HTMLCollection.prototype && !HTMLCollection.prototype.forEach) {
    HTMLCollection.prototype.forEach = Array.prototype.forEach;
  }
  
  // fetch polyfill check (Safari 9 doesn't have fetch)
  if (typeof fetch === 'undefined') {
    console.warn('[Revamp] fetch API not available - some features may not work');
  }
  
  // URLSearchParams polyfill (basic)
  if (typeof URLSearchParams === 'undefined') {
    window.URLSearchParams = function(init) {
      var params = {};
      if (typeof init === 'string') {
        init = init.replace(/^\\?/, '');
        var pairs = init.split('&');
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i].split('=');
          var key = decodeURIComponent(pair[0] || '');
          var value = decodeURIComponent(pair[1] || '');
          if (key) params[key] = value;
        }
      }
      this._params = params;
    };
    URLSearchParams.prototype.get = function(name) {
      return this._params[name] || null;
    };
    URLSearchParams.prototype.set = function(name, value) {
      this._params[name] = String(value);
    };
    URLSearchParams.prototype.has = function(name) {
      return name in this._params;
    };
    URLSearchParams.prototype.delete = function(name) {
      delete this._params[name];
    };
    URLSearchParams.prototype.toString = function() {
      var pairs = [];
      for (var key in this._params) {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(this._params[key]));
      }
      return pairs.join('&');
    };
  }
  
  // CustomEvent polyfill (Safari 9)
  if (typeof CustomEvent !== 'function') {
    window.CustomEvent = function(event, params) {
      params = params || { bubbles: false, cancelable: false, detail: undefined };
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
      return evt;
    };
    CustomEvent.prototype = window.Event.prototype;
  }
  
  // requestAnimationFrame polyfill (should exist in Safari 9 but just in case)
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = window.webkitRequestAnimationFrame || function(callback) {
      return setTimeout(callback, 16);
    };
  }
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = window.webkitCancelAnimationFrame || clearTimeout;
  }
  
  console.log('[Revamp] Polyfills loaded for iOS 9+ (iPad 2) compatibility');
})();
</script>
`;

/**
 * Error overlay script for debugging on device
 * Shows a visual overlay with error details when JavaScript errors occur
 */
const ERROR_OVERLAY_SCRIPT = `
<script>
(function() {
  // Error overlay state
  var errors = [];
  var overlay = null;
  var isVisible = false;
  var errorCount = 0;
  
  // Create error overlay styles
  var style = document.createElement('style');
  style.textContent = 
    '#revamp-error-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);' +
    'color:#fff;z-index:2147483647;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,monospace;' +
    'font-size:13px;line-height:1.5;display:none;padding:0;margin:0;-webkit-overflow-scrolling:touch;}' +
    '#revamp-error-overlay.visible{display:block;}' +
    '#revamp-error-header{background:#e74c3c;padding:12px 16px;position:sticky;top:0;z-index:1;' +
    'display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;' +
    '-webkit-align-items:center;align-items:center;}' +
    '#revamp-error-header h1{margin:0;font-size:16px;font-weight:600;}' +
    '#revamp-error-close{background:#c0392b;border:none;color:#fff;padding:8px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-error-close:active{background:#a93226;}' +
    '#revamp-error-list{padding:0;margin:0;list-style:none;}' +
    '.revamp-error-item{border-bottom:1px solid #333;padding:16px;}' +
    '.revamp-error-item:last-child{border-bottom:none;}' +
    '.revamp-error-type{color:#e74c3c;font-weight:600;font-size:14px;margin-bottom:4px;}' +
    '.revamp-error-message{color:#fff;font-size:14px;margin-bottom:8px;word-wrap:break-word;' +
    'white-space:pre-wrap;background:#1a1a1a;padding:10px;border-radius:4px;overflow-x:auto;}' +
    '.revamp-error-location{color:#3498db;font-size:12px;margin-bottom:8px;}' +
    '.revamp-error-stack{color:#888;font-size:11px;white-space:pre-wrap;word-wrap:break-word;' +
    'background:#111;padding:10px;border-radius:4px;overflow-x:auto;max-height:200px;overflow-y:auto;}' +
    '.revamp-error-time{color:#666;font-size:11px;margin-top:8px;}' +
    '#revamp-error-badge{position:fixed;bottom:20px;right:20px;background:#e74c3c;color:#fff;' +
    'width:50px;height:50px;border-radius:50%;display:-webkit-flex;display:flex;' +
    '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;' +
    'font-weight:bold;font-size:18px;z-index:2147483646;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    '-webkit-tap-highlight-color:transparent;display:none;}' +
    '#revamp-error-badge.visible{display:-webkit-flex;display:flex;}' +
    '#revamp-error-badge:active{-webkit-transform:scale(0.95);transform:scale(0.95);}' +
    '#revamp-error-clear{background:#2c3e50;border:none;color:#fff;padding:8px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;margin-left:8px;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-error-clear:active{background:#1a252f;}';
  
  // Create overlay element
  function createOverlay() {
    if (overlay) return;
    
    document.head.appendChild(style);
    
    overlay = document.createElement('div');
    overlay.id = 'revamp-error-overlay';
    overlay.innerHTML = 
      '<div id="revamp-error-header">' +
        '<h1>⚠️ JavaScript Errors</h1>' +
        '<div>' +
          '<button id="revamp-error-clear">Clear</button>' +
          '<button id="revamp-error-close">Close</button>' +
        '</div>' +
      '</div>' +
      '<ul id="revamp-error-list"></ul>';
    document.body.appendChild(overlay);
    
    // Create error badge
    var badge = document.createElement('div');
    badge.id = 'revamp-error-badge';
    badge.textContent = '0';
    document.body.appendChild(badge);
    
    // Event listeners
    document.getElementById('revamp-error-close').onclick = function() {
      hideOverlay();
    };
    
    document.getElementById('revamp-error-clear').onclick = function() {
      errors = [];
      errorCount = 0;
      updateErrorList();
      updateBadge();
      hideOverlay();
    };
    
    badge.onclick = function() {
      if (isVisible) {
        hideOverlay();
      } else {
        showOverlay();
      }
    };
  }
  
  function showOverlay() {
    if (!overlay) createOverlay();
    overlay.className = 'visible';
    isVisible = true;
  }
  
  function hideOverlay() {
    if (overlay) {
      overlay.className = '';
    }
    isVisible = false;
  }
  
  function updateBadge() {
    var badge = document.getElementById('revamp-error-badge');
    if (badge) {
      badge.textContent = errorCount > 99 ? '99+' : errorCount;
      badge.className = errorCount > 0 ? 'visible' : '';
    }
  }
  
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function updateErrorList() {
    var list = document.getElementById('revamp-error-list');
    if (!list) return;
    
    if (errors.length === 0) {
      list.innerHTML = '<li class="revamp-error-item" style="color:#888;text-align:center;padding:40px;">No errors captured</li>';
      return;
    }
    
    var html = '';
    for (var i = errors.length - 1; i >= 0; i--) {
      var err = errors[i];
      html += '<li class="revamp-error-item">' +
        '<div class="revamp-error-type">' + escapeHtml(err.type) + '</div>' +
        '<div class="revamp-error-message">' + escapeHtml(err.message) + '</div>';
      
      if (err.location) {
        html += '<div class="revamp-error-location">📍 ' + escapeHtml(err.location) + '</div>';
      }
      
      if (err.stack) {
        html += '<div class="revamp-error-stack">' + escapeHtml(err.stack) + '</div>';
      }
      
      html += '<div class="revamp-error-time">🕐 ' + err.time + '</div>' +
        '</li>';
    }
    list.innerHTML = html;
  }
  
  function formatTime() {
    var d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0') + ':' +
           d.getSeconds().toString().padStart(2, '0') + '.' +
           d.getMilliseconds().toString().padStart(3, '0');
  }
  
  function addError(type, message, filename, lineno, colno, stack) {
    var location = '';
    if (filename) {
      location = filename;
      if (lineno) location += ':' + lineno;
      if (colno) location += ':' + colno;
    }
    
    errors.push({
      type: type,
      message: message || 'Unknown error',
      location: location,
      stack: stack || '',
      time: formatTime()
    });
    
    // Keep only last 50 errors
    if (errors.length > 50) {
      errors.shift();
    }
    
    errorCount++;
    
    if (!overlay) createOverlay();
    updateErrorList();
    updateBadge();
  }
  
  // Global error handler
  window.onerror = function(message, source, lineno, colno, error) {
    var stack = '';
    if (error && error.stack) {
      stack = error.stack;
    }
    addError('Error', message, source, lineno, colno, stack);
    return false; // Don't suppress the error
  };
  
  // Unhandled promise rejection handler
  window.onunhandledrejection = function(event) {
    var message = 'Unhandled Promise Rejection';
    var stack = '';
    
    if (event.reason) {
      if (typeof event.reason === 'string') {
        message = event.reason;
      } else if (event.reason.message) {
        message = event.reason.message;
        stack = event.reason.stack || '';
      } else {
        try {
          message = JSON.stringify(event.reason);
        } catch (e) {
          message = String(event.reason);
        }
      }
    }
    
    addError('Promise Rejection', message, '', '', '', stack);
  };
  
  // Console.error interceptor
  var originalConsoleError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(arg) {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    addError('Console Error', message, '', '', '', '');
    originalConsoleError.apply(console, arguments);
  };
  
  console.log('[Revamp] Error overlay initialized - errors will show a red badge');
})();
</script>
`;

/**
 * Common ad/tracking script patterns
 */
const AD_SCRIPT_PATTERNS = [
  /atob/i,
  /ads\//i,
  /googletag/i,
  /doubleclick/i,
  /googleadservices/i,
  /googlesyndication/i,
  /adsbygoogle/i,
  /google_ad/i,
  /adsense/i,
  /adnxs\.com/i,
  /amazon-adsystem/i,
  /facebook\.net.*fbevents/i,
  /connect\.facebook\.net/i,
  /platform\.twitter\.com/i,
  /ads\.twitter\.com/i,
];

const TRACKING_SCRIPT_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /metrika\/tag\.js/i,
  /watch_serp\.js/i,
  /gtag\(/i,
  /gtm\.js/i,
  /analytics\.js/i,
  /hotjar\.com/i,
  /segment\.io/i,
  /segment\.com/i,
  /mixpanel/i,
  /fullstory/i,
  /mouseflow/i,
  /crazyegg/i,
  /clarity\.ms/i,
  /newrelic/i,
  /nr-data\.net/i,
  /sentry\.io/i,
  /bugsnag/i,
  /logrocket/i,
];

function isAdScript(src: string | undefined, content: string): boolean {
  const srcCheck = src ? AD_SCRIPT_PATTERNS.some(p => p.test(src)) : false;
  const contentCheck = AD_SCRIPT_PATTERNS.some(p => p.test(content));
  return srcCheck || contentCheck;
}

function isTrackingScript(src: string | undefined, content: string): boolean {
  const srcCheck = src ? TRACKING_SCRIPT_PATTERNS.some(p => p.test(src)) : false;
  const contentCheck = TRACKING_SCRIPT_PATTERNS.some(p => p.test(content));
  return srcCheck || contentCheck;
}

/**
 * Transform HTML content
 * - Remove ad scripts
 * - Remove tracking scripts
 * - Inject polyfills
 */
export async function transformHtml(html: string, url?: string): Promise<string> {
  const config = getConfig();
  
  if (!config.transformHtml) {
    return html;
  }
  
  try {
    const $ = cheerio.load(html, {
      xml: false,
    });
    
    let removedAds = 0;
    let removedTracking = 0;
    
    // Remove integrity attributes from scripts and links since we transform content
    // (transformed content won't match the original hash)
    $('script[integrity]').removeAttr('integrity');
    $('link[integrity]').removeAttr('integrity');
    
    // Process all script tags
    $('script').each((_, elem) => {
      const $script = $(elem);
      const src = $script.attr('src') || '';
      const content = $script.html() || '';
      
      // Remove ad scripts
      if (config.removeAds && isAdScript(src, content)) {
        $script.remove();
        removedAds++;
        return;
      }
      
      // Remove tracking scripts
      if (config.removeTracking && isTrackingScript(src, content)) {
        $script.remove();
        removedTracking++;
        return;
      }
    });
    
    // Remove common ad containers
    if (config.removeAds) {
      const adSelectors = [
        '[class*="ad-"]',
        '[class*="-ad"]',
        '[class*="ads-"]',
        '[class*="-ads"]',
        '[id*="google_ads"]',
        '[id*="ad-container"]',
        '[id*="ad_container"]',
        'ins.adsbygoogle',
        '[data-ad]',
        '[data-ad-slot]',
        '[data-ad-client]',
      ];
      
      adSelectors.forEach(selector => {
        try {
          $(selector).remove();
        } catch {
          // Ignore invalid selectors
        }
      });
    }
    
    // Remove tracking pixels (1x1 images, invisible iframes)
    if (config.removeTracking) {
      $('img[width="1"][height="1"]').remove();
      $('img[src*="pixel"]').remove();
      $('img[src*="beacon"]').remove();
      $('iframe[width="0"]').remove();
      $('iframe[height="0"]').remove();
      $('iframe[style*="display:none"]').remove();
      $('iframe[style*="display: none"]').remove();
      $('noscript img').remove(); // Tracking pixels often in noscript
    }
    
    // Normalize charset to UTF-8 (since we decode content to UTF-8 during transformation)
    // Update meta charset tag
    $('meta[charset]').attr('charset', 'UTF-8');
    // Update http-equiv Content-Type meta tag
    $('meta[http-equiv="Content-Type"]').attr('content', 'text/html; charset=UTF-8');
    
    // Inject polyfills at the beginning of <head>
    if (config.injectPolyfills) {
      const head = $('head');
      if (head.length > 0) {
        head.prepend(ERROR_OVERLAY_SCRIPT);
        head.prepend(POLYFILL_SCRIPT);
      } else {
        // No head tag, try to add at the beginning
        $.root().prepend(ERROR_OVERLAY_SCRIPT);
        $.root().prepend(POLYFILL_SCRIPT);
      }
    }
    
    // Add a comment showing what Revamp did
    const revampComment = `<!-- Revamp Proxy: Removed ${removedAds} ad scripts, ${removedTracking} tracking scripts -->`;
    $('head').append(revampComment);
    
    return $.html();
  } catch (error) {
    console.error('❌ HTML transform error:', error instanceof Error ? error.message : error);
    return html;
  }
}

/**
 * Check if this looks like an HTML document
 */
export function isHtmlDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') || 
         trimmed.startsWith('<html') ||
         /<html[\s>]/i.test(content);
}
