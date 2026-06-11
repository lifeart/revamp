/**
 * Revamp Plugin System - Validation
 *
 * Manifest validation, version compatibility checking,
 * and dependency resolution for plugins.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { log } from '../logger/log.js';
import type {
  PluginManifest,
  PluginPermission,
  HookName,
  SemVer,
} from './types.js';
import { isValidSemVer, compareSemVer } from './types.js';

// Current Revamp version - should match package.json
const REVAMP_VERSION: SemVer = '1.0.0';

// Valid plugin ID pattern
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

// All valid permissions
const VALID_PERMISSIONS: PluginPermission[] = [
  'request:read',
  'request:modify',
  'response:read',
  'response:modify',
  'config:read',
  'config:write',
  'cache:read',
  'cache:write',
  'metrics:read',
  'metrics:write',
  'network:fetch',
  'storage:read',
  'storage:write',
  'api:register',
];

// All valid hook names
const VALID_HOOKS: HookName[] = [
  'request:pre',
  'response:post',
  'transform:pre',
  'transform:post',
  'filter:decision',
  'config:resolution',
  'domain:lifecycle',
  'cache:get',
  'cache:set',
  'metrics:record',
];

/**
 * Validation error with field information
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate a plugin manifest
 * Returns an array of validation errors (empty if valid)
 */
export function validateManifest(manifest: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push({ field: 'manifest', message: 'Manifest must be an object' });
    return errors;
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (typeof m.id !== 'string' || !m.id) {
    errors.push({ field: 'id', message: 'id is required and must be a string' });
  } else if (!PLUGIN_ID_PATTERN.test(m.id)) {
    errors.push({
      field: 'id',
      message:
        'id must be lowercase with dots/hyphens (e.g., "com.example.my-plugin")',
    });
  }

  if (typeof m.name !== 'string' || !m.name) {
    errors.push({ field: 'name', message: 'name is required and must be a string' });
  }

  if (typeof m.version !== 'string' || !m.version) {
    errors.push({
      field: 'version',
      message: 'version is required and must be a string',
    });
  } else if (!isValidSemVer(m.version)) {
    errors.push({
      field: 'version',
      message: 'version must be a valid semver (e.g., "1.0.0")',
    });
  }

  if (typeof m.description !== 'string') {
    errors.push({
      field: 'description',
      message: 'description is required and must be a string',
    });
  }

  if (typeof m.author !== 'string') {
    errors.push({
      field: 'author',
      message: 'author is required and must be a string',
    });
  }

  if (typeof m.revampVersion !== 'string' || !m.revampVersion) {
    errors.push({
      field: 'revampVersion',
      message: 'revampVersion is required and must be a string',
    });
  } else if (!isValidSemVer(m.revampVersion)) {
    errors.push({
      field: 'revampVersion',
      message: 'revampVersion must be a valid semver (e.g., "1.0.0")',
    });
  }

  if (typeof m.main !== 'string' || !m.main) {
    errors.push({
      field: 'main',
      message: 'main is required and must be a string (entry point path)',
    });
  }

  // Optional fields
  if (m.homepage !== undefined && typeof m.homepage !== 'string') {
    errors.push({ field: 'homepage', message: 'homepage must be a string' });
  }

  if (m.dependencies !== undefined) {
    if (typeof m.dependencies !== 'object' || m.dependencies === null) {
      errors.push({ field: 'dependencies', message: 'dependencies must be an object' });
    } else {
      for (const [depId, version] of Object.entries(m.dependencies)) {
        if (!PLUGIN_ID_PATTERN.test(depId)) {
          errors.push({
            field: `dependencies.${depId}`,
            message: `Invalid dependency ID: ${depId}`,
          });
        }
        if (typeof version !== 'string') {
          errors.push({
            field: `dependencies.${depId}`,
            message: `Version must be a string`,
          });
        }
      }
    }
  }

  if (m.hooks !== undefined) {
    if (!Array.isArray(m.hooks)) {
      errors.push({ field: 'hooks', message: 'hooks must be an array' });
    } else {
      for (const hook of m.hooks) {
        if (!VALID_HOOKS.includes(hook as HookName)) {
          errors.push({
            field: 'hooks',
            message: `Invalid hook: ${hook}. Valid hooks: ${VALID_HOOKS.join(', ')}`,
          });
        }
      }
    }
  }

  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      errors.push({ field: 'permissions', message: 'permissions must be an array' });
    } else {
      for (const perm of m.permissions) {
        if (!VALID_PERMISSIONS.includes(perm as PluginPermission)) {
          errors.push({
            field: 'permissions',
            message: `Invalid permission: ${perm}. Valid permissions: ${VALID_PERMISSIONS.join(', ')}`,
          });
        }
      }
    }
  }

  if (m.configSchema !== undefined) {
    if (typeof m.configSchema !== 'object' || m.configSchema === null) {
      errors.push({
        field: 'configSchema',
        message: 'configSchema must be an object (JSON Schema)',
      });
    }
  }

  return errors;
}

/**
 * Check if a plugin is compatible with the current Revamp version
 */
export function checkVersionCompatibility(requiredVersion: SemVer): boolean {
  // For now, require exact major version match
  const required = requiredVersion.split('.').map(Number);
  const current = REVAMP_VERSION.split('.').map(Number);

  // Major version must match
  if (required[0] !== current[0]) {
    return false;
  }

  // Required minor/patch must be <= current
  return compareSemVer(requiredVersion, REVAMP_VERSION) <= 0;
}

/**
 * Get the current Revamp version
 */
export function getRevampVersion(): SemVer {
  return REVAMP_VERSION;
}

/**
 * Check if a version satisfies a version range
 * Supports: exact version, ^version (compatible), ~version (patch-level)
 */
export function satisfiesVersionRange(version: SemVer, range: string): boolean {
  const trimmed = range.trim();

  // Exact version
  if (isValidSemVer(trimmed as SemVer)) {
    return version === trimmed;
  }

  // Caret (^) - compatible versions (same major)
  if (trimmed.startsWith('^')) {
    const rangeVersion = trimmed.slice(1);
    if (!isValidSemVer(rangeVersion as SemVer)) {
      return false;
    }
    const vParsed = version.split('.').map(Number);
    const rParsed = rangeVersion.split('.').map(Number);

    // Major must match, version must be >= range
    return vParsed[0] === rParsed[0] && compareSemVer(version, rangeVersion as SemVer) >= 0;
  }

  // Tilde (~) - patch-level changes (same major.minor)
  if (trimmed.startsWith('~')) {
    const rangeVersion = trimmed.slice(1);
    if (!isValidSemVer(rangeVersion as SemVer)) {
      return false;
    }
    const vParsed = version.split('.').map(Number);
    const rParsed = rangeVersion.split('.').map(Number);

    // Major and minor must match, version must be >= range
    return (
      vParsed[0] === rParsed[0] &&
      vParsed[1] === rParsed[1] &&
      compareSemVer(version, rangeVersion as SemVer) >= 0
    );
  }

  // Greater than or equal (>=)
  if (trimmed.startsWith('>=')) {
    const rangeVersion = trimmed.slice(2).trim();
    if (!isValidSemVer(rangeVersion as SemVer)) {
      return false;
    }
    return compareSemVer(version, rangeVersion as SemVer) >= 0;
  }

  // Greater than (>)
  if (trimmed.startsWith('>')) {
    const rangeVersion = trimmed.slice(1).trim();
    if (!isValidSemVer(rangeVersion as SemVer)) {
      return false;
    }
    return compareSemVer(version, rangeVersion as SemVer) > 0;
  }

  // Unknown format, be conservative
  return false;
}

/**
 * Resolve plugin dependencies and return load order
 * Uses topological sort to determine correct order
 */
export function resolveDependencies(manifests: PluginManifest[]): PluginManifest[] {
  const manifestMap = new Map<string, PluginManifest>();
  for (const m of manifests) {
    manifestMap.set(m.id, m);
  }

  // Build dependency graph
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const m of manifests) {
    if (!inDegree.has(m.id)) {
      inDegree.set(m.id, 0);
    }
    if (!dependents.has(m.id)) {
      dependents.set(m.id, []);
    }

    const deps = m.dependencies || {};
    for (const depId of Object.keys(deps)) {
      // Only count dependencies that are in our manifest list
      if (manifestMap.has(depId)) {
        inDegree.set(m.id, (inDegree.get(m.id) || 0) + 1);

        if (!dependents.has(depId)) {
          dependents.set(depId, []);
        }
        dependents.get(depId)!.push(m.id);
      }
    }
  }

  // Topological sort (Kahn's algorithm)
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: PluginManifest[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const manifest = manifestMap.get(id);
    if (manifest) {
      sorted.push(manifest);
    }

    for (const dependent of dependents.get(id) || []) {
      const newDegree = (inDegree.get(dependent) || 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Check for cycles
  if (sorted.length !== manifests.length) {
    const missing = manifests.filter((m) => !sorted.includes(m));
    log.warn(
      '[PluginValidation] Circular dependencies detected for:',
      missing.map((m) => m.id)
    );
    // Add remaining plugins anyway (may fail later)
    sorted.push(...missing);
  }

  return sorted;
}

/**
 * Validate that all dependencies are satisfied
 */
export function validateDependencies(
  manifest: PluginManifest,
  availablePlugins: Map<string, PluginManifest>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const deps = manifest.dependencies || {};

  for (const [depId, versionRange] of Object.entries(deps)) {
    const depManifest = availablePlugins.get(depId);

    if (!depManifest) {
      errors.push({
        field: `dependencies.${depId}`,
        message: `Required dependency "${depId}" is not installed`,
      });
      continue;
    }

    if (!satisfiesVersionRange(depManifest.version, versionRange)) {
      errors.push({
        field: `dependencies.${depId}`,
        message: `Dependency "${depId}" version ${depManifest.version} does not satisfy ${versionRange}`,
      });
    }
  }

  return errors;
}

/**
 * JSON Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * JSON Schema type
 * Plugin config schemas are validated with ajv (JSON Schema Draft-07).
 * The index signature allows any additional draft keywords ($ref, const,
 * tuple items, definitions, ...) to pass through to ajv.
 */
export interface JSONSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema | JSONSchema[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  definitions?: Record<string, JSONSchema>;
  [keyword: string]: unknown;
}

// Maximum string length tested against `pattern` regexes. Longer values are
// truncated before matching to guard against catastrophic backtracking
// (ReDoS) in plugin-supplied patterns.
const PATTERN_TEST_MAX_LENGTH = 1000;

/**
 * Shared ajv instance for plugin config validation.
 * - allErrors: report one error per violation (callers join them for display)
 * - strict: false: plugin schemas are third-party input; unknown keywords are
 *   ignored instead of rejected
 * - validateFormats: false: `format` is treated as an annotation (no
 *   ajv-formats dependency)
 * - verbose: errors carry `schema`/`data` so messages can reference them
 */
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});

// Replace the built-in `pattern` keyword to keep the ReDoS guard: patterns
// are compiled without the `u` flag (matching legacy behavior) and only the
// first PATTERN_TEST_MAX_LENGTH characters are tested.
ajv.removeKeyword('pattern');
ajv.addKeyword({
  keyword: 'pattern',
  type: 'string',
  schemaType: 'string',
  compile(pattern: string) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      // Surface a stable message; rethrown so compileSchema reports it
      throw new Error(`Invalid pattern: ${pattern}`, { cause: error });
    }
    return (data: string) =>
      regex.test(
        data.length > PATTERN_TEST_MAX_LENGTH
          ? data.slice(0, PATTERN_TEST_MAX_LENGTH)
          : data
      );
  },
});

// Replace the built-in `uniqueItems` keyword: ajv's deep-equal comparison
// recurses infinitely on circular structures, so keep the legacy
// JSON.stringify comparison with a reference-equality fallback.
ajv.removeKeyword('uniqueItems');
ajv.addKeyword({
  keyword: 'uniqueItems',
  type: 'array',
  schemaType: 'boolean',
  compile(unique: boolean) {
    if (!unique) {
      return () => true;
    }
    return (data: unknown[]) => {
      try {
        const serialized = data.map((v) => JSON.stringify(v));
        return new Set(serialized).size === data.length;
      } catch (error) {
        // JSON.stringify throws on circular structures; fall back to
        // reference equality so validation still completes.
        log.warn(
          '[PluginValidation] uniqueItems: falling back to reference equality:',
          error instanceof Error ? error.message : error
        );
        return new Set(data).size === data.length;
      }
    };
  },
});

// Compiled validators cached per schema object so per-request validation
// does not recompile. Failed compilations are cached too.
const compiledSchemaCache = new WeakMap<JSONSchema, ValidateFunction | Error>();

function compileSchema(schema: JSONSchema): ValidateFunction | Error {
  const cached = compiledSchemaCache.get(schema);
  if (cached) {
    return cached;
  }

  let compiled: ValidateFunction | Error;
  try {
    compiled = ajv.compile(schema);
  } catch (error) {
    compiled = error instanceof Error ? error : new Error(String(error));
    log.warn(
      '[PluginValidation] Failed to compile JSON Schema:',
      compiled.message
    );
  }
  compiledSchemaCache.set(schema, compiled);
  return compiled;
}

/**
 * Convert an ajv JSON-pointer instancePath (e.g. "/a/0/b") into the dotted
 * path format used by ValidationError fields (e.g. "a[0].b"), prefixed with
 * the caller-supplied base path.
 */
function formatFieldPath(basePath: string, instancePath: string): string {
  let field = basePath;
  if (instancePath) {
    for (const rawSegment of instancePath.slice(1).split('/')) {
      const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (/^\d+$/.test(segment)) {
        field = `${field}[${segment}]`;
      } else {
        field = field ? `${field}.${segment}` : segment;
      }
    }
  }
  return field;
}

/**
 * Map an ajv error to the ValidationError shape (one per violation)
 */
function ajvErrorToValidationError(
  error: ErrorObject,
  basePath: string
): ValidationError {
  const objectPath = formatFieldPath(basePath, error.instancePath);
  const params = error.params as Record<string, unknown>;

  // These two keywords report on the parent object; point the field at the
  // offending property instead.
  if (error.keyword === 'required') {
    const prop = String(params.missingProperty);
    return {
      field: objectPath ? `${objectPath}.${prop}` : prop,
      message: `Missing required property: ${prop}`,
    };
  }
  if (error.keyword === 'additionalProperties') {
    const prop = String(params.additionalProperty);
    return {
      field: objectPath ? `${objectPath}.${prop}` : prop,
      message: `Unknown property: ${prop}`,
    };
  }

  return {
    field: objectPath || 'value',
    message: describeViolation(error, params),
  };
}

function describeViolation(
  error: ErrorObject,
  params: Record<string, unknown>
): string {
  switch (error.keyword) {
    case 'type':
      return `Expected ${params.type}, got ${getJsonType(error.data)}`;
    case 'enum': {
      const allowed = (params.allowedValues as unknown[]) ?? [];
      return `Value must be one of: ${allowed.map((v) => JSON.stringify(v)).join(', ')}`;
    }
    case 'minLength':
      return `String must be at least ${params.limit} characters`;
    case 'maxLength':
      return `String must be at most ${params.limit} characters`;
    case 'pattern':
      return `String must match pattern: ${String(error.schema)}`;
    case 'minimum':
      return `Number must be >= ${params.limit}`;
    case 'maximum':
      return `Number must be <= ${params.limit}`;
    case 'minItems':
      return `Array must have at least ${params.limit} items`;
    case 'maxItems':
      return `Array must have at most ${params.limit} items`;
    case 'uniqueItems':
      return 'Array items must be unique';
    case 'oneOf':
      return 'Value must match exactly one of the schemas';
    case 'anyOf':
      return 'Value must match at least one of the schemas';
    default:
      return error.message || `Failed "${error.keyword}" validation`;
  }
}

/**
 * Validate a value against a JSON Schema (Draft-07, via ajv)
 */
export function validateJsonSchema(
  value: unknown,
  schema: JSONSchema,
  path: string = ''
): SchemaValidationResult {
  const compiled = compileSchema(schema);

  if (compiled instanceof Error) {
    return {
      valid: false,
      errors: [{ field: path || 'value', message: compiled.message }],
    };
  }

  if (compiled(value)) {
    return { valid: true, errors: [] };
  }

  const errors = (compiled.errors ?? []).map((error) =>
    ajvErrorToValidationError(error, path)
  );
  return { valid: false, errors };
}

/**
 * Get JSON type of a value
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Validate plugin configuration against its schema
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  schema: JSONSchema
): SchemaValidationResult {
  return validateJsonSchema(config, schema);
}
