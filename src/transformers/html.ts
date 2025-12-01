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
import { getConfig, type RevampConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { buildPolyfillScript, getErrorOverlayScript, getConfigOverlayScript, userAgentPolyfill } from './polyfills/index.js';
import { bundleEsModule, bundleInlineModule, getModuleShimScript, isModuleScript, parseImportMap } from './esm-bundler.js';
import type { ImportMap } from './esm-bundler.js';

// =============================================================================
// Types
// =============================================================================

/** Script element with its content for transformation */
interface InlineScript {
  elem: Element;
  content: string;
}

/** Module script element (external or inline) */
interface ModuleScript {
  elem: Element;
  src?: string;
  content?: string;
}

/** Result of HTML transformation */
interface TransformResult {
  removedAds: number;
  removedTracking: number;
  bundledModules: number;
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

/**
 * Patterns for scripts that cause syntax errors on old Safari and should be removed.
 * These scripts are incompatible with Safari 9 and we provide our own polyfills instead.
 */
const INCOMPATIBLE_SCRIPT_PATTERNS: readonly RegExp[] = [
  // /custom-elements-es5-adapter/i,  // YouTube's adapter causes syntax errors
  // /webcomponents-bundle/i,         // Web components bundle may have incompatible syntax
  // /webcomponents-loader/i,         // Web components loader
  // /@webcomponents/i,               // @webcomponents packages
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

/** Patterns that indicate React Server Component (RSC) / Next.js data payloads */
const RSC_PAYLOAD_PATTERNS: readonly RegExp[] = [
  /self\.__next_f\.push/,           // Next.js RSC payload
  /self\.__next_s\.push/,           // Next.js streaming
  /self\.__next_c\.push/,           // Next.js chunks
  /\(\s*self\s*\.\s*__next/,        // Variations with parentheses
  /\["?\$"?,\s*"[^"]+"/,            // RSC wire format ["$","tag",...] at start
  /^\s*\d+:["\[]/,                  // RSC line format like "1a:[" or '0:"'
  /\$R[CSX]\s*\(/,                  // React component boundary markers $RC, $RS, $RX
];

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
 * Check if a script is incompatible with old Safari and should be removed.
 * These scripts cause syntax errors and we provide our own polyfills instead.
 */
function isIncompatibleScript(src: string | undefined, content: string): boolean {
  return matchesAnyPattern(src, content, INCOMPATIBLE_SCRIPT_PATTERNS);
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

/**
 * Check if script content is a React Server Component (RSC) or Next.js data payload.
 * These scripts contain JSON data strings that should not be transformed.
 */
function isRscPayload(content: string): boolean {
  return RSC_PAYLOAD_PATTERNS.some(pattern => pattern.test(content));
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
 * Remove Content-Security-Policy meta tags.
 * Required because we inject inline scripts/polyfills that would be blocked by CSP.
 */
function removeCspMetaTags($: CheerioAPI): void {
  // Remove CSP meta tags (case-insensitive check for http-equiv)
  $('meta').each((_, elem) => {
    const httpEquiv = $(elem).attr('http-equiv')?.toLowerCase();
    if (
      httpEquiv === 'content-security-policy' ||
      httpEquiv === 'x-content-security-policy' ||
      httpEquiv === 'x-webkit-csp'
    ) {
      $(elem).remove();
    }
  });
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

    // Remove scripts that cause syntax errors on old Safari
    // We provide our own polyfills for these features
    if (isIncompatibleScript(src, content)) {
      console.log(`[Revamp] Removed incompatible script: ${src || '(inline)'}`);
      $script.remove();
      return;
    }
  });

  return { removedAds, removedTracking, bundledModules: 0 };
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

    // Skip React Server Component (RSC) / Next.js data payloads
    if (isRscPayload(content)) {
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
 * Collect ES module scripts (both external and inline).
 */
function collectModuleScripts($: CheerioAPI): ModuleScript[] {
  const modules: ModuleScript[] = [];

  $('script[type="module"]').each((_, elem) => {
    const $script = $(elem);
    const src = $script.attr('src');
    const content = $script.html() || '';

    modules.push({
      elem,
      src: src || undefined,
      content: content.trim() || undefined,
    });
  });

  return modules;
}

/**
 * Extract import map from the HTML document if present.
 */
function extractImportMap($: CheerioAPI): ImportMap | undefined {
  let importMap: ImportMap | undefined;

  $('script[type="importmap"]').each((_, elem) => {
    const content = $(elem).html();
    if (content) {
      const parsed = parseImportMap(content);
      if (parsed) {
        // Merge multiple import maps (later ones override)
        if (importMap) {
          importMap = {
            imports: { ...importMap.imports, ...parsed.imports },
            scopes: { ...importMap.scopes, ...parsed.scopes },
          };
        } else {
          importMap = parsed;
        }
      }
    }
  });

  return importMap;
}

/**
 * Transform ES module scripts by bundling them for legacy browsers.
 * Converts module scripts to regular scripts with bundled code.
 */
async function transformModuleScripts(
  $: CheerioAPI,
  url: string | undefined,
  config: RevampConfig
): Promise<number> {
  // Check if ES module bundling is enabled
  if (!config.bundleEsModules) {
    return 0;
  }

  const moduleScripts = collectModuleScripts($);

  if (moduleScripts.length === 0) {
    return 0;
  }

  // Extract import map before processing modules
  const importMap = extractImportMap($);
  if (importMap) {
    console.log(`📦 Found import map with ${Object.keys(importMap.imports || {}).length} imports`);
  }

  console.log(`📦 Found ${moduleScripts.length} ES module script(s) to bundle`);

  // Inject module shim before any module processing
  const firstModule = $(moduleScripts[0].elem);
  firstModule.before(getModuleShimScript());

  let bundledCount = 0;

  for (const { elem, src, content } of moduleScripts) {
    const $script = $(elem);

    try {
      let bundleResult;

      if (src) {
        // External module - resolve URL and bundle
        const moduleUrl = new URL(src, url || 'http://localhost').href;
        console.log(`📦 Bundling external module: ${moduleUrl}`);
        bundleResult = await bundleEsModule(moduleUrl, undefined, importMap);
      } else if (content) {
        // Inline module - bundle with base URL for resolving imports
        const baseUrl = url || 'http://localhost/inline-module.js';
        console.log(`📦 Bundling inline module from: ${baseUrl}`);
        bundleResult = await bundleInlineModule(content, baseUrl, importMap);
      } else {
        // Empty module script - remove it
        $script.remove();
        continue;
      }

      // Replace module script with bundled IIFE
      $script.removeAttr('type');
      $script.removeAttr('src');
      $script.html(bundleResult.code);

      if (bundleResult.success) {
        bundledCount++;
        if (bundleResult.bundledModules.length > 0) {
          console.log(`✅ Bundled ${bundleResult.bundledModules.length} module(s) for: ${src || 'inline'}`);
        }
      } else {
        console.warn(`⚠️ Module bundling failed for ${src || 'inline'}: ${bundleResult.error}`);
      }
    } catch (err) {
      console.error(`❌ Failed to bundle module ${src || 'inline'}: ${err instanceof Error ? err.message : err}`);
      // Remove the failing module script to prevent errors
      $script.remove();
    }
  }

  return bundledCount;
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
 * For critical scripts like polyfills, use injectBeforeAllScripts instead.
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
 * Inject polyfills before the very first script in the document.
 * This ensures polyfills are available before ANY script executes.
 */
function injectBeforeAllScripts($: CheerioAPI, content: string): void {
  // Find the very first script tag in the entire document
  const firstScript = $('script').first();

  if (firstScript.length > 0) {
    // Insert before the first script tag anywhere in the document
    firstScript.before(content);
  } else {
    // No scripts found, prepend to head or root
    const head = $('head');
    if (head.length > 0) {
      head.prepend(content);
    } else {
      $.root().prepend(content);
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
  spoofUserAgentInJs: boolean,
  emulateServiceWorkers: boolean = true
): void {
  if (injectPolyfills) {
    // CRITICAL: Polyfills MUST be injected before ANY other script in the document
    // This ensures Object.fromEntries, Array.from, etc. are available
    injectBeforeAllScripts($, buildPolyfillScript({
      emulateServiceWorkers,
      debug: false, // Could be made configurable in the future
    }));

    // User-agent spoof right after polyfills
    if (spoofUserAgentInJs) {
      injectIntoHead($, buildUserAgentSpoofScript());
    }

    // Error overlay after polyfills
    injectIntoHead($, getErrorOverlayScript());
  }

  // Config overlay comes last (append to head)
  injectIntoHead($, getConfigOverlayScript(), false);
}

/**
 * Add a comment showing transformation statistics.
 */
function addTransformComment($: CheerioAPI, result: TransformResult): void {
  let comment = `<!-- Revamp Proxy: Removed ${result.removedAds} ad scripts, ${result.removedTracking} tracking scripts`;
  if (result.bundledModules > 0) {
    comment += `, bundled ${result.bundledModules} ES modules`;
  }
  comment += ' -->';
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
 * @param config - Optional config override (uses getConfig() if not provided)
 * @returns Transformed HTML string
 */
export async function transformHtml(html: string, url?: string, config?: RevampConfig): Promise<string> {
  const effectiveConfig = config || getConfig();

  if (!effectiveConfig.transformHtml) {
    return html;
  }

  try {
    const $ = cheerio.load(html, { xml: false });

    // Remove integrity attributes (required for transformed content)
    removeIntegrityAttributes($);

    // Remove CSP meta tags (required for injected inline scripts)
    removeCspMetaTags($);

    // Process and remove ad/tracking scripts
    const result = processScripts($, effectiveConfig.removeAds, effectiveConfig.removeTracking);

    // Transform inline scripts for legacy browsers
    if (effectiveConfig.transformJs) {
      await transformInlineScripts($, url);
    }

    // Bundle ES modules for legacy browsers
    if (effectiveConfig.bundleEsModules) {
      result.bundledModules = await transformModuleScripts($, url, effectiveConfig);
    }

    // Remove ad containers
    if (effectiveConfig.removeAds) {
      removeAdContainers($);
    }

    // Remove tracking pixels
    if (effectiveConfig.removeTracking) {
      removeTrackingPixels($);
    }

    // Normalize charset to UTF-8
    normalizeCharset($);

    // Inject Revamp scripts
    injectRevampScripts($, effectiveConfig.injectPolyfills, effectiveConfig.spoofUserAgentInJs, effectiveConfig.emulateServiceWorkers);

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
