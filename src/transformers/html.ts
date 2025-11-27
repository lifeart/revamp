/**
 * HTML Transformer
 * Removes ads, tracking scripts, and injects polyfills
 */

import * as cheerio from 'cheerio';
import { getConfig } from '../config/index.js';

// Core-js polyfills for iOS 11
const POLYFILL_SCRIPT = `
<!-- Revamp Polyfills for iOS 11 -->
<script>
(function() {
  // Promise.finally polyfill
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function(callback) {
      var P = this.constructor;
      return this.then(
        function(value) { return P.resolve(callback()).then(function() { return value; }); },
        function(reason) { return P.resolve(callback()).then(function() { throw reason; }); }
      );
    };
  }
  
  // Array.prototype.flat polyfill
  if (!Array.prototype.flat) {
    Array.prototype.flat = function(depth) {
      depth = depth === undefined ? 1 : Math.floor(depth);
      if (depth < 1) return Array.prototype.slice.call(this);
      return (function flat(arr, d) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && d > 0) {
            result = result.concat(flat(arr[i], d - 1));
          } else {
            result.push(arr[i]);
          }
        }
        return result;
      })(this, depth);
    };
  }
  
  // Array.prototype.flatMap polyfill
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function(callback, thisArg) {
      return Array.prototype.map.call(this, callback, thisArg).flat();
    };
  }
  
  // Object.fromEntries polyfill
  if (!Object.fromEntries) {
    Object.fromEntries = function(iterable) {
      return Array.from(iterable).reduce(function(obj, entry) {
        obj[entry[0]] = entry[1];
        return obj;
      }, {});
    };
  }
  
  // String.prototype.trimStart/trimEnd polyfill
  if (!String.prototype.trimStart) {
    String.prototype.trimStart = String.prototype.trimLeft || function() {
      return this.replace(/^\\s+/, '');
    };
  }
  if (!String.prototype.trimEnd) {
    String.prototype.trimEnd = String.prototype.trimRight || function() {
      return this.replace(/\\s+$/, '');
    };
  }
  
  // globalThis polyfill
  if (typeof globalThis === 'undefined') {
    (function() {
      if (typeof self !== 'undefined') { self.globalThis = self; }
      else if (typeof window !== 'undefined') { window.globalThis = window; }
      else if (typeof global !== 'undefined') { global.globalThis = global; }
    })();
  }
  
  // Element.prototype.matches polyfill (fallback)
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || 
                                Element.prototype.webkitMatchesSelector;
  }
  
  // Element.prototype.closest polyfill
  if (!Element.prototype.closest) {
    Element.prototype.closest = function(s) {
      var el = this;
      do {
        if (Element.prototype.matches.call(el, s)) return el;
        el = el.parentElement || el.parentNode;
      } while (el !== null && el.nodeType === 1);
      return null;
    };
  }
  
  // NodeList.prototype.forEach polyfill
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  
  console.log('[Revamp] Polyfills loaded for iOS 11 compatibility');
})();
</script>
`;

/**
 * Common ad/tracking script patterns
 */
const AD_SCRIPT_PATTERNS = [
  /atob/i,
  /googletag/i,
  /doubleclick/i,
  /googleadservices/i,
  /googlesyndication/i,
  /adsbygoogle/i,
  /google_ad/i,
  /adsense/i,
  /adnxs\.com/i,
  /amazon-adsystem/i,
  /facebook\.net.*fbevents/i,
  /connect\.facebook\.net/i,
  /platform\.twitter\.com/i,
  /ads\.twitter\.com/i,
];

const TRACKING_SCRIPT_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /metrika\/tag\.js/i,
  /gtag\(/i,
  /gtm\.js/i,
  /analytics\.js/i,
  /hotjar\.com/i,
  /segment\.io/i,
  /segment\.com/i,
  /mixpanel/i,
  /fullstory/i,
  /mouseflow/i,
  /crazyegg/i,
  /clarity\.ms/i,
  /newrelic/i,
  /nr-data\.net/i,
  /sentry\.io/i,
  /bugsnag/i,
  /logrocket/i,
];

function isAdScript(src: string | undefined, content: string): boolean {
  const srcCheck = src ? AD_SCRIPT_PATTERNS.some(p => p.test(src)) : false;
  const contentCheck = AD_SCRIPT_PATTERNS.some(p => p.test(content));
  return srcCheck || contentCheck;
}

function isTrackingScript(src: string | undefined, content: string): boolean {
  const srcCheck = src ? TRACKING_SCRIPT_PATTERNS.some(p => p.test(src)) : false;
  const contentCheck = TRACKING_SCRIPT_PATTERNS.some(p => p.test(content));
  return srcCheck || contentCheck;
}

/**
 * Transform HTML content
 * - Remove ad scripts
 * - Remove tracking scripts
 * - Inject polyfills
 */
export async function transformHtml(html: string, url?: string): Promise<string> {
  const config = getConfig();
  
  if (!config.transformHtml) {
    return html;
  }
  
  try {
    const $ = cheerio.load(html, {
      xml: false,
    });
    
    let removedAds = 0;
    let removedTracking = 0;
    
    // Process all script tags
    $('script').each((_, elem) => {
      const $script = $(elem);
      const src = $script.attr('src') || '';
      const content = $script.html() || '';
      
      // Remove ad scripts
      if (config.removeAds && isAdScript(src, content)) {
        $script.remove();
        removedAds++;
        return;
      }
      
      // Remove tracking scripts
      if (config.removeTracking && isTrackingScript(src, content)) {
        $script.remove();
        removedTracking++;
        return;
      }
    });
    
    // Remove common ad containers
    if (config.removeAds) {
      const adSelectors = [
        '[class*="ad-"]',
        '[class*="-ad"]',
        '[class*="ads-"]',
        '[class*="-ads"]',
        '[id*="google_ads"]',
        '[id*="ad-container"]',
        '[id*="ad_container"]',
        'ins.adsbygoogle',
        '[data-ad]',
        '[data-ad-slot]',
        '[data-ad-client]',
      ];
      
      adSelectors.forEach(selector => {
        try {
          $(selector).remove();
        } catch {
          // Ignore invalid selectors
        }
      });
    }
    
    // Remove tracking pixels (1x1 images, invisible iframes)
    if (config.removeTracking) {
      $('img[width="1"][height="1"]').remove();
      $('img[src*="pixel"]').remove();
      $('img[src*="beacon"]').remove();
      $('iframe[width="0"]').remove();
      $('iframe[height="0"]').remove();
      $('iframe[style*="display:none"]').remove();
      $('iframe[style*="display: none"]').remove();
      $('noscript img').remove(); // Tracking pixels often in noscript
    }
    
    // Normalize charset to UTF-8 (since we decode content to UTF-8 during transformation)
    // Update meta charset tag
    $('meta[charset]').attr('charset', 'UTF-8');
    // Update http-equiv Content-Type meta tag
    $('meta[http-equiv="Content-Type"]').attr('content', 'text/html; charset=UTF-8');
    
    // Inject polyfills at the beginning of <head>
    if (config.injectPolyfills) {
      const head = $('head');
      if (head.length > 0) {
        head.prepend(POLYFILL_SCRIPT);
      } else {
        // No head tag, try to add at the beginning
        $.root().prepend(POLYFILL_SCRIPT);
      }
    }
    
    // Add a comment showing what Revamp did
    const revampComment = `<!-- Revamp Proxy: Removed ${removedAds} ad scripts, ${removedTracking} tracking scripts -->`;
    $('head').append(revampComment);
    
    return $.html();
  } catch (error) {
    console.error('❌ HTML transform error:', error instanceof Error ? error.message : error);
    return html;
  }
}

/**
 * Check if this looks like an HTML document
 */
export function isHtmlDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') || 
         trimmed.startsWith('<html') ||
         /<html[\s>]/i.test(content);
}
