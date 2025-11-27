/**
 * Number polyfills for Safari 9
 */
export const numberPolyfill = `
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
`;
