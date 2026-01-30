/**
 * Revamp Admin Panel - Plugins
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function() {
  'use strict';

  var UI = window.RevampUI;
  var API = window.RevampAPI;

  var REFRESH_INTERVAL = 10000;
  var refreshTimer = null;
  var currentPluginId = null;

  /**
   * Get state badge HTML
   * @param {string} state - Plugin state
   * @returns {string} HTML string
   */
  function getStateBadge(state) {
    var classes = 'state-badge ';
    var label = state;

    switch (state) {
      case 'active':
        classes += 'active';
        label = 'Active';
        break;
      case 'loaded':
      case 'initialized':
        classes += 'inactive';
        label = 'Loaded';
        break;
      case 'deactivated':
        classes += 'inactive';
        label = 'Inactive';
        break;
      case 'error':
        classes += 'error';
        label = 'Error';
        break;
      case 'initializing':
      case 'activating':
      case 'deactivating':
        classes += 'loading';
        label = 'Loading...';
        break;
      default:
        classes += 'inactive';
    }

    return '<span class="' + classes + '"><span class="state-dot"></span>' + label + '</span>';
  }

  /**
   * Render plugin card
   * @param {Object} plugin - Plugin data
   * @returns {string} HTML string
   */
  function renderPluginCard(plugin) {
    var hooks = plugin.hooks || [];
    var permissions = plugin.permissions || [];
    var isActive = plugin.state === 'active';

    var hooksHtml = hooks.map(function(h) {
      return '<span class="plugin-tag hook">' + UI.escapeHtml(h) + '</span>';
    }).join('');

    var permsHtml = permissions.slice(0, 3).map(function(p) {
      return '<span class="plugin-tag permission">' + UI.escapeHtml(p) + '</span>';
    }).join('');

    if (permissions.length > 3) {
      permsHtml += '<span class="plugin-tag permission">+' + (permissions.length - 3) + ' more</span>';
    }

    var errorHtml = '';
    if (plugin.error) {
      errorHtml = '<div class="plugin-error">' + UI.escapeHtml(plugin.error) + '</div>';
    }

    var actionsHtml = '';
    if (isActive) {
      actionsHtml = '<button class="btn btn-secondary btn-sm" onclick="window.PluginsPage.deactivate(\'' + plugin.id + '\')">Deactivate</button>';
    } else if (plugin.state === 'loaded' || plugin.state === 'initialized' || plugin.state === 'deactivated') {
      actionsHtml = '<button class="btn btn-primary btn-sm" onclick="window.PluginsPage.activate(\'' + plugin.id + '\')">Activate</button>';
    }

    actionsHtml += '<button class="btn btn-secondary btn-sm" onclick="window.PluginsPage.configure(\'' + plugin.id + '\')">Configure</button>';
    actionsHtml += '<button class="btn btn-secondary btn-sm" onclick="window.PluginsPage.reload(\'' + plugin.id + '\')">Reload</button>';

    return '<div class="plugin-card" data-plugin-id="' + plugin.id + '">' +
      '<div class="plugin-header">' +
        '<div class="plugin-info">' +
          '<div class="plugin-name">' + UI.escapeHtml(plugin.name) + '<span class="plugin-version">v' + plugin.version + '</span></div>' +
          '<div class="plugin-author">by ' + UI.escapeHtml(plugin.author) + '</div>' +
        '</div>' +
        '<div class="plugin-actions">' +
          getStateBadge(plugin.state) +
        '</div>' +
      '</div>' +
      '<div class="plugin-description">' + UI.escapeHtml(plugin.description) + '</div>' +
      '<div class="plugin-meta">' +
        '<div class="plugin-meta-item">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          '<span>ID: ' + UI.escapeHtml(plugin.id) + '</span>' +
        '</div>' +
      '</div>' +
      (hooksHtml || permsHtml ? '<div class="plugin-tags">' + hooksHtml + permsHtml + '</div>' : '') +
      errorHtml +
      '<div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">' +
        actionsHtml +
      '</div>' +
    '</div>';
  }

  /**
   * Update stats display
   * @param {Object} stats - Stats data
   */
  function updateStats(stats) {
    var totalEl = document.getElementById('stat-total');
    var activeEl = document.getElementById('stat-active');
    var hooksEl = document.getElementById('stat-hooks');

    if (totalEl) totalEl.textContent = stats.totalPlugins || 0;
    if (activeEl) activeEl.textContent = stats.activePlugins || 0;
    if (hooksEl) hooksEl.textContent = stats.totalHooks || 0;
  }

  /**
   * Render plugin list
   * @param {Array} plugins - Array of plugins
   */
  function renderPluginList(plugins) {
    var container = document.getElementById('plugin-list');
    if (!container) return;

    if (!plugins || plugins.length === 0) {
      container.innerHTML = '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' +
        '</svg>' +
        '<p>No plugins installed</p>' +
        '<p class="text-sm">Place plugins in the <code>.revamp-plugins</code> directory and click "Load All Plugins"</p>' +
      '</div>';
      return;
    }

    var html = plugins.map(renderPluginCard).join('');
    container.innerHTML = html;
  }

  /**
   * Refresh plugin list
   */
  function refresh() {
    API.getPlugins()
      .then(function(data) {
        if (data.stats) {
          updateStats(data.stats);
        }
        renderPluginList(data.plugins || []);
      })
      .catch(function(err) {
        console.error('Failed to fetch plugins:', err);
        UI.showToast('Failed to load plugins', 'error');
      });
  }

  /**
   * Load all plugins
   */
  function loadAll() {
    UI.showLoading();
    API.loadAllPlugins()
      .then(function() {
        UI.hideLoading();
        UI.showToast('Plugins loaded successfully', 'success');
        refresh();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to load plugins:', err);
        UI.showToast('Failed to load plugins: ' + err.message, 'error');
      });
  }

  /**
   * Discover available plugins
   */
  function discover() {
    UI.showLoading();
    API.discoverPlugins()
      .then(function(data) {
        UI.hideLoading();
        var available = data.available || [];
        if (available.length === 0) {
          UI.showToast('No plugins found in .revamp-plugins directory', 'info');
        } else {
          var names = available.map(function(p) { return p.name; }).join(', ');
          UI.showToast('Found ' + available.length + ' plugins: ' + names, 'success');
        }
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to discover plugins:', err);
        UI.showToast('Failed to discover plugins: ' + err.message, 'error');
      });
  }

  /**
   * Activate a plugin
   * @param {string} pluginId - Plugin ID
   */
  function activate(pluginId) {
    UI.showLoading();
    API.activatePlugin(pluginId)
      .then(function() {
        UI.hideLoading();
        UI.showToast('Plugin activated', 'success');
        refresh();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to activate plugin:', err);
        UI.showToast('Failed to activate plugin: ' + err.message, 'error');
        refresh();
      });
  }

  /**
   * Deactivate a plugin
   * @param {string} pluginId - Plugin ID
   */
  function deactivate(pluginId) {
    UI.showLoading();
    API.deactivatePlugin(pluginId)
      .then(function() {
        UI.hideLoading();
        UI.showToast('Plugin deactivated', 'success');
        refresh();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to deactivate plugin:', err);
        UI.showToast('Failed to deactivate plugin: ' + err.message, 'error');
        refresh();
      });
  }

  /**
   * Reload a plugin
   * @param {string} pluginId - Plugin ID
   */
  function reload(pluginId) {
    UI.showLoading();
    API.reloadPlugin(pluginId)
      .then(function() {
        UI.hideLoading();
        UI.showToast('Plugin reloaded', 'success');
        refresh();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to reload plugin:', err);
        UI.showToast('Failed to reload plugin: ' + err.message, 'error');
        refresh();
      });
  }

  /**
   * Open config modal for a plugin
   * @param {string} pluginId - Plugin ID
   */
  function configure(pluginId) {
    currentPluginId = pluginId;

    API.getPlugin(pluginId)
      .then(function(data) {
        var plugin = data.plugin;
        var modal = document.getElementById('config-modal');
        var idInput = document.getElementById('config-plugin-id');
        var jsonInput = document.getElementById('config-json');

        if (idInput) idInput.value = pluginId;
        if (jsonInput) jsonInput.value = JSON.stringify(plugin.config || {}, null, 2);
        if (modal) modal.classList.add('show');
      })
      .catch(function(err) {
        console.error('Failed to get plugin:', err);
        UI.showToast('Failed to load plugin configuration', 'error');
      });
  }

  /**
   * Save plugin configuration
   */
  function saveConfig() {
    if (!currentPluginId) return;

    var jsonInput = document.getElementById('config-json');
    if (!jsonInput) return;

    var config;
    try {
      config = JSON.parse(jsonInput.value);
    } catch (e) {
      UI.showToast('Invalid JSON', 'error');
      return;
    }

    UI.showLoading();
    API.updatePluginConfig(currentPluginId, config)
      .then(function() {
        UI.hideLoading();
        UI.showToast('Configuration saved', 'success');
        closeConfigModal();
        refresh();
      })
      .catch(function(err) {
        UI.hideLoading();
        console.error('Failed to save config:', err);
        UI.showToast('Failed to save configuration: ' + err.message, 'error');
      });
  }

  /**
   * Close config modal
   */
  function closeConfigModal() {
    var modal = document.getElementById('config-modal');
    if (modal) modal.classList.remove('show');
    currentPluginId = null;
  }

  /**
   * Start auto-refresh
   */
  function startAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL);
  }

  /**
   * Initialize
   */
  function init() {
    // Initial fetch
    refresh();

    // Start auto-refresh
    startAutoRefresh();

    // Bind event listeners
    var btnLoadAll = document.getElementById('btn-load-all');
    var btnRefresh = document.getElementById('btn-refresh');
    var btnDiscover = document.getElementById('btn-discover');
    var configModalClose = document.getElementById('config-modal-close');
    var configCancel = document.getElementById('config-cancel');
    var configSave = document.getElementById('config-save');

    if (btnLoadAll) btnLoadAll.addEventListener('click', loadAll);
    if (btnRefresh) btnRefresh.addEventListener('click', refresh);
    if (btnDiscover) btnDiscover.addEventListener('click', discover);
    if (configModalClose) configModalClose.addEventListener('click', closeConfigModal);
    if (configCancel) configCancel.addEventListener('click', closeConfigModal);
    if (configSave) configSave.addEventListener('click', saveConfig);

    // Stop auto-refresh when page is hidden
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      } else {
        refresh();
        startAutoRefresh();
      }
    });
  }

  // Export functions for button onclick handlers
  window.PluginsPage = {
    activate: activate,
    deactivate: deactivate,
    reload: reload,
    configure: configure
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
