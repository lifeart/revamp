/**
 * Error overlay script for debugging on device
 * Shows a visual overlay with error details when JavaScript errors occur
 */
export const errorOverlayScript = `
<script>
(function() {
  // Error overlay state
  var errors = [];
  var overlay = null;
  var isVisible = false;
  var errorCount = 0;
  
  // Create error overlay styles
  var style = document.createElement('style');
  style.textContent = 
    '#revamp-error-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);' +
    'color:#fff;z-index:2147483647;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,monospace;' +
    'font-size:13px;line-height:1.5;display:none;padding:0;margin:0;-webkit-overflow-scrolling:touch;}' +
    '#revamp-error-overlay.visible{display:block;}' +
    '#revamp-error-header{background:#e74c3c;padding:12px 16px;position:sticky;top:0;z-index:1;' +
    'display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;' +
    '-webkit-align-items:center;align-items:center;}' +
    '#revamp-error-header h1{margin:0;font-size:16px;font-weight:600;}' +
    '#revamp-error-close{background:#c0392b;border:none;color:#fff;padding:8px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-error-close:active{background:#a93226;}' +
    '#revamp-error-list{padding:0;margin:0;list-style:none;}' +
    '.revamp-error-item{border-bottom:1px solid #333;padding:16px;}' +
    '.revamp-error-item:last-child{border-bottom:none;}' +
    '.revamp-error-type{color:#e74c3c;font-weight:600;font-size:14px;margin-bottom:4px;}' +
    '.revamp-error-type.warning{color:#f39c12;}' +
    '.revamp-error-type.promise{color:#9b59b6;}' +
    '.revamp-error-message{color:#fff;font-size:14px;margin-bottom:8px;word-wrap:break-word;' +
    'white-space:pre-wrap;background:#1a1a1a;padding:10px;border-radius:4px;overflow-x:auto;}' +
    '.revamp-error-location{color:#3498db;font-size:12px;margin-bottom:8px;}' +
    '.revamp-error-stack{color:#aaa;font-size:11px;white-space:pre-wrap;word-wrap:break-word;' +
    'background:#111;padding:10px;border-radius:4px;overflow-x:auto;max-height:300px;overflow-y:auto;' +
    'border-left:3px solid #e74c3c;}' +
    '.revamp-error-stack-label{color:#888;font-size:10px;margin-bottom:4px;text-transform:uppercase;}' +
    '.revamp-error-time{color:#666;font-size:11px;margin-top:8px;}' +
    '#revamp-error-badge{position:fixed;bottom:20px;right:20px;background:#e74c3c;color:#fff;' +
    'width:50px;height:50px;border-radius:50%;display:-webkit-flex;display:flex;' +
    '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;' +
    'font-weight:bold;font-size:18px;z-index:2147483646;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    '-webkit-tap-highlight-color:transparent;display:none;}' +
    '#revamp-error-badge.visible{display:-webkit-flex;display:flex;}' +
    '#revamp-error-badge:active{-webkit-transform:scale(0.95);transform:scale(0.95);}' +
    '#revamp-error-clear{background:#2c3e50;border:none;color:#fff;padding:8px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;margin-left:8px;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-error-clear:active{background:#1a252f;}';
  
  // Create overlay element
  function createOverlay() {
    if (overlay) return;
    
    document.head.appendChild(style);
    
    overlay = document.createElement('div');
    overlay.id = 'revamp-error-overlay';
    overlay.innerHTML = 
      '<div id="revamp-error-header">' +
        '<h1>⚠️ JavaScript Errors</h1>' +
        '<div>' +
          '<button id="revamp-error-clear">Clear</button>' +
          '<button id="revamp-error-close">Close</button>' +
        '</div>' +
      '</div>' +
      '<ul id="revamp-error-list"></ul>';
    document.body.appendChild(overlay);
    
    // Create error badge
    var badge = document.createElement('div');
    badge.id = 'revamp-error-badge';
    badge.textContent = '0';
    document.body.appendChild(badge);
    
    // Event listeners
    document.getElementById('revamp-error-close').onclick = function() {
      hideOverlay();
    };
    
    document.getElementById('revamp-error-clear').onclick = function() {
      errors = [];
      errorCount = 0;
      updateErrorList();
      updateBadge();
      hideOverlay();
    };
    
    badge.onclick = function() {
      if (isVisible) {
        hideOverlay();
      } else {
        showOverlay();
      }
    };
  }
  
  function showOverlay() {
    if (!overlay) createOverlay();
    overlay.className = 'visible';
    isVisible = true;
  }
  
  function hideOverlay() {
    if (overlay) {
      overlay.className = '';
    }
    isVisible = false;
  }
  
  function updateBadge() {
    var badge = document.getElementById('revamp-error-badge');
    if (badge) {
      badge.textContent = errorCount > 99 ? '99+' : errorCount;
      badge.className = errorCount > 0 ? 'visible' : '';
    }
  }
  
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function updateErrorList() {
    var list = document.getElementById('revamp-error-list');
    if (!list) return;
    
    if (errors.length === 0) {
      list.innerHTML = '<li class="revamp-error-item" style="color:#888;text-align:center;padding:40px;">No errors captured</li>';
      return;
    }
    
    var html = '';
    for (var i = errors.length - 1; i >= 0; i--) {
      var err = errors[i];
      var typeClass = '';
      if (err.type.indexOf('Warning') >= 0) typeClass = ' warning';
      else if (err.type.indexOf('Promise') >= 0) typeClass = ' promise';
      
      html += '<li class="revamp-error-item">' +
        '<div class="revamp-error-type' + typeClass + '">' + escapeHtml(err.type) + '</div>' +
        '<div class="revamp-error-message">' + escapeHtml(err.message) + '</div>';
      
      if (err.location) {
        html += '<div class="revamp-error-location">📍 ' + escapeHtml(err.location) + '</div>';
      }
      
      if (err.stack) {
        html += '<div class="revamp-error-stack-label">📚 Stack Trace:</div>' +
                '<div class="revamp-error-stack">' + escapeHtml(err.stack) + '</div>';
      }
      
      html += '<div class="revamp-error-time">🕐 ' + err.time + '</div>' +
        '</li>';
    }
    list.innerHTML = html;
  }
  
  function formatTime() {
    var d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0') + ':' +
           d.getSeconds().toString().padStart(2, '0') + '.' +
           d.getMilliseconds().toString().padStart(3, '0');
  }
  
  function addError(type, message, filename, lineno, colno, stack) {
    var location = '';
    if (filename) {
      location = filename;
      if (lineno) location += ':' + lineno;
      if (colno) location += ':' + colno;
    }
    
    errors.push({
      type: type,
      message: message || 'Unknown error',
      location: location,
      stack: stack || '',
      time: formatTime()
    });
    
    // Keep only last 50 errors
    if (errors.length > 50) {
      errors.shift();
    }
    
    errorCount++;
    
    if (!overlay) createOverlay();
    updateErrorList();
    updateBadge();
  }
  
  // Global error handler
  window.onerror = function(message, source, lineno, colno, error) {
    var stack = '';
    if (error && error.stack) {
      stack = error.stack;
    }
    addError('Error', message, source, lineno, colno, stack);
    return false; // Don't suppress the error
  };
  
  // Unhandled promise rejection handler
  window.onunhandledrejection = function(event) {
    var message = 'Unhandled Promise Rejection';
    var stack = '';
    
    if (event.reason) {
      if (typeof event.reason === 'string') {
        message = event.reason;
      } else if (event.reason.message) {
        message = event.reason.message;
        stack = event.reason.stack || '';
      } else {
        try {
          message = JSON.stringify(event.reason);
        } catch (e) {
          message = String(event.reason);
        }
      }
    }
    
    addError('Promise Rejection', message, '', '', '', stack);
  };
  
  // Console.error interceptor
  var originalConsoleError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(arg) {
      if (arg instanceof Error) {
        return arg.message || String(arg);
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    // Try to extract stack from Error objects in arguments
    var stack = '';
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error && args[i].stack) {
        stack = args[i].stack;
        break;
      }
    }
    
    // If no Error object found, generate a stack trace
    if (!stack) {
      try {
        throw new Error('Console error stack trace');
      } catch (e) {
        if (e.stack) {
          // Remove the first two lines (Error message and this function)
          var lines = e.stack.split('\\n');
          lines.splice(0, 3); // Remove Error line, console.error wrapper, and this try/catch
          stack = lines.join('\\n');
        }
      }
    }
    
    addError('Console Error', message, '', '', '', stack);
    originalConsoleError.apply(console, arguments);
  };
  
  // Console.warn interceptor (optional, for warnings)
  var originalConsoleWarn = console.warn;
  console.warn = function() {
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(arg) {
      if (arg instanceof Error) {
        return arg.message || String(arg);
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    // Generate stack trace for warnings too
    var stack = '';
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error && args[i].stack) {
        stack = args[i].stack;
        break;
      }
    }
    
    if (!stack) {
      try {
        throw new Error('Console warn stack trace');
      } catch (e) {
        if (e.stack) {
          var lines = e.stack.split('\\n');
          lines.splice(0, 3);
          stack = lines.join('\\n');
        }
      }
    }
    
    addError('Console Warning', message, '', '', '', stack);
    originalConsoleWarn.apply(console, arguments);
  };
  
  console.log('[Revamp] Error overlay initialized - errors will show a red badge');
})();
</script>
`;
