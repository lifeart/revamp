/**
 * Web Components polyfill for Safari 9
 * Provides Custom Elements v1 and basic Shadow DOM support
 */
export const webComponentsPolyfill = `
  // Web Components polyfill for Safari 9
  (function() {
    'use strict';

    // Custom Elements v1 polyfill
    if (!window.customElements) {
      var registry = {};
      var upgradeCandidates = [];

      function upgradeElement(element) {
        var name = element.tagName.toLowerCase();
        var constructor = registry[name];

        if (!constructor) return;

        // Skip if already upgraded
        if (element.__upgraded) return;
        element.__upgraded = true;

        // Set prototype
        Object.setPrototypeOf(element, constructor.prototype);

        // Call constructor logic
        try {
          constructor.call(element);
        } catch (e) {
          console.error('[Revamp] Custom element constructor error:', e);
        }

        // Call connectedCallback if element is in DOM
        if (document.contains(element) && element.connectedCallback) {
          try {
            element.connectedCallback();
          } catch (e) {
            console.error('[Revamp] connectedCallback error:', e);
          }
        }
      }

      function processUpgradeCandidates() {
        for (var i = 0; i < upgradeCandidates.length; i++) {
          upgradeElement(upgradeCandidates[i]);
        }
        upgradeCandidates = [];
      }

      window.customElements = {
        define: function(name, constructor, options) {
          if (registry[name]) {
            throw new DOMException('Element already defined: ' + name, 'NotSupportedError');
          }

          if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) {
            throw new DOMException('Invalid custom element name: ' + name, 'SyntaxError');
          }

          registry[name] = constructor;

          // Upgrade existing elements
          var existing = document.querySelectorAll(name);
          for (var i = 0; i < existing.length; i++) {
            upgradeElement(existing[i]);
          }
        },

        get: function(name) {
          return registry[name];
        },

        whenDefined: function(name) {
          if (registry[name]) {
            return Promise.resolve(registry[name]);
          }

          return new Promise(function(resolve) {
            var check = setInterval(function() {
              if (registry[name]) {
                clearInterval(check);
                resolve(registry[name]);
              }
            }, 10);
          });
        },

        upgrade: function(root) {
          var names = Object.keys(registry);
          for (var i = 0; i < names.length; i++) {
            var elements = root.querySelectorAll(names[i]);
            for (var j = 0; j < elements.length; j++) {
              upgradeElement(elements[j]);
            }
          }
        }
      };

      // Observe DOM for new custom elements
      if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
              mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                  var name = node.tagName.toLowerCase();
                  if (registry[name]) {
                    upgradeElement(node);
                  }
                  // Check descendants
                  if (node.querySelectorAll) {
                    var names = Object.keys(registry);
                    names.forEach(function(n) {
                      var elements = node.querySelectorAll(n);
                      for (var i = 0; i < elements.length; i++) {
                        upgradeElement(elements[i]);
                      }
                    });
                  }
                }
              });

              // Handle disconnectedCallback
              mutation.removedNodes.forEach(function(node) {
                if (node.nodeType === 1 && node.__upgraded && node.disconnectedCallback) {
                  try {
                    node.disconnectedCallback();
                  } catch (e) {
                    console.error('[Revamp] disconnectedCallback error:', e);
                  }
                }
              });
            }
          });
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }

      console.log('[Revamp] Custom Elements v1 polyfill loaded');
    }

    // Basic Shadow DOM polyfill (shim mode - not true encapsulation)
    if (!Element.prototype.attachShadow) {
      Element.prototype.attachShadow = function(options) {
        if (!options || options.mode !== 'open' && options.mode !== 'closed') {
          throw new DOMException('Invalid mode', 'NotSupportedError');
        }

        // Create a shadow root container
        var shadowRoot = document.createElement('div');
        shadowRoot.className = '__shadow-root__';
        shadowRoot.style.cssText = 'display: contents;';

        // Store reference
        if (options.mode === 'open') {
          this.shadowRoot = shadowRoot;
        }

        // Add host reference
        shadowRoot.host = this;

        // Add methods
        shadowRoot.getElementById = function(id) {
          return shadowRoot.querySelector('#' + id);
        };

        // Insert as first child
        if (this.firstChild) {
          this.insertBefore(shadowRoot, this.firstChild);
        } else {
          this.appendChild(shadowRoot);
        }

        return shadowRoot;
      };

      console.log('[Revamp] Basic Shadow DOM shim loaded (no true encapsulation)');
    }

    // HTMLSlotElement polyfill
    if (typeof HTMLSlotElement === 'undefined') {
      window.HTMLSlotElement = function() {};
      HTMLSlotElement.prototype = Object.create(HTMLElement.prototype);

      HTMLSlotElement.prototype.assignedNodes = function(options) {
        return [];
      };

      HTMLSlotElement.prototype.assignedElements = function(options) {
        return [];
      };
    }
  })();
`;
