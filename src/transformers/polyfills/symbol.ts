/**
 * Symbol is intentionally NOT polyfilled.
 *
 * The previous "polyfill" returned a string of the form `'__symbol_<random>'`
 * which broke `typeof x === 'symbol'`, `Symbol.iterator`, every `for..of`
 * over a Map/Set, and `Object.getOwnPropertySymbols`. Corrupt iteration
 * semantics are worse than the natural Safari 9 absence — code paths that
 * legitimately require Symbol should fail loudly so the user (or a feature
 * detect) can fall back, rather than silently iterating wrong values.
 *
 * If you need Symbol on the iPad, integrate `core-js/es/symbol`. Until then,
 * this export is an empty string so the polyfill bundle stays well-formed.
 */
export const symbolPolyfill = '';
