/**
 * Revamp Admin Panel - Configuration
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function() {
  'use strict';

  var UI = window.RevampUI;
  var API = window.RevampAPI;

  var currentConfig = {};
  var pendingChanges = {};

  // Configuration options grouped by category
  var configOptions = {
    transforms: [
      { key: 'transformJs', name: 'Transform JavaScript', desc: 'Transpile modern JS to ES5/ES6 using Babel' },
      { key: 'transformCss', name: 'Transform CSS', desc: 'Add vendor prefixes and fallbacks using PostCSS' },
      { key: 'transformHtml', name: 'Transform HTML', desc: 'Inject polyfills and modify HTML structure' },
      { key: 'bundleEsModules', name: 'Bundle ES Modules', desc: 'Convert ES modules to legacy-compatible bundles' },
      { key: 'injectPolyfills', name: 'Inject Polyfills', desc: 'Add polyfills for missing browser APIs' }
    ],
    filtering: [
      { key: 'removeAds', name: 'Remove Ads', desc: 'Block ad networks and remove ad containers' },
      { key: 'removeTracking', name: 'Remove Tracking', desc: 'Block tracking scripts and analytics' }
    ],
    sw: [
      { key: 'emulateServiceWorkers', name: 'Emulate Service Workers', desc: 'Bypass Service Worker registration for compatibility' },
      { key: 'remoteServiceWorkers', name: 'Remote Service Workers', desc: 'Execute Service Workers in a remote browser' }
    ],
    ua: [
      { key: 'spoofUserAgent', name: 'Spoof User-Agent Header', desc: 'Send modern User-Agent to servers' },
      { key: 'spoofUserAgentInJs', name: 'Spoof navigator.userAgent', desc: 'Override User-Agent in JavaScript' }
    ]
  };

  /**
   * Render a config grid section
   * @param {string} gridId - Grid element ID
   * @param {Array} options - Config options for this section
   */
  function renderConfigGrid(gridId, options) {
    var grid = document.getElementById(gridId);
    if (!grid) return;

    grid.innerHTML = options.map(function(opt) {
      var value = pendingChanges.hasOwnProperty(opt.key)
        ? pendingChanges[opt.key]
        : currentConfig[opt.key];
      var checked = value === true;

      return '<div class="config-item">' +
        '<div class="config-item-header">' +
          '<span class="config-item-name">' + UI.escapeHtml(opt.name) + '</span>' +
          '<label class="toggle">' +
            '<input type="checkbox" class="toggle-input" data-key="' + opt.key + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="toggle-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="config-item-desc">' + UI.escapeHtml(opt.desc) + '</div>' +
      '</div>';
    }).join('');

    // Bind toggle handlers
    grid.querySelectorAll('.toggle-input').forEach(function(input) {
      input.addEventListener('change', function(e) {
        var key = e.target.getAttribute('data-key');
        pendingChanges[key] = e.target.checked;
        updateJsonPreview();
      });
    });
  }

  /**
   * Render all config grids
   */
  function renderAllGrids() {
    renderConfigGrid('transforms-grid', configOptions.transforms);
    renderConfigGrid('filtering-grid', configOptions.filtering);
    renderConfigGrid('sw-grid', configOptions.sw);
    renderConfigGrid('ua-grid', configOptions.ua);
  }

  /**
   * Update JSON preview
   */
  function updateJsonPreview() {
    var preview = document.getElementById('json-preview');
    if (!preview) return;

    // Merge current config with pending changes
    var displayConfig = {};
    for (var key in currentConfig) {
      displayConfig[key] = pendingChanges.hasOwnProperty(key)
        ? pendingChanges[key]
        : currentConfig[key];
    }

    preview.textContent = JSON.stringify(displayConfig, null, 2);
  }

  /**
   * Load current configuration
   */
  function loadConfig() {
    API.getConfig()
      .then(function(data) {
        currentConfig = data.config || data;
        pendingChanges = {};
        renderAllGrids();
        updateJsonPreview();
      })
      .catch(function(err) {
        console.error('Failed to load config:', err);
        UI.showToast('Failed to load configuration', 'error');
      });
  }

  /**
   * Save configuration changes
   */
  function saveConfig() {
    if (Object.keys(pendingChanges).length === 0) {
      UI.showToast('No changes to save', 'warning');
      return;
    }

    UI.showLoading('Saving configuration...');

    API.updateConfig(pendingChanges)
      .then(function() {
        UI.hideLoading();
        UI.showToast('Configuration saved', 'success');

        // Merge pending changes into current config
        for (var key in pendingChanges) {
          currentConfig[key] = pendingChanges[key];
        }
        pendingChanges = {};
        updateJsonPreview();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to save config:', err);
        UI.showToast(err.data?.error || 'Failed to save configuration', 'error');
      });
  }

  /**
   * Reset configuration to defaults
   */
  function resetConfig() {
    UI.confirm('Are you sure you want to reset all settings to defaults?', {
      title: 'Reset Configuration',
      confirmText: 'Reset',
      danger: true
    }).then(function(confirmed) {
      if (!confirmed) return;

      UI.showLoading('Resetting configuration...');

      API.resetConfig()
        .then(function() {
          UI.hideLoading();
          UI.showToast('Configuration reset to defaults', 'success');
          loadConfig();
        })
        .catch(function(err) {
          UI.hideLoading();
          console.error('Failed to reset config:', err);
          UI.showToast('Failed to reset configuration', 'error');
        });
    });
  }

  /**
   * Copy JSON to clipboard
   */
  function copyJson() {
    var preview = document.getElementById('json-preview');
    if (!preview) return;

    var text = preview.textContent;

    // Use modern clipboard API if available, fallback for older browsers
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function() {
          UI.showToast('JSON copied to clipboard', 'success');
        })
        .catch(function() {
          fallbackCopy(text);
        });
    } else {
      fallbackCopy(text);
    }
  }

  /**
   * Fallback copy method for older browsers
   */
  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      UI.showToast('JSON copied to clipboard', 'success');
    } catch (err) {
      UI.showToast('Failed to copy to clipboard', 'error');
    }

    document.body.removeChild(textarea);
  }

  /**
   * Initialize
   */
  function init() {
    loadConfig();

    // Save button
    var saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveConfig);
    }

    // Reset button
    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetConfig);
    }

    // Copy JSON button
    var copyBtn = document.getElementById('copy-json-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', copyJson);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
