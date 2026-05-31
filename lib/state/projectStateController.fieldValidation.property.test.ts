import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ProjectStateController,
  createProjectStateController,
} from './projectStateController';
import { buildMaterialList } from '@/lib/scaffold/materialRules';
import type {
  DimensionField,
  ProjectState,
  ScaffoldCalculationOutput,
  UpdateResult,
} from '@/lib/types';

// Feature: stillas-calculator, Property 14: Field validation is total and atomic
//
// Property 14 (design.md): For any field with a defined range
//   - waste factor          numeric 0..100          (setWasteFactor)
//   - decimal places         integer 0..3           (setDecimalPlaces)
//   - working height         numeric 0.01..100      (setWorkingHeight)
//   - bay/lift/width (calc)  numeric 0.01..5        (setDimension, 'calculator')
//   - dimensions (system)    numeric >0 and <=100   (setDimension, 'systemEditor')
//   - manual quantity        integer 0..999999      (setMaterialQuantity)
// and for any candidate value, the controller accepts the value if and only if
// it is numeric and within range (and an integer where required). On rejection
// it retains the last valid value, leaves the rest of Project_State unchanged,
// and reports a validation error identifying the field. The rule is applied
// identically whether the value originates from a manual control or an AI tool
// call — both flow through these same validated updaters (Req 12.5).
//
// **Validates: Requirements 6.11, 7.3, 7.6, 8.1, 8.2, 8.3, 11.3, 11.6, 12.5, 17.5**

// ---------------------------------------------------------------------------
// Candidate-value generators
// ---------------------------------------------------------------------------
//
// Each candidate generator deliberately mixes in-range values, out-of-range
// values, non-numeric specials (NaN / ±Infinity), and (for integer fields)
// non-integers, so the "accept iff numeric-and-in-range(-and-integer)"
// biconditional is exercised from both sides.

/** Non-numeric / non-finite specials that every updater must reject. */
const SPECIALS: fc.Arbitrary<number> = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/** Finite doubles within [lo, hi] (never NaN, never ±Infinity). */
function finite(lo: number, hi: number): fc.Arbitrary<number> {
  return fc.double({ min: lo, max: hi, noNaN: true });
}

/**
 * Candidates for a numeric (non-integer-constrained) field whose valid range is
 * [min, max]. Spans well beyond the range and biases toward in-range values so
 * both acceptance and rejection branches get coverage.
 */
function numericCandidates(min: number, max: number): fc.Arbitrary<number> {
  const span = max - min;
  const lo = min - span;
  const hi = max + span;
  return fc.oneof(finite(lo, hi), finite(min, max), finite(lo, hi), SPECIALS);
}

/**
 * Candidates for an integer-constrained field whose valid range is [min, max].
 * Mixes integers (in and out of range), non-integer doubles, and specials.
 */
function integerCandidates(min: number, max: number): fc.Arbitrary<number> {
  const span = max - min;
  const lo = min - Math.max(1, Math.round(span * 0.5));
  const hi = max + Math.max(1, Math.round(span * 0.5));
  return fc.oneof(
    fc.integer({ min: lo, max: hi }),
    fc.integer({ min, max }),
    finite(lo, hi),
    SPECIALS,
  );
}

// ---------------------------------------------------------------------------
// Acceptance predicates — must mirror the controller's "Field Validation Rules"
// ---------------------------------------------------------------------------

const isFiniteNum = (v: number): boolean => Number.isFinite(v);
const inRange = (v: number, lo: number, hi: number): boolean =>
  isFiniteNum(v) && v >= lo && v <= hi;
const intInRange = (v: number, lo: number, hi: number): boolean =>
  isFiniteNum(v) && Number.isInteger(v) && v >= lo && v <= hi;

// ---------------------------------------------------------------------------
// Generic scalar-field harness
// ---------------------------------------------------------------------------
//
// Establishes a prior valid value on a fresh controller, snapshots the whole
// Project_State, applies a candidate, and asserts the total + atomic contract:
//   - acceptance iff the predicate holds;
//   - on acceptance only the targeted field changes (deep-equal elsewhere);
//   - on rejection the entire state is unchanged (the prior valid value is
//     retained) and the error identifies the field.

interface ScalarFieldCase {
  /** The Project_State key the updater writes and the error must identify. */
  fieldName: keyof ProjectState;
  apply: (controller: ProjectStateController, value: number) => UpdateResult;
  priorArb: fc.Arbitrary<number>;
  candidateArb: fc.Arbitrary<number>;
  isAccepted: (value: number) => boolean;
}

function runScalarFieldValidation(testCase: ScalarFieldCase): void {
  fc.assert(
    fc.property(testCase.priorArb, testCase.candidateArb, (prior, candidate) => {
      // Fresh controller per case (no state shared between examples).
      const controller = createProjectStateController();

      const setup = testCase.apply(controller, prior);
      expect(setup.ok, 'the prior in-range value must be accepted').toBe(true);

      const before = structuredClone(controller.getState());
      const result = testCase.apply(controller, candidate);
      const accepted = testCase.isAccepted(candidate);

      // Total: the result is decided purely by numeric-and-in-range.
      expect(result.ok).toBe(accepted);

      const after = controller.getState();
      if (accepted) {
        // The targeted field now holds exactly the candidate...
        expect((after as unknown as Record<string, unknown>)[testCase.fieldName]).toBe(
          candidate,
        );
        // ...and nothing else changed.
        const normalized = {
          ...after,
          [testCase.fieldName]: (before as unknown as Record<string, unknown>)[
            testCase.fieldName
          ],
        };
        expect(normalized).toEqual(before);
      } else {
        // Atomic rejection: field-identifying error, state fully retained.
        expect(result.error?.field).toBe(testCase.fieldName);
        expect(after).toEqual(before);
      }
    }),
    { numRuns: 200 },
  );
}

describe('ProjectStateController — Property 14: field validation is total and atomic', () => {
  it('setWasteFactor accepts iff numeric in 0..100, else retains state', () => {
    runScalarFieldValidation({
      fieldName: 'wasteFactorPercent',
      apply: (controller, value) => controller.setWasteFactor(value),
      priorArb: finite(0, 100),
      candidateArb: numericCandidates(0, 100),
      isAccepted: (value) => inRange(value, 0, 100),
    });
  });

  it('setDecimalPlaces accepts iff integer in 0..3, else retains state', () => {
    runScalarFieldValidation({
      fieldName: 'decimalPlaces',
      apply: (controller, value) => controller.setDecimalPlaces(value),
      priorArb: fc.integer({ min: 0, max: 3 }),
      candidateArb: integerCandidates(0, 3),
      isAccepted: (value) => intInRange(value, 0, 3),
    });
  });

  it('setWorkingHeight accepts iff numeric in 0.01..100, else retains state', () => {
    runScalarFieldValidation({
      fieldName: 'workingHeightMeters',
      apply: (controller, value) => controller.setWorkingHeight(value),
      priorArb: finite(0.01, 100),
      candidateArb: numericCandidates(0.01, 100),
      isAccepted: (value) => inRange(value, 0.01, 100),
    });
  });

  // --- setDimension: range depends on the editing context -------------------

  const DIMENSION_FIELDS = fc.constantFrom<DimensionField>(
    'bayLengthMeters',
    'liftHeightMeters',
    'scaffoldWidthMeters',
  );

  it('setDimension (calculator) accepts iff numeric in 0.01..5, else retains state', () => {
    fc.assert(
      fc.property(
        DIMENSION_FIELDS,
        finite(0.01, 5),
        numericCandidates(0.01, 5),
        (field, prior, candidate) => {
          const controller = createProjectStateController();
          expect(controller.setDimension(field, prior, 'calculator').ok).toBe(
            true,
          );

          const before = structuredClone(controller.getState());
          const result = controller.setDimension(field, candidate, 'calculator');
          const accepted = inRange(candidate, 0.01, 5);

          expect(result.ok).toBe(accepted);

          const after = controller.getState();
          if (accepted) {
            expect(after[field]).toBe(candidate);
            expect({ ...after, [field]: before[field] }).toEqual(before);
          } else {
            expect(result.error?.field).toBe(field);
            expect(after).toEqual(before);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('setDimension (systemEditor) accepts iff numeric >0 and <=100, else retains state', () => {
    fc.assert(
      fc.property(
        DIMENSION_FIELDS,
        finite(0.001, 100),
        numericCandidates(0, 100),
        (field, prior, candidate) => {
          const controller = createProjectStateController();
          expect(
            controller.setDimension(field, prior, 'systemEditor').ok,
          ).toBe(true);

          const before = structuredClone(controller.getState());
          const result = controller.setDimension(
            field,
            candidate,
            'systemEditor',
          );
          const accepted = isFiniteNum(candidate) && candidate > 0 && candidate <= 100;

          expect(result.ok).toBe(accepted);

          const after = controller.getState();
          if (accepted) {
            expect(after[field]).toBe(candidate);
            expect({ ...after, [field]: before[field] }).toEqual(before);
          } else {
            expect(result.error?.field).toBe(field);
            expect(after).toEqual(before);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // --- setMaterialQuantity: integer 0..999999 on an existing item -----------

  // A representative material list to seed the adjusted list before editing.
  const SEED_OUTPUT: ScaffoldCalculationOutput = {
    totalScaffoldLengthMeters: 12,
    numberOfBays: 3,
    numberOfLevels: 2,
    materialList: buildMaterialList(3, 2, 'generic-frame').items,
    warnings: [],
  };
  const SEED_ITEM_IDS: string[] = SEED_OUTPUT.materialList.map((item) => item.id);

  it('setMaterialQuantity accepts iff integer in 0..999999, else retains state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SEED_ITEM_IDS.length - 1 }),
        integerCandidates(0, 999999),
        (itemIndex, candidate) => {
          const controller = createProjectStateController();
          // Seed the adjusted material list (these quantities are valid).
          controller.applyCalculation(SEED_OUTPUT);

          const itemId = SEED_ITEM_IDS[itemIndex];
          const before = structuredClone(controller.getState());
          const result = controller.setMaterialQuantity(itemId, candidate);
          const accepted = intInRange(candidate, 0, 999999);

          expect(result.ok).toBe(accepted);

          const after = controller.getState();
          if (accepted) {
            // Only the targeted item's quantity changed.
            const expected = structuredClone(before);
            expected.materialListAdjusted![itemIndex].quantity = candidate;
            expect(after).toEqual(expected);
          } else {
            // Field-identifying error references the material quantity + item.
            expect(result.error?.field).toContain('materialQuantity');
            expect(result.error?.field).toContain(itemId);
            expect(after).toEqual(before);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // --- Origin independence: manual vs AI-tool call (Req 12.5) ---------------
  //
  // The controller exposes one validated updater per field; both manual UI
  // controls and AI tool calls (e.g. updateWorkingHeight) route through it. So
  // applying the same candidate through two independent controllers — standing
  // in for the two origins — must yield identical acceptance and identical
  // resulting state.
  it('validates identically regardless of origin (manual vs AI tool call)', () => {
    fc.assert(
      fc.property(
        finite(0.01, 100),
        numericCandidates(0.01, 100),
        (prior, candidate) => {
          const manual = createProjectStateController();
          const aiTool = createProjectStateController();

          expect(manual.setWorkingHeight(prior).ok).toBe(true);
          expect(aiTool.setWorkingHeight(prior).ok).toBe(true);

          const manualResult = manual.setWorkingHeight(candidate);
          const aiResult = aiTool.setWorkingHeight(candidate);

          expect(manualResult.ok).toBe(aiResult.ok);
          expect(manualResult.error?.field).toBe(aiResult.error?.field);
          expect(manual.getState()).toEqual(aiTool.getState());
        },
      ),
      { numRuns: 200 },
    );
  });
});
