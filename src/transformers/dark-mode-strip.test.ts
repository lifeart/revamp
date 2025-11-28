import { describe, it, expect } from 'vitest';
import {
  stripDarkMode,
  hasDarkModeQueries,
  stripColorSchemeProperty,
  stripAllDarkModeCSS,
} from './dark-mode-strip.js';

describe('hasDarkModeQueries', () => {
  it('should detect prefers-color-scheme media query', () => {
    expect(hasDarkModeQueries('@media (prefers-color-scheme: dark) { body { color: white; } }')).toBe(true);
    expect(hasDarkModeQueries('@media (prefers-color-scheme: light) { body { color: black; } }')).toBe(true);
    expect(hasDarkModeQueries('@media (PREFERS-COLOR-SCHEME: dark) {}')).toBe(true);
  });

  it('should return false for CSS without color scheme queries', () => {
    expect(hasDarkModeQueries('.box { color: red; }')).toBe(false);
    expect(hasDarkModeQueries('@media (max-width: 768px) {}')).toBe(false);
    expect(hasDarkModeQueries('@media screen {}')).toBe(false);
  });
});

describe('stripDarkMode', () => {
  it('should remove dark mode media query and keep light mode styles', () => {
    const css = `
      .box { color: black; }
      @media (prefers-color-scheme: dark) {
        .box { color: white; }
      }
      @media (prefers-color-scheme: light) {
        .box { color: gray; }
      }
    `;
    const result = stripDarkMode(css, { keepScheme: 'light', extractPreferredStyles: true });
    expect(result).toContain('color: black');
    expect(result).toContain('color: gray'); // Light mode extracted
    // The @media rule should be removed (not just the comment)
    expect(result).not.toContain('@media');
  });

  it('should remove light mode media query and keep dark mode styles', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        .box { color: white; }
      }
      @media (prefers-color-scheme: light) {
        .box { color: black; }
      }
    `;
    const result = stripDarkMode(css, { keepScheme: 'dark', extractPreferredStyles: true });
    expect(result).toContain('color: white'); // Dark mode extracted
    expect(result).not.toContain('@media');
  });

  it('should remove all color scheme queries when keepScheme is none', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        .box { color: white; }
      }
      @media (prefers-color-scheme: light) {
        .box { color: black; }
      }
    `;
    const result = stripDarkMode(css, { keepScheme: 'none' });
    expect(result).not.toContain('color: white');
    expect(result).not.toContain('color: black');
    expect(result).not.toContain('prefers-color-scheme');
  });

  it('should keep media query content when extractPreferredStyles is false', () => {
    const css = `
      @media (prefers-color-scheme: light) {
        .box { color: gray; }
      }
    `;
    // With extractPreferredStyles: false, we just remove the query without extracting
    const result = stripDarkMode(css, { keepScheme: 'light', extractPreferredStyles: false });
    // Media query removed but styles not extracted
    expect(result).not.toContain('prefers-color-scheme');
    expect(result.trim()).toBe('');
  });

  it('should use default options', () => {
    const css = `
      @media (prefers-color-scheme: light) {
        .box { color: black; }
      }
    `;
    const result = stripDarkMode(css);
    // Default: keepScheme = 'light', extractPreferredStyles = true
    expect(result).toContain('color: black');
    expect(result).not.toContain('@media');
  });

  it('should preserve non-color-scheme media queries', () => {
    const css = `
      @media (max-width: 768px) {
        .box { font-size: 14px; }
      }
      @media (prefers-color-scheme: dark) {
        .box { color: white; }
      }
    `;
    const result = stripDarkMode(css, { keepScheme: 'light' });
    expect(result).toContain('max-width: 768px');
    expect(result).toContain('font-size: 14px');
    expect(result).not.toContain('prefers-color-scheme');
  });

  it('should add comment when extracting styles', () => {
    const css = `
      @media (prefers-color-scheme: light) {
        .box { color: black; }
      }
    `;
    const result = stripDarkMode(css, { keepScheme: 'light', extractPreferredStyles: true });
    expect(result).toContain('Revamp');
    expect(result).toContain('Extracted');
  });
});

describe('stripColorSchemeProperty', () => {
  it('should remove color-scheme property', () => {
    const css = `
      :root {
        color-scheme: light dark;
      }
      body {
        color: black;
      }
    `;
    const result = stripColorSchemeProperty(css);
    expect(result).not.toContain('color-scheme');
    expect(result).toContain('color: black');
  });

  it('should preserve other properties', () => {
    const css = `
      :root {
        color-scheme: light;
        --primary: blue;
      }
    `;
    const result = stripColorSchemeProperty(css);
    expect(result).not.toContain('color-scheme');
    expect(result).toContain('--primary: blue');
  });

  it('should handle CSS without color-scheme', () => {
    const css = '.box { color: red; }';
    const result = stripColorSchemeProperty(css);
    expect(result).toContain('color: red');
  });
});

describe('stripAllDarkModeCSS', () => {
  it('should strip both media queries and color-scheme property', () => {
    const css = `
      :root {
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        body { background: black; }
      }
      @media (prefers-color-scheme: light) {
        body { background: white; }
      }
    `;
    const result = stripAllDarkModeCSS(css, { keepScheme: 'light' });
    // Check that color-scheme property was removed (not in :root rule)
    expect(result).not.toMatch(/color-scheme:\s*light\s*dark/);
    // The @media query should be gone
    expect(result).not.toContain('@media');
    expect(result).toContain('background: white');
  });

  it('should use default options', () => {
    const css = `
      :root { color-scheme: light dark; }
      @media (prefers-color-scheme: light) {
        .box { color: black; }
      }
    `;
    const result = stripAllDarkModeCSS(css);
    // Check property is removed from :root
    expect(result).not.toMatch(/color-scheme:\s*light\s*dark/);
    expect(result).toContain('color: black');
  });

  it('should handle CSS without dark mode features', () => {
    const css = '.box { color: red; margin: 10px; }';
    const result = stripAllDarkModeCSS(css);
    expect(result).toContain('color: red');
    expect(result).toContain('margin: 10px');
  });
});
