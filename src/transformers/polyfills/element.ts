/**
 * DOM Element polyfills for Safari 9
 */
export const elementPolyfill = `
  // Element.prototype.matches polyfill (fallback)
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector ||
                                Element.prototype.webkitMatchesSelector;
  }

  // Element.prototype.closest polyfill
  if (!Element.prototype.closest) {
    Element.prototype.closest = function(s) {
      var el = this;
      do {
        if (Element.prototype.matches.call(el, s)) return el;
        el = el.parentElement || el.parentNode;
      } while (el !== null && el.nodeType === 1);
      return null;
    };
  }

  // Element.prototype.remove polyfill (for very old browsers)
  if (!Element.prototype.remove) {
    Element.prototype.remove = function() {
      if (this.parentNode) this.parentNode.removeChild(this);
    };
  }

  // ParentNode.append/prepend polyfills (covers Element, Document, DocumentFragment)
  // This ensures document.head.append, document.body.append etc. work
  (function() {
    var targets = [Element.prototype, Document.prototype, DocumentFragment.prototype];

    // append polyfill
    targets.forEach(function(target) {
      if (!target.append) {
        target.append = function() {
          var nodes = arguments;
          for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (typeof node === 'string') {
              this.appendChild(document.createTextNode(node));
            } else {
              this.appendChild(node);
            }
          }
        };
      }
    });

    // prepend polyfill
    targets.forEach(function(target) {
      if (!target.prepend) {
        target.prepend = function() {
          var nodes = arguments;
          var firstChild = this.firstChild;
          for (var i = nodes.length - 1; i >= 0; i--) {
            var node = nodes[i];
            if (typeof node === 'string') {
              node = document.createTextNode(node);
            }
            if (firstChild) {
              this.insertBefore(node, firstChild);
            } else {
              this.appendChild(node);
            }
            firstChild = node;
          }
        };
      }
    });
  })();

  // NodeList.prototype.forEach polyfill
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }

  // HTMLCollection iteration support (for older Safari)
  if (typeof HTMLCollection !== 'undefined' && HTMLCollection.prototype && !HTMLCollection.prototype.forEach) {
    HTMLCollection.prototype.forEach = Array.prototype.forEach;
  }

  // Element.prototype.scrollTo polyfill (Safari 9 doesn't have it)
  if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function(optionsOrX, y) {
      if (typeof optionsOrX === 'object') {
        // Options object: { top, left, behavior }
        var left = optionsOrX.left !== undefined ? optionsOrX.left : this.scrollLeft;
        var top = optionsOrX.top !== undefined ? optionsOrX.top : this.scrollTop;
        this.scrollLeft = left;
        this.scrollTop = top;
      } else if (typeof optionsOrX === 'number') {
        // Legacy: scrollTo(x, y)
        this.scrollLeft = optionsOrX;
        this.scrollTop = y !== undefined ? y : this.scrollTop;
      }
    };
  }

  // Element.prototype.scrollBy polyfill
  if (typeof Element !== 'undefined' && !Element.prototype.scrollBy) {
    Element.prototype.scrollBy = function(optionsOrX, y) {
      if (typeof optionsOrX === 'object') {
        var left = optionsOrX.left !== undefined ? optionsOrX.left : 0;
        var top = optionsOrX.top !== undefined ? optionsOrX.top : 0;
        this.scrollLeft += left;
        this.scrollTop += top;
      } else if (typeof optionsOrX === 'number') {
        this.scrollLeft += optionsOrX;
        this.scrollTop += (y !== undefined ? y : 0);
      }
    };
  }

  // Element.prototype.scrollIntoView enhancement for older browsers
  // (basic scrollIntoView exists, but options object is not supported)
  (function() {
    if (typeof Element === 'undefined') return;
    var original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(optionsOrAlignToTop) {
      if (typeof optionsOrAlignToTop === 'object' && optionsOrAlignToTop !== null) {
        // Options object not fully supported in old browsers, fallback to basic behavior
        var alignToTop = optionsOrAlignToTop.block === 'start' || optionsOrAlignToTop.block === undefined;
        original.call(this, alignToTop);
      } else {
        original.call(this, optionsOrAlignToTop);
      }
    };
  })();

  // window.scrollTo polyfill (should exist but ensure options object support)
  (function() {
    if (typeof window === 'undefined') return;
    var originalWindowScrollTo = window.scrollTo;
    window.scrollTo = function(optionsOrX, y) {
      if (typeof optionsOrX === 'object' && optionsOrX !== null) {
        var left = optionsOrX.left !== undefined ? optionsOrX.left : window.pageXOffset;
        var top = optionsOrX.top !== undefined ? optionsOrX.top : window.pageYOffset;
        originalWindowScrollTo.call(window, left, top);
      } else {
        originalWindowScrollTo.call(window, optionsOrX, y);
      }
    };
    // Also alias scroll to scrollTo
    if (!window.scroll || window.scroll === originalWindowScrollTo) {
      window.scroll = window.scrollTo;
    }
  })();

  // window.scrollBy polyfill with options object support
  (function() {
    if (typeof window === 'undefined') return;
    var originalWindowScrollBy = window.scrollBy;
    window.scrollBy = function(optionsOrX, y) {
      if (typeof optionsOrX === 'object' && optionsOrX !== null) {
        var left = optionsOrX.left !== undefined ? optionsOrX.left : 0;
        var top = optionsOrX.top !== undefined ? optionsOrX.top : 0;
        originalWindowScrollBy.call(window, left, top);
      } else {
        originalWindowScrollBy.call(window, optionsOrX, y);
      }
    };
  })();
`;
