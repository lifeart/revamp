/**
 * BigInt polyfill for Safari 9-13
 * Note: This is a limited polyfill that stores values as strings internally
 */
export const bigIntPolyfill = `
  // BigInt polyfill (basic implementation for Safari 9-13)
  // Note: This is a limited polyfill that stores values as strings internally
  // It supports basic operations but not all BigInt features
  if (typeof BigInt === 'undefined') {
    (function() {
      // Simple BigInt implementation using string arithmetic
      function BigIntPolyfill(value) {
        if (!(this instanceof BigIntPolyfill)) {
          return new BigIntPolyfill(value);
        }
        if (value instanceof BigIntPolyfill) {
          this._value = value._value;
          this._negative = value._negative;
          return;
        }
        var str = String(value).trim();
        this._negative = str.charAt(0) === '-';
        if (this._negative || str.charAt(0) === '+') {
          str = str.slice(1);
        }
        // Remove 'n' suffix if present
        if (str.charAt(str.length - 1) === 'n') {
          str = str.slice(0, -1);
        }
        // Handle hex, octal, binary
        if (str.indexOf('0x') === 0 || str.indexOf('0X') === 0) {
          str = parseInt(str, 16).toString();
        } else if (str.indexOf('0o') === 0 || str.indexOf('0O') === 0) {
          str = parseInt(str.slice(2), 8).toString();
        } else if (str.indexOf('0b') === 0 || str.indexOf('0B') === 0) {
          str = parseInt(str.slice(2), 2).toString();
        }
        // Validate and store
        if (!/^\\d+$/.test(str)) {
          throw new SyntaxError('Cannot convert ' + value + ' to a BigInt');
        }
        // Remove leading zeros
        this._value = str.replace(/^0+/, '') || '0';
      }
      
      // Helper: compare absolute values
      function compareAbs(a, b) {
        if (a.length !== b.length) return a.length > b.length ? 1 : -1;
        for (var i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
        }
        return 0;
      }
      
      // Helper: add two positive number strings
      function addPositive(a, b) {
        var result = '';
        var carry = 0;
        var i = a.length - 1;
        var j = b.length - 1;
        while (i >= 0 || j >= 0 || carry) {
          var sum = carry;
          if (i >= 0) sum += parseInt(a[i--], 10);
          if (j >= 0) sum += parseInt(b[j--], 10);
          carry = Math.floor(sum / 10);
          result = (sum % 10) + result;
        }
        return result || '0';
      }
      
      // Helper: subtract smaller from larger (both positive strings, a >= b)
      function subtractPositive(a, b) {
        var result = '';
        var borrow = 0;
        var i = a.length - 1;
        var j = b.length - 1;
        while (i >= 0) {
          var diff = parseInt(a[i--], 10) - borrow - (j >= 0 ? parseInt(b[j--], 10) : 0);
          if (diff < 0) {
            diff += 10;
            borrow = 1;
          } else {
            borrow = 0;
          }
          result = diff + result;
        }
        return result.replace(/^0+/, '') || '0';
      }
      
      // Helper: multiply two positive number strings
      function multiplyPositive(a, b) {
        var result = Array(a.length + b.length).fill(0);
        for (var i = a.length - 1; i >= 0; i--) {
          for (var j = b.length - 1; j >= 0; j--) {
            var mul = parseInt(a[i], 10) * parseInt(b[j], 10);
            var p1 = i + j, p2 = i + j + 1;
            var sum = mul + result[p2];
            result[p2] = sum % 10;
            result[p1] += Math.floor(sum / 10);
          }
        }
        return result.join('').replace(/^0+/, '') || '0';
      }
      
      // Helper: divide two positive number strings, returns [quotient, remainder]
      function dividePositive(a, b) {
        if (b === '0') throw new RangeError('Division by zero');
        if (compareAbs(a, b) < 0) return ['0', a];
        var quotient = '';
        var remainder = '';
        for (var i = 0; i < a.length; i++) {
          remainder += a[i];
          remainder = remainder.replace(/^0+/, '') || '0';
          var count = 0;
          while (compareAbs(remainder, b) >= 0) {
            remainder = subtractPositive(remainder, b);
            count++;
          }
          quotient += count;
        }
        return [quotient.replace(/^0+/, '') || '0', remainder];
      }
      
      BigIntPolyfill.prototype.toString = function(radix) {
        if (radix && radix !== 10) {
          // For non-base-10, convert through number if safe
          var num = Number(this._value);
          if (num <= Number.MAX_SAFE_INTEGER) {
            var str = num.toString(radix);
            return this._negative ? '-' + str : str;
          }
        }
        return (this._negative && this._value !== '0' ? '-' : '') + this._value;
      };
      
      BigIntPolyfill.prototype.valueOf = function() {
        var num = Number(this._value);
        return this._negative ? -num : num;
      };
      
      BigIntPolyfill.prototype.toJSON = function() {
        return this.toString();
      };
      
      // Static methods
      BigIntPolyfill.asIntN = function(bits, bigint) {
        var bi = new BigIntPolyfill(bigint);
        // Simplified: just return the value for now
        return bi;
      };
      
      BigIntPolyfill.asUintN = function(bits, bigint) {
        var bi = new BigIntPolyfill(bigint);
        if (bi._negative) {
          // For negative, would need 2's complement - simplified
          return new BigIntPolyfill(0);
        }
        return bi;
      };
      
      // Make it callable without 'new' (like native BigInt)
      var BigIntWrapper = function BigInt(value) {
        if (typeof value === 'number') {
          if (!Number.isInteger(value)) {
            throw new RangeError('The number ' + value + ' cannot be converted to a BigInt because it is not an integer');
          }
        }
        return new BigIntPolyfill(value);
      };
      
      // Copy prototype methods
      BigIntWrapper.prototype = BigIntPolyfill.prototype;
      BigIntWrapper.asIntN = BigIntPolyfill.asIntN;
      BigIntWrapper.asUintN = BigIntPolyfill.asUintN;
      
      window.BigInt = BigIntWrapper;
      
      // Also expose for arithmetic operations via helper functions
      window.__bigIntAdd = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        if (a._negative === b._negative) {
          var result = new BigIntPolyfill(addPositive(a._value, b._value));
          result._negative = a._negative;
          return result;
        }
        var cmp = compareAbs(a._value, b._value);
        if (cmp === 0) return new BigIntPolyfill(0);
        if (cmp > 0) {
          var result = new BigIntPolyfill(subtractPositive(a._value, b._value));
          result._negative = a._negative;
          return result;
        }
        var result = new BigIntPolyfill(subtractPositive(b._value, a._value));
        result._negative = b._negative;
        return result;
      };
      
      window.__bigIntSub = function(a, b) {
        b = new BigIntPolyfill(b);
        b._negative = !b._negative;
        return window.__bigIntAdd(a, b);
      };
      
      window.__bigIntMul = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        var result = new BigIntPolyfill(multiplyPositive(a._value, b._value));
        result._negative = a._negative !== b._negative && result._value !== '0';
        return result;
      };
      
      window.__bigIntDiv = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        var divResult = dividePositive(a._value, b._value);
        var result = new BigIntPolyfill(divResult[0]);
        result._negative = a._negative !== b._negative && result._value !== '0';
        return result;
      };
      
      window.__bigIntMod = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        var divResult = dividePositive(a._value, b._value);
        var result = new BigIntPolyfill(divResult[1]);
        result._negative = a._negative && result._value !== '0';
        return result;
      };
      
      window.__bigIntEq = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        return a._negative === b._negative && a._value === b._value;
      };
      
      window.__bigIntLt = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        if (a._negative !== b._negative) return a._negative;
        var cmp = compareAbs(a._value, b._value);
        return a._negative ? cmp > 0 : cmp < 0;
      };
      
      window.__bigIntGt = function(a, b) {
        return window.__bigIntLt(b, a);
      };
      
      window.__bigIntLte = function(a, b) {
        return !window.__bigIntGt(a, b);
      };
      
      window.__bigIntGte = function(a, b) {
        return !window.__bigIntLt(a, b);
      };
      
      window.__bigIntPow = function(a, b) {
        a = new BigIntPolyfill(a);
        b = new BigIntPolyfill(b);
        if (b._negative) throw new RangeError('Exponent must be positive');
        if (b._value === '0') return new BigIntPolyfill(1);
        var result = new BigIntPolyfill(1);
        var base = a;
        var exp = b._value;
        // Simple exponentiation
        while (exp !== '0') {
          if (parseInt(exp[exp.length - 1], 10) % 2 === 1) {
            result = window.__bigIntMul(result, base);
          }
          base = window.__bigIntMul(base, base);
          exp = dividePositive(exp, '2')[0];
        }
        return result;
      };
    })();
  }
`;
