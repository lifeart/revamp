/**
 * HTML Transformer
 *
 * Transforms HTML content for legacy browser compatibility:
 * - Removes ad scripts and containers
 * - Removes tracking scripts and pixels
 * - Transforms inline JavaScript for legacy browsers
 * - Injects polyfills and compatibility scripts
 * - Normalizes charset to UTF-8
 *
 * @module transformers/html
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { getConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { buildPolyfillScript, getErrorOverlayScript, getConfigOverlayScript, userAgentPolyfill } from './polyfills/index.js';

// =============================================================================
// Types
// =============================================================================

/** Script element with its content for transformation */
interface InlineScript {
  elem: Element;
  content: string;
}

/** Result of HTML transformation */
interface TransformResult {
  removedAds: number;
  removedTracking: number;
}

// =============================================================================
// Ad Detection Patterns
// =============================================================================

/**
 * Patterns that identify ad-related scripts.
 * Matches against both script src URLs and inline content.
 */
const AD_SCRIPT_PATTERNS: readonly RegExp[] = [
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

/**
 * CSS selectors for ad container elements.
 *
 * IMPORTANT: Uses boundary-aware selectors (^, $, ~) to avoid false positives.
 * For example, [class^="ad-"] matches "ad-banner" but NOT "download-btn".
 */
const AD_CONTAINER_SELECTORS: readonly string[] = [
  // Class-based selectors with word boundaries
  '[class^="ad-"]',           // Class starts with "ad-"
  '[class$="-ad"]',           // Class ends with "-ad"
  '[class~="ad"]',            // Class contains word "ad" (space-separated)
  '[class^="ads-"]',          // Class starts with "ads-"
  '[class$="-ads"]',          // Class ends with "-ads"
  '[class~="ads"]',           // Class contains word "ads" (space-separated)

  // Specific ad-related class names
  '.advertisement',
  '.ad-container',
  '.ad-wrapper',
  '.ad-banner',
  '.ad-unit',
  '.advert',

  // ID-based selectors
  '[id*="google_ads"]',
  '[id*="ad-container"]',
  '[id*="ad_container"]',
  '[id^="ad-"]',              // ID starts with "ad-"
  '[id$="-ad"]',              // ID ends with "-ad"

  // Ad network specific
  'ins.adsbygoogle',

  // Data attribute selectors
  '[data-ad]',
  '[data-ad-slot]',
  '[data-ad-client]',
];

// =============================================================================
// Tracking Detection Patterns
// =============================================================================

/**
 * Patterns that identify tracking/analytics scripts.
 * Matches against both script src URLs and inline content.
 */
const TRACKING_SCRIPT_PATTERNS: readonly RegExp[] = [
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

/**
 * CSS selectors for tracking pixel elements (images and iframes).
 */
const TRACKING_PIXEL_SELECTORS: readonly string[] = [
  'img[width="1"][height="1"]',
  'img[src*="pixel"]',
  'img[src*="beacon"]',
  'iframe[width="0"]',
  'iframe[height="0"]',
  'iframe[style*="display:none"]',
  'iframe[style*="display: none"]',
  'noscript img',
];

// =============================================================================
// Script Type Detection
// =============================================================================

/** Script types that should not be transformed (contain data, not executable JS) */
const NON_TRANSFORMABLE_SCRIPT_TYPES: readonly string[] = [
  'json',
  'template',
  'text/html',
  'x-template',
];

/** Markers that identify Revamp's own injected scripts */
const REVAMP_SCRIPT_MARKERS: readonly string[] = [
  '[Revamp]',
  'revamp-error',
];

/** Regex to detect HTML template content in script tags */
const HTML_TEMPLATE_START_PATTERN = /^<[a-zA-Z]/;

/** Regex to count HTML tags */
const HTML_TAG_PATTERN = /<[a-zA-Z][^>]*>/g;

/** Regex to count JavaScript keywords */
const JS_KEYWORD_PATTERN = /\b(function|var|let|const|if|else|for|while|return|this)\b/g;

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if a script is ad-related based on its src URL or content.
 */
function isAdScript(src: string | undefined, content: string): boolean {
  return matchesAnyPattern(src, content, AD_SCRIPT_PATTERNS);
}

/**
 * Check if a script is tracking-related based on its src URL or content.
 */
function isTrackingScript(src: string | undefined, content: string): boolean {
  return matchesAnyPattern(src, content, TRACKING_SCRIPT_PATTERNS);
}

/**
 * Check if src or content matches any of the given patterns.
 */
function matchesAnyPattern(
  src: string | undefined,
  content: string,
  patterns: readonly RegExp[]
): boolean {
  const srcMatches = src ? patterns.some(p => p.test(src)) : false;
  const contentMatches = patterns.some(p => p.test(content));
  return srcMatches || contentMatches;
}

/**
 * Check if a script type indicates non-transformable content.
 */
function isNonTransformableScriptType(type: string): boolean {
  return NON_TRANSFORMABLE_SCRIPT_TYPES.some(t => type.includes(t));
}

/**
 * Check if script content is a Revamp-injected script.
 */
function isRevampScript(content: string): boolean {
  return REVAMP_SCRIPT_MARKERS.some(marker => content.includes(marker));
}

/**
 * Check if script content looks like an HTML template rather than JavaScript.
 */
function isHtmlTemplateContent(content: string): boolean {
  const trimmed = content.trim();

  // Check if content starts with an HTML tag
  if (HTML_TEMPLATE_START_PATTERN.test(trimmed)) {
    return true;
  }

  // Check if content has more HTML tags than JS keywords
  const htmlTagCount = (content.match(HTML_TAG_PATTERN) || []).length;
  const jsKeywordCount = (content.match(JS_KEYWORD_PATTERN) || []).length;

  return htmlTagCount > 3 && htmlTagCount > jsKeywordCount;
}

// =============================================================================
// DOM Manipulation Functions
// =============================================================================

/**
 * Remove integrity attributes from scripts and links.
 * Required because transformed content won't match original hashes.
 */
function removeIntegrityAttributes($: CheerioAPI): void {
  $('script[integrity]').removeAttr('integrity');
  $('link[integrity]').removeAttr('integrity');
}

/**
 * Process and optionally remove ad/tracking scripts.
 * Returns count of removed scripts.
 */
function processScripts(
  $: CheerioAPI,
  removeAds: boolean,
  removeTracking: boolean
): TransformResult {
  let removedAds = 0;
  let removedTracking = 0;

  $('script').each((_, elem) => {
    const $script = $(elem);
    const src = $script.attr('src') || '';
    const content = $script.html() || '';
    const type = $script.attr('type') || '';

    // Skip JSON data scripts
    if (type.includes('json')) {
      return;
    }

    // Remove ad scripts
    if (removeAds && isAdScript(src, content)) {
      $script.remove();
      removedAds++;
      return;
    }

    // Remove tracking scripts
    if (removeTracking && isTrackingScript(src, content)) {
      $script.remove();
      removedTracking++;
      return;
    }
  });

  return { removedAds, removedTracking };
}

/**
 * Collect inline scripts that should be transformed.
 */
function collectInlineScripts($: CheerioAPI): InlineScript[] {
  const scripts: InlineScript[] = [];

  $('script').each((_, elem) => {
    const $script = $(elem);
    const src = $script.attr('src');
    const type = $script.attr('type') || '';
    const content = $script.html() || '';

    // Only transform inline scripts (no src) with JavaScript content
    const isInlineScript = !src && content.trim();
    const isTransformable = !isNonTransformableScriptType(type) && type !== 'module';

    if (isInlineScript && isTransformable) {
      scripts.push({ elem, content });
    }
  });

  return scripts;
}

/**
 * Transform inline scripts for legacy browser compatibility.
 */
async function transformInlineScripts(
  $: CheerioAPI,
  url: string | undefined
): Promise<void> {
  const inlineScripts = collectInlineScripts($);

  for (const { elem, content } of inlineScripts) {
    // Skip Revamp's own scripts
    if (isRevampScript(content)) {
      continue;
    }

    // Skip HTML template content
    if (isHtmlTemplateContent(content)) {
      continue;
    }

    try {
      const transformed = await transformJs(content, url ? `${url}#inline` : 'inline.js');
      $(elem).html(transformed);
    } catch (err) {
      console.error(`⚠️ Failed to transform inline script: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Remove ad container elements.
 */
function removeAdContainers($: CheerioAPI): void {
  for (const selector of AD_CONTAINER_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // Ignore invalid selectors
    }
  }
}

/**
 * Remove tracking pixels and hidden iframes.
 */
function removeTrackingPixels($: CheerioAPI): void {
  for (const selector of TRACKING_PIXEL_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // Ignore invalid selectors
    }
  }
}

/**
 * Normalize charset meta tags to UTF-8.
 */
function normalizeCharset($: CheerioAPI): void {
  $('meta[charset]').attr('charset', 'UTF-8');
  $('meta[http-equiv="Content-Type"]').attr('content', 'text/html; charset=UTF-8');
}

/**
 * Inject script content into the document head (or root if no head).
 */
function injectIntoHead($: CheerioAPI, content: string, prepend = true): void {
  const head = $('head');

  if (head.length > 0) {
    if (prepend) {
      head.prepend(content);
    } else {
      head.append(content);
    }
  } else {
    const root = $.root();
    if (prepend) {
      root.prepend(content);
    } else {
      root.append(content);
    }
  }
}

/**
 * Build and inject user-agent spoof script if enabled.
 */
function buildUserAgentSpoofScript(): string {
  return `
<!-- Revamp User-Agent Spoof -->
<script>
(function() {
${userAgentPolyfill}
})();
</script>
`;
}

/**
 * Inject all Revamp scripts (config overlay, polyfills, error overlay).
 * Order matters: polyfills must run first, then user-agent spoof, then overlays.
 */
function injectRevampScripts(
  $: CheerioAPI,
  injectPolyfills: boolean,
  spoofUserAgentInJs: boolean
): void {
  // Inject in reverse order since we're prepending (last prepend = first in DOM)

  // Config overlay comes last (prepend first = appears last)
  injectIntoHead($, getConfigOverlayScript());

  if (injectPolyfills) {
    // Error overlay after polyfills
    injectIntoHead($, getErrorOverlayScript());

    // User-agent spoof after polyfills but before error overlay
    if (spoofUserAgentInJs) {
      injectIntoHead($, buildUserAgentSpoofScript());
    }

    // Polyfills run first (prepend last = appears first in DOM)
    injectIntoHead($, buildPolyfillScript());
  }
}

/**
 * Add a comment showing transformation statistics.
 */
function addTransformComment($: CheerioAPI, result: TransformResult): void {
  const comment = `<!-- Revamp Proxy: Removed ${result.removedAds} ad scripts, ${result.removedTracking} tracking scripts -->`;
  $('head').append(comment);
}

// =============================================================================
// Main Transform Function
// =============================================================================

/**
 * Transform HTML content for legacy browser compatibility.
 *
 * @param html - The HTML content to transform
 * @param url - Optional URL for context (used in error messages)
 * @returns Transformed HTML string
 */
export async function transformHtml(html: string, url?: string): Promise<string> {
  const config = getConfig();

  if (!config.transformHtml) {
    return html;
  }

  try {
    const $ = cheerio.load(html, { xml: false });

    // Remove integrity attributes (required for transformed content)
    removeIntegrityAttributes($);

    // Process and remove ad/tracking scripts
    const result = processScripts($, config.removeAds, config.removeTracking);

    // Transform inline scripts for legacy browsers
    if (config.transformJs) {
      await transformInlineScripts($, url);
    }

    // Remove ad containers
    if (config.removeAds) {
      removeAdContainers($);
    }

    // Remove tracking pixels
    if (config.removeTracking) {
      removeTrackingPixels($);
    }

    // Normalize charset to UTF-8
    normalizeCharset($);

    // Inject Revamp scripts
    injectRevampScripts($, config.injectPolyfills, config.spoofUserAgentInJs);

    // Add transformation statistics comment
    addTransformComment($, result);

    return $.html();
  } catch (error) {
    console.error('❌ HTML transform error:', error instanceof Error ? error.message : error);
    return html;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if content looks like an HTML document.
 *
 * @param content - Content to check
 * @returns true if content appears to be an HTML document
 */
export function isHtmlDocument(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') ||
         trimmed.startsWith('<html') ||
         /<html[\s>]/i.test(content);
}
