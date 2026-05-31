// Feature: stillas-calculator, Property 10: Calculation is deterministic
//
// Property 10 (design.md): For any valid calculation input, invoking
// `calculateScaffoldMaterials` twice (in any order, any number of times, on any
// device or session) produces deeply-equal outputs.
//
// `calculateScaffoldMaterials` (lib/scaffold/scaffoldCalculator.ts) is a pure
// function with no I/O, clock, or randomness, so determinism must hold for
// EVERY input — not just the valid ones. We therefore generate both valid
// inputs (all four required values finite and > 0) and invalid ones (missing,
// NaN, non-finite, zero, or negative values), invoke the calculator several
// times (2..5) on the exact same input object, and assert that every result is
// deeply equal to the first. This covers both the `{ ok: true, output }` and
// the `{ ok: false, error }` branches of the discriminated CalculationResult.
//
// **Validates: Requirements 9.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateScaffoldMaterials } from './scaffoldCalculator';
import type {
  ScaffoldCalculationInput,
  ScaffoldSystemId,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

// A "well-behaved" finite double in a bounded range.
const finiteDouble = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

// Values that exercise the validation/rejection branch as well as the valid
// branch: finite positives, zero, negatives, NaN, and the non-finite
// infinities. Determinism must hold across all of them.
const messyNumberArb: fc.Arbitrary<number> = fc.oneof(
  finiteDouble(0.01, 100_000), // valid positive
  fc.constant(0), // rejected: <= 0
  finiteDouble(-1000, -0.01), // rejected: negative
  fc.constant(Number.NaN), // treated as missing
  fc.constant(Number.POSITIVE_INFINITY), // rejected: non-finite
  fc.constant(Number.NEGATIVE_INFINITY), // rejected: non-finite
);

// An optionally-present numeric field (covers the "missing" branch via
// undefined) used for the required values, so we exercise rejection too.
const maybeMessyNumberArb: fc.Arbitrary<number | undefined> = fc.oneof(
  messyNumberArb,
  fc.constant(undefined),
);

// Waste factor: unset, in-range, and deliberately out-of-range so the engine's
// internal clamp is exercised; non-finite values are included as well.
const wasteFactorArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant(undefined),
  finiteDouble(0, 100),
  finiteDouble(-50, 200),
  fc.constant(Number.NaN),
);

// Arbitrary scaffold calculation input mixing valid and invalid combinations.
// `as ScaffoldCalculationInput` because some generated records intentionally
// leave required numeric fields undefined to drive the rejection branch.
const inputArb: fc.Arbitrary<ScaffoldCalculationInput> = fc.record({
  scaffoldLengthMeters: maybeMessyNumberArb,
  workingHeightMeters: maybeMessyNumberArb,
  bayLengthMeters: maybeMessyNumberArb,
  liftHeightMeters: maybeMessyNumberArb,
  scaffoldWidthMeters: finiteDouble(0.01, 5),
  scaffoldSystemId: systemIdArb,
  wasteFactorPercent: wasteFactorArb,
}) as fc.Arbitrary<ScaffoldCalculationInput>;

// How many times to invoke the calculator on the same input.
const repeatCountArb: fc.Arbitrary<number> = fc.integer({ min: 2, max: 5 });

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: calculation is deterministic (Req 9.5)', () => {
  it('repeated invocations on the same input produce deeply-equal outputs', () => {
    fc.assert(
      fc.property(inputArb, repeatCountArb, (input, times) => {
        const first = calculateScaffoldMaterials(input);

        // Every subsequent invocation on the identical input must be deeply
        // equal to the first — same ok flag, same output/error structure.
        for (let i = 1; i < times; i++) {
          const next = calculateScaffoldMaterials(input);
          expect(next).toEqual(first);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('determinism holds independently of intervening calls on other inputs', () => {
    // Determinism must not depend on call order or hidden state: interleaving a
    // call on a different input between two calls on the same input must not
    // change the result for the original input.
    fc.assert(
      fc.property(inputArb, inputArb, (inputA, inputB) => {
        const a1 = calculateScaffoldMaterials(inputA);
        // Intervening invocation on a different input.
        calculateScaffoldMaterials(inputB);
        const a2 = calculateScaffoldMaterials(inputA);

        expect(a2).toEqual(a1);
      }),
      { numRuns: 300 },
    );
  });
});
