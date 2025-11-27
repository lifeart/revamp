/**
 * MutationObserver polyfill for Safari 9
 * Safari 9 has MutationObserver but this provides a fallback for edge cases
 */
export const mutationObserverPolyfill = `
  // MutationObserver polyfill (Safari 9 has it, but ensure full support)
  (function() {
    'use strict';

    if (typeof MutationObserver !== 'undefined') {
      // MutationObserver exists, but patch observe to handle edge cases
      var originalObserve = MutationObserver.prototype.observe;
      MutationObserver.prototype.observe = function(target, options) {
        // Ensure options has at least one observation type
        if (!options.childList && !options.attributes && !options.characterData) {
          options.childList = true;
        }
        return originalObserve.call(this, target, options);
      };
      return;
    }

    // Full MutationObserver polyfill using MutationEvents (deprecated but works)
    function MutationObserverPolyfill(callback) {
      this._callback = callback;
      this._queue = [];
      this._targets = [];
      this._options = [];
      this._scheduled = false;
    }

    MutationObserverPolyfill.prototype.observe = function(target, options) {
      if (!target || !target.nodeType) {
        throw new TypeError('Target must be a Node');
      }

      options = options || {};
      if (!options.childList && !options.attributes && !options.characterData) {
        throw new TypeError('Options must specify at least one of childList, attributes, or characterData');
      }

      var self = this;
      var index = this._targets.indexOf(target);

      if (index === -1) {
        this._targets.push(target);
        this._options.push(options);
        index = this._targets.length - 1;
      } else {
        this._options[index] = options;
      }

      // Use DOM Mutation Events as fallback
      var handleMutation = function(e) {
        var record = {
          type: e.type === 'DOMNodeInserted' || e.type === 'DOMNodeRemoved' ? 'childList' :
                e.type === 'DOMAttrModified' ? 'attributes' :
                e.type === 'DOMCharacterDataModified' ? 'characterData' : 'childList',
          target: e.target,
          addedNodes: e.type === 'DOMNodeInserted' ? [e.target] : [],
          removedNodes: e.type === 'DOMNodeRemoved' ? [e.target] : [],
          previousSibling: e.target.previousSibling,
          nextSibling: e.target.nextSibling,
          attributeName: e.attrName || null,
          attributeNamespace: null,
          oldValue: e.prevValue || null
        };

        self._queue.push(record);
        self._scheduleCallback();
      };

      if (options.childList || options.subtree) {
        target.addEventListener('DOMNodeInserted', handleMutation, true);
        target.addEventListener('DOMNodeRemoved', handleMutation, true);
      }
      if (options.attributes) {
        target.addEventListener('DOMAttrModified', handleMutation, true);
      }
      if (options.characterData) {
        target.addEventListener('DOMCharacterDataModified', handleMutation, true);
      }

      // Store handlers for disconnect
      if (!target._mutationHandlers) target._mutationHandlers = [];
      target._mutationHandlers.push(handleMutation);
    };

    MutationObserverPolyfill.prototype._scheduleCallback = function() {
      if (this._scheduled) return;
      this._scheduled = true;

      var self = this;
      setTimeout(function() {
        self._scheduled = false;
        var records = self._queue.splice(0);
        if (records.length > 0) {
          self._callback(records, self);
        }
      }, 0);
    };

    MutationObserverPolyfill.prototype.disconnect = function() {
      for (var i = 0; i < this._targets.length; i++) {
        var target = this._targets[i];
        var handlers = target._mutationHandlers || [];
        for (var j = 0; j < handlers.length; j++) {
          target.removeEventListener('DOMNodeInserted', handlers[j], true);
          target.removeEventListener('DOMNodeRemoved', handlers[j], true);
          target.removeEventListener('DOMAttrModified', handlers[j], true);
          target.removeEventListener('DOMCharacterDataModified', handlers[j], true);
        }
        target._mutationHandlers = [];
      }
      this._targets = [];
      this._options = [];
      this._queue = [];
    };

    MutationObserverPolyfill.prototype.takeRecords = function() {
      return this._queue.splice(0);
    };

    window.MutationObserver = MutationObserverPolyfill;
  })();
`;
