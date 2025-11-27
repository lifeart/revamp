/**
 * Math polyfills for Safari 9
 */
export const mathPolyfill = `
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
`;
