/**
 * globalThis polyfill for Safari 9
 */
export const globalThisPolyfill = `
  // globalThis polyfill
  if (typeof globalThis === 'undefined') {
    (function() {
      if (typeof self !== 'undefined') { self.globalThis = self; }
      else if (typeof window !== 'undefined') { window.globalThis = window; }
      else if (typeof global !== 'undefined') { global.globalThis = global; }
    })();
  }
`;
