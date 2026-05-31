import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput } from '@/lib/types';

// Feature: stillas-calculator, Property 6: Adjusted length formula
//
// Property 6 (design.md): For any valid calculation input, the adjusted length
// equals `scaffoldLengthMeters * (1 + clamp(wasteFactorPercent, 0, 100) / 100)`,
// equals the scaffold length exactly when the waste factor is 0, and is greater
// than or equal to the scaffold length for any waste factor in 0 to 100.
//
// The adjusted length is surfaced as `output.totalScaffoldLengthMeters` from a
// successful `calculateScaffoldMaterials` result (Req 9.6). Core Formula:
//   wasteFactor    = clamp(wasteFactorPercent ?? 0, 0, 100)
//   adjustedLength = scaffoldLengthMeters * (1 + wasteFactor / 100)
//
// **Validates: Requirements 9.1**

/** Mirror of the engine's clamp, used to compute the expected adjusted length. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Relative + absolute floating-point tolerance. The adjusted length can grow
 * large (scaffoldLength up to 1e6, waste up to 100%), so a purely absolute
 * epsilon is too strict; scale tolerance with the magnitude of the expected
 * value.
 */
function closeEnough(actual: number, expected: number): boolean {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) <= tolerance;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// All four required inputs must be present, finite, and > 0 for a successful
// calculation. We constrain each to its valid input space (design Field
// Validation Rules): scaffold length > 0, bay/lift 0.01..5, working height
// 0.01..100.
const scaffoldLengthArb: fc.Arbitrary<number> = fc.double({
  min: 1e-3,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

const bayLengthArb: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 5,
  noNaN: true,
  noDefaultInfinity: true,
});

const liftHeightArb: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 5,
  noNaN: true,
  noDefaultInfinity: true,
});

const workingHeightArb: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

// A waste factor that exercises the clamp on both ends: includes the in-range
// 0..100 band as well as negative and >100 values that must be clamped.
const wasteFactorArb: fc.Arbitrary<number> = fc.double({
  min: -50,
  max: 200,
  noNaN: true,
  noDefaultInfinity: true,
});

// A waste factor strictly within the documented 0..100 range, used for the
// monotonicity (>= scaffoldLength) assertion.
const wasteInRangeArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

function makeInput(
  overrides: Partial<ScaffoldCalculationInput>
): ScaffoldCalculationInput {
  return {
    scaffoldLengthMeters: 10,
    workingHeightMeters: 10,
    bayLengthMeters: 2.5,
    liftHeightMeters: 2,
    scaffoldWidthMeters: 0.7,
    scaffoldSystemId: 'generic-frame',
    ...overrides,
  };
}

describe('calculateScaffoldMaterials — Property 6: adjusted length formula', () => {
  it('adjusted length equals scaffoldLength * (1 + clamp(waste, 0, 100) / 100)', () => {
    fc.assert(
      fc.property(
        scaffoldLengthArb,
        bayLengthArb,
        liftHeightArb,
        workingHeightArb,
        wasteFactorArb,
        (scaffoldLength, bayLength, liftHeight, workingHeight, waste) => {
          const input = makeInput({
            scaffoldLengthMeters: scaffoldLength,
            bayLengthMeters: bayLength,
            liftHeightMeters: liftHeight,
            workingHeightMeters: workingHeight,
            wasteFactorPercent: waste,
          });

          const result = calculateScaffoldMaterials(input);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const expected =
            scaffoldLength * (1 + clamp(waste, 0, 100) / 100);
          expect(
            closeEnough(result.output.totalScaffoldLengthMeters, expected)
          ).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('equals the scaffold length exactly when the waste factor is 0', () => {
    fc.assert(
      fc.property(
        scaffoldLengthArb,
        bayLengthArb,
        liftHeightArb,
        workingHeightArb,
        (scaffoldLength, bayLength, liftHeight, workingHeight) => {
          const input = makeInput({
            scaffoldLengthMeters: scaffoldLength,
            bayLengthMeters: bayLength,
            liftHeightMeters: liftHeight,
            workingHeightMeters: workingHeight,
            wasteFactorPercent: 0,
          });

          const result = calculateScaffoldMaterials(input);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // At waste 0 the formula is exact: scaffoldLength * (1 + 0) === scaffoldLength.
          expect(result.output.totalScaffoldLengthMeters).toBe(scaffoldLength);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('is >= the scaffold length for any waste factor in 0 to 100', () => {
    fc.assert(
      fc.property(
        scaffoldLengthArb,
        bayLengthArb,
        liftHeightArb,
        workingHeightArb,
        wasteInRangeArb,
        (scaffoldLength, bayLength, liftHeight, workingHeight, waste) => {
          const input = makeInput({
            scaffoldLengthMeters: scaffoldLength,
            bayLengthMeters: bayLength,
            liftHeightMeters: liftHeight,
            workingHeightMeters: workingHeight,
            wasteFactorPercent: waste,
          });

          const result = calculateScaffoldMaterials(input);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(
            result.output.totalScaffoldLengthMeters
          ).toBeGreaterThanOrEqual(scaffoldLength);
        }
      ),
      { numRuns: 200 }
    );
  });
});
