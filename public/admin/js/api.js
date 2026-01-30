/**
 * Revamp Admin Panel - API Client
 * ES5 compatible for Safari 9 / iOS 9 support
 */

(function(global) {
  'use strict';

  var BASE_URL = '/__revamp__';

  /**
   * Make an API request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise}
   */
  function request(endpoint, options) {
    options = options || {};
    var url = BASE_URL + endpoint;

    var fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return fetch(url, fetchOptions)
      .then(function(response) {
        return response.json().then(function(data) {
          if (!response.ok) {
            var error = new Error(data.error || 'Request failed');
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
  }

  /**
   * API Client
   */
  var RevampAPI = {
    // ==========================================
    // Metrics
    // ==========================================

    /**
     * Get current metrics
     * @returns {Promise}
     */
    getMetrics: function() {
      return request('/metrics/json');
    },

    // ==========================================
    // Configuration
    // ==========================================

    /**
     * Get current client configuration
     * @returns {Promise}
     */
    getConfig: function() {
      return request('/config');
    },

    /**
     * Update client configuration
     * @param {Object} data - Configuration updates
     * @returns {Promise}
     */
    updateConfig: function(data) {
      return request('/config', {
        method: 'POST',
        body: data
      });
    },

    /**
     * Reset configuration to defaults
     * @returns {Promise}
     */
    resetConfig: function() {
      return request('/config', {
        method: 'DELETE'
      });
    },

    // ==========================================
    // Domain Profiles
    // ==========================================

    /**
     * Get all domain profiles
     * @returns {Promise}
     */
    getDomains: function() {
      return request('/domains');
    },

    /**
     * Create a new domain profile
     * @param {Object} data - Profile data
     * @returns {Promise}
     */
    createDomain: function(data) {
      return request('/domains', {
        method: 'POST',
        body: data
      });
    },

    /**
     * Get a specific domain profile
     * @param {string} id - Profile ID
     * @returns {Promise}
     */
    getDomain: function(id) {
      return request('/domains/' + encodeURIComponent(id));
    },

    /**
     * Update a domain profile
     * @param {string} id - Profile ID
     * @param {Object} data - Profile updates
     * @returns {Promise}
     */
    updateDomain: function(id, data) {
      return request('/domains/' + encodeURIComponent(id), {
        method: 'PUT',
        body: data
      });
    },

    /**
     * Delete a domain profile
     * @param {string} id - Profile ID
     * @returns {Promise}
     */
    deleteDomain: function(id) {
      return request('/domains/' + encodeURIComponent(id), {
        method: 'DELETE'
      });
    },

    /**
     * Test which profile matches a domain
     * @param {string} domain - Domain to test
     * @returns {Promise}
     */
    testDomain: function(domain) {
      return request('/domains/match/' + encodeURIComponent(domain));
    },

    // ==========================================
    // Service Workers
    // ==========================================

    /**
     * Get remote Service Worker status
     * @returns {Promise}
     */
    getSwStatus: function() {
      return request('/sw/remote/status');
    },

    // ==========================================
    // Plugins
    // ==========================================

    /**
     * Get all plugins
     * @returns {Promise}
     */
    getPlugins: function() {
      return request('/plugins');
    },

    /**
     * Get a specific plugin
     * @param {string} id - Plugin ID
     * @returns {Promise}
     */
    getPlugin: function(id) {
      return request('/plugins/' + encodeURIComponent(id));
    },

    /**
     * Discover available plugins
     * @returns {Promise}
     */
    discoverPlugins: function() {
      return request('/plugins/discover');
    },

    /**
     * Load and activate all plugins
     * @returns {Promise}
     */
    loadAllPlugins: function() {
      return request('/plugins/load-all', {
        method: 'POST'
      });
    },

    /**
     * Activate a plugin
     * @param {string} id - Plugin ID
     * @returns {Promise}
     */
    activatePlugin: function(id) {
      return request('/plugins/' + encodeURIComponent(id) + '/activate', {
        method: 'POST'
      });
    },

    /**
     * Deactivate a plugin
     * @param {string} id - Plugin ID
     * @returns {Promise}
     */
    deactivatePlugin: function(id) {
      return request('/plugins/' + encodeURIComponent(id) + '/deactivate', {
        method: 'POST'
      });
    },

    /**
     * Reload a plugin
     * @param {string} id - Plugin ID
     * @returns {Promise}
     */
    reloadPlugin: function(id) {
      return request('/plugins/' + encodeURIComponent(id) + '/reload', {
        method: 'POST'
      });
    },

    /**
     * Update plugin configuration
     * @param {string} id - Plugin ID
     * @param {Object} config - New configuration
     * @returns {Promise}
     */
    updatePluginConfig: function(id, config) {
      return request('/plugins/' + encodeURIComponent(id) + '/config', {
        method: 'PUT',
        body: config
      });
    },

    /**
     * Unload a plugin
     * @param {string} id - Plugin ID
     * @returns {Promise}
     */
    unloadPlugin: function(id) {
      return request('/plugins/' + encodeURIComponent(id), {
        method: 'DELETE'
      });
    }
  };

  // Export to global scope
  global.RevampAPI = RevampAPI;

})(typeof window !== 'undefined' ? window : this);
