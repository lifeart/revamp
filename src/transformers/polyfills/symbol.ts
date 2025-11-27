/**
 * Symbol polyfill for Safari 9
 */
export const symbolPolyfill = `
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
`;
