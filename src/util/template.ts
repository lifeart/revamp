/**
 * Minimal HTML template loader + renderer.
 *
 * Templates live next to the modules that use them (e.g.
 * `src/portal/templates/*.html`) and are resolved with
 * `new URL('./templates/x.html', import.meta.url)` so the same code works
 * under tsx (running from `src/`) and from the compiled `dist/` output
 * (the build script copies the template directories into `dist`).
 *
 * Placeholder syntax:
 *   - `{{name}}`   — value is HTML-escaped before insertion (safe default
 *                    for plain-text values: IPs, ports, counters, labels).
 *   - `{{{name}}}` — value is inserted verbatim (for pre-rendered HTML
 *                    fragments; the caller owns its safety).
 *
 * Missing variables throw — a template/var mismatch is a programming error
 * and silently leaving `{{name}}` in served HTML would mask it.
 */

import { readFileSync } from 'node:fs';

/** Loaded templates, keyed by URL href. Read once per process. */
const templateCache = new Map<string, string>();

/**
 * Read a template file (once — subsequent calls hit an in-memory cache).
 */
export function loadTemplate(url: URL): string {
  const key = url.href;
  const cached = templateCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(url, 'utf-8');
  templateCache.set(key, content);
  return content;
}

/**
 * Escape a string for safe insertion into HTML text or attribute values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type TemplateVars = Record<string, string | number>;

/**
 * Substitute `{{name}}` (escaped) and `{{{name}}}` (raw) placeholders.
 * Replacement values are produced by a callback, so `$`-sequences in values
 * are never interpreted by `String.prototype.replace`.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(
    /\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g,
    (_match, rawName: string | undefined, escapedName: string | undefined) => {
      const name = rawName ?? escapedName ?? '';
      const value = vars[name];
      if (value === undefined) {
        throw new Error(`renderTemplate: missing variable "${name}"`);
      }
      const str = String(value);
      return rawName !== undefined ? str : escapeHtml(str);
    }
  );
}
