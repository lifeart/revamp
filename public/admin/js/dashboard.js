/**
 * Revamp Admin Panel - Dashboard
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function() {
  'use strict';

  var UI = window.RevampUI;
  var API = window.RevampAPI;

  // Refresh interval in milliseconds
  var REFRESH_INTERVAL = 5000;
  var refreshTimer = null;

  /**
   * Update dashboard with metrics data
   * @param {Object} data - Metrics data from API (shape: ProxyMetrics)
   */
  function updateDashboard(data) {
    var requests = data.requests || {};
    var bandwidth = data.bandwidth || {};
    var transforms = data.transforms || {};

    var uptimeEl = document.getElementById('uptime');
    if (uptimeEl && data.uptime !== undefined) {
      uptimeEl.textContent = UI.formatDuration(data.uptime);
    }

    var lastRefreshEl = document.getElementById('last-refresh');
    if (lastRefreshEl) {
      lastRefreshEl.textContent = new Date().toLocaleTimeString();
    }

    var totalRequestsEl = document.getElementById('total-requests');
    if (totalRequestsEl && requests.total !== undefined) {
      totalRequestsEl.textContent = UI.formatNumber(requests.total);
    }

    var activeConnectionsEl = document.getElementById('active-connections');
    if (activeConnectionsEl && data.activeConnections !== undefined) {
      activeConnectionsEl.textContent = UI.formatNumber(data.activeConnections);
    }

    // T24: API is the canonical scale (0..100). Render as-is.
    var cacheHitRateEl = document.getElementById('cache-hit-rate');
    var cacheProgressEl = document.getElementById('cache-progress');
    if (cacheHitRateEl && data.cacheHitRate !== undefined) {
      var hitRate = data.cacheHitRate;
      cacheHitRateEl.textContent = UI.formatPercent(hitRate, false);
      if (cacheProgressEl) {
        cacheProgressEl.style.width = hitRate + '%';
      }
    }

    var blockedRequestsEl = document.getElementById('blocked-requests');
    if (blockedRequestsEl && requests.blocked !== undefined) {
      blockedRequestsEl.textContent = UI.formatNumber(requests.blocked);
    }

    var bandwidthInEl = document.getElementById('bandwidth-in');
    if (bandwidthInEl && bandwidth.totalBytesIn !== undefined) {
      bandwidthInEl.textContent = UI.formatBytes(bandwidth.totalBytesIn);
    }

    var bandwidthOutEl = document.getElementById('bandwidth-out');
    if (bandwidthOutEl && bandwidth.totalBytesOut !== undefined) {
      bandwidthOutEl.textContent = UI.formatBytes(bandwidth.totalBytesOut);
    }

    var transformJsEl = document.getElementById('transform-js');
    if (transformJsEl) {
      transformJsEl.textContent = UI.formatNumber(transforms.js || 0);
    }

    var transformCssEl = document.getElementById('transform-css');
    if (transformCssEl) {
      transformCssEl.textContent = UI.formatNumber(transforms.css || 0);
    }

    var transformHtmlEl = document.getElementById('transform-html');
    if (transformHtmlEl) {
      transformHtmlEl.textContent = UI.formatNumber(transforms.html || 0);
    }

    var transformImagesEl = document.getElementById('transform-images');
    if (transformImagesEl) {
      transformImagesEl.textContent = UI.formatNumber(transforms.images || 0);
    }
  }

  /**
   * Fetch and update metrics
   */
  function refreshMetrics() {
    API.getMetrics()
      .then(function(data) {
        updateDashboard(data);
        updateStatusBadge(true);
      })
      .catch(function(err) {
        console.error('Failed to fetch metrics:', err);
        updateStatusBadge(false);
        UI.showToast('Failed to fetch metrics', 'error');
      });
  }

  /**
   * Update status badge
   * @param {boolean} online - Whether proxy is online
   */
  function updateStatusBadge(online) {
    var badge = document.getElementById('status-badge');
    if (badge) {
      badge.textContent = online ? 'Online' : 'Offline';
      badge.className = 'badge ' + (online ? 'badge-success' : 'badge-error');
    }
  }

  /**
   * Start auto-refresh timer
   */
  function startAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refreshMetrics, REFRESH_INTERVAL);
  }

  /**
   * Initialize dashboard
   */
  function init() {
    // Initial fetch
    refreshMetrics();

    // Start auto-refresh
    startAutoRefresh();

    // Manual refresh button
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        refreshMetrics();
        UI.showToast('Data refreshed', 'success');
      });
    }

    // Stop auto-refresh when page is hidden
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      } else {
        refreshMetrics();
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
