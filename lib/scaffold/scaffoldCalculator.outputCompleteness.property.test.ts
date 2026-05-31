// Feature: stillas-calculator, Property 11: Valid calculation output is structurally complete
//
// Property 11 (design.md): For any valid calculation input, the output contains
// the total Scaffold_Length in meters, the number of bays, the number of
// levels, a Material_List, and a warnings array, all with their specified
// types.
//
// **Validates: Requirements 9.6**
//
// `calculateScaffoldMaterials` (lib/scaffold/scaffoldCalculator.ts) is the
// function under test. For valid input (all four required values finite and
// > 0) it returns `{ ok: true, output }`. This property asserts that `output`
// is structurally complete with the exact field types declared by
// `ScaffoldCalculationOutput` (lib/types.ts):
//   - totalScaffoldLengthMeters: finite number
//   - numberOfBays:              positive integer
//   - numberOfLevels:            positive integer
//   - materialList:              non-empty array of MaterialItem (correct types)
//   - warnings:                  array of strings

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput, ScaffoldSystemId } from '@/lib/types';

// ---------------------------------------------------------------------------
// Generators — valid calculation inputs (Req 9.6)
// ---------------------------------------------------------------------------

// A successful calculation requires the four required values to be finite and
// strictly greater than 0. Ranges are bounded to keep derived material
// quantities comfortably within safe-integer range while still exercising
// small bays/levels (large length / tiny bay length) and single-bay cases.
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

// Waste factor: unset (default 0), in-range, and out-of-range (exercises the
// engine's clamp). None of these change the structural completeness contract.
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
// Property 11
// ---------------------------------------------------------------------------

describe('Property 11: valid calculation output is structurally complete (Req 9.6)', () => {
  it('returns ok=true with all output fields present and correctly typed', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = calculateScaffoldMaterials(input);

        // Inputs are valid by construction, so the calculation succeeds.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const output = result.output;

        // total Scaffold_Length in meters: a finite number (Req 9.6).
        expect(typeof output.totalScaffoldLengthMeters).toBe('number');
        expect(Number.isFinite(output.totalScaffoldLengthMeters)).toBe(true);

        // number of bays: a positive integer (Req 9.2, 9.6).
        expect(typeof output.numberOfBays).toBe('number');
        expect(Number.isInteger(output.numberOfBays)).toBe(true);
        expect(output.numberOfBays).toBeGreaterThan(0);

        // number of levels: a positive integer (Req 9.4, 9.6).
        expect(typeof output.numberOfLevels).toBe('number');
        expect(Number.isInteger(output.numberOfLevels)).toBe(true);
        expect(output.numberOfLevels).toBeGreaterThan(0);

        // Material_List: a non-empty array of correctly-typed MaterialItem.
        expect(Array.isArray(output.materialList)).toBe(true);
        expect(output.materialList.length).toBeGreaterThan(0);
        for (const item of output.materialList) {
          expect(typeof item.id).toBe('string');
          expect(item.id.length).toBeGreaterThan(0);
          expect(typeof item.itemName).toBe('string');
          expect(item.itemName.length).toBeGreaterThan(0);
          expect(typeof item.quantity).toBe('number');
          expect(Number.isInteger(item.quantity)).toBe(true);
          expect(item.quantity).toBeGreaterThanOrEqual(0);
          expect(typeof item.unit).toBe('string');
          expect(item.unit.length).toBeGreaterThan(0);
          // `notes` is optional; when present it must be a string.
          if (item.notes !== undefined) {
            expect(typeof item.notes).toBe('string');
          }
        }

        // warnings: an array of strings (Req 9.6, 10.5).
        expect(Array.isArray(output.warnings)).toBe(true);
        for (const warning of output.warnings) {
          expect(typeof warning).toBe('string');
        }
      }),
      { numRuns: 300 },
    );
  });

  // Concrete example pinning the structural-completeness contract.
  it('produces a complete output on a representative input', () => {
    const result = calculateScaffoldMaterials({
      scaffoldLengthMeters: 24,
      workingHeightMeters: 10,
      bayLengthMeters: 3,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 0.7,
      scaffoldSystemId: 'generic-frame',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const output = result.output;
    expect(Number.isFinite(output.totalScaffoldLengthMeters)).toBe(true);
    expect(output.numberOfBays).toBeGreaterThan(0);
    expect(output.numberOfLevels).toBeGreaterThan(0);
    expect(output.materialList.length).toBeGreaterThan(0);
    expect(Array.isArray(output.warnings)).toBe(true);
  });
});
