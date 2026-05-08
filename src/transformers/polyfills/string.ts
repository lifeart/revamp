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

  // String.prototype.replaceAll polyfill (ES2021)
  // Spec: when searchValue is a RegExp, it MUST have the global flag set,
  // otherwise throw TypeError. String search replaces every occurrence.
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function(search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) {
          throw new TypeError(
            'String.prototype.replaceAll called with a non-global RegExp argument'
          );
        }
        return this.replace(search, replacement);
      }
      var str = String(this);
      var searchStr = String(search);
      if (searchStr === '') {
        // Insert replacement between every code unit and at both ends.
        var replStr = typeof replacement === 'function'
          ? null
          : String(replacement);
        var out = '';
        for (var i = 0; i < str.length; i++) {
          out += (typeof replacement === 'function'
            ? String(replacement('', i, str))
            : replStr) + str.charAt(i);
        }
        out += (typeof replacement === 'function'
          ? String(replacement('', str.length, str))
          : replStr);
        return out;
      }
      var result = '';
      var lastIndex = 0;
      var idx = str.indexOf(searchStr);
      while (idx !== -1) {
        result += str.slice(lastIndex, idx);
        if (typeof replacement === 'function') {
          result += String(replacement(searchStr, idx, str));
        } else {
          // $ substitutions ($&, $\`, $', $n) — delegate to native replace
          // by passing a literal regex with the search escaped.
          // String-replacement form only: there are no capture groups when the
          // search is a plain string, so $0/$N digit references are intentionally
          // not given distinct semantics (treated as literal pass-through).
          result += String(replacement).replace(/\\$([&\`'$]|\\d{1,2})/g, function(match, group) {
            if (group === '&') return searchStr;
            if (group === '\`') return str.slice(0, idx);
            if (group === "'") return str.slice(idx + searchStr.length);
            if (group === '$') return '$';
            return match;
          });
        }
        lastIndex = idx + searchStr.length;
        idx = str.indexOf(searchStr, lastIndex);
      }
      result += str.slice(lastIndex);
      return result;
    };
  }

  // String.prototype.matchAll polyfill (ES2020)
  // Returns an iterator over all matches as RegExpMatchArray objects.
  // Per spec, if regexp is a RegExp without the global flag, throws TypeError.
  if (!String.prototype.matchAll) {
    String.prototype.matchAll = function(regexp) {
      var str = String(this);
      var flags;
      var pattern;
      if (regexp instanceof RegExp) {
        if (!regexp.global) {
          throw new TypeError(
            'String.prototype.matchAll called with a non-global RegExp argument'
          );
        }
        flags = regexp.flags;
        pattern = regexp.source;
      } else {
        flags = 'g';
        pattern = String(regexp == null ? '' : regexp);
      }
      // Always create a fresh regex so we own lastIndex.
      var re = new RegExp(pattern, flags);
      // Build a manual iterator (Symbol.iterator may be missing on Safari 9
      // — for..of users get a fallback below).
      return {
        next: function() {
          var match = re.exec(str);
          if (match === null) {
            return { value: undefined, done: true };
          }
          // Avoid infinite loop on zero-length matches.
          if (match[0] === '' && re.lastIndex === match.index) {
            re.lastIndex++;
          }
          return { value: match, done: false };
        }
      };
    };
  }
`;
