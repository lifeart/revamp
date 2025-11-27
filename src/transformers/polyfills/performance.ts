/**
 * Performance API polyfill for Safari 9
 */
export const performancePolyfill = `
  // Performance API polyfill (Safari 9 has partial support)
  (function() {
    if (typeof window.performance === 'undefined') {
      window.performance = {};
    }
    var perf = window.performance;
    var startTime = Date.now();
    
    // performance.now() - high resolution timestamp
    if (!perf.now) {
      perf.now = function() {
        return Date.now() - startTime;
      };
    }
    
    // performance.timeOrigin
    if (!perf.timeOrigin) {
      perf.timeOrigin = startTime;
    }
    
    // performance.timing (Navigation Timing API)
    if (!perf.timing) {
      perf.timing = {
        navigationStart: startTime,
        unloadEventStart: 0,
        unloadEventEnd: 0,
        redirectStart: 0,
        redirectEnd: 0,
        fetchStart: startTime,
        domainLookupStart: startTime,
        domainLookupEnd: startTime,
        connectStart: startTime,
        connectEnd: startTime,
        secureConnectionStart: 0,
        requestStart: startTime,
        responseStart: startTime,
        responseEnd: startTime,
        domLoading: startTime,
        domInteractive: startTime,
        domContentLoadedEventStart: startTime,
        domContentLoadedEventEnd: startTime,
        domComplete: startTime,
        loadEventStart: startTime,
        loadEventEnd: startTime
      };
    }
    
    // performance.navigation
    if (!perf.navigation) {
      perf.navigation = {
        type: 0, // TYPE_NAVIGATE
        redirectCount: 0,
        TYPE_NAVIGATE: 0,
        TYPE_RELOAD: 1,
        TYPE_BACK_FORWARD: 2,
        TYPE_RESERVED: 255
      };
    }
    
    // performance.getEntries and related methods
    var entries = [];
    
    if (!perf.getEntries) {
      perf.getEntries = function() {
        return entries.slice();
      };
    }
    
    if (!perf.getEntriesByType) {
      perf.getEntriesByType = function(type) {
        return entries.filter(function(e) { return e.entryType === type; });
      };
    }
    
    if (!perf.getEntriesByName) {
      perf.getEntriesByName = function(name, type) {
        return entries.filter(function(e) {
          return e.name === name && (!type || e.entryType === type);
        });
      };
    }
    
    // performance.mark (User Timing API)
    if (!perf.mark) {
      perf.mark = function(name, options) {
        var entry = {
          name: name,
          entryType: 'mark',
          startTime: perf.now(),
          duration: 0,
          detail: options && options.detail ? options.detail : null
        };
        entries.push(entry);
        return entry;
      };
    }
    
    // performance.measure (User Timing API)
    if (!perf.measure) {
      perf.measure = function(name, startMark, endMark) {
        var startTime = 0;
        var endTime = perf.now();
        
        if (typeof startMark === 'string') {
          var startEntry = entries.find(function(e) { return e.name === startMark && e.entryType === 'mark'; });
          if (startEntry) startTime = startEntry.startTime;
        } else if (typeof startMark === 'number') {
          startTime = startMark;
        } else if (startMark && typeof startMark === 'object') {
          // PerformanceMeasureOptions
          if (startMark.start !== undefined) {
            if (typeof startMark.start === 'string') {
              var se = entries.find(function(e) { return e.name === startMark.start && e.entryType === 'mark'; });
              if (se) startTime = se.startTime;
            } else {
              startTime = startMark.start;
            }
          }
          if (startMark.end !== undefined) {
            if (typeof startMark.end === 'string') {
              var ee = entries.find(function(e) { return e.name === startMark.end && e.entryType === 'mark'; });
              if (ee) endTime = ee.startTime;
            } else {
              endTime = startMark.end;
            }
          }
          if (startMark.duration !== undefined) {
            endTime = startTime + startMark.duration;
          }
        }
        
        if (typeof endMark === 'string') {
          var endEntry = entries.find(function(e) { return e.name === endMark && e.entryType === 'mark'; });
          if (endEntry) endTime = endEntry.startTime;
        }
        
        var entry = {
          name: name,
          entryType: 'measure',
          startTime: startTime,
          duration: endTime - startTime,
          detail: null
        };
        entries.push(entry);
        return entry;
      };
    }
    
    // performance.clearMarks
    if (!perf.clearMarks) {
      perf.clearMarks = function(name) {
        if (name) {
          entries = entries.filter(function(e) { return !(e.entryType === 'mark' && e.name === name); });
        } else {
          entries = entries.filter(function(e) { return e.entryType !== 'mark'; });
        }
      };
    }
    
    // performance.clearMeasures
    if (!perf.clearMeasures) {
      perf.clearMeasures = function(name) {
        if (name) {
          entries = entries.filter(function(e) { return !(e.entryType === 'measure' && e.name === name); });
        } else {
          entries = entries.filter(function(e) { return e.entryType !== 'measure'; });
        }
      };
    }
    
    // performance.clearResourceTimings
    if (!perf.clearResourceTimings) {
      perf.clearResourceTimings = function() {
        entries = entries.filter(function(e) { return e.entryType !== 'resource'; });
      };
    }
    
    // performance.setResourceTimingBufferSize
    if (!perf.setResourceTimingBufferSize) {
      perf.setResourceTimingBufferSize = function(maxSize) {
        // No-op in polyfill
      };
    }
    
    // performance.toJSON
    if (!perf.toJSON) {
      perf.toJSON = function() {
        return {
          timing: perf.timing,
          navigation: perf.navigation,
          timeOrigin: perf.timeOrigin
        };
      };
    }
    
    // PerformanceObserver polyfill (basic)
    if (typeof PerformanceObserver === 'undefined') {
      var observers = [];
      
      window.PerformanceObserver = function(callback) {
        this._callback = callback;
        this._entryTypes = [];
      };
      
      PerformanceObserver.prototype.observe = function(options) {
        if (options.entryTypes) {
          this._entryTypes = options.entryTypes;
        } else if (options.type) {
          this._entryTypes = [options.type];
        }
        observers.push(this);
      };
      
      PerformanceObserver.prototype.disconnect = function() {
        var idx = observers.indexOf(this);
        if (idx !== -1) observers.splice(idx, 1);
      };
      
      PerformanceObserver.prototype.takeRecords = function() {
        return [];
      };
      
      PerformanceObserver.supportedEntryTypes = ['mark', 'measure', 'navigation', 'resource'];
      
      // Patch mark/measure to notify observers
      var origMark = perf.mark;
      var origMeasure = perf.measure;
      
      perf.mark = function(name, options) {
        var entry = origMark.call(perf, name, options);
        observers.forEach(function(obs) {
          if (obs._entryTypes.indexOf('mark') !== -1) {
            obs._callback({ getEntries: function() { return [entry]; } });
          }
        });
        return entry;
      };
      
      perf.measure = function(name, startMark, endMark) {
        var entry = origMeasure.call(perf, name, startMark, endMark);
        observers.forEach(function(obs) {
          if (obs._entryTypes.indexOf('measure') !== -1) {
            obs._callback({ getEntries: function() { return [entry]; } });
          }
        });
        return entry;
      };
    }
  })();
`;
