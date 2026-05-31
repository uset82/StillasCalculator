// Feature: stillas-calculator, Property 3: Scaffold length aggregation
//
// Property 3 (design.md "Correctness Properties"):
//   For any valid polygon and any selection of side indices, the computed
//   Scaffold_Length equals the sum of the selected side lengths; when no subset
//   is selected it equals the full perimeter; and when the selected subset is
//   empty (or sums to 0) the Scaffold_Length is 0.
//
// Validates: Requirements 6.7, 6.8, 6.9
//
// `computeScaffoldLength` operates on a `PolygonMeasurements` value, so these
// generators synthesize valid measurements directly: a random list of
// non-negative side lengths with `perimeterMeters` set to their exact sum (the
// invariant `measurePolygon` always upholds, see Property 1). Index selections
// are drawn to deliberately include out-of-range and non-integer values plus
// duplicates so the "treat the selection as a set of valid side indices"
// behaviour is exercised across many inputs.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeScaffoldLength } from './turfMeasurements';
import type { PolygonMeasurements } from '@/lib/types';

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators and helpers
// ---------------------------------------------------------------------------

/** Builds a valid PolygonMeasurements from a list of side lengths. */
function measurementsFromSides(sides: number[]): PolygonMeasurements {
  const perimeterMeters = sides.reduce((total, side) => total + side, 0);
  return {
    perimeterMeters,
    areaSquareMeters: 0,
    sideLengthsMeters: sides,
    valid: true,
  };
}

/** Non-negative finite side lengths, at least one side. */
const sideLengthsArb: fc.Arbitrary<number[]> = fc.array(
  fc.double({ min: 0, max: 1000, noNaN: true }),
  { minLength: 1, maxLength: 12 },
);

const measurementsArb: fc.Arbitrary<PolygonMeasurements> =
  sideLengthsArb.map(measurementsFromSides);

/**
 * Candidate index values for a polygon of `n` sides. Mixes:
 *   - in-range and out-of-range integers, and
 *   - arbitrary doubles (frequently non-integers),
 * so the property exercises the dedup / range-filter / integer-filter logic.
 */
function indexValueArb(n: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: -3, max: n + 3 }),
    fc.double({ min: -3, max: n + 3, noNaN: true }),
  );
}

/** A measurement paired with an arbitrary (possibly messy) index selection. */
const measurementsAndSelectionArb: fc.Arbitrary<{
  measurements: PolygonMeasurements;
  selection: number[];
}> = sideLengthsArb.chain((sides) =>
  fc
    .array(indexValueArb(sides.length), { maxLength: 24 })
    .map((selection) => ({
      measurements: measurementsFromSides(sides),
      selection,
    })),
);

/**
 * Reference implementation of the aggregation rule: sum the side lengths at the
 * unique, in-range, integer indices, in first-seen order (matching how
 * `computeScaffoldLength` accumulates over its index set).
 */
function expectedSelectedSum(sides: number[], selection: number[]): number {
  const seen = new Set<number>();
  let total = 0;
  for (const index of selection) {
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < sides.length &&
      !seen.has(index)
    ) {
      seen.add(index);
      total += sides[index];
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

describe('Property 3: Scaffold length aggregation', () => {
  it('returns the full perimeter when no facade subset is selected (null)', () => {
    fc.assert(
      fc.property(measurementsArb, (measurements) => {
        // No subset selected -> the whole perimeter (Req 6.8).
        expect(computeScaffoldLength(measurements, null)).toBe(
          measurements.perimeterMeters,
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('returns 0 when the selected subset is empty', () => {
    fc.assert(
      fc.property(measurementsArb, (measurements) => {
        // Empty selection contributes nothing (Req 6.9).
        expect(computeScaffoldLength(measurements, [])).toBe(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('returns the sum of the selected side lengths (dedup, ignoring out-of-range/non-integer indices)', () => {
    fc.assert(
      fc.property(measurementsAndSelectionArb, ({ measurements, selection }) => {
        const actual = computeScaffoldLength(measurements, selection);
        const expected = expectedSelectedSum(
          measurements.sideLengthsMeters,
          selection,
        );
        // Both accumulate the same values in the same order, so they match
        // within a small floating-point tolerance (Req 6.7).
        const tolerance = 1e-9 * (1 + Math.abs(expected));
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('returns 0 when every selected side has length 0 (subset sums to 0)', () => {
    const zeroSumArb = fc.integer({ min: 1, max: 12 }).chain((n) =>
      fc
        .record({
          positives: fc.array(
            fc.double({ min: 0.001, max: 1000, noNaN: true }),
            { minLength: n, maxLength: n },
          ),
          zeroIndices: fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), {
            minLength: 1,
            maxLength: n,
          }),
        })
        .map(({ positives, zeroIndices }) => {
          const sides = positives.slice();
          for (const index of zeroIndices) {
            sides[index] = 0;
          }
          return {
            measurements: measurementsFromSides(sides),
            selection: zeroIndices,
          };
        }),
    );

    fc.assert(
      fc.property(zeroSumArb, ({ measurements, selection }) => {
        // A non-empty subset whose sides are all 0 m yields 0 (Req 6.9).
        expect(computeScaffoldLength(measurements, selection)).toBe(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
