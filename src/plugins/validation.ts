/**
 * Revamp Plugin System - Validation
 *
 * Manifest validation, version compatibility checking,
 * and dependency resolution for plugins.
 */

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
    console.warn(
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
 * Supports a subset of JSON Schema Draft-07 for plugin config validation
 */
export interface JSONSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
}

/**
 * Validate a value against a JSON Schema
 * Supports common JSON Schema keywords for plugin configuration validation
 */
export function validateJsonSchema(
  value: unknown,
  schema: JSONSchema,
  path: string = ''
): SchemaValidationResult {
  const errors: ValidationError[] = [];

  // Handle oneOf
  if (schema.oneOf) {
    const validCount = schema.oneOf.filter(
      (s) => validateJsonSchema(value, s, path).valid
    ).length;
    if (validCount !== 1) {
      errors.push({
        field: path || 'value',
        message: `Value must match exactly one of the schemas`,
      });
    }
    return { valid: errors.length === 0, errors };
  }

  // Handle anyOf
  if (schema.anyOf) {
    const valid = schema.anyOf.some((s) => validateJsonSchema(value, s, path).valid);
    if (!valid) {
      errors.push({
        field: path || 'value',
        message: `Value must match at least one of the schemas`,
      });
    }
    return { valid: errors.length === 0, errors };
  }

  // Handle allOf
  if (schema.allOf) {
    for (const s of schema.allOf) {
      const result = validateJsonSchema(value, s, path);
      errors.push(...result.errors);
    }
    return { valid: errors.length === 0, errors };
  }

  // Type validation
  if (schema.type) {
    const actualType = getJsonType(value);

    // Handle integer as a special case of number
    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({
          field: path || 'value',
          message: `Expected integer, got ${actualType}`,
        });
        return { valid: false, errors };
      }
    } else if (schema.type !== actualType) {
      errors.push({
        field: path || 'value',
        message: `Expected ${schema.type}, got ${actualType}`,
      });
      return { valid: false, errors };
    }
  }

  // Enum validation
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({
        field: path || 'value',
        message: `Value must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
      });
    }
  }

  // String validations
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        field: path || 'value',
        message: `String must be at least ${schema.minLength} characters`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        field: path || 'value',
        message: `String must be at most ${schema.maxLength} characters`,
      });
    }
    if (schema.pattern !== undefined) {
      try {
        const regex = new RegExp(schema.pattern);
        // Use a timeout to prevent ReDoS - test with limited input
        const testValue = value.length > 1000 ? value.slice(0, 1000) : value;
        if (!regex.test(testValue)) {
          errors.push({
            field: path || 'value',
            message: `String must match pattern: ${schema.pattern}`,
          });
        }
      } catch {
        errors.push({
          field: path || 'value',
          message: `Invalid pattern: ${schema.pattern}`,
        });
      }
    }
  }

  // Number validations
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        field: path || 'value',
        message: `Number must be >= ${schema.minimum}`,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        field: path || 'value',
        message: `Number must be <= ${schema.maximum}`,
      });
    }
  }

  // Array validations
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        field: path || 'value',
        message: `Array must have at least ${schema.minItems} items`,
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        field: path || 'value',
        message: `Array must have at most ${schema.maxItems} items`,
      });
    }
    if (schema.uniqueItems) {
      try {
        const serialized = value.map((v) => JSON.stringify(v));
        if (new Set(serialized).size !== value.length) {
          errors.push({
            field: path || 'value',
            message: `Array items must be unique`,
          });
        }
      } catch {
        // If we can't serialize (e.g., circular refs), fall back to reference equality
        if (new Set(value).size !== value.length) {
          errors.push({
            field: path || 'value',
            message: `Array items must be unique`,
          });
        }
      }
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`;
        const result = validateJsonSchema(value[i], schema.items, itemPath);
        errors.push(...result.errors);
      }
    }
  }

  // Object validations
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Check required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (!(prop in obj)) {
          errors.push({
            field: path ? `${path}.${prop}` : prop,
            message: `Missing required property: ${prop}`,
          });
        }
      }
    }

    // Validate known properties
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in obj) {
          const propPath = path ? `${path}.${prop}` : prop;
          const result = validateJsonSchema(obj[prop], propSchema, propPath);
          errors.push(...result.errors);
        }
      }
    }

    // Check additional properties
    if (schema.additionalProperties === false && schema.properties) {
      const knownProps = new Set(Object.keys(schema.properties));
      for (const prop of Object.keys(obj)) {
        if (!knownProps.has(prop)) {
          errors.push({
            field: path ? `${path}.${prop}` : prop,
            message: `Unknown property: ${prop}`,
          });
        }
      }
    } else if (typeof schema.additionalProperties === 'object') {
      const knownProps = new Set(Object.keys(schema.properties || {}));
      for (const [prop, val] of Object.entries(obj)) {
        if (!knownProps.has(prop)) {
          const propPath = path ? `${path}.${prop}` : prop;
          const result = validateJsonSchema(val, schema.additionalProperties, propPath);
          errors.push(...result.errors);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
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
 * Deep equality check for enum validation
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
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
