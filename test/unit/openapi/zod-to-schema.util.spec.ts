import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import { zodObjectPropertySchemas, zodRequiredFields, zodToApiSchema } from '../../../src/common/openapi/zod-to-schema.util.js';

describe('zodToApiSchema', () => {
  it('converts a basic object schema to an OpenAPI-compatible SchemaObject without leaking $schema', () => {
    const schema = z.object({ name: z.string().min(2).max(50), age: z.number().int().min(0).optional() });
    const result = zodToApiSchema(schema);

    expect(result.$schema).toBeUndefined();
    expect(result.type).toBe('object');
    expect(result.properties?.name).toMatchObject({ type: 'string', minLength: 2, maxLength: 50 });
    expect(result.required).toEqual(['name']);
  });

  it('captures enum values', () => {
    const schema = z.object({ role: z.enum(['customer', 'admin']) });
    const result = zodToApiSchema(schema);
    expect(result.properties?.role).toMatchObject({ enum: ['customer', 'admin'] });
  });

  it('captures regex-validated string fields (e.g. numeric id params) as a pattern', () => {
    const schema = z.object({ customerId: z.string().regex(/^[1-9][0-9]*$/) });
    const result = zodToApiSchema(schema);
    expect((result.properties?.customerId as Record<string, unknown>).pattern).toBeDefined();
  });

  it('captures a .default(...) value on the field schema itself', () => {
    const schema = z.object({ page: z.coerce.number().int().positive().default(1) });
    const result = zodToApiSchema(schema);
    expect(result.properties?.page).toMatchObject({ default: 1 });
  });

  it('reflects .strict() as additionalProperties: false', () => {
    const schema = z.object({ a: z.string() }).strict();
    const result = zodToApiSchema(schema);
    expect(result.additionalProperties).toBe(false);
  });
});

describe('zodObjectPropertySchemas / zodRequiredFields', () => {
  it('exposes per-field schemas usable for individual @ApiQuery decorators', () => {
    const schema = z.object({ q: z.string().optional(), limit: z.coerce.number().int().positive().default(20) });
    const properties = zodObjectPropertySchemas(schema);
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(['q', 'limit']));
  });

  it('returns the required field names of a top-level object schema', () => {
    const schema = z.object({ required1: z.string(), optional1: z.string().optional() });
    expect(zodRequiredFields(schema)).toEqual(['required1']);
  });
});
