/**
 * Polyfills Index
 * Combines all polyfills for iOS 9+ (iPad 2) and iOS 11+ compatibility
 */

// Core polyfills
export { symbolPolyfill } from './symbol.js';
export { arrayPolyfill } from './array.js';
export { stringPolyfill } from './string.js';
export { objectPolyfill } from './object.js';
export { numberPolyfill } from './number.js';
export { mathPolyfill } from './math.js';
export { promisePolyfill } from './promise.js';
export { globalThisPolyfill } from './global-this.js';

// API polyfills
export { performancePolyfill } from './performance.js';
export { bigIntPolyfill } from './bigint.js';
export { elementPolyfill } from './element.js';
export { fetchPolyfill } from './fetch.js';
export { urlSearchParamsPolyfill } from './url-search-params.js';
export { customEventPolyfill } from './custom-event.js';
export { requestAnimationFramePolyfill } from './request-animation-frame.js';
export { abortControllerPolyfill } from './abort-controller.js';
export { textEncoderPolyfill } from './text-encoder.js';
export { intersectionObserverPolyfill } from './intersection-observer.js';
export { resizeObserverPolyfill } from './resize-observer.js';
export { userAgentPolyfill } from './user-agent.js';
export { esModulesPolyfill } from './es-modules.js';
export { readableStreamPolyfill } from './readable-stream.js';

// Debug tools
export { errorOverlayScript } from './error-overlay.js';
export { configOverlayScript } from './config-overlay.js';

// Import all polyfills
import { symbolPolyfill } from './symbol.js';
import { arrayPolyfill } from './array.js';
import { stringPolyfill } from './string.js';
import { objectPolyfill } from './object.js';
import { numberPolyfill } from './number.js';
import { mathPolyfill } from './math.js';
import { promisePolyfill } from './promise.js';
import { globalThisPolyfill } from './global-this.js';
import { performancePolyfill } from './performance.js';
import { bigIntPolyfill } from './bigint.js';
import { elementPolyfill } from './element.js';
import { fetchPolyfill } from './fetch.js';
import { urlSearchParamsPolyfill } from './url-search-params.js';
import { customEventPolyfill } from './custom-event.js';
import { requestAnimationFramePolyfill } from './request-animation-frame.js';
import { abortControllerPolyfill } from './abort-controller.js';
import { textEncoderPolyfill } from './text-encoder.js';
import { intersectionObserverPolyfill } from './intersection-observer.js';
import { resizeObserverPolyfill } from './resize-observer.js';
import { userAgentPolyfill } from './user-agent.js';
import { esModulesPolyfill } from './es-modules.js';
import { readableStreamPolyfill } from './readable-stream.js';
import { errorOverlayScript } from './error-overlay.js';
import { configOverlayScript } from './config-overlay.js';

/**
 * Build the complete polyfill script from all atomic polyfills
 */
export function buildPolyfillScript(): string {
  const polyfills = [
    // ES Modules compatibility (run first to handle nomodule scripts)
    esModulesPolyfill,
    
    // Core ES6+ polyfills
    symbolPolyfill,
    arrayPolyfill,
    stringPolyfill,
    objectPolyfill,
    numberPolyfill,
    mathPolyfill,
    promisePolyfill,
    globalThisPolyfill,
    
    // Web API polyfills
    performancePolyfill,
    bigIntPolyfill,
    elementPolyfill,
    fetchPolyfill,
    urlSearchParamsPolyfill,
    customEventPolyfill,
    requestAnimationFramePolyfill,
    abortControllerPolyfill,
    textEncoderPolyfill,
    intersectionObserverPolyfill,
    resizeObserverPolyfill,
    readableStreamPolyfill,
  ];

  return `
<!-- Revamp Polyfills for iOS 9+ (iPad 2) and iOS 11+ -->
<script>
(function() {
  // === Safari 9 (iOS 9 / iPad 2) Polyfills ===
${polyfills.join('\n')}
  console.log('[Revamp] Polyfills loaded for iOS 9+ (iPad 2) compatibility');
})();
</script>
`;
}

/**
 * Get the error overlay script
 */
export function getErrorOverlayScript(): string {
  return errorOverlayScript;
}

/**
 * Get the config overlay script
 */
export function getConfigOverlayScript(): string {
  return configOverlayScript;
}

/**
 * Types for custom polyfill loading
 */
export type PolyfillName = 
  | 'symbol'
  | 'array'
  | 'string'
  | 'object'
  | 'number'
  | 'math'
  | 'promise'
  | 'globalThis'
  | 'performance'
  | 'bigint'
  | 'element'
  | 'fetch'
  | 'urlSearchParams'
  | 'customEvent'
  | 'requestAnimationFrame'
  | 'abortController'
  | 'textEncoder'
  | 'intersectionObserver'
  | 'resizeObserver'
  | 'userAgent'
  | 'esModules'
  | 'readableStream';

const polyfillMap: Record<PolyfillName, string> = {
  symbol: symbolPolyfill,
  array: arrayPolyfill,
  string: stringPolyfill,
  object: objectPolyfill,
  number: numberPolyfill,
  math: mathPolyfill,
  promise: promisePolyfill,
  globalThis: globalThisPolyfill,
  performance: performancePolyfill,
  bigint: bigIntPolyfill,
  element: elementPolyfill,
  fetch: fetchPolyfill,
  urlSearchParams: urlSearchParamsPolyfill,
  customEvent: customEventPolyfill,
  requestAnimationFrame: requestAnimationFramePolyfill,
  abortController: abortControllerPolyfill,
  textEncoder: textEncoderPolyfill,
  intersectionObserver: intersectionObserverPolyfill,
  resizeObserver: resizeObserverPolyfill,
  userAgent: userAgentPolyfill,
  esModules: esModulesPolyfill,
  readableStream: readableStreamPolyfill,
};

/**
 * Build a custom polyfill script with only selected polyfills
 */
export function buildCustomPolyfillScript(polyfillNames: PolyfillName[]): string {
  const selectedPolyfills = polyfillNames
    .filter(name => polyfillMap[name])
    .map(name => polyfillMap[name]);

  if (selectedPolyfills.length === 0) {
    return '';
  }

  return `
<!-- Revamp Custom Polyfills -->
<script>
(function() {
${selectedPolyfills.join('\n')}
  console.log('[Revamp] Custom polyfills loaded');
})();
</script>
`;
}
