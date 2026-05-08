/**
 * ES Module Bundler
 *
 * Bundles ES modules using esbuild for legacy browser compatibility.
 * When a <script type="module"> is detected in HTML, this module:
 * 1. Fetches the module and all its dependencies (concurrently when possible)
 * 2. Bundles them into a single IIFE using esbuild
 * 3. Transforms the bundled code for legacy browsers
 * 4. Handles dynamic imports with runtime loader
 * 5. Transforms top-level await for legacy browser support
 * 6. Processes CSS module imports by injecting styles
 *
 * @module transformers/esm-bundler
 */

import * as esbuild from 'esbuild';
import { URL } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getConfig } from '../config/index.js';
import { transformJs } from './js.js';
import { getCached, setCache } from '../cache/index.js';

// =============================================================================
// Types
// =============================================================================

/** Result of module bundling */
export interface BundleResult {
  /** Bundled and transformed code */
  code: string;
  /** Whether bundling succeeded (false means fallback was used) */
  success: boolean;
  /** Error message if bundling failed */
  error?: string;
  /** List of URLs that were bundled */
  bundledModules: string[];
}

/** Module fetch result */
interface FetchResult {
  content: string;
  contentType: string;
  finalUrl: string;
}

/** Cached module content */
interface ModuleCache {
  content: string;
  url: string;
}

/** Import map structure (subset of the full spec) */
export interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache for fetched modules during bundling */
const moduleCache = new Map<string, ModuleCache>();

/** Cache size limit - clear cache when exceeded */
const MAX_CACHE_SIZE = 500;

/** Maximum number of modules to bundle (prevent infinite loops) */
const MAX_MODULES = 100;

/** Maximum redirect hops to follow */
const MAX_REDIRECTS = 5;

/** Request timeout in milliseconds */
const FETCH_TIMEOUT = 30000;

/** Maximum concurrent fetch operations */
const MAX_CONCURRENT_FETCHES = 6;

/** User agent for fetching modules */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =============================================================================
// Concurrent Fetch Queue
// =============================================================================

/** Queue for managing concurrent fetches */
interface FetchQueueItem {
  url: string;
  resolve: (result: FetchResult) => void;
  reject: (error: Error) => void;
  redirectCount: number;
}

const fetchQueue: FetchQueueItem[] = [];
let activeFetches = 0;

/**
 * Process the fetch queue, starting new fetches if under the limit
 */
function processFetchQueue(): void {
  while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
    const item = fetchQueue.shift()!;
    activeFetches++;

    fetchUrlInternal(item.url, item.redirectCount)
      .then((result) => {
        activeFetches--;
        item.resolve(result);
        processFetchQueue();
      })
      .catch((error) => {
        activeFetches--;
        item.reject(error);
        processFetchQueue();
      });
  }
}

/**
 * Fetch multiple URLs concurrently
 */
export async function fetchUrlsConcurrently(urls: string[]): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();
  const uniqueUrls = [...new Set(urls)];

  const fetchPromises = uniqueUrls.map(async (url) => {
    try {
      const result = await fetchUrl(url);
      results.set(url, result);
    } catch (error) {
      console.warn(`[ESM Bundler] Failed to prefetch ${url}: ${error instanceof Error ? error.message : error}`);
    }
  });

  await Promise.all(fetchPromises);
  return results;
}

// =============================================================================
// Module Fetching
// =============================================================================

/**
 * Internal fetch implementation - does the actual HTTP request
 */
function fetchUrlInternal(url: string, redirectCount: number): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'identity', // Don't accept compressed responses
      },
      rejectUnauthorized: getConfig().allowInsecureUpstream !== true,
      timeout: FETCH_TIMEOUT,
    };

    const req = requestFn(options, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (${MAX_REDIRECTS}) for ${url}`));
          return;
        }
        const redirectUrl = new URL(res.headers.location, url).href;
        fetchUrlInternal(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf-8');
        const contentType = res.headers['content-type'] || 'application/javascript';

        // Cache the result
        moduleCache.set(url, { content, url });

        resolve({
          content,
          contentType,
          finalUrl: url,
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });

    req.end();
  });
}

/**
 * Fetch a URL and return its content (uses queue for concurrency control)
 */
async function fetchUrl(url: string, redirectCount = 0): Promise<FetchResult> {
  // Check cache first
  const cached = moduleCache.get(url);
  if (cached) {
    return {
      content: cached.content,
      contentType: 'application/javascript',
      finalUrl: cached.url,
    };
  }

  // Add to queue for concurrent fetching
  return new Promise((resolve, reject) => {
    fetchQueue.push({ url, resolve, reject, redirectCount });
    processFetchQueue();
  });
}

/**
 * Resolve a specifier using an import map
 */
function resolveWithImportMap(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  if (!importMap) return null;

  // Check scopes first (more specific)
  if (importMap.scopes) {
    for (const [scope, mappings] of Object.entries(importMap.scopes)) {
      if (baseUrl.startsWith(scope)) {
        // Check for exact match
        if (mappings[specifier]) {
          return mappings[specifier];
        }
        // Check for prefix match (e.g., "lodash/" -> "https://cdn/lodash/")
        for (const [prefix, replacement] of Object.entries(mappings)) {
          if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
            return replacement + specifier.slice(prefix.length);
          }
        }
      }
    }
  }

  // Check top-level imports
  if (importMap.imports) {
    // Exact match
    if (importMap.imports[specifier]) {
      return importMap.imports[specifier];
    }
    // Prefix match
    for (const [prefix, replacement] of Object.entries(importMap.imports)) {
      if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
        return replacement + specifier.slice(prefix.length);
      }
    }
  }

  return null;
}

/**
 * Resolve a module specifier to an absolute URL
 */
function resolveModuleUrl(specifier: string, baseUrl: string, importMap?: ImportMap): string | null {
  // Try import map first for bare specifiers
  const importMapResolved = resolveWithImportMap(specifier, baseUrl, importMap);
  if (importMapResolved) {
    try {
      return new URL(importMapResolved, baseUrl).href;
    } catch {
      // Invalid resolved URL
    }
  }

  // Handle bare specifiers (npm packages) - these can't be resolved without import maps
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('http')) {
    // Check for common CDN patterns that look like bare specifiers but have URLs
    if (specifier.includes('://')) {
      try {
        return new URL(specifier).href;
      } catch {
        // Not a valid URL
      }
    }
    console.warn(`[ESM Bundler] Cannot resolve bare specifier: "${specifier}" - consider using an import map or full URL`);
    return null;
  }

  try {
    return new URL(specifier, baseUrl).href;
  } catch {
    console.warn(`[ESM Bundler] Failed to resolve "${specifier}" from "${baseUrl}"`);
    return null;
  }
}

// =============================================================================
// Top-Level Await Handling
// =============================================================================

// Import Babel for AST-based top-level await detection
import * as babel from '@babel/core';
import { types as t, type NodePath, type PluginObj } from '@babel/core';

/**
 * Walk a path's ancestors and report whether any of them is a function-like
 * scope. `await` / `for await` inside such a scope is bound by the inner
 * function, not the module top level.
 */
function isInsideFunction(path: NodePath): boolean {
  let parent = path.parentPath;
  while (parent !== null) {
    if (
      parent.isFunction() ||
      parent.isArrowFunctionExpression() ||
      parent.isFunctionDeclaration() ||
      parent.isFunctionExpression() ||
      parent.isObjectMethod() ||
      parent.isClassMethod()
    ) {
      return true;
    }
    if (!parent.parentPath) break;
    parent = parent.parentPath;
  }
  return false;
}

/**
 * Detect if code contains top-level await using Babel AST parsing
 * This is accurate and handles all edge cases (strings, comments, nested functions)
 */
export function detectTopLevelAwait(code: string): boolean {
  try {
    let hasTopLevelAwait = false;

    babel.transformSync(code, {
      sourceType: 'module',
      plugins: [
        {
          visitor: {
            AwaitExpression(path) {
              if (!isInsideFunction(path)) {
                hasTopLevelAwait = true;
              }
            },
            ForOfStatement(path) {
              if (path.node.await && !isInsideFunction(path)) {
                hasTopLevelAwait = true;
              }
            },
          },
        },
      ],
      code: false,
    });

    return hasTopLevelAwait;
  } catch {
    return /\bawait\b/.test(code);
  }
}

/**
 * Build the body of the async IIFE from `tlaStatements`, wrapping in
 * try/catch so a TLA failure doesn't kill the whole page.
 */
function buildAsyncIife(tlaStatements: t.Statement[]): t.ExpressionStatement {
  const tryBlock = t.blockStatement(tlaStatements);
  const catchClause = t.catchClause(
    t.identifier('e'),
    t.blockStatement([
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier('console'), t.identifier('error')),
          [t.stringLiteral('[Revamp] Top-level await error:'), t.identifier('e')],
        ),
      ),
    ]),
  );
  const fnBody = t.blockStatement([t.tryStatement(tryBlock, catchClause)]);
  const asyncFn = t.functionExpression(null, [], fnBody, false, true);
  return t.expressionStatement(t.callExpression(asyncFn, []));
}

/**
 * Rewrite a module so top-level await statements run inside an async IIFE
 * while preserving named, default, and re-exports.
 *
 * For `export const x = <expr-with-await>` we emit `let x;` at top level so
 * the binding still exists for `export { x }`, and assign inside the IIFE.
 * For `export default <expr-with-await>` we hoist a synthetic binding
 * `__revampTlaDefault` and re-export it as default. Re-exports
 * (`export { foo } from 'mod'`) and TLA-free statements stay where they were
 * so esbuild can still see imports/exports for bundling.
 */
export function wrapTopLevelAwait(code: string): string {
  const transformed = babel.transformSync(code, {
    sourceType: 'module',
    babelrc: false,
    configFile: false,
    parserOpts: { allowReturnOutsideFunction: true },
    plugins: [tlaWrapPlugin],
  });

  if (!transformed?.code) {
    // If Babel produced nothing (shouldn't happen), fall back to the safe
    // wrap-only-no-exports form so syntax errors don't take down the page.
    return `\n(async function(){\n  'use strict';\n  try {\n${code}\n  } catch (e) {\n    console.error('[Revamp] Top-level await error:', e);\n  }\n})();\n`;
  }

  return transformed.code;
}

/**
 * Collect the set of local binding names referenced by specifier-only
 * named exports (`export { x }`, `export { x as default }`, `export { foo as bar }`).
 * These locals MUST appear at the top level of the rewritten module so the
 * export specifier can resolve — otherwise esbuild errors with
 * `Export 'x' is not defined in module`.
 */
function collectSpecifierExportLocals(body: t.Statement[]): Set<string> {
  const locals = new Set<string>();
  for (const stmt of body) {
    if (
      t.isExportNamedDeclaration(stmt) &&
      !stmt.declaration &&
      !stmt.source &&
      stmt.specifiers.length > 0
    ) {
      for (const spec of stmt.specifiers) {
        if (t.isExportSpecifier(spec) && t.isIdentifier(spec.local)) {
          locals.add(spec.local.name);
        }
      }
    }
  }
  return locals;
}

/**
 * Collect every identifier name whose value is produced INSIDE the async IIFE
 * (and therefore not yet resolvable when top-level code runs). A class hoisted
 * to top level whose `extends` clause / decorators / static initializers / etc.
 * reference any of these names would throw at module evaluation time —
 * `ReferenceError` for IIFE-private locals, or "extends value undefined" for
 * `let`-hoisted exports that haven't been assigned yet. Such classes must
 * stay in the IIFE.
 */
function collectIifeBoundBindings(
  body: t.Statement[],
  specifierExportLocals: Set<string>,
): Set<string> {
  const names = new Set<string>();

  const collectIds = (lval: t.LVal | t.Identifier): void => {
    if (t.isIdentifier(lval)) {
      names.add(lval.name);
      return;
    }
    if (t.isObjectPattern(lval)) {
      for (const prop of lval.properties) {
        if (t.isObjectProperty(prop) && t.isLVal(prop.value)) {
          collectIds(prop.value);
        } else if (t.isRestElement(prop)) {
          collectIds(prop.argument);
        }
      }
      return;
    }
    if (t.isArrayPattern(lval)) {
      for (const el of lval.elements) {
        if (el && t.isLVal(el)) collectIds(el);
      }
      return;
    }
    if (t.isAssignmentPattern(lval) && t.isLVal(lval.left)) {
      collectIds(lval.left);
      return;
    }
    if (t.isRestElement(lval)) {
      collectIds(lval.argument);
    }
  };

  for (const stmt of body) {
    if (t.isImportDeclaration(stmt)) continue;
    if (t.isExportAllDeclaration(stmt)) continue;
    if (t.isExportNamedDeclaration(stmt) && stmt.source) continue;

    if (
      t.isExportNamedDeclaration(stmt) &&
      !stmt.declaration &&
      !stmt.source
    ) {
      continue;
    }

    if (
      t.isExportDefaultDeclaration(stmt) &&
      (t.isFunctionDeclaration(stmt.declaration) ||
        t.isClassDeclaration(stmt.declaration))
    ) {
      continue;
    }

    if (
      t.isExportNamedDeclaration(stmt) &&
      stmt.declaration &&
      t.isVariableDeclaration(stmt.declaration)
    ) {
      for (const d of stmt.declaration.declarations) {
        if (t.isLVal(d.id)) collectIds(d.id);
      }
      continue;
    }

    if (
      t.isExportNamedDeclaration(stmt) &&
      stmt.declaration &&
      (t.isFunctionDeclaration(stmt.declaration) ||
        t.isClassDeclaration(stmt.declaration))
    ) {
      continue;
    }

    if (t.isFunctionDeclaration(stmt)) continue;

    if (
      t.isClassDeclaration(stmt) &&
      stmt.id &&
      specifierExportLocals.has(stmt.id.name)
    ) {
      continue;
    }

    if (t.isVariableDeclaration(stmt)) {
      for (const d of stmt.declarations) {
        if (t.isLVal(d.id)) collectIds(d.id);
      }
      continue;
    }

    if (t.isClassDeclaration(stmt) && stmt.id) {
      names.add(stmt.id.name);
      continue;
    }

    if (t.isForOfStatement(stmt) && stmt.await) {
      const left = stmt.left;
      if (t.isVariableDeclaration(left)) {
        for (const d of left.declarations) {
          if (t.isLVal(d.id)) collectIds(d.id);
        }
      } else if (t.isLVal(left)) {
        collectIds(left);
      }
      continue;
    }
  }

  return names;
}

/**
 * Walk a class declaration looking for any identifier reference (in the
 * `extends` clause, decorators, computed keys, or class body) that names a
 * binding listed in `iifeBoundNames`. We deliberately skip nested function
 * scopes because their bodies do not execute at class-definition time.
 */
function classReferencesIifeBoundBinding(
  cls: t.ClassDeclaration,
  iifeBoundNames: Set<string>,
): boolean {
  if (iifeBoundNames.size === 0) return false;

  let found = false;

  const referencesName = (node: t.Node | null | undefined): void => {
    if (found || !node) return;
    babel.traverse(
      t.file(t.program([t.expressionStatement(node as t.Expression)])),
      {
        Function(path) {
          path.skip();
        },
        Identifier(path) {
          if (found) return;
          const parent = path.parent;
          if (
            t.isMemberExpression(parent) &&
            parent.property === path.node &&
            !parent.computed
          ) {
            return;
          }
          if (
            (t.isObjectProperty(parent) || t.isObjectMethod(parent)) &&
            parent.key === path.node &&
            !parent.computed
          ) {
            return;
          }
          if (iifeBoundNames.has(path.node.name)) {
            found = true;
            path.stop();
          }
        },
      },
    );
  };

  if (cls.superClass) {
    referencesName(cls.superClass);
  }

  if (cls.decorators) {
    for (const dec of cls.decorators) {
      if (found) break;
      referencesName(dec.expression);
    }
  }

  for (const member of cls.body.body) {
    if (found) break;
    if (t.isClassMethod(member) || t.isClassPrivateMethod(member)) {
      if (member.computed) referencesName(member.key);
      if (member.decorators) {
        for (const dec of member.decorators) {
          if (found) break;
          referencesName(dec.expression);
        }
      }
      continue;
    }
    if (t.isClassProperty(member) || t.isClassPrivateProperty(member)) {
      if ('computed' in member && member.computed) {
        referencesName(member.key);
      }
      if (member.value) referencesName(member.value);
      if (member.decorators) {
        for (const dec of member.decorators) {
          if (found) break;
          referencesName(dec.expression);
        }
      }
      continue;
    }
    if (t.isStaticBlock(member)) {
      babel.traverse(t.file(t.program(member.body)), {
        Function(path) {
          path.skip();
        },
        Identifier(path) {
          if (found) return;
          const parent = path.parent;
          if (
            t.isMemberExpression(parent) &&
            parent.property === path.node &&
            !parent.computed
          ) {
            return;
          }
          if (iifeBoundNames.has(path.node.name)) {
            found = true;
            path.stop();
          }
        },
      });
    }
  }

  return found;
}

const tlaWrapPlugin: () => PluginObj = () => ({
  name: 'revamp-tla-wrap',
  visitor: {
    Program: {
      exit(path: NodePath<t.Program>) {
        const body = path.node.body;
        const newBody: t.Statement[] = [];
        const tlaBody: t.Statement[] = [];
        let defaultCounter = 0;

        // Pre-pass: figure out which local bindings are referenced by
        // specifier-only exports. Those bindings MUST live at the top level
        // (declared with `let` so the IIFE can assign them) — otherwise
        // esbuild rejects the module with `Export 'x' is not defined`.
        const specifierExportLocals = collectSpecifierExportLocals(body);

        // Names whose values are produced inside the IIFE. A class hoisted
        // to top level whose extends clause / decorators / static
        // initializers reference any of these would throw at module
        // evaluation time.
        const iifeBoundNames = collectIifeBoundBindings(body, specifierExportLocals);

        for (const stmt of body) {
          // Imports are hoisted by the spec — keep them at the top so
          // esbuild can resolve them ahead of any module work.
          if (t.isImportDeclaration(stmt)) {
            newBody.push(stmt);
            continue;
          }

          // Pure re-exports (`export … from 'mod'`) are declarative and
          // contain no TLA — leave intact at top level.
          // `export * from 'mod'` and `export * as ns from 'mod'` are both
          // ExportAllDeclaration nodes and are covered here.
          if (
            (t.isExportNamedDeclaration(stmt) && stmt.source !== null && stmt.source !== undefined) ||
            t.isExportAllDeclaration(stmt)
          ) {
            newBody.push(stmt);
            continue;
          }

          // Specifier-only named exports — `export { helper }`, `export { foo as bar }`.
          // These have no `declaration` and no `source`, so they cannot contain TLA.
          // They must stay at the top level so esbuild sees the export bindings.
          if (
            t.isExportNamedDeclaration(stmt) &&
            !stmt.declaration &&
            !stmt.source &&
            stmt.specifiers.length > 0
          ) {
            newBody.push(stmt);
            continue;
          }

          // `export default function foo() {}` and `export default class Foo {}`.
          // Function/class declarations are hoisted, cannot contain TLA at the top
          // level, and must remain top-level so the default export is visible to
          // the bundler. (Distinct from `export default <expr>` handled below,
          // which may have an awaited initializer.)
          if (
            t.isExportDefaultDeclaration(stmt) &&
            (t.isFunctionDeclaration(stmt.declaration) ||
              t.isClassDeclaration(stmt.declaration))
          ) {
            newBody.push(stmt);
            continue;
          }

          // export const/let/var x = INIT — hoist the binding so the export
          // specifier resolves, and run the initializer inside the IIFE
          // (preserving the original execution order).
          if (
            t.isExportNamedDeclaration(stmt) &&
            stmt.declaration &&
            t.isVariableDeclaration(stmt.declaration)
          ) {
            const decl = stmt.declaration;
            const hoistedDeclarators = decl.declarations.map((d) =>
              t.variableDeclarator(d.id, null),
            );
            newBody.push(t.variableDeclaration('let', hoistedDeclarators));

            for (const d of decl.declarations) {
              if (!d.init) continue;
              tlaBody.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    d.id as unknown as t.LVal,
                    d.init,
                  ),
                ),
              );
            }

            const specifiers: t.ExportSpecifier[] = decl.declarations
              .filter((d): d is t.VariableDeclarator & { id: t.Identifier } =>
                t.isIdentifier(d.id),
              )
              .map((d) =>
                t.exportSpecifier(t.identifier(d.id.name), t.identifier(d.id.name)),
              );
            if (specifiers.length > 0) {
              newBody.push(t.exportNamedDeclaration(null, specifiers));
            }
            continue;
          }

          // export default <expr> — hoist a synthetic binding so the IIFE
          // can assign it asynchronously, and re-export as default.
          if (
            t.isExportDefaultDeclaration(stmt) &&
            t.isExpression(stmt.declaration)
          ) {
            const id = t.identifier(`__revampTlaDefault${defaultCounter++}`);
            newBody.push(
              t.variableDeclaration('let', [t.variableDeclarator(id)]),
            );
            tlaBody.push(
              t.expressionStatement(
                t.assignmentExpression('=', id, stmt.declaration),
              ),
            );
            newBody.push(
              t.exportDefaultDeclaration(t.identifier(id.name)),
            );
            continue;
          }

          // export function/class declarations — declarations themselves are
          // hoisted in ES modules, so leave the export at the top level.
          if (
            t.isExportNamedDeclaration(stmt) &&
            stmt.declaration &&
            (t.isFunctionDeclaration(stmt.declaration) ||
              t.isClassDeclaration(stmt.declaration))
          ) {
            newBody.push(stmt);
            continue;
          }

          // Plain top-level `var`/`let`/`const` declarations whose names are
          // referenced by a specifier-only export (`export { x as default }`).
          // Those names MUST exist as top-level bindings or esbuild errors
          // with `Export 'x' is not defined in module`. Hoist as `let` (no
          // init) at top level and move the initializer (if any) into the
          // IIFE as an assignment. Mirrors the `export const x = …` treatment.
          if (
            t.isVariableDeclaration(stmt) &&
            stmt.declarations.some(
              (d) => t.isIdentifier(d.id) && specifierExportLocals.has(d.id.name),
            )
          ) {
            const hoistedDeclarators = stmt.declarations.map((d) =>
              t.variableDeclarator(d.id, null),
            );
            newBody.push(t.variableDeclaration('let', hoistedDeclarators));
            for (const d of stmt.declarations) {
              if (!d.init) continue;
              tlaBody.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    d.id as unknown as t.LVal,
                    d.init,
                  ),
                ),
              );
            }
            continue;
          }

          // Function declarations are hoisted; classes are TDZ-bound and
          // stay in the IIFE so they can reference TLA-initialized bindings.
          // Function declaration BODIES never contain top-level await (an
          // `await` inside is bound by the inner function scope), so hoisting
          // them out of the IIFE is sound.
          if (t.isFunctionDeclaration(stmt)) {
            newBody.push(stmt);
            continue;
          }

          // Class declarations referenced by a specifier-only export need
          // their identifier resolvable at the top level so the export
          // specifier binds. If the class can be safely evaluated at top
          // level (no IIFE-bound names in extends/decorators/initializers),
          // emit it as-is. Otherwise hoist `let Foo;` at top level and
          // assign `Foo = class extends Base {…}` inside the IIFE so the
          // class evaluation sees the IIFE-initialized bindings.
          if (
            t.isClassDeclaration(stmt) &&
            stmt.id &&
            specifierExportLocals.has(stmt.id.name)
          ) {
            if (classReferencesIifeBoundBinding(stmt, iifeBoundNames)) {
              const className = stmt.id.name;
              newBody.push(
                t.variableDeclaration('let', [
                  t.variableDeclarator(t.identifier(className)),
                ]),
              );
              const classExpr = t.classExpression(
                null,
                stmt.superClass ?? null,
                stmt.body,
                stmt.decorators ?? null,
              );
              tlaBody.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(className),
                    classExpr,
                  ),
                ),
              );
              continue;
            }
            newBody.push(stmt);
            continue;
          }

          // Anything else — including non-TLA statements and class
          // declarations not referenced by specifier-only exports — runs
          // inside the IIFE in original order so that statements depending
          // on bindings assigned earlier in the IIFE still see their values.
          tlaBody.push(stmt);
        }

        if (tlaBody.length > 0) {
          newBody.push(buildAsyncIife(tlaBody));
        }

        path.node.body = newBody;
      },
    },
  },
});

// =============================================================================
// CSS Module Handling
// =============================================================================

/**
 * Check if a URL points to a CSS file
 */
export function isCssUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.css');
  } catch {
    return url.toLowerCase().endsWith('.css');
  }
}

/**
 * Generate code to inject CSS into the page at runtime
 */
export function generateCssInjectionCode(css: string, url: string): string {
  // Escape the CSS content for embedding in JavaScript
  const escapedCss = css
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `
(function() {
  var css = \`${escapedCss}\`;
  var style = document.createElement('style');
  style.setAttribute('data-revamp-css-module', '${url}');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  console.log('[Revamp] Injected CSS module: ${url}');
})();
`;
}

// =============================================================================
// esbuild Plugins
// =============================================================================

/**
 * Create an esbuild plugin that resolves ES module imports via HTTP(S)
 * Also handles CSS module imports by converting them to style injection code
 */
function createHttpResolverPlugin(baseUrl: string, bundledModules: string[], importMap?: ImportMap): esbuild.Plugin {
  return {
    name: 'http-resolver',
    setup(build) {
      // Track loaded modules to prevent infinite loops
      const loadedModules = new Set<string>();

      // Resolve relative and absolute imports
      build.onResolve({ filter: /.*/ }, (args) => {
        // Handle entry point
        if (args.kind === 'entry-point') {
          return { path: baseUrl, namespace: 'http' };
        }

        // Handle dynamic imports - these need special runtime handling
        if (args.kind === 'dynamic-import') {
          const resolveBase = args.namespace === 'http' && args.importer ? args.importer : baseUrl;
          const resolvedUrl = resolveModuleUrl(args.path, resolveBase, importMap);

          if (resolvedUrl) {
            // Store the resolved URL for the dynamic import handler
            return { path: resolvedUrl, namespace: 'dynamic-import' };
          }
          return { external: true };
        }

        // Determine the base for resolution
        // If importer is in http namespace, use it as base URL
        // Otherwise use the original baseUrl
        const resolveBase = args.namespace === 'http' && args.importer
          ? args.importer
          : baseUrl;

        const resolvedUrl = resolveModuleUrl(args.path, resolveBase, importMap);

        if (!resolvedUrl) {
          // Can't resolve - mark as external and let runtime handle it
          return { external: true };
        }

        // Check if this is a CSS file - route to css namespace for special handling
        if (isCssUrl(resolvedUrl)) {
          console.log(`🎨 CSS import detected: ${args.path} -> ${resolvedUrl}`);
          return { path: resolvedUrl, namespace: 'css-http' };
        }

        // Check for circular dependencies or too many modules
        if (loadedModules.size >= MAX_MODULES) {
          console.warn(`[ESM Bundler] Max modules reached (${MAX_MODULES}), marking ${args.path} as external`);
          return { external: true };
        }

        return { path: resolvedUrl, namespace: 'http' };
      });

      // Handle CSS files loaded via HTTP
      build.onLoad({ filter: /.*/, namespace: 'css-http' }, async (args) => {
        const url = args.path;
        bundledModules.push(url);

        try {
          console.log(`🎨 Loading CSS module: ${url}`);
          const result = await fetchUrl(url);
          const jsCode = generateCssInjectionCode(result.content, url);
          return { contents: jsCode, loader: 'js' };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[ESM Bundler] Failed to load CSS ${url}: ${message}`);
          return { contents: `console.warn('[Revamp] Failed to load CSS: ${url}');`, loader: 'js' };
        }
      });

      // Handle dynamic imports - generate runtime loader code
      build.onLoad({ filter: /.*/, namespace: 'dynamic-import' }, async (args) => {
        const url = args.path;
        console.log(`⚡ Dynamic import detected: ${url}`);

        // Generate code that uses the runtime dynamic import loader
        const code = `
// Dynamic import placeholder for: ${url}
var __dynamicImportUrl = "${url}";
export default window.__revampDynamicImport ? window.__revampDynamicImport(__dynamicImportUrl) : Promise.reject(new Error('[Revamp] Dynamic import not supported: ' + __dynamicImportUrl));
`;
        return { contents: code, loader: 'js' };
      });

      // Load modules via HTTP(S)
      build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
        const url = args.path;

        // Prevent infinite loops
        if (loadedModules.has(url)) {
          return { contents: '', loader: 'js' };
        }

        loadedModules.add(url);
        bundledModules.push(url);

        try {
          const result = await fetchUrl(url);
          return {
            contents: result.content,
            loader: 'js',
            // Don't set resolveDir - our onResolve handles URL resolution
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[ESM Bundler] Failed to fetch ${url}: ${message}`);
          // Return empty content to allow bundling to continue
          return { contents: `console.error('[Revamp] Failed to load module: ${url}');`, loader: 'js' };
        }
      });
    },
  };
}

// =============================================================================
// Main Bundler Function
// =============================================================================

/**
 * Bundle an ES module and its dependencies into a single IIFE
 *
 * @param moduleUrl - URL of the entry module
 * @param inlineCode - Optional inline code to bundle (if module is inline)
 * @param importMap - Optional import map for resolving bare specifiers
 * @returns Bundle result with code and metadata
 */
export async function bundleEsModule(moduleUrl: string, inlineCode?: string, importMap?: ImportMap): Promise<BundleResult> {
  const bundledModules: string[] = [];

  try {
    // Check if bundling is enabled
    const config = getConfig();
    if (!config.transformJs) {
      // Just return the original code without bundling
      if (inlineCode) {
        return {
          code: inlineCode,
          success: true,
          bundledModules: [],
        };
      }

      const result = await fetchUrl(moduleUrl);
      return {
        code: result.content,
        success: true,
        bundledModules: [moduleUrl],
      };
    }

    // Check cache first
    const cacheKey = `esm-bundle:${moduleUrl}`;
    const cached = await getCached(moduleUrl, 'esm-bundle');
    if (cached) {
      console.log(`📦 ESM bundle cache hit: ${moduleUrl}`);
      return {
        code: cached.toString('utf-8'),
        success: true,
        bundledModules: [],
      };
    }

    console.log(`📦 Bundling ES module: ${moduleUrl}`);

    // Prepare entry point
    let entryContent: string;
    if (inlineCode) {
      entryContent = inlineCode;
      bundledModules.push(moduleUrl + '#inline');
    } else {
      const fetchResult = await fetchUrl(moduleUrl);
      entryContent = fetchResult.content;
    }

    // Check for top-level await and wrap if needed
    const hasTopLevelAwait = detectTopLevelAwait(entryContent);
    if (hasTopLevelAwait) {
      console.log(`⏳ Top-level await detected in: ${moduleUrl}`);
      entryContent = wrapTopLevelAwait(entryContent);
    }

    // Bundle with esbuild
    const result = await esbuild.build({
      stdin: {
        contents: entryContent,
        loader: 'js',
        // Use empty resolveDir - our plugin handles all resolution
        resolveDir: '.',
        sourcefile: moduleUrl,
      },
      bundle: true,
      write: false,
      format: 'iife',
      // Use es2015 for bundling structure - Babel will transform to ES5
      target: 'es2015',
      platform: 'browser',
      minify: false, // Don't minify - we want readable code for further transform
      sourcemap: false,
      keepNames: true,
      treeShaking: false,
      plugins: [
        createHttpResolverPlugin(moduleUrl, bundledModules, importMap),
      ],
      logLevel: 'silent',
      // Handle dynamic imports by converting to require
      splitting: false,
      // Define import.meta.url for modules that need it
      define: {
        'import.meta.url': JSON.stringify(moduleUrl),
        'import.meta': JSON.stringify({ url: moduleUrl }),
      },
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
      let bundledCode = result.outputFiles[0].text;

      // Transform the bundled code for legacy browsers using Babel
      console.log(`🔧 Transforming bundled module: ${moduleUrl}`);
      bundledCode = await transformJs(bundledCode, moduleUrl);

      // Cache the result
      await setCache(moduleUrl, 'esm-bundle', Buffer.from(bundledCode, 'utf-8'));

      return {
        code: bundledCode,
        success: true,
        bundledModules,
      };
    }

    throw new Error('esbuild produced no output');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ESM bundling failed: ${message}`);

    // Fallback: return a script that logs the error
    const fallbackCode = `
(function() {
  console.error('[Revamp] Failed to bundle ES module: ${moduleUrl}');
  console.error('[Revamp] Error: ${message.replace(/'/g, "\\'")}');
  console.error('[Revamp] The module may not work correctly on this browser.');
})();
`;

    return {
      code: fallbackCode,
      success: false,
      error: message,
      bundledModules,
    };
  }
}

/**
 * Bundle inline module code
 *
 * @param code - Inline module code
 * @param baseUrl - Base URL for resolving relative imports
 * @param importMap - Optional import map for resolving bare specifiers
 * @returns Bundle result
 */
export async function bundleInlineModule(code: string, baseUrl: string, importMap?: ImportMap): Promise<BundleResult> {
  return bundleEsModule(baseUrl, code, importMap);
}

/**
 * Clear the module cache (useful for testing or memory management)
 */
export function clearModuleCache(): void {
  moduleCache.clear();
}

/**
 * Get the current cache size
 */
export function getModuleCacheSize(): number {
  return moduleCache.size;
}

/**
 * Prune the module cache if it exceeds the size limit
 * Uses LRU-like approach by clearing entire cache when limit exceeded
 */
export function pruneModuleCacheIfNeeded(): void {
  if (moduleCache.size > MAX_CACHE_SIZE) {
    console.log(`[ESM Bundler] Cache size exceeded ${MAX_CACHE_SIZE}, clearing cache`);
    moduleCache.clear();
  }
}

/**
 * Check if a script tag represents an ES module
 */
export function isModuleScript(type: string | undefined): boolean {
  return type === 'module';
}

/**
 * Parse an import map from JSON string
 *
 * @param json - Import map JSON string
 * @returns Parsed import map or undefined if invalid
 */
export function parseImportMap(json: string): ImportMap | undefined {
  try {
    const map = JSON.parse(json);

    // Validate basic structure
    if (typeof map !== 'object' || map === null) {
      console.warn('[ESM Bundler] Invalid import map: must be an object');
      return undefined;
    }

    const result: ImportMap = {};

    // Validate imports
    if (map.imports) {
      if (typeof map.imports !== 'object' || map.imports === null) {
        console.warn('[ESM Bundler] Invalid import map: imports must be an object');
        return undefined;
      }
      result.imports = {};
      for (const [key, value] of Object.entries(map.imports)) {
        if (typeof value === 'string') {
          result.imports[key] = value;
        }
      }
    }

    // Validate scopes
    if (map.scopes) {
      if (typeof map.scopes !== 'object' || map.scopes === null) {
        console.warn('[ESM Bundler] Invalid import map: scopes must be an object');
        return undefined;
      }
      result.scopes = {};
      for (const [scope, mappings] of Object.entries(map.scopes)) {
        if (typeof mappings === 'object' && mappings !== null) {
          result.scopes[scope] = {};
          for (const [key, value] of Object.entries(mappings)) {
            if (typeof value === 'string') {
              result.scopes[scope][key] = value;
            }
          }
        }
      }
    }

    console.log(`[ESM Bundler] Parsed import map with ${Object.keys(result.imports || {}).length} imports, ${Object.keys(result.scopes || {}).length} scopes`);
    return result;
  } catch (e) {
    console.warn('[ESM Bundler] Failed to parse import map:', e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * Generate a shim script that provides basic import/export support
 * This is injected before any bundled modules to provide runtime support
 */
export function getModuleShimScript(): string {
  return `
<!-- Revamp ES Module Shim -->
<script>
(function() {
  'use strict';
  // ES Module shim for legacy browsers
  // Bundled modules are converted to IIFE format by esbuild
  // This shim provides any additional runtime support needed

  // Track loaded modules for debugging
  window.__revampModules = window.__revampModules || {};

  // Top-level await exports storage
  window.__tlaExports = window.__tlaExports || {};

  // Provide a fake import.meta for modules that need it
  window.__importMeta = window.__importMeta || { url: location.href };

  // Dynamic import runtime loader
  // This fetches and evaluates modules at runtime for dynamic import() calls
  window.__revampDynamicImport = function(url) {
    console.log('[Revamp] Dynamic import:', url);

    // Check if module is already loaded
    if (window.__revampModules[url]) {
      return Promise.resolve(window.__revampModules[url]);
    }

    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            // T10: prepare a CommonJS-like environment for the upstream
            // module. Variables in this shim's enclosing scope are NOT
            // visible to the wrapped code below — \`new Function\` only
            // closes over its formal parameters and globals, which keeps
            // resolver-internal state (import map, sentinels) invisible
            // to potentially-hostile module bodies.
            var exportsObj = {};
            window.__revampModules[url] = exportsObj;
            var moduleObj = { exports: exportsObj };

            // T10: \`new Function\` instead of \`eval\` — the wrapped code
            // executes in its own function scope with only the named
            // parameters available, so we never lend the surrounding shim
            // closure to remote JS.
            var moduleFactory = new Function(
              'module',
              'exports',
              'require',
              xhr.responseText
            );
            moduleFactory.call(undefined, moduleObj, moduleObj.exports, undefined);

            var result = moduleObj.exports;
            window.__revampModules[url] = result || exportsObj;
            resolve(window.__revampModules[url]);
          } catch (e) {
            console.error('[Revamp] Dynamic import module error:', e);
            reject(e);
          }
        } else {
          reject(new Error('Failed to load module: ' + url + ' (HTTP ' + xhr.status + ')'));
        }
      };
      xhr.onerror = function() {
        reject(new Error('Network error loading module: ' + url));
      };
      xhr.send();
    });
  };

  console.log('[Revamp] ES Module runtime initialized');
})();
</script>
`;
}
