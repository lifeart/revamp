/**
 * Transformers index
 * Re-exports all transformers for easy importing
 */

export { transformJs, needsJsTransform, shutdownWorkerPool, prewarmWorkerPool } from './js.js';
export { transformCss, needsCssTransform, resetCssProcessor } from './css.js';
export { transformHtml, isHtmlDocument } from './html.js';
export {
  bundleEsModule,
  bundleInlineModule,
  clearModuleCache,
  getModuleCacheSize,
  pruneModuleCacheIfNeeded,
  isModuleScript,
  getModuleShimScript,
  parseImportMap,
  fetchUrlsConcurrently,
  isCssUrl,
  generateCssInjectionCode,
  detectTopLevelAwait,
  wrapTopLevelAwait,
} from './esm-bundler.js';
export type { BundleResult, ImportMap } from './esm-bundler.js';

// Service Worker bundler
export {
  bundleServiceWorker,
  transformInlineServiceWorker,
  clearSwModuleCache,
  getSwModuleCacheSize,
} from './sw-bundler.js';
export type { SwBundleResult } from './sw-bundler.js';

// Content transformer registry
export {
  registerTransformer,
  unregisterTransformer,
  unregisterTransformersForPlugin,
  getRegisteredTransformerNames,
  dispatchTextTransform,
  dispatchBinaryTransform,
} from './registry.js';
export type {
  ContentTransformer,
  TextContentTransformer,
  BinaryContentTransformer,
  BinaryTransformResult,
  TransformDispatchContext,
} from './registry.js';
