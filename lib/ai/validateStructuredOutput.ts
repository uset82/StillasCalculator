// Structured Output schema validation (Req 13.4, Property 26).
//
// A small, dependency-free validator for the local {@link JsonSchema} subset the
// AI layer uses (object/array/scalar shapes, enums, nullability, numeric bounds,
// and `additionalProperties: false`). It is the single shared implementation the
// `/api/ai/chat` route uses to reject any nonconforming Material_List or report
// summary before it can be presented (Req 13.4), and that the Property 26 test
// exercises directly. Extracted from the route so the exact same logic is both
// used in production and verified in isolation.

import type { JsonSchema } from '@/lib/ai/schemas';

/**
 * Validates `value` against the local {@link JsonSchema} subset used by the AI
 * layer (object/array/scalar shapes, enums, nullability, numeric bounds, and
 * `additionalProperties: false`). Returns the list of human-readable errors; an
 * empty list means the value conforms. Used to reject any nonconforming
 * Structured Output before it can be presented (Req 13.4, Property 26).
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '$',
): string[] {
  const errors: string[] = [];
  const types =
    schema.type === undefined
      ? []
      : Array.isArray(schema.type)
        ? schema.type
        : [schema.type];

  if (value === null) {
    if (types.length === 0 || types.includes('null')) {
      return errors;
    }
    errors.push(`${path}: expected ${types.join(' | ')} but got null`);
    return errors;
  }

  const matchesType = (t: string): boolean => {
    switch (t) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return false;
    }
  };

  if (types.length > 0 && !types.some(matchesType)) {
    errors.push(`${path}: expected ${types.join(' | ')}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path}: value is not one of the permitted enum values`);
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: ${value} is above the maximum ${schema.maximum}`);
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = schema.properties ?? {};

    for (const required of schema.required ?? []) {
      if (!(required in obj)) {
        errors.push(`${path}.${required}: required property is missing`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key}: additional property is not allowed`);
        }
      }
    }

    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(obj[key], subSchema, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((element, index) => {
      errors.push(
        ...validateAgainstSchema(element, schema.items as JsonSchema, `${path}[${index}]`),
      );
    });
  }

  return errors;
}
