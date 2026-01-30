/**
 * Revamp Admin Panel - Service Workers
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function() {
  'use strict';

  var UI = window.RevampUI;
  var API = window.RevampAPI;

  var REFRESH_INTERVAL = 5000;
  var refreshTimer = null;

  /**
   * Update SW status display
   * @param {Object} status - SW status data
   */
  function updateStatus(status) {
    // Status indicator
    var statusDot = document.getElementById('status-dot');
    var statusText = document.getElementById('status-text');

    if (statusDot && statusText) {
      var isOnline = status && status.initialized;
      statusDot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
      statusText.textContent = isOnline ? 'Running' : 'Not Running';
    }

    // Stats
    var connectedClientsEl = document.getElementById('connected-clients');
    if (connectedClientsEl) {
      connectedClientsEl.textContent = status ? (status.connectedClients || 0) : '--';
    }

    var activeWorkersEl = document.getElementById('active-workers');
    if (activeWorkersEl) {
      activeWorkersEl.textContent = status ? (status.activeWorkers || 0) : '--';
    }

    var totalMessagesEl = document.getElementById('total-messages');
    if (totalMessagesEl) {
      totalMessagesEl.textContent = status ? UI.formatNumber(status.totalMessages || 0) : '--';
    }

    // WebSocket endpoint
    var wsEndpointEl = document.getElementById('ws-endpoint');
    if (wsEndpointEl) {
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      var host = window.location.host;
      wsEndpointEl.textContent = protocol + '//' + host + '/__revamp__/sw/remote';
    }
  }

  /**
   * Update mode cards based on current config
   * @param {Object} config - Current configuration
   */
  function updateModeCards(config) {
    var emulateCard = document.getElementById('mode-emulate');
    var remoteCard = document.getElementById('mode-remote');
    var emulateBadge = document.getElementById('emulate-badge');
    var remoteBadge = document.getElementById('remote-badge');

    var emulateActive = config.emulateServiceWorkers === true;
    var remoteActive = config.remoteServiceWorkers === true;

    if (emulateCard) {
      emulateCard.className = 'mode-card' + (emulateActive ? ' active' : '');
    }
    if (remoteCard) {
      remoteCard.className = 'mode-card' + (remoteActive ? ' active' : '');
    }
    if (emulateBadge) {
      emulateBadge.textContent = emulateActive ? 'Active' : 'Inactive';
      emulateBadge.className = 'badge ' + (emulateActive ? 'badge-success' : '');
    }
    if (remoteBadge) {
      remoteBadge.textContent = remoteActive ? 'Active' : 'Inactive';
      remoteBadge.className = 'badge ' + (remoteActive ? 'badge-success' : '');
    }
  }

  /**
   * Fetch and update SW status
   */
  function refreshStatus() {
    // Get SW status
    API.getSwStatus()
      .then(function(status) {
        updateStatus(status);
      })
      .catch(function(err) {
        console.error('Failed to fetch SW status:', err);
        updateStatus(null);
      });

    // Get current config for mode display
    API.getConfig()
      .then(function(data) {
        updateModeCards(data.config || data);
      })
      .catch(function(err) {
        console.error('Failed to fetch config:', err);
      });
  }

  /**
   * Start auto-refresh
   */
  function startAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refreshStatus, REFRESH_INTERVAL);
  }

  /**
   * Initialize
   */
  function init() {
    // Initial fetch
    refreshStatus();

    // Start auto-refresh
    startAutoRefresh();

    // Stop auto-refresh when page is hidden
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      } else {
        refreshStatus();
        startAutoRefresh();
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
