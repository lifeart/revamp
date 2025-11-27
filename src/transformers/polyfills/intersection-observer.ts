/**
 * IntersectionObserver polyfill for legacy browsers
 * Provides a simplified implementation for iOS 9/Safari 9
 */

export const intersectionObserverPolyfill = `
(function() {
  'use strict';
  
  if (typeof window.IntersectionObserver !== 'undefined') {
    return;
  }
  
  /**
   * IntersectionObserverEntry polyfill
   */
  function IntersectionObserverEntry(entry) {
    this.time = entry.time;
    this.target = entry.target;
    this.rootBounds = entry.rootBounds;
    this.boundingClientRect = entry.boundingClientRect;
    this.intersectionRect = entry.intersectionRect || {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0
    };
    this.isIntersecting = entry.isIntersecting;
    this.intersectionRatio = entry.intersectionRatio;
  }
  
  /**
   * IntersectionObserver polyfill
   */
  function IntersectionObserver(callback, options) {
    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }
    
    this._callback = callback;
    this._options = options || {};
    this._root = this._options.root || null;
    this._rootMargin = this._parseRootMargin(this._options.rootMargin || '0px');
    this._thresholds = this._parseThresholds(this._options.threshold || 0);
    this._targets = [];
    this._previousEntries = [];
    this._checkInterval = null;
    this._checkBound = this._check.bind(this);
  }
  
  IntersectionObserver.prototype._parseRootMargin = function(margin) {
    var parts = String(margin).split(/\\s+/).map(function(part) {
      var match = /^(-?\\d*\\.?\\d+)(px|%)$/.exec(part);
      if (!match) return { value: 0, unit: 'px' };
      return { value: parseFloat(match[1]), unit: match[2] };
    });
    
    // Expand to 4 values (top, right, bottom, left)
    while (parts.length < 4) {
      parts.push(parts[parts.length - 1] || { value: 0, unit: 'px' });
    }
    
    return {
      top: parts[0],
      right: parts[1],
      bottom: parts[2],
      left: parts[3]
    };
  };
  
  IntersectionObserver.prototype._parseThresholds = function(threshold) {
    if (!Array.isArray(threshold)) {
      threshold = [threshold];
    }
    return threshold.map(function(t) {
      return Math.min(Math.max(Number(t) || 0, 0), 1);
    }).sort();
  };
  
  IntersectionObserver.prototype._getRootBounds = function() {
    var root = this._root;
    var bounds;
    
    if (root) {
      bounds = root.getBoundingClientRect();
    } else {
      // Use viewport
      var html = document.documentElement;
      bounds = {
        top: 0,
        left: 0,
        right: html.clientWidth || window.innerWidth || 0,
        bottom: html.clientHeight || window.innerHeight || 0,
        width: html.clientWidth || window.innerWidth || 0,
        height: html.clientHeight || window.innerHeight || 0
      };
    }
    
    // Apply root margin
    var margin = this._rootMargin;
    var width = bounds.width || (bounds.right - bounds.left);
    var height = bounds.height || (bounds.bottom - bounds.top);
    
    function resolveMargin(m, size) {
      return m.unit === '%' ? (m.value * size / 100) : m.value;
    }
    
    return {
      top: bounds.top - resolveMargin(margin.top, height),
      left: bounds.left - resolveMargin(margin.left, width),
      right: bounds.right + resolveMargin(margin.right, width),
      bottom: bounds.bottom + resolveMargin(margin.bottom, height),
      width: width + resolveMargin(margin.left, width) + resolveMargin(margin.right, width),
      height: height + resolveMargin(margin.top, height) + resolveMargin(margin.bottom, height)
    };
  };
  
  IntersectionObserver.prototype._computeIntersection = function(targetRect, rootBounds) {
    var top = Math.max(targetRect.top, rootBounds.top);
    var left = Math.max(targetRect.left, rootBounds.left);
    var bottom = Math.min(targetRect.bottom, rootBounds.bottom);
    var right = Math.min(targetRect.right, rootBounds.right);
    
    var width = Math.max(0, right - left);
    var height = Math.max(0, bottom - top);
    
    return {
      top: top,
      left: left,
      bottom: bottom,
      right: right,
      width: width,
      height: height
    };
  };
  
  IntersectionObserver.prototype._computeIsIntersecting = function(intersectionRect, targetRect) {
    return intersectionRect.width > 0 && intersectionRect.height > 0;
  };
  
  IntersectionObserver.prototype._computeRatio = function(intersectionRect, targetRect) {
    var targetArea = targetRect.width * targetRect.height;
    if (targetArea === 0) return 0;
    var intersectionArea = intersectionRect.width * intersectionRect.height;
    return Math.min(intersectionArea / targetArea, 1);
  };
  
  IntersectionObserver.prototype._createEntry = function(target) {
    var targetRect = target.getBoundingClientRect();
    var rootBounds = this._getRootBounds();
    var intersectionRect = this._computeIntersection(targetRect, rootBounds);
    var isIntersecting = this._computeIsIntersecting(intersectionRect, targetRect);
    var ratio = this._computeRatio(intersectionRect, targetRect);
    
    return new IntersectionObserverEntry({
      time: Date.now(),
      target: target,
      rootBounds: rootBounds,
      boundingClientRect: targetRect,
      intersectionRect: isIntersecting ? intersectionRect : {
        top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0
      },
      isIntersecting: isIntersecting,
      intersectionRatio: ratio
    });
  };
  
  IntersectionObserver.prototype._hasThresholdCrossed = function(oldRatio, newRatio) {
    var thresholds = this._thresholds;
    for (var i = 0; i < thresholds.length; i++) {
      var threshold = thresholds[i];
      if ((oldRatio < threshold && newRatio >= threshold) ||
          (oldRatio >= threshold && newRatio < threshold)) {
        return true;
      }
    }
    return false;
  };
  
  IntersectionObserver.prototype._check = function() {
    var entries = [];
    var self = this;
    
    this._targets.forEach(function(target, index) {
      var entry = self._createEntry(target);
      var previousEntry = self._previousEntries[index];
      var previousRatio = previousEntry ? previousEntry.intersectionRatio : -1;
      
      // Check if threshold crossed or initial observation
      if (previousRatio === -1 || self._hasThresholdCrossed(previousRatio, entry.intersectionRatio)) {
        entries.push(entry);
      }
      
      self._previousEntries[index] = entry;
    });
    
    if (entries.length > 0) {
      this._callback(entries, this);
    }
  };
  
  IntersectionObserver.prototype._startObserving = function() {
    if (this._checkInterval) return;
    
    // Use requestAnimationFrame for better performance, fallback to setInterval
    var self = this;
    var lastCheck = 0;
    var checkThrottle = 100; // Check at most every 100ms
    
    function rafCheck() {
      var now = Date.now();
      if (now - lastCheck >= checkThrottle) {
        self._check();
        lastCheck = now;
      }
      if (self._targets.length > 0) {
        self._checkInterval = requestAnimationFrame(rafCheck);
      }
    }
    
    // Also listen for scroll and resize
    window.addEventListener('scroll', this._checkBound, true);
    window.addEventListener('resize', this._checkBound, true);
    
    this._checkInterval = requestAnimationFrame(rafCheck);
  };
  
  IntersectionObserver.prototype._stopObserving = function() {
    if (this._checkInterval) {
      cancelAnimationFrame(this._checkInterval);
      this._checkInterval = null;
    }
    window.removeEventListener('scroll', this._checkBound, true);
    window.removeEventListener('resize', this._checkBound, true);
  };
  
  IntersectionObserver.prototype.observe = function(target) {
    if (!(target instanceof Element)) {
      throw new TypeError('target must be an Element');
    }
    
    // Don't observe the same target twice
    if (this._targets.indexOf(target) !== -1) {
      return;
    }
    
    this._targets.push(target);
    this._previousEntries.push(null);
    
    // Start observing if this is the first target
    if (this._targets.length === 1) {
      this._startObserving();
    }
    
    // Trigger initial callback
    var self = this;
    setTimeout(function() {
      var entry = self._createEntry(target);
      var index = self._targets.indexOf(target);
      if (index !== -1) {
        self._previousEntries[index] = entry;
        self._callback([entry], self);
      }
    }, 0);
  };
  
  IntersectionObserver.prototype.unobserve = function(target) {
    var index = this._targets.indexOf(target);
    if (index !== -1) {
      this._targets.splice(index, 1);
      this._previousEntries.splice(index, 1);
    }
    
    // Stop observing if no more targets
    if (this._targets.length === 0) {
      this._stopObserving();
    }
  };
  
  IntersectionObserver.prototype.disconnect = function() {
    this._targets = [];
    this._previousEntries = [];
    this._stopObserving();
  };
  
  IntersectionObserver.prototype.takeRecords = function() {
    var entries = [];
    var self = this;
    
    this._targets.forEach(function(target) {
      entries.push(self._createEntry(target));
    });
    
    return entries;
  };
  
  // Expose to global
  window.IntersectionObserver = IntersectionObserver;
  window.IntersectionObserverEntry = IntersectionObserverEntry;
})();
`;
