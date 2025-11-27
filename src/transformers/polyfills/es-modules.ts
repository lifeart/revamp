/**
 * ES Modules support polyfill
 * Tricks legacy browsers into appearing to support ES modules
 * This bypasses nomodule checks so modern code paths are used
 */

export const esModulesPolyfill = `
(function() {
  'use strict';
  
  // Check if we need to polyfill module support detection
  // Modern browsers have native module support, legacy browsers don't
  
  // Create a fake module script support indicator
  // This makes feature detection think modules are supported
  try {
    // Override the nomodule attribute behavior
    // Scripts with nomodule should not run on "modern" browsers
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var script = scripts[i];
      if (script.hasAttribute('nomodule')) {
        // Prevent nomodule scripts from executing by removing them
        // since we want the module version to run instead
        script.parentNode && script.parentNode.removeChild(script);
      }
    }
  } catch (e) {}
  
  // Observe for dynamically added nomodule scripts
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeName === 'SCRIPT' && node.hasAttribute && node.hasAttribute('nomodule')) {
            // Remove nomodule scripts as they're added
            node.parentNode && node.parentNode.removeChild(node);
          }
        });
      });
    });
    
    // Start observing
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }
  
  // Make HTMLScriptElement.supports() return true for 'module' if it exists
  if (typeof HTMLScriptElement !== 'undefined' && HTMLScriptElement.supports) {
    var originalSupports = HTMLScriptElement.supports;
    HTMLScriptElement.supports = function(type) {
      if (type === 'module' || type === 'importmap') {
        return true;
      }
      return originalSupports.call(this, type);
    };
  }
  
  // Polyfill HTMLScriptElement.supports if it doesn't exist
  if (typeof HTMLScriptElement !== 'undefined' && !HTMLScriptElement.supports) {
    HTMLScriptElement.supports = function(type) {
      return type === 'module' || type === 'importmap' || type === 'classic';
    };
  }
  
  console.log('[Revamp] ES Modules compatibility layer loaded');
})();
`;
