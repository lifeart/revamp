/**
 * Config overlay script for managing proxy settings on device
 * Shows a settings panel accessible via a gear icon
 * Settings are stored on the proxy server via API endpoint
 */
export const configOverlayScript = `
<script>
(function() {
  'use strict';
  
  // Config API endpoint (intercepted by proxy regardless of domain)
  var CONFIG_ENDPOINT = '/__revamp__/config';
  
  // Default config values (should match server defaults)
  var defaultConfig = {
    transformJs: true,
    transformCss: true,
    transformHtml: true,
    removeAds: true,
    removeTracking: true,
    injectPolyfills: true,
    spoofUserAgent: true,
    spoofUserAgentInJs: true,
    cacheEnabled: true
  };
  
  // Load saved config from proxy via API
  function loadConfigAsync(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', CONFIG_ENDPOINT, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var response = JSON.parse(xhr.responseText);
            if (response.config) {
              // Merge with defaults to handle new options
              var config = {};
              for (var key in defaultConfig) {
                if (defaultConfig.hasOwnProperty(key)) {
                  config[key] = response.config.hasOwnProperty(key) ? response.config[key] : defaultConfig[key];
                }
              }
              callback(config);
              return;
            }
          } catch (e) {
            console.error('[Revamp] Error parsing config:', e);
          }
        }
        // Use defaults if request fails or no saved config
        callback(JSON.parse(JSON.stringify(defaultConfig)));
      }
    };
    xhr.onerror = function() {
      console.error('[Revamp] Error loading config from proxy');
      callback(JSON.parse(JSON.stringify(defaultConfig)));
    };
    xhr.send();
  }
  
  // Load config synchronously (for initial load) - fallback to defaults
  function loadConfigSync() {
    // On initial load, use defaults; async load will update later
    return JSON.parse(JSON.stringify(defaultConfig));
  }
  
  // Save config to proxy via API
  function saveConfigAsync(config, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', CONFIG_ENDPOINT, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var response = JSON.parse(xhr.responseText);
            callback(response.success === true, null);
            return;
          } catch (e) {
            callback(false, 'Invalid response');
            return;
          }
        }
        callback(false, 'Request failed: ' + xhr.status);
      }
    };
    xhr.onerror = function() {
      callback(false, 'Network error');
    };
    xhr.send(JSON.stringify(config));
  }
  
  // Reset config on proxy via API
  function resetConfigAsync(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', CONFIG_ENDPOINT, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        callback(xhr.status === 200);
      }
    };
    xhr.onerror = function() {
      callback(false);
    };
    xhr.send();
  }
  
  var currentConfig = loadConfigSync();
  var configLoaded = false;
  var overlay = null;
  var isVisible = false;
  
  // Create styles
  var style = document.createElement('style');
  style.textContent = 
    '#revamp-config-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);' +
    'color:#fff;z-index:2147483645;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'font-size:14px;line-height:1.5;display:none;padding:0;margin:0;-webkit-overflow-scrolling:touch;}' +
    '#revamp-config-overlay.visible{display:block;}' +
    '#revamp-config-header{background:#3498db;padding:12px 16px;position:sticky;top:0;z-index:1;' +
    'display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;' +
    '-webkit-align-items:center;align-items:center;}' +
    '#revamp-config-header h1{margin:0;font-size:16px;font-weight:600;}' +
    '#revamp-config-close{background:#2980b9;border:none;color:#fff;padding:8px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-config-close:active{background:#1f6dad;}' +
    '#revamp-config-content{padding:16px;max-width:500px;margin:0 auto;}' +
    '.revamp-config-section{margin-bottom:24px;}' +
    '.revamp-config-section-title{font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;' +
    'margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #333;}' +
    '.revamp-config-option{display:-webkit-flex;display:flex;-webkit-justify-content:space-between;' +
    'justify-content:space-between;-webkit-align-items:center;align-items:center;padding:12px 0;' +
    'border-bottom:1px solid #222;}' +
    '.revamp-config-option:last-child{border-bottom:none;}' +
    '.revamp-config-label{-webkit-flex:1;flex:1;padding-right:16px;}' +
    '.revamp-config-label-text{font-weight:500;margin-bottom:2px;}' +
    '.revamp-config-label-desc{font-size:12px;color:#888;}' +
    '.revamp-config-toggle{position:relative;width:50px;height:28px;-webkit-flex-shrink:0;flex-shrink:0;}' +
    '.revamp-config-toggle input{opacity:0;width:0;height:0;}' +
    '.revamp-config-toggle-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;' +
    'background-color:#444;-webkit-transition:.3s;transition:.3s;border-radius:28px;}' +
    '.revamp-config-toggle-slider:before{position:absolute;content:"";height:22px;width:22px;left:3px;bottom:3px;' +
    'background-color:#fff;-webkit-transition:.3s;transition:.3s;border-radius:50%;}' +
    '.revamp-config-toggle input:checked+.revamp-config-toggle-slider{background-color:#27ae60;}' +
    '.revamp-config-toggle input:checked+.revamp-config-toggle-slider:before{' +
    '-webkit-transform:translateX(22px);transform:translateX(22px);}' +
    '#revamp-config-badge{position:fixed;bottom:20px;left:20px;background:#3498db;color:#fff;' +
    'width:50px;height:50px;border-radius:50%;display:-webkit-flex;display:flex;' +
    '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;' +
    'font-size:24px;z-index:2147483644;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    '-webkit-tap-highlight-color:transparent;}' +
    '#revamp-config-badge:active{-webkit-transform:scale(0.95);transform:scale(0.95);}' +
    '#revamp-config-apply{background:#27ae60;border:none;color:#fff;padding:14px 24px;border-radius:6px;' +
    'font-size:16px;font-weight:600;cursor:pointer;width:100%;margin-top:16px;' +
    '-webkit-tap-highlight-color:transparent;}' +
    '#revamp-config-apply:active{background:#219a52;}' +
    '#revamp-config-reset{background:#e74c3c;border:none;color:#fff;padding:10px 16px;border-radius:4px;' +
    'font-size:14px;cursor:pointer;width:100%;margin-top:8px;-webkit-tap-highlight-color:transparent;}' +
    '#revamp-config-reset:active{background:#c0392b;}' +
    '.revamp-config-status{text-align:center;padding:12px;margin-top:16px;border-radius:4px;display:none;}' +
    '.revamp-config-status.success{display:block;background:#27ae60;color:#fff;}' +
    '.revamp-config-status.error{display:block;background:#e74c3c;color:#fff;}' +
    '#revamp-config-version{text-align:center;color:#666;font-size:11px;margin-top:24px;}';
  
  function createToggle(id, checked) {
    return '<label class="revamp-config-toggle">' +
      '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="revamp-config-toggle-slider"></span>' +
      '</label>';
  }
  
  function createOption(id, label, description, checked) {
    return '<div class="revamp-config-option">' +
      '<div class="revamp-config-label">' +
        '<div class="revamp-config-label-text">' + label + '</div>' +
        '<div class="revamp-config-label-desc">' + description + '</div>' +
      '</div>' +
      createToggle(id, checked) +
    '</div>';
  }
  
  function createOverlay() {
    if (overlay) return;
    
    document.head.appendChild(style);
    
    overlay = document.createElement('div');
    overlay.id = 'revamp-config-overlay';
    overlay.innerHTML = 
      '<div id="revamp-config-header">' +
        '<h1>⚙️ Revamp Settings</h1>' +
        '<button id="revamp-config-close">Close</button>' +
      '</div>' +
      '<div id="revamp-config-content">' +
        '<div class="revamp-config-section">' +
          '<div class="revamp-config-section-title">🔧 Transformation</div>' +
          createOption('revamp-opt-transformJs', 'Transform JavaScript', 
            'Convert modern JS to Safari 9 compatible code', currentConfig.transformJs) +
          createOption('revamp-opt-transformCss', 'Transform CSS', 
            'Convert modern CSS features for older browsers', currentConfig.transformCss) +
          createOption('revamp-opt-transformHtml', 'Transform HTML', 
            'Inject polyfills and modify HTML', currentConfig.transformHtml) +
        '</div>' +
        '<div class="revamp-config-section">' +
          '<div class="revamp-config-section-title">🛡️ Privacy</div>' +
          createOption('revamp-opt-removeAds', 'Remove Ads', 
            'Block ad domains and remove ad elements', currentConfig.removeAds) +
          createOption('revamp-opt-removeTracking', 'Remove Tracking', 
            'Block tracking scripts and pixels', currentConfig.removeTracking) +
        '</div>' +
        '<div class="revamp-config-section">' +
          '<div class="revamp-config-section-title">🔌 Polyfills & Compatibility</div>' +
          createOption('revamp-opt-injectPolyfills', 'Inject Polyfills', 
            'Add missing browser features (Promise, fetch, etc.)', currentConfig.injectPolyfills) +
          createOption('revamp-opt-spoofUserAgent', 'Spoof User-Agent (HTTP)', 
            'Send modern browser headers to servers', currentConfig.spoofUserAgent) +
          createOption('revamp-opt-spoofUserAgentInJs', 'Spoof User-Agent (JS)', 
            'Override navigator.userAgent in JavaScript', currentConfig.spoofUserAgentInJs) +
        '</div>' +
        '<div class="revamp-config-section">' +
          '<div class="revamp-config-section-title">💾 Cache</div>' +
          createOption('revamp-opt-cacheEnabled', 'Enable Cache', 
            'Cache transformed content for faster loading', currentConfig.cacheEnabled) +
        '</div>' +
        '<button id="revamp-config-apply">Apply & Reload</button>' +
        '<button id="revamp-config-reset">Reset to Defaults</button>' +
        '<div id="revamp-config-status" class="revamp-config-status"></div>' +
        '<div id="revamp-config-note" style="text-align:center;color:#888;font-size:11px;margin-top:16px;' +
          'padding:12px;background:#1a1a1a;border-radius:4px;">' +
          '💡 Settings are saved on the proxy server.<br>' +
          'Changes take effect on next page load.' +
        '</div>' +
        '<div id="revamp-config-version">Revamp Proxy v1.0</div>' +
      '</div>';
    document.body.appendChild(overlay);
    
    // Create settings badge (gear icon)
    var badge = document.createElement('div');
    badge.id = 'revamp-config-badge';
    badge.innerHTML = '⚙️';
    badge.title = 'Revamp Settings';
    document.body.appendChild(badge);
    
    // Event listeners
    document.getElementById('revamp-config-close').onclick = hideOverlay;
    badge.onclick = function() {
      if (isVisible) {
        hideOverlay();
      } else {
        showOverlay();
      }
    };
    
    document.getElementById('revamp-config-apply').onclick = applyConfig;
    document.getElementById('revamp-config-reset').onclick = resetConfig;
  }
  
  function showOverlay() {
    if (!overlay) createOverlay();
    // Refresh checkbox states from current config
    updateCheckboxes();
    overlay.className = 'visible';
    isVisible = true;
  }
  
  function hideOverlay() {
    if (overlay) {
      overlay.className = '';
    }
    isVisible = false;
  }
  
  function updateCheckboxes() {
    var mappings = {
      'revamp-opt-transformJs': 'transformJs',
      'revamp-opt-transformCss': 'transformCss',
      'revamp-opt-transformHtml': 'transformHtml',
      'revamp-opt-removeAds': 'removeAds',
      'revamp-opt-removeTracking': 'removeTracking',
      'revamp-opt-injectPolyfills': 'injectPolyfills',
      'revamp-opt-spoofUserAgent': 'spoofUserAgent',
      'revamp-opt-spoofUserAgentInJs': 'spoofUserAgentInJs',
      'revamp-opt-cacheEnabled': 'cacheEnabled'
    };
    
    for (var id in mappings) {
      if (mappings.hasOwnProperty(id)) {
        var checkbox = document.getElementById(id);
        if (checkbox) {
          checkbox.checked = currentConfig[mappings[id]];
        }
      }
    }
  }
  
  function getConfigFromUI() {
    return {
      transformJs: document.getElementById('revamp-opt-transformJs').checked,
      transformCss: document.getElementById('revamp-opt-transformCss').checked,
      transformHtml: document.getElementById('revamp-opt-transformHtml').checked,
      removeAds: document.getElementById('revamp-opt-removeAds').checked,
      removeTracking: document.getElementById('revamp-opt-removeTracking').checked,
      injectPolyfills: document.getElementById('revamp-opt-injectPolyfills').checked,
      spoofUserAgent: document.getElementById('revamp-opt-spoofUserAgent').checked,
      spoofUserAgentInJs: document.getElementById('revamp-opt-spoofUserAgentInJs').checked,
      cacheEnabled: document.getElementById('revamp-opt-cacheEnabled').checked
    };
  }
  
  function showStatus(message, isError) {
    var status = document.getElementById('revamp-config-status');
    if (status) {
      status.textContent = message;
      status.className = 'revamp-config-status ' + (isError ? 'error' : 'success');
      setTimeout(function() {
        status.className = 'revamp-config-status';
      }, 3000);
    }
  }
  
  function applyConfig() {
    var newConfig = getConfigFromUI();
    var applyBtn = document.getElementById('revamp-config-apply');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Saving...';
    }
    
    saveConfigAsync(newConfig, function(success, error) {
      if (success) {
        currentConfig = newConfig;
        showStatus('✓ Settings saved! Reloading...', false);
        
        // Reload the page after a short delay to show the success message
        setTimeout(function() {
          // Clear any cached data for this page
          if (window.caches && window.caches.keys) {
            window.caches.keys().then(function(names) {
              names.forEach(function(name) {
                window.caches.delete(name);
              });
            });
          }
          // Force reload from server (bypass browser cache)
          window.location.reload(true);
        }, 500);
      } else {
        showStatus('✗ Failed to save: ' + (error || 'Unknown error'), true);
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply & Reload';
        }
      }
    });
  }
  
  function resetConfig() {
    if (confirm('Reset all settings to defaults?')) {
      var resetBtn = document.getElementById('revamp-config-reset');
      if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting...';
      }
      
      resetConfigAsync(function(success) {
        if (success) {
          currentConfig = JSON.parse(JSON.stringify(defaultConfig));
          updateCheckboxes();
          showStatus('✓ Settings reset to defaults', false);
        } else {
          showStatus('✗ Failed to reset settings', true);
        }
        if (resetBtn) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset to Defaults';
        }
      });
    }
  }
  
  // Initialize when DOM is ready
  function init() {
    createOverlay();
    
    // Load config from proxy API asynchronously
    loadConfigAsync(function(config) {
      currentConfig = config;
      configLoaded = true;
      updateCheckboxes();
      console.log('[Revamp] Config loaded from proxy');
    });
    
    console.log('[Revamp] Config overlay initialized');
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
`;
