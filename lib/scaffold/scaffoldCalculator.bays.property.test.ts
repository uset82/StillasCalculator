// Feature: stillas-calculator, Property 7: Number of bays is a correct ceiling division
//
// Property 7 (design.md): For any valid calculation input, `numberOfBays` is a
// positive integer equal to `ceil(adjustedLength / bayLengthMeters)`,
// satisfying the bracketing inequality
//   (numberOfBays - 1) * bayLengthMeters < adjustedLength <= numberOfBays * bayLengthMeters
// where adjustedLength = scaffoldLengthMeters * (1 + clamp(wasteFactorPercent, 0, 100) / 100).
//
// **Validates: Requirements 9.2**
//
// `calculateScaffoldMaterials` (lib/scaffold/scaffoldCalculator.ts) is the
// function under test; we read `output.numberOfBays` from its successful
// result. The bracketing inequality is checked with a small relative
// floating-point tolerance because adjustedLength, the division, and the
// products are all computed in IEEE-754 doubles.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput, ScaffoldSystemId } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp `value` into the inclusive range [min, max] — mirrors the engine. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Recompute the waste-adjusted length exactly as the engine does (Req 9.1). */
function adjustedLengthOf(input: ScaffoldCalculationInput): number {
  const wasteRaw = input.wasteFactorPercent ?? 0;
  const wasteFactor = Number.isFinite(wasteRaw) ? clamp(wasteRaw, 0, 100) : 0;
  return input.scaffoldLengthMeters * (1 + wasteFactor / 100);
}

// ---------------------------------------------------------------------------
// Generators — valid calculation inputs (Req 9.1, 9.2)
// ---------------------------------------------------------------------------

// All four required values must be finite and strictly greater than 0 for a
// successful calculation. Ranges are bounded to keep products comfortably
// within safe-integer range while still exercising small bays (large length /
// tiny bay length) and single-bay cases (length <= bay length).
const finiteDouble = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const scaffoldLengthArb = finiteDouble(0.01, 100_000);
const bayLengthArb = finiteDouble(0.01, 100);
const workingHeightArb = finiteDouble(0.01, 100);
const liftHeightArb = finiteDouble(0.01, 100);
const scaffoldWidthArb = finiteDouble(0.01, 5);

const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

// Waste factor: unset (default 0), in-range, and deliberately out-of-range so
// the engine's clamp(·, 0, 100) is exercised; the test recomputes with the
// same clamp so the expected bays stay aligned.
const wasteFactorArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant(undefined),
  finiteDouble(0, 100),
  finiteDouble(-50, 200),
);

const inputArb: fc.Arbitrary<ScaffoldCalculationInput> = fc.record({
  scaffoldLengthMeters: scaffoldLengthArb,
  workingHeightMeters: workingHeightArb,
  bayLengthMeters: bayLengthArb,
  liftHeightMeters: liftHeightArb,
  scaffoldWidthMeters: scaffoldWidthArb,
  scaffoldSystemId: systemIdArb,
  wasteFactorPercent: wasteFactorArb,
});

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Property 7: number of bays is a correct ceiling division (Req 9.2)', () => {
  it('numberOfBays is a positive integer = ceil(adjustedLength / bayLength) and brackets adjustedLength', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = calculateScaffoldMaterials(input);

        // Inputs are valid by construction, so the calculation succeeds.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { numberOfBays } = result.output;
        const adjustedLength = adjustedLengthOf(input);
        const bayLength = input.bayLengthMeters;

        // Positive integer (Req 9.2).
        expect(Number.isInteger(numberOfBays)).toBe(true);
        expect(numberOfBays).toBeGreaterThan(0);

        // Exact ceiling division: recomputing the same way the engine does
        // must reproduce the reported value bit-for-bit.
        expect(numberOfBays).toBe(Math.ceil(adjustedLength / bayLength));

        // Bracketing inequality with a small relative float tolerance:
        //   (numberOfBays - 1) * bayLength < adjustedLength <= numberOfBays * bayLength
        const lower = (numberOfBays - 1) * bayLength;
        const upper = numberOfBays * bayLength;
        const tol = 1e-9 * Math.max(1, adjustedLength, upper);

        // adjustedLength <= numberOfBays * bayLength (within tolerance)
        expect(adjustedLength).toBeLessThanOrEqual(upper + tol);
        // (numberOfBays - 1) * bayLength < adjustedLength (within tolerance)
        expect(lower).toBeLessThan(adjustedLength + tol);
      }),
      { numRuns: 300 },
    );
  });

  // Concrete examples pinning the same Property 7 behavior on named cases.
  it('matches ceiling division on representative examples', () => {
    const base = {
      workingHeightMeters: 10,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 0.7,
      scaffoldSystemId: 'generic-frame' as ScaffoldSystemId,
    };

    // 10 / 2.5 = 4 exactly -> 4 bays.
    const exact = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: 10,
      bayLengthMeters: 2.5,
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.output.numberOfBays).toBe(4);

    // 10 / 3 = 3.33... -> ceil -> 4 bays.
    const ceilUp = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: 10,
      bayLengthMeters: 3,
    });
    expect(ceilUp.ok).toBe(true);
    if (ceilUp.ok) expect(ceilUp.output.numberOfBays).toBe(4);

    // length <= bayLength -> exactly 1 bay.
    const single = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: 1.5,
      bayLengthMeters: 3,
    });
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.output.numberOfBays).toBe(1);

    // Waste factor grows the adjusted length: 10 * 1.5 = 15, 15 / 3 = 5 bays.
    const withWaste = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: 10,
      bayLengthMeters: 3,
      wasteFactorPercent: 50,
    });
    expect(withWaste.ok).toBe(true);
    if (withWaste.ok) expect(withWaste.output.numberOfBays).toBe(5);
  });
});
