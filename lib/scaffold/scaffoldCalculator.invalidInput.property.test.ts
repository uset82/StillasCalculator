// Feature: stillas-calculator, Property 9: Invalid calculation inputs are rejected without side effects
//
// Property 9 (design.md): For any calculation input where
//   scaffoldLengthMeters <= 0, bayLengthMeters <= 0, or liftHeightMeters <= 0,
// `calculateScaffoldMaterials` returns an invalid-input error identifying the
// offending value, produces no Material_List, and leaves the Project_State
// unchanged.
//
// **Validates: Requirements 9.3, 9.7**
//
// `calculateScaffoldMaterials` (lib/scaffold/scaffoldCalculator.ts) is the
// function under test. It is a PURE function that never reads or writes
// Project_State, so "leaves the Project_State unchanged" is established two
// ways here:
//   1. The function returns `{ ok: false, error }` with no `output`/Material_List.
//   2. Because the function is pure, it must not mutate the input object it is
//      given — we assert the input is deeply unchanged (deep-equal before/after).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type { ScaffoldCalculationInput, ScaffoldSystemId } from '@/lib/types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const finiteDouble = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

// A strictly-positive, finite value -> always passes the > 0 precondition.
const positiveArb = (min: number, max: number): fc.Arbitrary<number> =>
  finiteDouble(min, max);

// A non-positive, finite value (<= 0, includes 0 and negatives) -> always
// fails the > 0 precondition and is reported as an offending value (Req 9.3, 9.7).
const nonPositiveArb: fc.Arbitrary<number> = finiteDouble(-100_000, 0);

const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

const wasteFactorArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant(undefined),
  finiteDouble(0, 100),
  finiteDouble(-50, 200),
);

/** Choose a value that is either valid-positive or offending-non-positive. */
const fieldArb = (offending: boolean): fc.Arbitrary<number> =>
  offending ? nonPositiveArb : positiveArb(0.01, 100_000);

// Generate an input where AT LEAST ONE of scaffoldLength/bayLength/liftHeight
// is <= 0, while every other required value stays valid. We carry the chosen
// "offending" flags alongside the input so the property knows exactly which
// fields the engine must flag.
interface InvalidCase {
  input: ScaffoldCalculationInput;
  expectedInvalidFields: string[];
}

const invalidCaseArb: fc.Arbitrary<InvalidCase> = fc
  .tuple(fc.boolean(), fc.boolean(), fc.boolean())
  .chain(([a, b, c]) => {
    // Guarantee at least one offending field (Req 9.3, 9.7 trigger).
    const [oLen, oBay, oLift] = a || b || c ? [a, b, c] : [true, b, c];

    return fc
      .record({
        scaffoldLengthMeters: fieldArb(oLen),
        bayLengthMeters: fieldArb(oBay),
        liftHeightMeters: fieldArb(oLift),
        // Always-valid required value so the only failures come from the three
        // fields under test (keeps `missingFields` empty).
        workingHeightMeters: positiveArb(0.01, 100),
        // Not part of the > 0 precondition; kept valid/realistic.
        scaffoldWidthMeters: positiveArb(0.01, 5),
        scaffoldSystemId: systemIdArb,
        wasteFactorPercent: wasteFactorArb,
      })
      .map((input) => {
        const expectedInvalidFields: string[] = [];
        if (oLen) expectedInvalidFields.push('scaffoldLengthMeters');
        if (oBay) expectedInvalidFields.push('bayLengthMeters');
        if (oLift) expectedInvalidFields.push('liftHeightMeters');
        return { input, expectedInvalidFields };
      });
  });

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Property 9: invalid calculation inputs are rejected without side effects (Req 9.3, 9.7)', () => {
  it('rejects any non-positive scaffold/bay/lift, identifies it, yields no Material_List, and does not mutate input', () => {
    fc.assert(
      fc.property(invalidCaseArb, ({ input, expectedInvalidFields }) => {
        // Snapshot the input so we can prove the pure function mutated nothing
        // (stands in for "Project_State unchanged", Req 9.7).
        const before = structuredClone(input);

        const result = calculateScaffoldMaterials(input);

        // Rejected with an invalid-input error (Req 9.3, 9.7).
        expect(result.ok).toBe(false);
        if (result.ok) return; // narrow for TypeScript

        expect(result.error.kind).toBe('invalid-input');

        // The error identifies every offending value, and only those (no
        // false positives, no missing-field noise since all are present).
        expect([...result.error.invalidFields].sort()).toEqual(
          [...expectedInvalidFields].sort(),
        );
        expect(result.error.missingFields).toEqual([]);

        // A human-readable message is present.
        expect(typeof result.error.message).toBe('string');
        expect(result.error.message.length).toBeGreaterThan(0);

        // No Material_List / output is produced (Req 9.3, 9.7).
        expect(result).not.toHaveProperty('output');

        // The input object is deeply unchanged — the function is pure and
        // touched no external state (Req 9.7).
        expect(input).toStrictEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  // Representative examples pinning Property 9 on named cases.
  it('rejects representative non-positive inputs and identifies the offending field', () => {
    const base: ScaffoldCalculationInput = {
      scaffoldLengthMeters: 10,
      workingHeightMeters: 10,
      bayLengthMeters: 2.5,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 0.7,
      scaffoldSystemId: 'generic-frame',
    };

    // scaffoldLength <= 0 (Req 9.7).
    const badLength = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: 0,
    });
    expect(badLength.ok).toBe(false);
    if (!badLength.ok) {
      expect(badLength.error.invalidFields).toContain('scaffoldLengthMeters');
      expect(badLength).not.toHaveProperty('output');
    }

    // bayLength <= 0 (Req 9.3).
    const badBay = calculateScaffoldMaterials({
      ...base,
      bayLengthMeters: -1,
    });
    expect(badBay.ok).toBe(false);
    if (!badBay.ok) {
      expect(badBay.error.invalidFields).toContain('bayLengthMeters');
    }

    // liftHeight <= 0 (Req 9.3).
    const badLift = calculateScaffoldMaterials({
      ...base,
      liftHeightMeters: 0,
    });
    expect(badLift.ok).toBe(false);
    if (!badLift.ok) {
      expect(badLift.error.invalidFields).toContain('liftHeightMeters');
    }

    // Multiple offending values are all identified.
    const badAll = calculateScaffoldMaterials({
      ...base,
      scaffoldLengthMeters: -5,
      bayLengthMeters: 0,
      liftHeightMeters: -0.1,
    });
    expect(badAll.ok).toBe(false);
    if (!badAll.ok) {
      expect([...badAll.error.invalidFields].sort()).toEqual(
        ['bayLengthMeters', 'liftHeightMeters', 'scaffoldLengthMeters'].sort(),
      );
    }
  });
});
