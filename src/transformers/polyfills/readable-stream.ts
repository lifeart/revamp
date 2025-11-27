/**
 * ReadableStream polyfill for legacy browsers
 * Provides a basic implementation for iOS 9/Safari 9
 */

export const readableStreamPolyfill = `
(function() {
  'use strict';
  
  if (typeof ReadableStream !== 'undefined') {
    return;
  }
  
  /**
   * ReadableStreamDefaultReader polyfill
   */
  function ReadableStreamDefaultReader(stream) {
    if (!(stream instanceof ReadableStream)) {
      throw new TypeError('ReadableStreamDefaultReader can only be constructed with a ReadableStream');
    }
    if (stream._reader) {
      throw new TypeError('ReadableStream is already locked');
    }
    this._stream = stream;
    stream._reader = this;
    this._closed = false;
    this._closedPromise = new Promise(function(resolve, reject) {
      this._resolveClosedPromise = resolve;
      this._rejectClosedPromise = reject;
    }.bind(this));
  }
  
  ReadableStreamDefaultReader.prototype = {
    get closed() {
      return this._closedPromise;
    },
    
    read: function() {
      var self = this;
      if (this._closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise(function(resolve, reject) {
        self._stream._pull(resolve, reject);
      });
    },
    
    releaseLock: function() {
      if (this._stream) {
        this._stream._reader = null;
        this._stream = null;
      }
    },
    
    cancel: function(reason) {
      if (this._stream) {
        return this._stream.cancel(reason);
      }
      return Promise.resolve();
    }
  };
  
  /**
   * ReadableStreamDefaultController polyfill
   */
  function ReadableStreamDefaultController(stream) {
    this._stream = stream;
    this._closeRequested = false;
  }
  
  ReadableStreamDefaultController.prototype = {
    get desiredSize() {
      return this._stream._queue.length > 0 ? 0 : 1;
    },
    
    enqueue: function(chunk) {
      if (this._closeRequested) {
        throw new TypeError('Cannot enqueue after close');
      }
      this._stream._queue.push(chunk);
      this._stream._processQueue();
    },
    
    close: function() {
      if (this._closeRequested) {
        throw new TypeError('Cannot close twice');
      }
      this._closeRequested = true;
      this._stream._closeRequested = true;
      this._stream._processQueue();
    },
    
    error: function(e) {
      this._stream._error(e);
    }
  };
  
  /**
   * ReadableStream polyfill
   */
  function ReadableStream(underlyingSource, strategy) {
    this._queue = [];
    this._reader = null;
    this._closeRequested = false;
    this._errored = false;
    this._errorValue = undefined;
    this._pendingReads = [];
    this._started = false;
    this._pulling = false;
    this._pullAgain = false;
    
    this._controller = new ReadableStreamDefaultController(this);
    this._underlyingSource = underlyingSource || {};
    this._strategy = strategy || { highWaterMark: 1 };
    
    var self = this;
    
    // Call start if provided
    if (this._underlyingSource.start) {
      try {
        var startResult = this._underlyingSource.start(this._controller);
        if (startResult && typeof startResult.then === 'function') {
          startResult.then(function() {
            self._started = true;
            self._callPull();
          }, function(e) {
            self._error(e);
          });
        } else {
          this._started = true;
        }
      } catch (e) {
        this._error(e);
      }
    } else {
      this._started = true;
    }
  }
  
  ReadableStream.prototype = {
    get locked() {
      return this._reader !== null;
    },
    
    _processQueue: function() {
      while (this._pendingReads.length > 0 && this._queue.length > 0) {
        var read = this._pendingReads.shift();
        var chunk = this._queue.shift();
        read.resolve({ value: chunk, done: false });
      }
      
      // If close was requested and queue is empty, resolve pending reads with done
      if (this._closeRequested && this._queue.length === 0) {
        while (this._pendingReads.length > 0) {
          var read = this._pendingReads.shift();
          read.resolve({ value: undefined, done: true });
        }
        if (this._reader) {
          this._reader._closed = true;
          this._reader._resolveClosedPromise();
        }
      }
      
      // Call pull if needed
      this._callPull();
    },
    
    _callPull: function() {
      if (!this._started || this._pulling || this._closeRequested || this._errored) {
        return;
      }
      
      if (this._underlyingSource.pull && this._queue.length < (this._strategy.highWaterMark || 1)) {
        this._pulling = true;
        var self = this;
        try {
          var pullResult = this._underlyingSource.pull(this._controller);
          if (pullResult && typeof pullResult.then === 'function') {
            pullResult.then(function() {
              self._pulling = false;
              if (self._pullAgain) {
                self._pullAgain = false;
                self._callPull();
              }
            }, function(e) {
              self._error(e);
            });
          } else {
            this._pulling = false;
          }
        } catch (e) {
          this._error(e);
        }
      }
    },
    
    _pull: function(resolve, reject) {
      if (this._errored) {
        reject(this._errorValue);
        return;
      }
      
      if (this._queue.length > 0) {
        resolve({ value: this._queue.shift(), done: false });
        this._callPull();
        return;
      }
      
      if (this._closeRequested) {
        resolve({ value: undefined, done: true });
        return;
      }
      
      this._pendingReads.push({ resolve: resolve, reject: reject });
      this._callPull();
    },
    
    _error: function(e) {
      this._errored = true;
      this._errorValue = e;
      
      // Reject all pending reads
      while (this._pendingReads.length > 0) {
        var read = this._pendingReads.shift();
        read.reject(e);
      }
      
      // Reject reader's closed promise
      if (this._reader) {
        this._reader._rejectClosedPromise(e);
      }
    },
    
    cancel: function(reason) {
      if (this._underlyingSource.cancel) {
        try {
          return Promise.resolve(this._underlyingSource.cancel(reason));
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.resolve();
    },
    
    getReader: function(options) {
      if (options && options.mode === 'byob') {
        throw new TypeError('BYOB readers are not supported');
      }
      return new ReadableStreamDefaultReader(this);
    },
    
    tee: function() {
      var self = this;
      var reader = this.getReader();
      var cancelled1 = false;
      var cancelled2 = false;
      var reason1, reason2;
      
      function pullAlgorithm(controller1, controller2) {
        reader.read().then(function(result) {
          if (result.done) {
            if (!cancelled1) controller1.close();
            if (!cancelled2) controller2.close();
            return;
          }
          if (!cancelled1) controller1.enqueue(result.value);
          if (!cancelled2) controller2.enqueue(result.value);
          pullAlgorithm(controller1, controller2);
        });
      }
      
      var branch1 = new ReadableStream({
        start: function(controller) {
          // Will be started by pullAlgorithm
        },
        pull: function(controller) {
          // Handled by pullAlgorithm
        },
        cancel: function(reason) {
          cancelled1 = true;
          reason1 = reason;
          if (cancelled2) {
            reader.cancel([reason1, reason2]);
          }
        }
      });
      
      var branch2 = new ReadableStream({
        start: function(controller) {
          pullAlgorithm(branch1._controller, controller);
        },
        cancel: function(reason) {
          cancelled2 = true;
          reason2 = reason;
          if (cancelled1) {
            reader.cancel([reason1, reason2]);
          }
        }
      });
      
      return [branch1, branch2];
    },
    
    pipeTo: function(dest, options) {
      var self = this;
      var reader = this.getReader();
      var writer = dest.getWriter ? dest.getWriter() : null;
      
      options = options || {};
      
      function pump() {
        return reader.read().then(function(result) {
          if (result.done) {
            if (writer && !options.preventClose) {
              writer.close();
            }
            return;
          }
          if (writer) {
            return writer.write(result.value).then(pump);
          }
          return pump();
        });
      }
      
      return pump().catch(function(e) {
        if (writer && !options.preventAbort) {
          writer.abort(e);
        }
        throw e;
      });
    },
    
    pipeThrough: function(transform, options) {
      this.pipeTo(transform.writable, options);
      return transform.readable;
    }
  };
  
  // Static method to create from iterable
  ReadableStream.from = function(iterable) {
    var iterator;
    
    return new ReadableStream({
      start: function() {
        if (iterable[Symbol.iterator]) {
          iterator = iterable[Symbol.iterator]();
        } else if (iterable[Symbol.asyncIterator]) {
          iterator = iterable[Symbol.asyncIterator]();
        } else if (Array.isArray(iterable)) {
          iterator = iterable[Symbol.iterator]();
        } else {
          throw new TypeError('Object is not iterable');
        }
      },
      pull: function(controller) {
        var result = iterator.next();
        if (result && typeof result.then === 'function') {
          return result.then(function(res) {
            if (res.done) {
              controller.close();
            } else {
              controller.enqueue(res.value);
            }
          });
        }
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      }
    });
  };
  
  // Expose to global
  window.ReadableStream = ReadableStream;
  window.ReadableStreamDefaultReader = ReadableStreamDefaultReader;
  window.ReadableStreamDefaultController = ReadableStreamDefaultController;
  
  console.log('[Revamp] ReadableStream polyfill loaded');
})();
`;
