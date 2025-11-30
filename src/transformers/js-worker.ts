/**
 * Babel Worker for JavaScript Transformation
 *
 * This worker runs Babel transformations in a separate thread to avoid
 * blocking the main event loop during CPU-intensive transpilation.
 */

import { transformAsync, type TransformOptions, type PluginObj } from '@babel/core';
import type { NodePath, types as t } from '@babel/core';

export interface JsWorkerInput {
  code: string;
  filename?: string;
  targets: string[];
}

export interface JsWorkerOutput {
  code: string;
  error?: string;
  isIgnorable?: boolean;
}

/**
 * Custom Babel plugin to preserve BigInt exponentiation
 *
 * The exponentiation operator transform converts `a ** b` to `Math.pow(a, b)`,
 * but Math.pow doesn't work with BigInt values. This plugin runs AFTER
 * preset-env and converts any `Math.pow(BigIntLiteral, BigIntLiteral)` back
 * to the `**` operator.
 */
function preserveBigIntExponentiation(): PluginObj {
  return {
    name: 'preserve-bigint-exponentiation',
    visitor: {
      CallExpression(path: NodePath<t.CallExpression>) {
        const { node } = path;
        const callee = node.callee;

        // Check if it's Math.pow(...)
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Math' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'pow' &&
          node.arguments.length === 2
        ) {
          const [base, exponent] = node.arguments;

          // Check if either argument is a BigInt literal (ends with 'n')
          const isBigIntLiteral = (arg: t.Node): boolean => {
            return arg.type === 'BigIntLiteral';
          };

          // Also check for numeric literals that might have been BigInt
          // by looking at the raw source (contains 'n' suffix)
          const mightBeBigInt = (arg: t.Node): boolean => {
            if (arg.type === 'BigIntLiteral') return true;
            if (arg.type === 'NumericLiteral' && arg.extra?.raw?.toString().endsWith('n')) return true;
            return false;
          };

          if (
            (base.type === 'BigIntLiteral' || base.type === 'NumericLiteral') &&
            (exponent.type === 'BigIntLiteral' || exponent.type === 'NumericLiteral') &&
            (mightBeBigInt(base) || mightBeBigInt(exponent))
          ) {
            // Convert back to BinaryExpression with ** operator
            path.replaceWith({
              type: 'BinaryExpression',
              operator: '**',
              left: base as t.Expression,
              right: exponent as t.Expression,
            });
          }
        }
      },
    },
  };
}

/**
 * Build Babel configuration for the given targets
 *
 * Note: bugfixes: false is intentional - with bugfixes: true, Babel doesn't
 * transform template literals for Safari 9, causing syntax errors.
 * Safari 9 has partial support for various ES6 features that bugfixes mode
 * incorrectly assumes are fully supported.
 */
function getBabelConfig(targets: string[]): TransformOptions {
  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: targets.join(', '),
          useBuiltIns: false,
          modules: false,
          // bugfixes: false is required for Safari 9 compatibility
          // With bugfixes: true, template literals are not transformed
          bugfixes: false,
        },
      ],
    ],
    plugins: [
      // Fix BigInt exponentiation - must run after preset-env transforms
      // Math.pow() doesn't work with BigInt, so we need to preserve **
      preserveBigIntExponentiation,
    ],
    parserOpts: {
      allowReturnOutsideFunction: true,
      errorRecovery: true,
    },
    sourceMaps: false,
    compact: true,
    comments: false,
  };
}

/**
 * Known non-critical errors that we can safely ignore
 */
const IGNORABLE_ERROR_PATTERNS = [
  'has already been declared',
  'Identifier .* has already been declared',
  'Unexpected token',
];

function isIgnorableError(message: string): boolean {
  return IGNORABLE_ERROR_PATTERNS.some(pattern =>
    new RegExp(pattern).test(message)
  );
}

/**
 * Worker entry point - transforms JavaScript code using Babel
 */
export default async function transformJsWorker(input: JsWorkerInput): Promise<JsWorkerOutput> {
  const { code, filename, targets } = input;

  try {
    const babelConfig = getBabelConfig(targets);

    if (filename) {
      babelConfig.filename = filename;
    }

    const result = await transformAsync(code, babelConfig);

    if (result?.code) {
      return { code: result.code };
    }

    console.warn(`⚠️ Babel returned no code for: ${filename || 'unknown'}`);
    return { code };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isIgnorable = isIgnorableError(errorMessage);

    console.error(`❌ Babel error for ${filename || 'unknown'}: ${errorMessage}`);

    return {
      code,
      error: errorMessage,
      isIgnorable,
    };
  }
}
