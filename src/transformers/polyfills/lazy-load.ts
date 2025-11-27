/**
 * Lazy loading polyfill for Safari 9
 * Implements loading="lazy" for images and iframes
 */
export const lazyLoadPolyfill = `
  // Lazy loading polyfill for loading="lazy" attribute
  (function() {
    'use strict';

    // Check if native lazy loading is supported
    if ('loading' in HTMLImageElement.prototype) {
      return;
    }

    var lazyElements = [];
    var observer = null;
    var rootMargin = '200px'; // Start loading 200px before element enters viewport

    function loadElement(element) {
      if (element.dataset.revampSrc) {
        element.src = element.dataset.revampSrc;
        delete element.dataset.revampSrc;
      }
      if (element.dataset.revampSrcset) {
        element.srcset = element.dataset.revampSrcset;
        delete element.dataset.revampSrcset;
      }
      element.removeAttribute('loading');
    }

    function handleIntersection(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var element = entry.target;
          loadElement(element);
          observer.unobserve(element);

          var index = lazyElements.indexOf(element);
          if (index > -1) {
            lazyElements.splice(index, 1);
          }
        }
      });
    }

    function setupLazyElement(element) {
      // Skip if already processed
      if (element.dataset.revampLazy) return;
      element.dataset.revampLazy = 'true';

      // Store original src
      if (element.src) {
        element.dataset.revampSrc = element.src;
        // Use tiny transparent placeholder
        element.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
      if (element.srcset) {
        element.dataset.revampSrcset = element.srcset;
        element.removeAttribute('srcset');
      }

      lazyElements.push(element);

      if (observer) {
        observer.observe(element);
      }
    }

    function processLazyElements() {
      // Find images and iframes with loading="lazy"
      var images = document.querySelectorAll('img[loading="lazy"]');
      var iframes = document.querySelectorAll('iframe[loading="lazy"]');

      for (var i = 0; i < images.length; i++) {
        setupLazyElement(images[i]);
      }
      for (var i = 0; i < iframes.length; i++) {
        setupLazyElement(iframes[i]);
      }
    }

    // Use IntersectionObserver if available, otherwise load immediately
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(handleIntersection, {
        rootMargin: rootMargin,
        threshold: 0
      });

      // Process existing elements
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processLazyElements);
      } else {
        processLazyElements();
      }

      // Watch for new lazy elements
      if (typeof MutationObserver !== 'undefined') {
        var mutationObserver = new MutationObserver(function(mutations) {
          var shouldProcess = false;
          mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
              shouldProcess = true;
            }
          });
          if (shouldProcess) {
            processLazyElements();
          }
        });

        mutationObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
    } else {
      // Fallback: just load everything immediately
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          var images = document.querySelectorAll('img[loading="lazy"]');
          var iframes = document.querySelectorAll('iframe[loading="lazy"]');
          for (var i = 0; i < images.length; i++) {
            images[i].removeAttribute('loading');
          }
          for (var i = 0; i < iframes.length; i++) {
            iframes[i].removeAttribute('loading');
          }
        });
      }
    }

    console.log('[Revamp] Lazy loading polyfill loaded');
  })();
`;
