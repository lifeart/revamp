/**
 * User-Agent override polyfill
 * Spoofs navigator.userAgent to simulate a modern browser
 */

export const userAgentPolyfill = `
(function() {
  'use strict';
  
  var modernUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var modernAppVersion = '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var modernPlatform = 'MacIntel';
  var modernVendor = 'Google Inc.';
  
  // Store original values
  var originalUserAgent = navigator.userAgent;
  var originalAppVersion = navigator.appVersion;
  var originalPlatform = navigator.platform;
  var originalVendor = navigator.vendor;
  
  // Override navigator properties
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: function() { return modernUserAgent; },
      configurable: true
    });
  } catch (e) {
    // Fallback for older browsers that don't support defineProperty on navigator
  }
  
  try {
    Object.defineProperty(navigator, 'appVersion', {
      get: function() { return modernAppVersion; },
      configurable: true
    });
  } catch (e) {}
  
  try {
    Object.defineProperty(navigator, 'platform', {
      get: function() { return modernPlatform; },
      configurable: true
    });
  } catch (e) {}
  
  try {
    Object.defineProperty(navigator, 'vendor', {
      get: function() { return modernVendor; },
      configurable: true
    });
  } catch (e) {}
  
  // Override userAgentData if it exists (modern Chrome feature)
  try {
    if (!navigator.userAgentData) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: function() {
          return {
            brands: [
              { brand: 'Not_A Brand', version: '8' },
              { brand: 'Chromium', version: '120' },
              { brand: 'Google Chrome', version: '120' }
            ],
            mobile: false,
            platform: 'macOS',
            getHighEntropyValues: function(hints) {
              return Promise.resolve({
                brands: this.brands,
                mobile: this.mobile,
                platform: this.platform,
                platformVersion: '10.15.7',
                architecture: 'x86',
                bitness: '64',
                model: '',
                uaFullVersion: '120.0.0.0',
                fullVersionList: this.brands
              });
            }
          };
        },
        configurable: true
      });
    }
  } catch (e) {}
  
  // Store original for debugging if needed
  window.__revamp_originalUserAgent = originalUserAgent;
  window.__revamp_originalAppVersion = originalAppVersion;
  window.__revamp_originalPlatform = originalPlatform;
  window.__revamp_originalVendor = originalVendor;
  
  console.log('[Revamp] User-Agent spoofed to Chrome 120');
})();
`;
