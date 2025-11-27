/**
 * User-Agent override polyfill
 * Spoofs navigator.userAgent to simulate a modern browser
 * Designed to fool browser detection scripts like BrowserDetector
 */

export const userAgentPolyfill = `
(function() {
  'use strict';
  
  // Chrome 120 User-Agent - will pass checks like "Chrome > 70"
  // Format: Mozilla/5.0 (platform) AppleWebKit/version (KHTML, like Gecko) Chrome/version Safari/version
  var modernUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var modernAppVersion = '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var modernPlatform = 'MacIntel';
  var modernVendor = 'Google Inc.';
  var modernAppName = 'Netscape';
  var modernProduct = 'Gecko';
  var modernAppCodeName = 'Mozilla';
  
  // Store original values for debugging
  var originalUserAgent = navigator.userAgent;
  var originalAppVersion = navigator.appVersion;
  var originalPlatform = navigator.platform;
  var originalVendor = navigator.vendor;
  
  // Helper to safely define property
  function safeDefineProperty(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, {
        get: getter,
        configurable: true,
        enumerable: true
      });
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Override navigator properties
  safeDefineProperty(navigator, 'userAgent', function() { return modernUserAgent; });
  safeDefineProperty(navigator, 'appVersion', function() { return modernAppVersion; });
  safeDefineProperty(navigator, 'platform', function() { return modernPlatform; });
  safeDefineProperty(navigator, 'vendor', function() { return modernVendor; });
  safeDefineProperty(navigator, 'appName', function() { return modernAppName; });
  safeDefineProperty(navigator, 'product', function() { return modernProduct; });
  safeDefineProperty(navigator, 'appCodeName', function() { return modernAppCodeName; });
  
  // Override userAgentData (modern Chrome feature for Client Hints)
  if (!navigator.userAgentData) {
    safeDefineProperty(navigator, 'userAgentData', function() {
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
    });
  }
  
  // Store originals for debugging
  window.__revamp_originalUserAgent = originalUserAgent;
  window.__revamp_originalAppVersion = originalAppVersion;
  window.__revamp_originalPlatform = originalPlatform;
  window.__revamp_originalVendor = originalVendor;
  
  console.log('[Revamp] User-Agent spoofed to Chrome 120 (passes browser version checks)');
})();
`;
