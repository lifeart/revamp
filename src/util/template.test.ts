/**
 * Template Util Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTemplate, renderTemplate, escapeHtml } from './template.js';

describe('renderTemplate', () => {
  it('substitutes {{name}} placeholders', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'world' })).toBe('Hello world!');
  });

  it('HTML-escapes {{name}} values', () => {
    expect(renderTemplate('<p>{{v}}</p>', { v: '<b>&"\'</b>' })).toBe(
      '<p>&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;</p>'
    );
  });

  it('inserts {{{name}}} values raw (unescaped)', () => {
    expect(renderTemplate('<div>{{{v}}}</div>', { v: '<ol><li>a &amp; b</li></ol>' })).toBe(
      '<div><ol><li>a &amp; b</li></ol></div>'
    );
  });

  it('stringifies number values', () => {
    expect(renderTemplate('{{ip}}:{{port}}', { ip: '10.0.0.1', port: 8888 })).toBe(
      '10.0.0.1:8888'
    );
  });

  it('replaces repeated placeholders everywhere', () => {
    expect(renderTemplate('{{a}}-{{a}}-{{{a}}}', { a: '<x>' })).toBe('&lt;x&gt;-&lt;x&gt;-<x>');
  });

  it('does not interpret $-sequences in values', () => {
    expect(renderTemplate('{{v}}', { v: "$& $' $` $1" })).toBe('$&amp; $&#39; $` $1');
  });

  it('throws on a missing variable instead of leaving the placeholder', () => {
    expect(() => renderTemplate('{{present}} {{absent}}', { present: 'x' })).toThrow(
      /missing variable "absent"/
    );
  });

  it('leaves non-placeholder braces (CSS/JS) untouched', () => {
    const tpl = 'body { color: red; } function f() { return { a: 1 }; }';
    expect(renderTemplate(tpl, {})).toBe(tpl);
  });
});

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('192.168.1.10:8888 / 1,234 OK')).toBe('192.168.1.10:8888 / 1,234 OK');
  });
});

describe('loadTemplate', () => {
  it('reads a template file and caches it (subsequent reads ignore disk changes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revamp-tpl-'));
    const file = join(dir, 'cached.html');
    writeFileSync(file, '<p>{{v}} one</p>');
    const url = pathToFileURL(file);

    expect(loadTemplate(url)).toBe('<p>{{v}} one</p>');

    // Overwrite on disk — the cache must keep serving the first read.
    writeFileSync(file, '<p>{{v}} two</p>');
    expect(loadTemplate(url)).toBe('<p>{{v}} one</p>');

    // A distinct URL is a distinct cache entry.
    const other = join(dir, 'other.html');
    writeFileSync(other, 'other');
    expect(loadTemplate(pathToFileURL(other))).toBe('other');
  });

  it('throws for a nonexistent file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revamp-tpl-'));
    const url = pathToFileURL(join(dir, 'nope.html'));
    expect(() => loadTemplate(url)).toThrow();
  });
});

describe('loadTemplate + renderTemplate integration', () => {
  it('renders a file-backed template with escaped and raw vars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revamp-tpl-'));
    const file = join(dir, 'page.html');
    writeFileSync(file, '<title>{{title}}</title>{{{body}}}');
    const html = renderTemplate(loadTemplate(pathToFileURL(file)), {
      title: 'A & B',
      body: '<p>hi</p>',
    });
    expect(html).toBe('<title>A &amp; B</title><p>hi</p>');
  });
});
