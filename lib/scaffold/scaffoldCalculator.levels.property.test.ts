import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput } from '@/lib/types';

// Feature: stillas-calculator, Property 8: Number of levels is a correct ceiling division
//
// Property 8 (design.md): For any valid calculation input, `numberOfLevels` is
// a positive integer equal to `ceil(workingHeightMeters / liftHeightMeters)`,
// satisfying
//   (numberOfLevels - 1) * liftHeightMeters < workingHeightMeters
//                                          <= numberOfLevels * liftHeightMeters.
//
// **Validates: Requirements 9.4**
//
// `calculateScaffoldMaterials(input)` is the implementation under test. Only
// the `numberOfLevels` field of a successful output is exercised here; bays,
// adjusted length, and material rules are covered by their own properties.

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A finite double in [min, max] with no NaN/Infinity. Used to build the
// valid-input space the calculator accepts (every value > 0).
function finiteDouble(min: number, max: number): fc.Arbitrary<number> {
  return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
}

// Valid scaffold inputs per the task constraints: a positive scaffold length,
// bay and lift heights in 0.01..5 m, and a working height in 0.01..100 m. The
// scaffold width and system id are required by the type but do not affect
// numberOfLevels.
const validInputArb: fc.Arbitrary<ScaffoldCalculationInput> = fc.record({
  scaffoldLengthMeters: finiteDouble(0.01, 1000),
  workingHeightMeters: finiteDouble(0.01, 100),
  bayLengthMeters: finiteDouble(0.01, 5),
  liftHeightMeters: finiteDouble(0.01, 5),
  scaffoldWidthMeters: finiteDouble(0.5, 3),
  scaffoldSystemId: fc.constant('generic-frame' as const),
  wasteFactorPercent: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
});

describe('calculateScaffoldMaterials — Property 8: number of levels is a correct ceiling division', () => {
  it('numberOfLevels is a positive integer equal to ceil(workingHeight / liftHeight) and brackets the working height', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = calculateScaffoldMaterials(input);

        // Inputs are all strictly positive, so the calculation must succeed.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { numberOfLevels } = result.output;
        const { workingHeightMeters, liftHeightMeters } = input;

        // Positive integer.
        expect(Number.isInteger(numberOfLevels)).toBe(true);
        expect(numberOfLevels).toBeGreaterThanOrEqual(1);

        // Equals the ceiling division.
        expect(numberOfLevels).toBe(
          Math.ceil(workingHeightMeters / liftHeightMeters),
        );

        // Bracketing inequality, with a relative float tolerance to absorb
        // rounding at the boundaries:
        //   (L - 1) * lift < workingHeight <= L * lift
        const tolerance =
          1e-9 * Math.max(1, workingHeightMeters, liftHeightMeters);

        const lowerBound = (numberOfLevels - 1) * liftHeightMeters;
        const upperBound = numberOfLevels * liftHeightMeters;

        expect(workingHeightMeters).toBeGreaterThan(lowerBound - tolerance);
        expect(workingHeightMeters).toBeLessThanOrEqual(upperBound + tolerance);
      }),
      { numRuns: 200 },
    );
  });
});
