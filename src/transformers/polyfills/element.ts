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
`;
