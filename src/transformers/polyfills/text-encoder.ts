/**
 * TextEncoder/TextDecoder polyfill for Safari 9/10
 */
export const textEncoderPolyfill = `
  // TextEncoder/TextDecoder polyfill (Safari 9/10 doesn't have it)
  if (typeof TextEncoder === 'undefined') {
    window.TextEncoder = function TextEncoder(encoding) {
      this.encoding = 'utf-8'; // Only UTF-8 is supported
    };
    TextEncoder.prototype.encode = function(str) {
      if (typeof str !== 'string') {
        str = String(str);
      }
      var bytes = [];
      for (var i = 0; i < str.length; i++) {
        var codePoint = str.charCodeAt(i);
        // Handle surrogate pairs
        if (codePoint >= 0xD800 && codePoint <= 0xDBFF && i + 1 < str.length) {
          var next = str.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            codePoint = ((codePoint - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
            i++;
          }
        }
        // Encode to UTF-8
        if (codePoint < 0x80) {
          bytes.push(codePoint);
        } else if (codePoint < 0x800) {
          bytes.push(0xC0 | (codePoint >> 6));
          bytes.push(0x80 | (codePoint & 0x3F));
        } else if (codePoint < 0x10000) {
          bytes.push(0xE0 | (codePoint >> 12));
          bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
          bytes.push(0x80 | (codePoint & 0x3F));
        } else {
          bytes.push(0xF0 | (codePoint >> 18));
          bytes.push(0x80 | ((codePoint >> 12) & 0x3F));
          bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
          bytes.push(0x80 | (codePoint & 0x3F));
        }
      }
      return new Uint8Array(bytes);
    };
    TextEncoder.prototype.encodeInto = function(str, dest) {
      var encoded = this.encode(str);
      var len = Math.min(encoded.length, dest.length);
      for (var i = 0; i < len; i++) {
        dest[i] = encoded[i];
      }
      return { read: str.length, written: len };
    };
  }

  if (typeof TextDecoder === 'undefined') {
    window.TextDecoder = function TextDecoder(encoding, options) {
      this.encoding = (encoding || 'utf-8').toLowerCase();
      this.fatal = options && options.fatal || false;
      this.ignoreBOM = options && options.ignoreBOM || false;
      // Support common encodings
      var supported = ['utf-8', 'utf8', 'ascii', 'iso-8859-1', 'latin1'];
      if (supported.indexOf(this.encoding) === -1) {
        this.encoding = 'utf-8';
      }
    };
    TextDecoder.prototype.decode = function(input, options) {
      if (!input) return '';

      var bytes;
      if (input instanceof Uint8Array) {
        bytes = input;
      } else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
      } else if (input.buffer instanceof ArrayBuffer) {
        // Safely handle TypedArray views with bounds checking
        try {
          var offset = input.byteOffset || 0;
          var length = input.byteLength;
          if (typeof length !== 'number' || length < 0 || offset < 0 || offset + length > input.buffer.byteLength) {
            bytes = new Uint8Array(input.buffer);
          } else {
            bytes = new Uint8Array(input.buffer, offset, length);
          }
        } catch (e) {
          bytes = new Uint8Array(input.buffer);
        }
      } else {
        try {
          bytes = new Uint8Array(input);
        } catch (e) {
          bytes = new Uint8Array(0);
        }
      }

      // Handle ASCII and Latin-1
      if (this.encoding === 'ascii' || this.encoding === 'iso-8859-1' || this.encoding === 'latin1') {
        var result = '';
        for (var i = 0; i < bytes.length; i++) {
          result += String.fromCharCode(bytes[i]);
        }
        return result;
      }

      // UTF-8 decoding
      var result = '';
      var i = 0;

      // Skip BOM if present and not ignored
      if (!this.ignoreBOM && bytes.length >= 3 &&
          bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        i = 3;
      }

      while (i < bytes.length) {
        var byte1 = bytes[i++];
        var codePoint;

        if (byte1 < 0x80) {
          codePoint = byte1;
        } else if ((byte1 & 0xE0) === 0xC0) {
          var byte2 = bytes[i++] || 0;
          codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
        } else if ((byte1 & 0xF0) === 0xE0) {
          var byte2 = bytes[i++] || 0;
          var byte3 = bytes[i++] || 0;
          codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
        } else if ((byte1 & 0xF8) === 0xF0) {
          var byte2 = bytes[i++] || 0;
          var byte3 = bytes[i++] || 0;
          var byte4 = bytes[i++] || 0;
          codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) |
                      ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
        } else {
          codePoint = 0xFFFD; // Replacement character
        }

        // Convert code point to string
        if (codePoint > 0xFFFF) {
          // Surrogate pair
          codePoint -= 0x10000;
          result += String.fromCharCode(0xD800 + (codePoint >> 10));
          result += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
        } else {
          result += String.fromCharCode(codePoint);
        }
      }

      return result;
    };
  }
`;
