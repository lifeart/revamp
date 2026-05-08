/**
 * Guards against README drift for the plugin context API. Every member
 * documented in README.md's `interface PluginContext { ... }` block must exist
 * on the real context. If you remove or rename a method, update the README.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestContext } from './testing.js';

const readmePath = resolve(__dirname, '../../README.md');

function extractDocumentedMembers(): string[] {
  const readme = readFileSync(readmePath, 'utf8');
  const match = readme.match(/interface PluginContext \{([\s\S]*?)\n\}\n```/);
  if (!match) {
    throw new Error('Could not locate `interface PluginContext` block in README.md');
  }
  const block = match[1];
  const memberPattern = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[(<]/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = memberPattern.exec(block)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

describe('README plugin doc drift', () => {
  it('every documented PluginContext member exists at runtime', () => {
    const ctx = createTestContext();
    const documented = extractDocumentedMembers();
    expect(documented.length).toBeGreaterThan(0);

    const missing = documented.filter(
      (name) => typeof (ctx as unknown as Record<string, unknown>)[name] !== 'function',
    );

    expect(missing, `README documents members that do not exist on PluginContext: ${missing.join(', ')}`).toEqual([]);
  });
});
