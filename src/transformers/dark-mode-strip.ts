/**
 * Dark Mode CSS Stripping
 * Removes prefers-color-scheme media queries for legacy browsers
 */

import postcss, { Root, AtRule, Rule } from 'postcss';

/**
 * Options for dark mode stripping
 */
export interface DarkModeStripOptions {
  /**
   * Which color scheme to keep: 'light' keeps light mode styles,
   * 'dark' keeps dark mode styles, 'none' removes all color scheme queries
   */
  keepScheme?: 'light' | 'dark' | 'none';

  /**
   * Whether to keep the styles from the preferred scheme
   * without the media query wrapper
   */
  extractPreferredStyles?: boolean;
}

/**
 * Remove or transform prefers-color-scheme media queries
 */
export function stripDarkMode(css: string, options: DarkModeStripOptions = {}): string {
  const { keepScheme = 'light', extractPreferredStyles = true } = options;

  const root = postcss.parse(css);
  const extractedRules: Rule[] = [];

  root.walkAtRules('media', (atRule: AtRule) => {
    const params = atRule.params.toLowerCase();

    // Check if this is a color scheme media query
    if (!params.includes('prefers-color-scheme')) {
      return;
    }

    const isLightMode = params.includes('light');
    const isDarkMode = params.includes('dark');

    // Handle based on options
    if (keepScheme === 'none') {
      // Remove all color scheme media queries
      atRule.remove();
      return;
    }

    const shouldKeep = (keepScheme === 'light' && isLightMode) ||
                       (keepScheme === 'dark' && isDarkMode);

    if (shouldKeep && extractPreferredStyles) {
      // Extract the styles without the media query wrapper
      atRule.walkRules((rule: Rule) => {
        extractedRules.push(rule.clone());
      });
    }

    // Remove the media query
    atRule.remove();
  });

  // Append extracted rules at the end
  if (extractedRules.length > 0) {
    root.append(postcss.comment({ text: ' Revamp: Extracted from prefers-color-scheme media query ' }));
    extractedRules.forEach(rule => {
      root.append(rule);
    });
  }

  return root.toString();
}

/**
 * Check if CSS contains prefers-color-scheme media queries
 */
export function hasDarkModeQueries(css: string): boolean {
  return /prefers-color-scheme/i.test(css);
}

/**
 * Remove color-scheme property which isn't supported in older browsers
 */
export function stripColorSchemeProperty(css: string): string {
  const root = postcss.parse(css);

  root.walkDecls('color-scheme', (decl) => {
    decl.remove();
  });

  return root.toString();
}

/**
 * Combined function to strip all dark mode related CSS
 */
export function stripAllDarkModeCSS(css: string, options: DarkModeStripOptions = {}): string {
  let result = css;

  // Strip prefers-color-scheme media queries
  if (hasDarkModeQueries(result)) {
    result = stripDarkMode(result, options);
  }

  // Strip color-scheme property
  result = stripColorSchemeProperty(result);

  return result;
}
