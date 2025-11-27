/**
 * ResizeObserver polyfill for legacy browsers
 * Provides a simplified implementation for iOS 9/Safari 9
 */

export const resizeObserverPolyfill = `
(function() {
  'use strict';
  
  if (typeof window.ResizeObserver !== 'undefined') {
    return;
  }
  
  // Store all observers for the global check loop
  var allObservers = [];
  var checkScheduled = false;
  var resizeTimeout = null;
  
  /**
   * ResizeObserverEntry - represents a single observed element's size change
   */
  function ResizeObserverEntry(target) {
    var rect = target.getBoundingClientRect();
    var cs = window.getComputedStyle ? window.getComputedStyle(target) : target.currentStyle || {};
    
    // Calculate content box size (excluding padding and border)
    var paddingTop = parseFloat(cs.paddingTop) || 0;
    var paddingRight = parseFloat(cs.paddingRight) || 0;
    var paddingBottom = parseFloat(cs.paddingBottom) || 0;
    var paddingLeft = parseFloat(cs.paddingLeft) || 0;
    var borderTop = parseFloat(cs.borderTopWidth) || 0;
    var borderRight = parseFloat(cs.borderRightWidth) || 0;
    var borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    var borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    
    var contentWidth = rect.width - paddingLeft - paddingRight - borderLeft - borderRight;
    var contentHeight = rect.height - paddingTop - paddingBottom - borderTop - borderBottom;
    
    // Ensure non-negative values
    contentWidth = Math.max(0, contentWidth);
    contentHeight = Math.max(0, contentHeight);
    
    this.target = target;
    
    // Content rect (deprecated but still used)
    this.contentRect = {
      x: paddingLeft,
      y: paddingTop,
      width: contentWidth,
      height: contentHeight,
      top: paddingTop,
      right: paddingLeft + contentWidth,
      bottom: paddingTop + contentHeight,
      left: paddingLeft
    };
    
    // Border box size
    this.borderBoxSize = [{
      inlineSize: rect.width,
      blockSize: rect.height
    }];
    
    // Content box size
    this.contentBoxSize = [{
      inlineSize: contentWidth,
      blockSize: contentHeight
    }];
    
    // Device pixel content box size (approximate - no direct access to device pixels in older browsers)
    var dpr = window.devicePixelRatio || 1;
    this.devicePixelContentBoxSize = [{
      inlineSize: Math.round(contentWidth * dpr),
      blockSize: Math.round(contentHeight * dpr)
    }];
  }
  
  /**
   * ResizeObserver - observes changes to element dimensions
   */
  function ResizeObserver(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to construct 'ResizeObserver': The callback provided as parameter 1 is not a function.");
    }
    
    this._callback = callback;
    this._targets = [];
    this._previousSizes = new WeakMapPolyfill();
    
    allObservers.push(this);
  }
  
  // Simple WeakMap polyfill for internal use (since WeakMap might not be available)
  function WeakMapPolyfill() {
    this._id = '_ro_' + Math.random().toString(36).substr(2, 9);
  }
  
  WeakMapPolyfill.prototype.get = function(key) {
    if (key && typeof key === 'object') {
      return key[this._id];
    }
    return undefined;
  };
  
  WeakMapPolyfill.prototype.set = function(key, value) {
    if (key && typeof key === 'object') {
      try {
        Object.defineProperty(key, this._id, {
          value: value,
          writable: true,
          configurable: true
        });
      } catch (e) {
        key[this._id] = value;
      }
    }
    return this;
  };
  
  WeakMapPolyfill.prototype.has = function(key) {
    if (key && typeof key === 'object') {
      return this._id in key;
    }
    return false;
  };
  
  WeakMapPolyfill.prototype['delete'] = function(key) {
    if (key && typeof key === 'object' && this._id in key) {
      delete key[this._id];
      return true;
    }
    return false;
  };
  
  /**
   * Start observing an element
   */
  ResizeObserver.prototype.observe = function(target, options) {
    if (!target || target.nodeType !== 1) {
      throw new TypeError("Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'.");
    }
    
    // Check if already observing this target
    for (var i = 0; i < this._targets.length; i++) {
      if (this._targets[i] === target) {
        return;
      }
    }
    
    this._targets.push(target);
    
    // Store initial size
    var rect = target.getBoundingClientRect();
    this._previousSizes.set(target, {
      width: rect.width,
      height: rect.height
    });
    
    // Schedule initial callback
    scheduleCheck();
  };
  
  /**
   * Stop observing an element
   */
  ResizeObserver.prototype.unobserve = function(target) {
    if (!target || target.nodeType !== 1) {
      throw new TypeError("Failed to execute 'unobserve' on 'ResizeObserver': parameter 1 is not of type 'Element'.");
    }
    
    var idx = -1;
    for (var i = 0; i < this._targets.length; i++) {
      if (this._targets[i] === target) {
        idx = i;
        break;
      }
    }
    
    if (idx !== -1) {
      this._targets.splice(idx, 1);
      this._previousSizes['delete'](target);
    }
  };
  
  /**
   * Stop observing all elements
   */
  ResizeObserver.prototype.disconnect = function() {
    for (var i = 0; i < this._targets.length; i++) {
      this._previousSizes['delete'](this._targets[i]);
    }
    this._targets = [];
  };
  
  /**
   * Check for size changes on all targets
   */
  ResizeObserver.prototype._check = function() {
    var entries = [];
    
    for (var i = 0; i < this._targets.length; i++) {
      var target = this._targets[i];
      
      // Skip if element is not in DOM
      if (!document.body.contains(target)) {
        continue;
      }
      
      var rect = target.getBoundingClientRect();
      var prevSize = this._previousSizes.get(target);
      
      if (!prevSize || 
          Math.abs(rect.width - prevSize.width) > 0.5 || 
          Math.abs(rect.height - prevSize.height) > 0.5) {
        
        entries.push(new ResizeObserverEntry(target));
        
        this._previousSizes.set(target, {
          width: rect.width,
          height: rect.height
        });
      }
    }
    
    if (entries.length > 0) {
      try {
        this._callback(entries, this);
      } catch (e) {
        // Report error but don't break the observer
        setTimeout(function() { throw e; }, 0);
      }
    }
  };
  
  /**
   * Schedule a check for all observers
   */
  function scheduleCheck() {
    if (checkScheduled) return;
    checkScheduled = true;
    
    // Use requestAnimationFrame if available, otherwise setTimeout
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function() {
        checkScheduled = false;
        checkAllObservers();
      });
    } else {
      setTimeout(function() {
        checkScheduled = false;
        checkAllObservers();
      }, 16);
    }
  }
  
  /**
   * Check all active observers
   */
  function checkAllObservers() {
    for (var i = 0; i < allObservers.length; i++) {
      allObservers[i]._check();
    }
  }
  
  /**
   * Set up global resize/mutation detection
   */
  function setupGlobalListeners() {
    // Listen for window resize
    var handleResize = function() {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(function() {
        scheduleCheck();
      }, 20);
    };
    
    if (window.addEventListener) {
      window.addEventListener('resize', handleResize, true);
      window.addEventListener('orientationchange', handleResize, true);
    } else if (window.attachEvent) {
      window.attachEvent('onresize', handleResize);
    }
    
    // Periodic polling for other size changes (CSS animations, content changes, etc.)
    // This is a fallback since MutationObserver may not be available in older browsers
    setInterval(function() {
      scheduleCheck();
    }, 500);
    
    // Also check on DOM mutations if MutationObserver is available
    if (typeof MutationObserver !== 'undefined') {
      var mutationObserver = new MutationObserver(function() {
        scheduleCheck();
      });
      
      // Start observing once DOM is ready
      if (document.body) {
        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      } else {
        document.addEventListener('DOMContentLoaded', function() {
          mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
          });
        });
      }
    }
    
    // Also check after images and other resources load
    if (window.addEventListener) {
      window.addEventListener('load', function() {
        scheduleCheck();
      });
    }
  }
  
  // Initialize global listeners
  setupGlobalListeners();
  
  // Expose to window
  window.ResizeObserver = ResizeObserver;
  window.ResizeObserverEntry = ResizeObserverEntry;
  
  console.log('[Revamp] ResizeObserver polyfill applied');
})();
`;
