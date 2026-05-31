// Feature: ai-agent-building-drawing, Task 1.4 — malformed coordinate rejection.
//
// Unit tests for `coordinatesToClosedRing` (lib/ai/geometryToolArgs.ts) covering
// Requirement 12.6:
//
//   "IF a Geometry_Tool receives a coordinate list containing more than 10,000
//    coordinate pairs, or a coordinate pair that is not exactly two finite
//    numeric values, THEN THE AI_Agent SHALL reject the input, return an error
//    to the model identifying the malformed coordinate input, and leave the
//    Project_State unchanged."
//
// `coordinatesToClosedRing` is the single, pure adapter that converts a
// model-supplied [lon, lat] coordinate list into a closed GeoJSON ring before
// the Geometry_Engine validation/storage step. Because it is pure (no I/O, no
// state mutation), "leave the Project_State unchanged" is verified structurally:
// a rejected input MUST return `{ ok: false, error }` carrying no polygon and
// MUST NOT throw. A caller that only ever stores `polygon` from an `ok: true`
// result therefore leaves Project_State untouched on every rejection here.
//
// Validates: Requirements 12.6

import { describe, it, expect } from 'vitest';

import {
  coordinatesToClosedRing,
  MAX_COORDINATE_PAIRS,
  type ClosedRingResult,
} from './geometryToolArgs';

/**
 * Assert a result is a rejection that (a) names the malformed coordinate input,
 * (b) carries no polygon, satisfying "leave the Project_State unchanged" for a
 * pure converter whose only state-affecting output is the produced polygon.
 */
function expectRejection(result: ClosedRingResult): void {
  expect(result.ok).toBe(false);
  if (result.ok) return; // type-narrowing guard
  expect(typeof result.error).toBe('string');
  // The error must identify the input as malformed coordinate input (Req 12.6).
  expect(result.error.toLowerCase()).toContain('malformed coordinate input');
  // No polygon is produced on rejection — nothing could reach Project_State.
  expect('polygon' in result).toBe(false);
}

describe('coordinatesToClosedRing — malformed coordinate rejection (Req 12.6)', () => {
  describe('the >10,000-pair limit', () => {
    it('accepts a list with exactly MAX_COORDINATE_PAIRS pairs (boundary, not rejected)', () => {
      // A square-ish ring repeated up to the limit; values are well-formed so
      // the size guard is the only thing under test. Exactly 10,000 is allowed.
      const coordinates = Array.from({ length: MAX_COORDINATE_PAIRS }, (_, i) => [
        i * 0.0001,
        1,
      ]);
      expect(coordinates.length).toBe(MAX_COORDINATE_PAIRS);

      const result = coordinatesToClosedRing(coordinates);

      // The size guard rejects only > MAX; the boundary value passes the guard.
      expect(result.ok).toBe(true);
    });

    it('rejects a list with more than MAX_COORDINATE_PAIRS pairs and reports the count', () => {
      const tooMany = MAX_COORDINATE_PAIRS + 1;
      const coordinates = Array.from({ length: tooMany }, (_, i) => [i * 0.0001, 1]);

      const result = coordinatesToClosedRing(coordinates);

      expectRejection(result);
      if (!result.ok) {
        // The error identifies the offending size against the documented max.
        expect(result.error).toContain(String(tooMany));
        expect(result.error).toContain(String(MAX_COORDINATE_PAIRS));
      }
    });
  });

  describe('pairs that are not exactly two finite numbers', () => {
    it('rejects a pair with too few components (length 1)', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [1], // malformed: only one component
        [2, 2],
      ]);

      expectRejection(result);
      if (!result.ok) {
        // The error identifies the index of the malformed pair (Req 12.6).
        expect(result.error).toContain('index 1');
      }
    });

    it('rejects a pair with too many components (length 3)', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [1, 2, 3], // malformed: three components
      ]);

      expectRejection(result);
      if (!result.ok) {
        expect(result.error).toContain('index 1');
      }
    });

    it('rejects a pair containing a non-numeric value (string)', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        ['1', 2], // malformed: longitude is a string
      ]);

      expectRejection(result);
    });

    it('rejects a pair containing null', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [1, null], // malformed: latitude is null
      ]);

      expectRejection(result);
    });

    it('rejects a pair containing NaN', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [Number.NaN, 1], // malformed: not finite
      ]);

      expectRejection(result);
    });

    it('rejects a pair containing Infinity', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [1, Number.POSITIVE_INFINITY], // malformed: not finite
      ]);

      expectRejection(result);
    });

    it('rejects a pair containing -Infinity', () => {
      const result = coordinatesToClosedRing([
        [Number.NEGATIVE_INFINITY, 0], // malformed at index 0
        [1, 1],
      ]);

      expectRejection(result);
      if (!result.ok) {
        expect(result.error).toContain('index 0');
      }
    });

    it('rejects a pair that is not an array', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        { lon: 1, lat: 2 } as unknown, // malformed: object instead of [lon, lat] pair
      ]);

      expectRejection(result);
    });

    it('rejects an empty nested pair (length 0)', () => {
      const result = coordinatesToClosedRing([
        [0, 0],
        [], // malformed: no components
      ]);

      expectRejection(result);
    });
  });

  describe('non-array top-level input', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
      ['a string', 'not coordinates'],
      ['an object', { type: 'Polygon' }],
    ])('rejects %s as the coordinate list', (_label, input) => {
      const result = coordinatesToClosedRing(input);
      expectRejection(result);
    });
  });

  describe('Project_State is left unchanged on rejection', () => {
    // `coordinatesToClosedRing` is pure: it performs no state mutation and only
    // ever exposes a polygon through an `ok: true` result. Confirming that every
    // malformed input returns `ok: false` with no polygon and without throwing
    // proves a caller would leave Project_State untouched on rejection.
    const malformedInputs: ReadonlyArray<readonly [string, unknown]> = [
      ['too many pairs', Array.from({ length: MAX_COORDINATE_PAIRS + 1 }, () => [0, 0])],
      ['a non-finite pair', [[0, 0], [Number.NaN, 0], [1, 1]]],
      ['a wrong-length pair', [[0, 0], [1], [2, 2]]],
      ['a non-array input', 'nope'],
    ];

    it.each(malformedInputs)(
      'does not throw and produces no polygon for %s',
      (_label, input) => {
        let result: ClosedRingResult | undefined;
        // A pure converter must never throw on untrusted input — it returns a
        // rejection instead, so the caller's Project_State write never runs.
        expect(() => {
          result = coordinatesToClosedRing(input);
        }).not.toThrow();

        expect(result).toBeDefined();
        if (result) {
          expectRejection(result);
        }
      }
    );
  });
});
