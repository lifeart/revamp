/**
 * ES Module Bundler — CSS module handling
 *
 * Detection of CSS imports and codegen that injects fetched CSS into the page
 * at runtime via a <style> element.
 *
 * @module transformers/esm/css-module
 */

import { URL } from 'node:url';

/**
 * Check if a URL points to a CSS file
 */
export function isCssUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.css');
  } catch {
    return url.toLowerCase().endsWith('.css');
  }
}

/**
 * Generate code to inject CSS into the page at runtime
 */
export function generateCssInjectionCode(css: string, url: string): string {
  // Escape the CSS content for embedding in JavaScript
  const escapedCss = css
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `
(function() {
  var css = \`${escapedCss}\`;
  var style = document.createElement('style');
  style.setAttribute('data-revamp-css-module', '${url}');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  console.log('[Revamp] Injected CSS module: ${url}');
})();
`;
}
