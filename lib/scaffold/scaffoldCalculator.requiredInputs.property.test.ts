// Feature: stillas-calculator, Property 16: Calculation requires all inputs
//
// Property 16 (design.md): For any calculation request in which Scaffold_Length,
// Working_Height, Bay_Length, or Lift_Height is missing or unset, no
// Material_List is produced and every missing value is identified.
//
// **Validates: Requirements 8.4**
//
// `calculateScaffoldMaterials` (lib/scaffold/scaffoldCalculator.ts) treats a
// required field as "missing"/unset when its value is null, undefined, or NaN.
// On any missing required input it returns `{ ok: false, error }` whose
// `error.missingFields` lists each missing field, and it produces no successful
// `output` (hence no Material_List).
//
// This test generates inputs in which a non-empty random subset of the four
// required fields { scaffoldLengthMeters, workingHeightMeters, bayLengthMeters,
// liftHeightMeters } is missing (set to null / undefined / NaN) while every
// other field holds a valid, finite, strictly-positive value. It then asserts:
//   - result.ok === false (the calculation is rejected),
//   - no `output` / Material_List is produced, and
//   - error.missingFields contains EXACTLY the fields we made missing.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput, ScaffoldSystemId } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The four required fields, in the order the engine reports them. */
const REQUIRED_FIELDS = [
  'scaffoldLengthMeters',
  'workingHeightMeters',
  'bayLengthMeters',
  'liftHeightMeters',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A finite, strictly-positive value that the engine accepts as present + valid. */
const validValueArb: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * A "missing"/unset value: null, undefined, or NaN. These are the three forms
 * the engine treats as missing (Req 8.4).
 */
const missingValueArb: fc.Arbitrary<number | null | undefined> = fc.constantFrom(
  null,
  undefined,
  NaN,
);

const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

const wasteFactorArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
);

/**
 * Generates a non-empty subset of the four required fields to mark as missing.
 * We draw one boolean per field and force at least one to be true, so the
 * resulting input always has at least one missing required value.
 */
const missingSubsetArb: fc.Arbitrary<RequiredField[]> = fc
  .record({
    scaffoldLengthMeters: fc.boolean(),
    workingHeightMeters: fc.boolean(),
    bayLengthMeters: fc.boolean(),
    liftHeightMeters: fc.boolean(),
  })
  .chain((flags) => {
    const chosen = REQUIRED_FIELDS.filter((f) => flags[f]);
    if (chosen.length > 0) return fc.constant(chosen);
    // Degenerate all-false draw: pick exactly one field to be missing instead.
    return fc.constantFrom(...REQUIRED_FIELDS).map((f) => [f]);
  });

/**
 * Builds a calculation input where exactly the fields in `missing` are unset
 * (null / undefined / NaN) and every other required field — plus width, system,
 * and the optional waste factor — holds a valid value.
 */
const scenarioArb = missingSubsetArb.chain((missing) =>
  fc
    .record({
      scaffoldLengthMeters: validValueArb,
      workingHeightMeters: validValueArb,
      bayLengthMeters: validValueArb,
      liftHeightMeters: validValueArb,
      scaffoldWidthMeters: validValueArb,
      scaffoldSystemId: systemIdArb,
      wasteFactorPercent: wasteFactorArb,
      // One missing value per required field; only those in `missing` are used.
      missingScaffoldLength: missingValueArb,
      missingWorkingHeight: missingValueArb,
      missingBayLength: missingValueArb,
      missingLiftHeight: missingValueArb,
    })
    .map((draw) => {
      const missingByField: Record<RequiredField, number | null | undefined> = {
        scaffoldLengthMeters: draw.missingScaffoldLength,
        workingHeightMeters: draw.missingWorkingHeight,
        bayLengthMeters: draw.missingBayLength,
        liftHeightMeters: draw.missingLiftHeight,
      };

      const input = {
        scaffoldLengthMeters: draw.scaffoldLengthMeters,
        workingHeightMeters: draw.workingHeightMeters,
        bayLengthMeters: draw.bayLengthMeters,
        liftHeightMeters: draw.liftHeightMeters,
        scaffoldWidthMeters: draw.scaffoldWidthMeters,
        scaffoldSystemId: draw.scaffoldSystemId,
        wasteFactorPercent: draw.wasteFactorPercent,
      } as ScaffoldCalculationInput;

      for (const field of missing) {
        // Intentionally assign a missing value; the field type is `number`, so
        // cast through `unknown` to model the "empty/unset" runtime case.
        (input as unknown as Record<string, unknown>)[field] =
          missingByField[field];
      }

      return { input, missing };
    }),
);

// ---------------------------------------------------------------------------
// Property 16
// ---------------------------------------------------------------------------

describe('Property 16: calculation requires all inputs (Req 8.4)', () => {
  it('rejects with no Material_List and identifies exactly each missing required value', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input, missing }) => {
        const result = calculateScaffoldMaterials(input);

        // The request is rejected: no successful output, hence no Material_List.
        expect(result.ok).toBe(false);
        if (result.ok) return;

        // No Material_List / output is produced on the rejected result.
        expect('output' in result).toBe(false);
        expect(
          (result as unknown as { output?: unknown }).output,
        ).toBeUndefined();

        // Every missing value is identified — exactly the fields we unset.
        expect(result.error.kind).toBe('invalid-input');
        expect([...result.error.missingFields].sort()).toEqual(
          [...missing].sort(),
        );

        // Since the remaining required fields are valid and present, none of
        // them should be flagged as missing or invalid.
        expect(
          result.error.invalidFields.some((f) =>
            (missing as string[]).includes(f),
          ),
        ).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  // Concrete examples pinning Property 16 on named cases.
  it('identifies missing values on representative examples', () => {
    const valid = {
      scaffoldLengthMeters: 10,
      workingHeightMeters: 8,
      bayLengthMeters: 2.5,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 0.7,
      scaffoldSystemId: 'generic-frame' as ScaffoldSystemId,
    };

    // Single missing field (working height unset).
    const oneMissing = calculateScaffoldMaterials({
      ...valid,
      workingHeightMeters: undefined as unknown as number,
    });
    expect(oneMissing.ok).toBe(false);
    if (!oneMissing.ok) {
      expect(oneMissing.error.missingFields).toEqual(['workingHeightMeters']);
    }

    // Multiple missing fields, using null and NaN as the unset forms.
    const manyMissing = calculateScaffoldMaterials({
      ...valid,
      scaffoldLengthMeters: null as unknown as number,
      bayLengthMeters: NaN,
    });
    expect(manyMissing.ok).toBe(false);
    if (!manyMissing.ok) {
      expect([...manyMissing.error.missingFields].sort()).toEqual(
        ['bayLengthMeters', 'scaffoldLengthMeters'].sort(),
      );
    }

    // All four missing.
    const allMissing = calculateScaffoldMaterials({
      ...valid,
      scaffoldLengthMeters: undefined as unknown as number,
      workingHeightMeters: null as unknown as number,
      bayLengthMeters: NaN,
      liftHeightMeters: undefined as unknown as number,
    });
    expect(allMissing.ok).toBe(false);
    if (!allMissing.ok) {
      expect([...allMissing.error.missingFields].sort()).toEqual(
        [...REQUIRED_FIELDS].sort(),
      );
    }
  });
});
