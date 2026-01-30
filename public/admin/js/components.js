/**
 * Revamp Admin Panel - UI Components
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function(global) {
  'use strict';

  // ==========================================
  // Toast Notifications
  // ==========================================

  var toastContainer = null;

  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  /**
   * Show a toast notification
   * @param {string} message - Toast message
   * @param {string} type - Toast type: 'success', 'error', 'warning'
   * @param {number} duration - Duration in ms (default: 3000)
   */
  function showToast(message, type, duration) {
    type = type || 'success';
    duration = duration || 3000;

    var container = ensureToastContainer();

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Close">&times;</button>';

    container.appendChild(toast);

    // Trigger animation
    setTimeout(function() {
      toast.classList.add('show');
    }, 10);

    // Auto dismiss
    var timeout = setTimeout(function() {
      dismissToast(toast);
    }, duration);

    // Manual dismiss
    toast.querySelector('.toast-close').addEventListener('click', function() {
      clearTimeout(timeout);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    toast.classList.remove('show');
    setTimeout(function() {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // ==========================================
  // Modal
  // ==========================================

  var activeModal = null;

  /**
   * Show a modal dialog
   * @param {Object} options - Modal options
   * @param {string} options.title - Modal title
   * @param {string} options.content - Modal HTML content
   * @param {Array} options.buttons - Array of button configs
   * @param {Function} options.onClose - Close callback
   * @returns {HTMLElement} Modal element
   */
  function showModal(options) {
    options = options || {};

    // Close any existing modal
    if (activeModal) {
      closeModal();
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    var buttonsHtml = '';
    if (options.buttons) {
      buttonsHtml = options.buttons.map(function(btn, index) {
        return '<button class="btn ' + (btn.class || 'btn-secondary') + '" data-action="' + index + '">' +
          escapeHtml(btn.text) + '</button>';
      }).join('');
    }

    overlay.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header">' +
          '<h3 class="modal-title">' + escapeHtml(options.title || 'Modal') + '</h3>' +
          '<button class="modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          (options.content || '') +
        '</div>' +
        (buttonsHtml ? '<div class="modal-footer">' + buttonsHtml + '</div>' : '') +
      '</div>';

    document.body.appendChild(overlay);
    activeModal = overlay;

    // Show animation
    setTimeout(function() {
      overlay.classList.add('active');
    }, 10);

    // Close button
    overlay.querySelector('.modal-close').addEventListener('click', function() {
      closeModal();
      if (options.onClose) options.onClose();
    });

    // Overlay click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closeModal();
        if (options.onClose) options.onClose();
      }
    });

    // Button handlers
    if (options.buttons) {
      overlay.querySelectorAll('[data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-action'), 10);
          var buttonConfig = options.buttons[index];
          if (buttonConfig && buttonConfig.onClick) {
            buttonConfig.onClick(overlay);
          }
        });
      });
    }

    // Escape key
    function handleEscape(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeModal();
        if (options.onClose) options.onClose();
        document.removeEventListener('keydown', handleEscape);
      }
    }
    document.addEventListener('keydown', handleEscape);

    return overlay;
  }

  /**
   * Close the active modal
   */
  function closeModal() {
    if (activeModal) {
      activeModal.classList.remove('active');
      var modal = activeModal;
      setTimeout(function() {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }, 300);
      activeModal = null;
    }
  }

  /**
   * Show a confirmation dialog
   * @param {string} message - Confirmation message
   * @param {Object} options - Options
   * @returns {Promise}
   */
  function confirm(message, options) {
    options = options || {};

    return new Promise(function(resolve) {
      showModal({
        title: options.title || 'Confirm',
        content: '<p>' + escapeHtml(message) + '</p>',
        buttons: [
          {
            text: options.cancelText || 'Cancel',
            class: 'btn-secondary',
            onClick: function() {
              closeModal();
              resolve(false);
            }
          },
          {
            text: options.confirmText || 'Confirm',
            class: options.danger ? 'btn-danger' : 'btn-primary',
            onClick: function() {
              closeModal();
              resolve(true);
            }
          }
        ],
        onClose: function() {
          resolve(false);
        }
      });
    });
  }

  // ==========================================
  // Loading State
  // ==========================================

  var loadingOverlay = null;

  /**
   * Show loading overlay
   * @param {string} message - Optional loading message
   */
  function showLoading(message) {
    if (loadingOverlay) return;

    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML =
      '<div style="text-align: center;">' +
        '<div class="spinner" style="width: 48px; height: 48px; margin: 0 auto 16px;"></div>' +
        '<div style="color: var(--text-secondary);">' + escapeHtml(message || 'Loading...') + '</div>' +
      '</div>';

    document.body.appendChild(loadingOverlay);
  }

  /**
   * Hide loading overlay
   */
  function hideLoading() {
    if (loadingOverlay) {
      document.body.removeChild(loadingOverlay);
      loadingOverlay = null;
    }
  }

  // ==========================================
  // Utilities
  // ==========================================

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Format bytes to human readable
   * @param {number} bytes - Bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Format duration to human readable
   * @param {number} ms - Milliseconds
   * @returns {string}
   */
  function formatDuration(ms) {
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);

    if (days > 0) {
      return days + 'd ' + (hours % 24) + 'h';
    }
    if (hours > 0) {
      return hours + 'h ' + (minutes % 60) + 'm';
    }
    if (minutes > 0) {
      return minutes + 'm ' + (seconds % 60) + 's';
    }
    return seconds + 's';
  }

  /**
   * Format number with commas
   * @param {number} num - Number
   * @returns {string}
   */
  function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Format percentage
   * @param {number} value - Value (0-1 or 0-100)
   * @param {boolean} isDecimal - Whether value is decimal (0-1)
   * @returns {string}
   */
  function formatPercent(value, isDecimal) {
    if (isDecimal) {
      value = value * 100;
    }
    return value.toFixed(1) + '%';
  }

  /**
   * Debounce function
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in ms
   * @returns {Function}
   */
  function debounce(fn, delay) {
    var timeout;
    return function() {
      var context = this;
      var args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(function() {
        fn.apply(context, args);
      }, delay);
    };
  }

  /**
   * Get element by ID with type checking
   * @param {string} id - Element ID
   * @returns {HTMLElement|null}
   */
  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Query selector shorthand
   * @param {string} selector - CSS selector
   * @param {HTMLElement} parent - Parent element
   * @returns {HTMLElement|null}
   */
  function $$(selector, parent) {
    return (parent || document).querySelector(selector);
  }

  /**
   * Query selector all shorthand
   * @param {string} selector - CSS selector
   * @param {HTMLElement} parent - Parent element
   * @returns {NodeList}
   */
  function $$$(selector, parent) {
    return (parent || document).querySelectorAll(selector);
  }

  // ==========================================
  // Navigation
  // ==========================================

  /**
   * Initialize mobile navigation
   */
  function initNavigation() {
    var toggle = document.querySelector('.mobile-menu-toggle');
    var sidebar = document.querySelector('.sidebar');

    if (toggle && sidebar) {
      toggle.addEventListener('click', function() {
        sidebar.classList.toggle('open');
      });

      // Close on outside click
      document.addEventListener('click', function(e) {
        if (sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !toggle.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      });
    }

    // Mark current page as active
    var currentPath = window.location.pathname;
    var navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(function(link) {
      var href = link.getAttribute('href');
      if (href && (currentPath.endsWith(href) ||
          (href === 'index.html' && (currentPath.endsWith('/admin/') || currentPath.endsWith('/admin'))))) {
        link.classList.add('active');
      }
    });
  }

  // ==========================================
  // Icons (inline SVG)
  // ==========================================

  var icons = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    domains: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    sw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    metrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
  };

  /**
   * Get icon SVG
   * @param {string} name - Icon name
   * @returns {string}
   */
  function getIcon(name) {
    return icons[name] || '';
  }

  // ==========================================
  // Export
  // ==========================================

  global.RevampUI = {
    showToast: showToast,
    showModal: showModal,
    closeModal: closeModal,
    confirm: confirm,
    showLoading: showLoading,
    hideLoading: hideLoading,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    formatNumber: formatNumber,
    formatPercent: formatPercent,
    debounce: debounce,
    $: $,
    $$: $$,
    $$$: $$$,
    initNavigation: initNavigation,
    getIcon: getIcon,
    icons: icons
  };

  // Auto-init navigation on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation);
  } else {
    initNavigation();
  }

})(typeof window !== 'undefined' ? window : this);
