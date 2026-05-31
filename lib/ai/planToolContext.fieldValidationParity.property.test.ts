// Feature: ai-agent-building-drawing, Property C: Field validation is total and
// state-preserving across providers
//
// Property C (design.md "Components and Interfaces" → Plan tool context; Task
// 7.2): the two Plan_Updater implementations — `createControllerPlanContext`
// (OpenAI / in-process path, over a fresh `createProjectStateController()`) and
// `createFilePlanContext` (Codex / MCP file path, over a `createScaffoldPlan()`
// object) — validate identically. For ARBITRARY inputs (in-range, out-of-range,
// NaN/Infinity, and the exact boundary values 0.01 / 5 / 100), the field
// updaters `setWorkingHeight`, `setDimension`, and `setScaffoldSystem` produce
// the SAME ok/rejected outcome on both contexts. On rejection the affected
// field value is unchanged and no other field is partially updated (the prior
// Project_State is preserved exactly).
//
// Validates: Requirements 3.1, 3.2, 3.5
//
// Req 3.1: "WHEN any AI_Provider supplies a value to a stateful Application_Tool,
// THE AI_Agent SHALL apply that value exclusively through the validated
// Plan_Updater — createControllerPlanContext delegating to scaffoldPlanController
// on the OpenAI path, or createFilePlanContext on the MCP path — with no direct
// write bypassing that updater."
// Req 3.2: "IF a value supplied through any AI_Provider's tool call is
// non-numeric, out of its permitted range, or references an unknown identifier,
// THEN THE AI_Agent SHALL reject the value, retain the last valid Project_State
// value for the affected field, apply no partial update to any other field, and
// return an error to the model that names the affected field and its permitted
// range."
// Req 3.5: "THE AI_Agent SHALL apply the field-validation rules ... identically
// for the OpenAI_Provider and the Codex_Provider, where those rules constrain
// Working_Height to 0.01–100 m (setWorkingHeight), input Bay_Length, Lift_Height,
// and Scaffold_Width to 0.01–5 m in the calculator context (setDimension), ..."
//
// Strategy: both Plan_Updaters expose the identical `PlanToolContext` interface,
// so each property is exercised against BOTH contexts via a shared factory list
// and additionally asserts the two contexts AGREE on the same input. The oracle
// for acceptance is the documented numeric range (0.01–100 working height,
// 0.01–5 calculator dimensions, the five known scaffold systems), so the test
// proves not only that the two contexts agree but that they agree on the
// CORRECT outcome — admitting exactly the values the rules permit, no more, no
// fewer. The full plan is deep-compared before/after a rejection to prove the
// total state (not just the targeted field) is preserved with no partial write.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createControllerPlanContext,
  createFilePlanContext,
} from '@/lib/ai/planToolContext';
import type { PlanToolContext } from '@/lib/ai/toolExecutor';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { DimensionField, ScaffoldPlan, ScaffoldSystemId } from '@/lib/types';

const MIN_RUNS = 300;
const SESSION_ID = 'field-validation-parity-test';

// ---------------------------------------------------------------------------
// Plan_Updater context factories — the two implementations under test.
// Each factory returns a fresh, isolated context starting from an empty plan.
// Both implement the identical `PlanToolContext` interface and both expose
// `getScaffoldPlan()`, so the properties read state uniformly.
// ---------------------------------------------------------------------------

interface ContextFactory {
  readonly name: string;
  make(): PlanToolContext;
}

const controllerFactory: ContextFactory = {
  name: 'controller-backed (createControllerPlanContext)',
  make: () =>
    createControllerPlanContext(createProjectStateController(), SESSION_ID),
};

const fileFactory: ContextFactory = {
  name: 'file-backed (createFilePlanContext)',
  make: () => {
    let plan: ScaffoldPlan = createScaffoldPlan();
    return createFilePlanContext(
      () => plan,
      (next) => {
        plan = next;
      },
      SESSION_ID,
    );
  },
};

const contextFactories: readonly ContextFactory[] = [
  controllerFactory,
  fileFactory,
];

// ---------------------------------------------------------------------------
// Documented validation ranges — the oracle (Req 3.5).
// ---------------------------------------------------------------------------

const WORKING_HEIGHT_MIN = 0.01;
const WORKING_HEIGHT_MAX = 100;
const DIMENSION_MIN = 0.01;
const DIMENSION_MAX = 5;

/** The exactly-five selectable scaffold systems (stillas-calculator Req 7.1). */
const KNOWN_SYSTEM_IDS: readonly ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

const DIMENSION_FIELDS: readonly DimensionField[] = [
  'bayLengthMeters',
  'liftHeightMeters',
  'scaffoldWidthMeters',
];

function isAcceptedInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

// ---------------------------------------------------------------------------
// Numeric generators — span across AND outside the ranges, plus the exact
// boundaries (0.01 / 5 / 100) and non-finite values (NaN, ±Infinity).
// ---------------------------------------------------------------------------

/**
 * A numeric value covering: a wide finite span well below and above both
 * ranges, the exact accepted/rejected boundary values for the two ranges and
 * their immediate neighbours, and the non-finite values a tool call might carry
 * (`NaN`, `±Infinity`). These must all be rejected when out of range or
 * non-finite, and accepted when finite and in range (Req 3.2, 3.5).
 */
const numericValueArb: fc.Arbitrary<number> = fc.oneof(
  // Broad finite span: dips below 0.01 (incl. negatives/zero) and rises past
  // 100, so both ranges' lower and upper bounds are crossed.
  fc.double({ min: -50, max: 250, noNaN: true }),
  // Tight span around the small lower bound where 0.01 lives.
  fc.double({ min: -0.5, max: 6, noNaN: true }),
  // Exact boundary values and their immediate neighbours for both ranges.
  fc.constantFrom(
    0.01, // accepted low bound (both ranges)
    5, // accepted high bound (dimension), in range (working height)
    100, // accepted high bound (working height), out of range (dimension)
    0, // below low bound
    -0.01, // negative, below low bound
    0.009, // just below low bound
    0.0099, // just below low bound
    4.9999, // just inside dimension high bound
    5.0001, // just above dimension high bound
    99.9999, // just inside working-height high bound
    100.0001, // just above working-height high bound
    -1,
    50,
    500,
  ),
  // Non-finite values: must be rejected as non-numeric (Req 3.2).
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

/** A scaffold-system identifier: a mix of the five known ids and unknown ids. */
const systemIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KNOWN_SYSTEM_IDS),
  fc.constantFrom(
    'does-not-exist',
    'layher-typo',
    'HAKI', // wrong case
    'generic',
    '',
    'undefined',
    'null',
  ),
  fc.string(),
);

const dimensionFieldArb: fc.Arbitrary<DimensionField> =
  fc.constantFrom(...DIMENSION_FIELDS);

// ---------------------------------------------------------------------------
// Property C
// ---------------------------------------------------------------------------

describe('Property C: Field validation is total and state-preserving across providers (Req 3.1, 3.2, 3.5)', () => {
  // -- setWorkingHeight (0.01–100 m) -----------------------------------------

  it('setWorkingHeight: both contexts agree on the documented 0.01–100 outcome and preserve state on rejection', () => {
    fc.assert(
      fc.property(numericValueArb, (value) => {
        const expectedAccept = isAcceptedInRange(
          value,
          WORKING_HEIGHT_MIN,
          WORKING_HEIGHT_MAX,
        );

        for (const factory of contextFactories) {
          const context = factory.make();

          // Seed a known-good prior value so a rejection has something valid to
          // preserve (the "last valid Project_State value", Req 3.2).
          const PRIOR = 12;
          expect(context.setWorkingHeight(PRIOR).ok).toBe(true);
          const before = context.getScaffoldPlan();
          const beforeSnapshot = structuredClone(before);
          expect(before.workingHeightMeters).toBe(PRIOR);

          const result = context.setWorkingHeight(value);

          // The gate admits exactly the values the documented range permits.
          expect(result.ok).toBe(expectedAccept);

          const after = context.getScaffoldPlan();
          if (expectedAccept) {
            // Accepted: the exact value is stored, untransformed.
            expect(Object.is(after.workingHeightMeters, value)).toBe(true);
          } else {
            // Rejected: a field-named error with the permitted range, the prior
            // value retained, and NO partial update to any other field (the
            // entire plan is byte-for-byte the prior plan) — Req 3.2.
            expect(result.error?.field).toBe('workingHeightMeters');
            expect(result.error?.permittedRange).toBe('0.01 to 100');
            expect(after.workingHeightMeters).toBe(PRIOR);
            expect(after).toEqual(beforeSnapshot);
          }
        }

        // The two implementations are observationally identical for this input:
        // same outcome and same resulting field value (Req 3.1, 3.5).
        const controllerCtx = controllerFactory.make();
        const fileCtx = fileFactory.make();
        controllerCtx.setWorkingHeight(12);
        fileCtx.setWorkingHeight(12);
        const cr = controllerCtx.setWorkingHeight(value);
        const fr = fileCtx.setWorkingHeight(value);
        expect(cr.ok).toBe(fr.ok);
        expect(
          Object.is(
            controllerCtx.getScaffoldPlan().workingHeightMeters,
            fileCtx.getScaffoldPlan().workingHeightMeters,
          ),
        ).toBe(true);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // -- setDimension (0.01–5 m, calculator context) ---------------------------

  it('setDimension: both contexts agree on the documented 0.01–5 outcome and preserve state on rejection', () => {
    fc.assert(
      fc.property(dimensionFieldArb, numericValueArb, (field, value) => {
        const expectedAccept = isAcceptedInRange(
          value,
          DIMENSION_MIN,
          DIMENSION_MAX,
        );

        for (const factory of contextFactories) {
          const context = factory.make();

          // Seed a known-good prior value for the field under test.
          const PRIOR = 2.5;
          expect(context.setDimension(field, PRIOR).ok).toBe(true);
          const before = context.getScaffoldPlan();
          const beforeSnapshot = structuredClone(before);
          expect(before[field]).toBe(PRIOR);

          const result = context.setDimension(field, value);

          expect(result.ok).toBe(expectedAccept);

          const after = context.getScaffoldPlan();
          if (expectedAccept) {
            expect(Object.is(after[field], value)).toBe(true);
          } else {
            // Rejected: field-named error naming the calculator range, prior
            // value retained, no partial update anywhere else (Req 3.2).
            expect(result.error?.field).toBe(field);
            expect(result.error?.permittedRange).toBe('0.01 to 5');
            expect(after[field]).toBe(PRIOR);
            expect(after).toEqual(beforeSnapshot);
          }
        }

        // Cross-context agreement on the same field + value.
        const controllerCtx = controllerFactory.make();
        const fileCtx = fileFactory.make();
        controllerCtx.setDimension(field, 2.5);
        fileCtx.setDimension(field, 2.5);
        const cr = controllerCtx.setDimension(field, value);
        const fr = fileCtx.setDimension(field, value);
        expect(cr.ok).toBe(fr.ok);
        expect(
          Object.is(
            controllerCtx.getScaffoldPlan()[field],
            fileCtx.getScaffoldPlan()[field],
          ),
        ).toBe(true);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // -- setScaffoldSystem (unknown identifier rejected) -----------------------

  it('setScaffoldSystem: both contexts agree on known-vs-unknown ids and preserve state on rejection', () => {
    fc.assert(
      fc.property(systemIdArb, (systemId) => {
        const expectedAccept = (KNOWN_SYSTEM_IDS as readonly string[]).includes(
          systemId,
        );

        for (const factory of contextFactories) {
          const context = factory.make();

          // Seed a known-good prior system so a rejection has a valid selection
          // (and the loaded default dimensions) to preserve.
          const PRIOR_SYSTEM: ScaffoldSystemId = 'generic-frame';
          expect(context.setScaffoldSystem(PRIOR_SYSTEM).ok).toBe(true);
          const before = context.getScaffoldPlan();
          const beforeSnapshot = structuredClone(before);
          expect(before.scaffoldSystemId).toBe(PRIOR_SYSTEM);

          const result = context.setScaffoldSystem(
            systemId as ScaffoldSystemId,
          );

          expect(result.ok).toBe(expectedAccept);

          const after = context.getScaffoldPlan();
          if (expectedAccept) {
            expect(after.scaffoldSystemId).toBe(systemId);
          } else {
            // Rejected: error names the scaffold-system field, the prior
            // selection AND its loaded default dimensions are untouched, and no
            // other field is partially updated (Req 3.2).
            expect(result.error?.field).toBe('scaffoldSystemId');
            expect(after.scaffoldSystemId).toBe(PRIOR_SYSTEM);
            expect(after).toEqual(beforeSnapshot);
          }
        }

        // Cross-context agreement on the same id.
        const controllerCtx = controllerFactory.make();
        const fileCtx = fileFactory.make();
        controllerCtx.setScaffoldSystem('generic-frame');
        fileCtx.setScaffoldSystem('generic-frame');
        const cr = controllerCtx.setScaffoldSystem(systemId as ScaffoldSystemId);
        const fr = fileCtx.setScaffoldSystem(systemId as ScaffoldSystemId);
        expect(cr.ok).toBe(fr.ok);
        expect(controllerCtx.getScaffoldPlan().scaffoldSystemId).toBe(
          fileCtx.getScaffoldPlan().scaffoldSystemId,
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
