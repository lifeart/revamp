/**
 * Plugin Validation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  checkVersionCompatibility,
  getRevampVersion,
  satisfiesVersionRange,
  resolveDependencies,
  validateDependencies,
  validateJsonSchema,
  validatePluginConfig,
  type JSONSchema,
} from './validation.js';
import type { PluginManifest, SemVer } from './types.js';

describe('Manifest Validation', () => {
  const validManifest = {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'Test Author',
    revampVersion: '1.0.0',
    main: 'index.js',
  };

  it('should validate a correct manifest', () => {
    const errors = validateManifest(validManifest);
    expect(errors).toHaveLength(0);
  });

  it('should reject non-object manifest', () => {
    const errors = validateManifest('invalid');
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('manifest');
  });

  it('should require id field', () => {
    const { id: _, ...manifest } = validManifest;
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('should validate id format', () => {
    const errors = validateManifest({ ...validManifest, id: 'Invalid-ID' });
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('should validate version format', () => {
    const errors = validateManifest({ ...validManifest, version: 'invalid' });
    expect(errors.some((e) => e.field === 'version')).toBe(true);
  });

  it('should validate hooks array', () => {
    const errors = validateManifest({ ...validManifest, hooks: ['invalid:hook'] });
    expect(errors.some((e) => e.field === 'hooks')).toBe(true);
  });

  it('should validate permissions array', () => {
    const errors = validateManifest({ ...validManifest, permissions: ['invalid:perm'] });
    expect(errors.some((e) => e.field === 'permissions')).toBe(true);
  });
});

describe('Version Compatibility', () => {
  it('should return current revamp version', () => {
    const version = getRevampVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should accept compatible version', () => {
    expect(checkVersionCompatibility('1.0.0')).toBe(true);
  });

  it('should reject incompatible major version', () => {
    expect(checkVersionCompatibility('2.0.0')).toBe(false);
  });
});

describe('Version Range Satisfaction', () => {
  it('should match exact version', () => {
    expect(satisfiesVersionRange('1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.0.0', '1.0.1')).toBe(false);
  });

  it('should handle caret (^) ranges', () => {
    expect(satisfiesVersionRange('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.0.0', '^1.0.0')).toBe(true);
    expect(satisfiesVersionRange('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfiesVersionRange('0.9.0', '^1.0.0')).toBe(false);
  });

  it('should handle tilde (~) ranges', () => {
    expect(satisfiesVersionRange('1.0.5', '~1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.0.0', '~1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.1.0', '~1.0.0')).toBe(false);
  });

  it('should handle >= ranges', () => {
    expect(satisfiesVersionRange('1.0.0', '>=1.0.0')).toBe(true);
    expect(satisfiesVersionRange('2.0.0', '>=1.0.0')).toBe(true);
    expect(satisfiesVersionRange('0.9.0', '>=1.0.0')).toBe(false);
  });

  it('should handle > ranges', () => {
    expect(satisfiesVersionRange('1.0.1', '>1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.0.0', '>1.0.0')).toBe(false);
  });
});

describe('Dependency Resolution', () => {
  it('should return empty array for empty input', () => {
    expect(resolveDependencies([])).toHaveLength(0);
  });

  it('should return single plugin unchanged', () => {
    const manifest: PluginManifest = {
      id: 'com.test.plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
    };
    const result = resolveDependencies([manifest]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('com.test.plugin');
  });

  it('should order plugins by dependencies', () => {
    const pluginA: PluginManifest = {
      id: 'com.test.a',
      name: 'A',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
      dependencies: { 'com.test.b': '1.0.0' },
    };
    const pluginB: PluginManifest = {
      id: 'com.test.b',
      name: 'B',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
    };

    const result = resolveDependencies([pluginA, pluginB]);
    const indexA = result.findIndex((p) => p.id === 'com.test.a');
    const indexB = result.findIndex((p) => p.id === 'com.test.b');
    expect(indexB).toBeLessThan(indexA);
  });
});

describe('Dependency Validation', () => {
  it('should validate when no dependencies', () => {
    const manifest: PluginManifest = {
      id: 'com.test.plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
    };
    const errors = validateDependencies(manifest, new Map());
    expect(errors).toHaveLength(0);
  });

  it('should report missing dependency', () => {
    const manifest: PluginManifest = {
      id: 'com.test.plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
      dependencies: { 'com.test.missing': '1.0.0' },
    };
    const errors = validateDependencies(manifest, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('not installed');
  });

  it('should report version mismatch', () => {
    const manifest: PluginManifest = {
      id: 'com.test.plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      author: 'Test',
      revampVersion: '1.0.0',
      main: 'index.js',
      dependencies: { 'com.test.dep': '^2.0.0' },
    };
    const available = new Map<string, PluginManifest>([
      [
        'com.test.dep',
        {
          id: 'com.test.dep',
          name: 'Dep',
          version: '1.0.0',
          description: 'Test',
          author: 'Test',
          revampVersion: '1.0.0',
          main: 'index.js',
        },
      ],
    ]);
    const errors = validateDependencies(manifest, available);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('does not satisfy');
  });
});

describe('JSON Schema Validation', () => {
  describe('Type Validation', () => {
    it('should validate string type', () => {
      const schema: JSONSchema = { type: 'string' };
      expect(validateJsonSchema('hello', schema).valid).toBe(true);
      expect(validateJsonSchema(123, schema).valid).toBe(false);
    });

    it('should validate number type', () => {
      const schema: JSONSchema = { type: 'number' };
      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema(123.45, schema).valid).toBe(true);
      expect(validateJsonSchema('123', schema).valid).toBe(false);
    });

    it('should validate integer type', () => {
      const schema: JSONSchema = { type: 'integer' };
      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema(123.45, schema).valid).toBe(false);
    });

    it('should validate boolean type', () => {
      const schema: JSONSchema = { type: 'boolean' };
      expect(validateJsonSchema(true, schema).valid).toBe(true);
      expect(validateJsonSchema(false, schema).valid).toBe(true);
      expect(validateJsonSchema('true', schema).valid).toBe(false);
    });

    it('should validate array type', () => {
      const schema: JSONSchema = { type: 'array' };
      expect(validateJsonSchema([], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema({}, schema).valid).toBe(false);
    });

    it('should validate object type', () => {
      const schema: JSONSchema = { type: 'object' };
      expect(validateJsonSchema({}, schema).valid).toBe(true);
      expect(validateJsonSchema({ a: 1 }, schema).valid).toBe(true);
      expect(validateJsonSchema([], schema).valid).toBe(false);
    });

    it('should validate null type', () => {
      const schema: JSONSchema = { type: 'null' };
      expect(validateJsonSchema(null, schema).valid).toBe(true);
      expect(validateJsonSchema(undefined, schema).valid).toBe(false);
    });
  });

  describe('String Constraints', () => {
    it('should validate minLength', () => {
      const schema: JSONSchema = { type: 'string', minLength: 3 };
      expect(validateJsonSchema('abc', schema).valid).toBe(true);
      expect(validateJsonSchema('ab', schema).valid).toBe(false);
    });

    it('should validate maxLength', () => {
      const schema: JSONSchema = { type: 'string', maxLength: 3 };
      expect(validateJsonSchema('abc', schema).valid).toBe(true);
      expect(validateJsonSchema('abcd', schema).valid).toBe(false);
    });

    it('should validate pattern', () => {
      const schema: JSONSchema = { type: 'string', pattern: '^[a-z]+$' };
      expect(validateJsonSchema('abc', schema).valid).toBe(true);
      expect(validateJsonSchema('ABC', schema).valid).toBe(false);
    });

    it('should handle invalid regex pattern gracefully', () => {
      const schema: JSONSchema = { type: 'string', pattern: '[invalid(' };
      const result = validateJsonSchema('test', schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Invalid pattern');
    });

    it('should truncate very long strings for pattern matching', () => {
      const schema: JSONSchema = { type: 'string', pattern: '^[a-z]+$' };
      const longString = 'a'.repeat(2000);
      // Should not throw and should validate the truncated version
      const result = validateJsonSchema(longString, schema);
      expect(result.valid).toBe(true);
    });
  });

  describe('Number Constraints', () => {
    it('should validate minimum', () => {
      const schema: JSONSchema = { type: 'number', minimum: 5 };
      expect(validateJsonSchema(5, schema).valid).toBe(true);
      expect(validateJsonSchema(10, schema).valid).toBe(true);
      expect(validateJsonSchema(4, schema).valid).toBe(false);
    });

    it('should validate maximum', () => {
      const schema: JSONSchema = { type: 'number', maximum: 10 };
      expect(validateJsonSchema(10, schema).valid).toBe(true);
      expect(validateJsonSchema(5, schema).valid).toBe(true);
      expect(validateJsonSchema(11, schema).valid).toBe(false);
    });
  });

  describe('Array Constraints', () => {
    it('should validate minItems', () => {
      const schema: JSONSchema = { type: 'array', minItems: 2 };
      expect(validateJsonSchema([1, 2], schema).valid).toBe(true);
      expect(validateJsonSchema([1], schema).valid).toBe(false);
    });

    it('should validate maxItems', () => {
      const schema: JSONSchema = { type: 'array', maxItems: 2 };
      expect(validateJsonSchema([1, 2], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(false);
    });

    it('should validate uniqueItems', () => {
      const schema: JSONSchema = { type: 'array', uniqueItems: true };
      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 2, 2], schema).valid).toBe(false);
    });

    it('should handle uniqueItems with circular references gracefully', () => {
      const schema: JSONSchema = { type: 'array', uniqueItems: true };
      // Create an object with circular reference
      const obj1: Record<string, unknown> = { name: 'a' };
      const obj2: Record<string, unknown> = { name: 'b' };
      obj1.self = obj1; // circular reference
      obj2.self = obj2; // circular reference

      // Should not throw, falls back to reference equality
      const result = validateJsonSchema([obj1, obj2], schema);
      expect(result.valid).toBe(true);

      // Same reference twice should fail
      const result2 = validateJsonSchema([obj1, obj1], schema);
      expect(result2.valid).toBe(false);
    });

    it('should validate items schema', () => {
      const schema: JSONSchema = { type: 'array', items: { type: 'number' } };
      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 'two', 3], schema).valid).toBe(false);
    });
  });

  describe('Object Constraints', () => {
    it('should validate required properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      };
      expect(validateJsonSchema({ name: 'test' }, schema).valid).toBe(true);
      expect(validateJsonSchema({}, schema).valid).toBe(false);
    });

    it('should validate property types', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };
      expect(validateJsonSchema({ name: 'test', age: 25 }, schema).valid).toBe(true);
      expect(validateJsonSchema({ name: 'test', age: 'twenty-five' }, schema).valid).toBe(false);
    });

    it('should reject additional properties when configured', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      };
      expect(validateJsonSchema({ name: 'test' }, schema).valid).toBe(true);
      expect(validateJsonSchema({ name: 'test', extra: 'value' }, schema).valid).toBe(false);
    });

    it('should validate additional properties against schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: { type: 'number' },
      };
      expect(validateJsonSchema({ name: 'test', count: 5 }, schema).valid).toBe(true);
      expect(validateJsonSchema({ name: 'test', count: 'five' }, schema).valid).toBe(false);
    });
  });

  describe('Enum Validation', () => {
    it('should validate enum values', () => {
      const schema: JSONSchema = { enum: ['a', 'b', 'c'] };
      expect(validateJsonSchema('a', schema).valid).toBe(true);
      expect(validateJsonSchema('d', schema).valid).toBe(false);
    });

    it('should validate enum with different types', () => {
      const schema: JSONSchema = { enum: [1, 'two', true] };
      expect(validateJsonSchema(1, schema).valid).toBe(true);
      expect(validateJsonSchema('two', schema).valid).toBe(true);
      expect(validateJsonSchema(true, schema).valid).toBe(true);
      expect(validateJsonSchema('one', schema).valid).toBe(false);
    });
  });

  describe('Composition Keywords', () => {
    it('should validate oneOf', () => {
      const schema: JSONSchema = {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      };
      expect(validateJsonSchema('hello', schema).valid).toBe(true);
      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema(true, schema).valid).toBe(false);
    });

    it('should validate anyOf', () => {
      const schema: JSONSchema = {
        anyOf: [{ type: 'string', minLength: 5 }, { type: 'number' }],
      };
      expect(validateJsonSchema('hello', schema).valid).toBe(true);
      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema('hi', schema).valid).toBe(false);
    });

    it('should validate allOf', () => {
      const schema: JSONSchema = {
        allOf: [{ type: 'number' }, { minimum: 5 }],
      };
      expect(validateJsonSchema(10, schema).valid).toBe(true);
      expect(validateJsonSchema(3, schema).valid).toBe(false);
    });
  });

  describe('validatePluginConfig', () => {
    it('should validate plugin config against schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string', minLength: 10 },
          timeout: { type: 'integer', minimum: 0, maximum: 60000 },
        },
      };

      expect(validatePluginConfig({ apiKey: '0123456789' }, schema).valid).toBe(true);
      expect(validatePluginConfig({ apiKey: '0123456789', timeout: 5000 }, schema).valid).toBe(true);
      expect(validatePluginConfig({}, schema).valid).toBe(false);
      expect(validatePluginConfig({ apiKey: 'short' }, schema).valid).toBe(false);
    });
  });
});
