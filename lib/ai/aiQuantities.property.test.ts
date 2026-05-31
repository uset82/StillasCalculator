// Feature: stillas-calculator, Property 25: AI presents only engine-computed quantities
//
// Property 25 (design.md): *For any* calculation input, every scaffold quantity
// surfaced by the AI Assistant is exactly equal — with no rounding, scaling, or
// other transformation — to the value returned by `calculateScaffoldMaterials`
// for that input, and no quantity is presented that did not originate from a
// tool-call result.
//
// Validates: Requirements 13.1, 13.6
//
// Req 13.1: "WHEN the AI_Assistant needs scaffold quantities, THE AI_Assistant
// SHALL obtain them by calling the deterministic function
// calculateScaffoldMaterials, and SHALL NOT present any quantity that did not
// originate from a tool call result."
// Req 13.6: "THE AI_Assistant SHALL present quantities in chat exactly equal to
// the values returned by the deterministic Scaffold_Calculator for the same
// inputs, with no rounding, scaling, or other transformation."
//
// The AI trust boundary lives in `createToolDispatch`: the model never computes
// a quantity itself; whenever it needs one it must call the
// `calculateScaffoldMaterials` tool, whose executor runs the same pure engine
// the UI runs and hands the result back through the tool-call result's `data`
// channel only. This test generates valid `ScaffoldCalculationInput`, builds a
// dispatch with a stub `ToolContext`, invokes the
// `calculateScaffoldMaterials` executor with those args, and asserts the tool
// result's `data` is byte-for-byte equal to `calculateScaffoldMaterials(input).output`
// — every quantity (numberOfBays, numberOfLevels, totalScaffoldLengthMeters,
// and each materialList item quantity) is identical with no rounding/scaling,
// and the only channel a quantity reaches the model through is the tool-call
// result.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { createToolDispatch, type PlanToolContext, type ToolResult } from './toolExecutor';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { calculateScaffoldMaterials } from '../scaffold/scaffoldCalculator';
import type {
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
  UpdateResult,
} from '../types';

// The exactly-five selectable scaffold systems (Req 7.1).
const SYSTEM_IDS: ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

// --- Stub ToolContext ------------------------------------------------------

/**
 * `calculateScaffoldMaterials` is a PURE tool — it never reads or writes
 * Project_State — so the context is only needed to satisfy the type. The stub
 * throws if the calculate tool ever reaches into state, which would itself be a
 * trust-boundary violation.
 */
function makeStubContext(): PlanToolContext {
  let plan = createScaffoldPlan();
  return {
    getScaffoldPlan: () => plan,
    setWorkingHeight: (): UpdateResult => {
      throw new Error('calculateScaffoldMaterials must not update working height');
    },
    setPerimeter: () => {
      throw new Error('calculateScaffoldMaterials must not set perimeter');
    },
    setSelectedFacades: () => {
      throw new Error('calculateScaffoldMaterials must not set facades');
    },
    setScaffoldSystem: () => {
      throw new Error('calculateScaffoldMaterials must not set system');
    },
    setDimension: () => {
      throw new Error('calculateScaffoldMaterials must not set dimensions');
    },
    applyCalculation: (result: ScaffoldCalculationOutput) => {
      plan = { ...plan, calculation: result };
    },
    setDrawingOverlay: () => {},
    clearDrawingOverlay: () => {},
    setCadModel: () => {},
    addCadExport: () => {},
  };
}

// --- Generators ------------------------------------------------------------

/**
 * A valid `ScaffoldCalculationInput`: the four required inputs are finite and
 * strictly greater than 0 (the calculator's success precondition), the working
 * height stays within the documented 0.01..100 range (Req 8.1), the system id
 * is one of the five selectable systems, and the optional waste factor is
 * either absent or a 0..100 value (Req 9.1). Ranges are bounded to realistic
 * magnitudes so the comparison exercises ordinary numbers rather than overflow.
 */
const validInputArb: fc.Arbitrary<ScaffoldCalculationInput> = fc
  .record({
    scaffoldLengthMeters: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
    workingHeightMeters: fc.double({ min: 0.01, max: 100, noNaN: true }),
    bayLengthMeters: fc.double({ min: 0.1, max: 50, noNaN: true }),
    liftHeightMeters: fc.double({ min: 0.1, max: 10, noNaN: true }),
    scaffoldWidthMeters: fc.double({ min: 0.1, max: 10, noNaN: true }),
    scaffoldSystemId: fc.constantFrom(...SYSTEM_IDS),
    wasteFactorPercent: fc.option(
      fc.double({ min: 0, max: 100, noNaN: true }),
      { nil: undefined }
    ),
  })
  .map((input): ScaffoldCalculationInput => {
    // Omit the optional field entirely when undefined so the executor's
    // `readNumber` and the engine's `?? 0` see the identical shape.
    if (input.wasteFactorPercent === undefined) {
      const { wasteFactorPercent: _omit, ...rest } = input;
      return rest;
    }
    return input;
  });

// --- Property --------------------------------------------------------------

describe('Property 25: AI presents only engine-computed quantities (Req 13.1, 13.6)', () => {
  it('every AI-surfaced quantity equals calculateScaffoldMaterials output exactly, sourced only from the tool-call result', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        // The engine is the single source of truth for quantities (Req 13.1).
        const engine = calculateScaffoldMaterials(input);
        expect(engine.ok).toBe(true);
        if (!engine.ok) return; // narrow; generator guarantees validity
        const expected: ScaffoldCalculationOutput = engine.output;

        // The model can only obtain quantities by calling the tool; build the
        // same dispatch the server route builds and invoke the executor with
        // the model-supplied args.
        const dispatch = createToolDispatch(makeStubContext());
        const result: ToolResult = dispatch.calculateScaffoldMaterials(input);

        // A quantity reaches the model only through a successful tool-call
        // result's `data` channel — nothing is surfaced outside it (Req 13.1).
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const surfaced = result.data as ScaffoldCalculationOutput;

        // The whole payload is byte-for-byte equal to the engine output:
        // no field is rounded, scaled, or otherwise transformed (Req 13.6).
        expect(surfaced).toEqual(expected);

        // Pin each individual quantity with strict identity to rule out any
        // float-level rounding/scaling that a structural compare might miss.
        expect(Object.is(surfaced.totalScaffoldLengthMeters, expected.totalScaffoldLengthMeters)).toBe(true);
        expect(Object.is(surfaced.numberOfBays, expected.numberOfBays)).toBe(true);
        expect(Object.is(surfaced.numberOfLevels, expected.numberOfLevels)).toBe(true);

        expect(surfaced.materialList).toHaveLength(expected.materialList.length);
        for (let i = 0; i < expected.materialList.length; i++) {
          const surfacedItem = surfaced.materialList[i];
          const expectedItem = expected.materialList[i];
          expect(surfacedItem.id).toBe(expectedItem.id);
          expect(surfacedItem.itemName).toBe(expectedItem.itemName);
          expect(surfacedItem.unit).toBe(expectedItem.unit);
          // Each material quantity is exactly the engine's quantity (Req 13.6).
          expect(Object.is(surfacedItem.quantity, expectedItem.quantity)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
