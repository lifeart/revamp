/**
 * CustomEvent polyfill for Safari 9
 */
export const customEventPolyfill = `
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
`;
