/**
 * HTML Transformer
 * Removes ads, tracking scripts, and injects polyfills
 */

import * as cheerio from 'cheerio';
import { getConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { buildPolyfillScript, getErrorOverlayScript, userAgentPolyfill } from './polyfills/index.js';

/**
 * Common ad/tracking script patterns
 */
const AD_SCRIPT_PATTERNS = [
  /atob/i,
  /ads\//i,
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
  /watch_serp\.js/i,
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
    
    // Remove integrity attributes from scripts and links since we transform content
    // (transformed content won't match the original hash)
    $('script[integrity]').removeAttr('integrity');
    $('link[integrity]').removeAttr('integrity');
    
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
    
    // Transform inline scripts with Babel for legacy browser compatibility
    if (config.transformJs) {
      const inlineScripts: Array<{ elem: ReturnType<typeof $>[number]; content: string }> = [];
      
      $('script').each((_, elem) => {
        const $script = $(elem);
        const src = $script.attr('src');
        const type = $script.attr('type') || '';
        const content = $script.html() || '';
        
        // Only transform inline scripts (no src) with JavaScript content
        // Skip JSON, templates, and other non-JS types
        if (!src && content.trim() && 
            !type.includes('json') && 
            !type.includes('template') &&
            !type.includes('text/html') &&
            !type.includes('x-template') &&
            type !== 'module') { // Skip ES modules as they may have import/export
          inlineScripts.push({ elem, content });
        }
      });
      
      // Transform each inline script
      for (const { elem, content } of inlineScripts) {
        try {
          // Skip our own polyfill/error overlay scripts
          if (content.includes('[Revamp]') || content.includes('revamp-error')) {
            continue;
          }
          
          const transformed = await transformJs(content, url ? `${url}#inline` : 'inline.js');
          $(elem).html(transformed);
        } catch (err) {
          // If transformation fails, leave the original script
          console.error(`⚠️ Failed to transform inline script: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    
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
      const polyfillScript = buildPolyfillScript();
      const errorOverlayScript = getErrorOverlayScript();
      
      // Conditionally build user-agent spoof script
      let userAgentScript = '';
      if (config.spoofUserAgentInJs) {
        userAgentScript = `
<!-- Revamp User-Agent Spoof -->
<script>
(function() {
${userAgentPolyfill}
})();
</script>
`;
      }
      
      const head = $('head');
      if (head.length > 0) {
        head.prepend(errorOverlayScript);
        head.prepend(polyfillScript);
        if (userAgentScript) {
          // User-agent spoof should run first, before any other scripts
          head.prepend(userAgentScript);
        }
      } else {
        // No head tag, try to add at the beginning
        $.root().prepend(errorOverlayScript);
        $.root().prepend(polyfillScript);
        if (userAgentScript) {
          $.root().prepend(userAgentScript);
        }
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
