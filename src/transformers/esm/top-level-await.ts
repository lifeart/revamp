/**
 * ES Module Bundler — top-level await handling
 *
 * AST-based detection of top-level await and the Babel plugin that rewrites a
 * module so TLA statements run inside an async IIFE while preserving named,
 * default, and re-exports.
 *
 * @module transformers/esm/top-level-await
 */

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
