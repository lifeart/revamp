/**
 * Babel Worker for JavaScript Transformation
 *
 * This worker runs Babel transformations in a separate thread to avoid
 * blocking the main event loop during CPU-intensive transpilation.
 */

import { transformAsync, type TransformOptions } from '@babel/core';

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
 * Build Babel configuration for the given targets
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
          bugfixes: true,
        },
      ],
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

    return { code };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isIgnorable = isIgnorableError(errorMessage);

    return {
      code,
      error: errorMessage,
      isIgnorable,
    };
  }
}
