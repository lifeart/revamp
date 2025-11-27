/**
 * requestAnimationFrame polyfill for Safari 9
 */
export const requestAnimationFramePolyfill = `
  // requestAnimationFrame polyfill (should exist in Safari 9 but just in case)
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = window.webkitRequestAnimationFrame || function(callback) {
      return setTimeout(callback, 16);
    };
  }
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = window.webkitCancelAnimationFrame || clearTimeout;
  }
`;
