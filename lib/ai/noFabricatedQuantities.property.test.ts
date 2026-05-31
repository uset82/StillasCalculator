// Feature: ai-agent-building-drawing, Property D: No fabricated quantities.
//
// Property D (design.md "Correctness Properties", Task 7.3):
//   Every scaffold quantity or measurement the AI_Agent presents equals a value
//   present in an executed Tool_Result / Geometry_Engine output for the same
//   inputs. The test sits at the boundary that maps engine output to presented
//   values and asserts value EQUALITY — no rounding, scaling, or other
//   transformation, and no value the model could inject from outside the engine.
//
// **Validates: Requirements 2.5, 3.3, 7.3**
//
// Req 2.5: "WHEN the Codex_Provider model presents a scaffold quantity, THE
//   AI_Agent SHALL present a value equal to the quantity carried by an executed
//   Tool_Result for the same inputs, with no rounding, scaling, or other
//   transformation."
// Req 3.3: "WHEN any AI_Provider presents a scaffold quantity, THE AI_Agent
//   SHALL present a value equal to the deterministic engine result for the same
//   inputs, with no rounding, scaling, or other transformation."
// Req 7.3: "WHEN the AI_Agent reports a measurement for an AI-drawn perimeter,
//   THE AI_Agent SHALL present a value equal to the Geometry_Engine's computed
//   value for that polygon, with no rounding, scaling, or other transformation."
//
// The single channel a quantity reaches the model through is a Tool_Result's
// `data` payload produced by the shared `executeTool` dispatch — the same path
// both the OpenAI_Provider (in-process) and the Codex_Provider (MCP) use. This
// test drives that dispatch over BOTH Plan_Updater implementations and asserts:
//
//   1. calculateScaffoldMaterials — the surfaced payload is byte-for-byte and
//      element-for-element identical to `calculateScaffoldMaterials(input)`'s
//      engine output: total scaffold length, bay/level counts, and every
//      material-list quantity (Req 2.5, 3.3). The model cannot inject a
//      fabricated quantity because the only value surfaced is the engine's.
//   2. setBuildingPerimeter — the surfaced measurements and Scaffold_Length are
//      identical to the Geometry_Engine's own `measurePolygon` /
//      `computeScaffoldLength` output for the SAME polygon, and identical to the
//      value the engine stored in the plan (Req 7.3).
//   3. getSelectedBuildingMeasurements — the surfaced measurements and
//      Scaffold_Length are identical to the values already stored in the plan
//      by the engine: a read tool transforms nothing (Req 3.3, 7.3).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createToolDispatch,
  executeTool,
  type PlanToolContext,
  type ToolResult,
} from './toolExecutor';
import {
  createControllerPlanContext,
  createFilePlanContext,
} from './planToolContext';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { calculateScaffoldMaterials } from '@/lib/scaffold/scaffoldCalculator';
import {
  computeScaffoldLength,
  isValidPerimeter,
  measurePolygon,
} from '@/lib/geometry/turfMeasurements';
import type {
  GeoJsonPolygon,
  PolygonMeasurements,
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
  ScaffoldSystemId,
} from '@/lib/types';

const MIN_RUNS = 200;
const SESSION_ID = 'no-fabricated-quantities-test';

// ---------------------------------------------------------------------------
// Plan_Updater context factories — the two implementations under test.
// Both implement the identical `PlanToolContext`, so Property D holds at the
// presentation boundary regardless of which provider path produced the value.
// ---------------------------------------------------------------------------

interface ContextFactory {
  readonly name: string;
  make(): PlanToolContext;
}

const contextFactories: readonly ContextFactory[] = [
  {
    name: 'controller-backed (createControllerPlanContext)',
    make: () =>
      createControllerPlanContext(createProjectStateController(), SESSION_ID),
  },
  {
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
  },
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// The exactly-five selectable scaffold systems.
const SYSTEM_IDS: ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

/**
 * A valid `ScaffoldCalculationInput`: the four required inputs are finite and
 * strictly greater than 0 (the calculator's success precondition), the working
 * height stays within 0.01..100, the system id is one of the five systems, and
 * the optional waste factor is either absent or a 0..100 value. Ranges are
 * bounded to realistic magnitudes so the comparison exercises ordinary numbers.
 */
const validInputArb: fc.Arbitrary<ScaffoldCalculationInput> = fc
  .record({
    scaffoldLengthMeters: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
    workingHeightMeters: fc.double({ min: 0.01, max: 100, noNaN: true }),
    bayLengthMeters: fc.double({ min: 0.1, max: 50, noNaN: true }),
    liftHeightMeters: fc.double({ min: 0.1, max: 10, noNaN: true }),
    scaffoldWidthMeters: fc.double({ min: 0.1, max: 10, noNaN: true }),
    scaffoldSystemId: fc.constantFrom(...SYSTEM_IDS),
    wasteFactorPercent: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
      nil: undefined,
    }),
  })
  .map((input): ScaffoldCalculationInput => {
    // Omit the optional field entirely when undefined so the executor and the
    // engine see the identical input shape.
    if (input.wasteFactorPercent === undefined) {
      const { wasteFactorPercent: _omit, ...rest } = input;
      return rest;
    }
    return input;
  });

/** Axis-aligned rectangle ring, wound counter-clockwise and closed. */
function buildRectangle(
  lon0: number,
  lat0: number,
  w: number,
  h: number,
): GeoJsonPolygon {
  const ring: number[][] = [
    [lon0, lat0],
    [lon0 + w, lat0],
    [lon0 + w, lat0 + h],
    [lon0, lat0 + h],
    [lon0, lat0],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

const rectangleArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon0: fc.double({ min: -179, max: 178, noNaN: true }),
    lat0: fc.double({ min: -60, max: 59, noNaN: true }),
    w: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
    h: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
  })
  .map(({ lon0, lat0, w, h }) => buildRectangle(lon0, lat0, w, h));

/**
 * Star-shaped (hence simple) polygon: n vertices at strictly increasing angles
 * around (clon, clat). Confining vertex i to the i-th angular sector keeps the
 * angles strictly increasing, so the ring never self-intersects.
 */
function buildStarPolygon(
  clon: number,
  clat: number,
  radii: number[],
  fractions: number[],
): GeoJsonPolygon {
  const n = radii.length;
  const ring: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = ((i + fractions[i]) / n) * 2 * Math.PI;
    ring.push([clon + radii[i] * Math.cos(angle), clat + radii[i] * Math.sin(angle)]);
  }
  ring.push([...ring[0]]); // close the ring
  return { type: 'Polygon', coordinates: [ring] };
}

const starRingArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .integer({ min: 3, max: 8 })
  .chain((n) =>
    fc
      .record({
        clon: fc.double({ min: -170, max: 170, noNaN: true }),
        clat: fc.double({ min: -60, max: 60, noNaN: true }),
        radii: fc.array(fc.double({ min: 0.0005, max: 0.005, noNaN: true }), {
          minLength: n,
          maxLength: n,
        }),
        fractions: fc.array(fc.double({ min: 0.05, max: 0.9, noNaN: true }), {
          minLength: n,
          maxLength: n,
        }),
      })
      .map(({ clon, clat, radii, fractions }) =>
        buildStarPolygon(clon, clat, radii, fractions),
      ),
  );

const validPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.oneof(
  rectangleArb,
  starRingArb,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts two measurement objects are geometrically identical: same validity,
 * perimeter, area, and per-side lengths (element-for-element by strict identity
 * to rule out any float-level rounding/scaling that a structural compare might
 * miss).
 */
function expectMeasurementsIdentical(
  actual: PolygonMeasurements | null | undefined,
  expected: PolygonMeasurements | null | undefined,
): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(expected).not.toBeNull();
  expect(expected).not.toBeUndefined();
  const a = actual as PolygonMeasurements;
  const e = expected as PolygonMeasurements;

  expect(a.valid).toBe(e.valid);
  expect(Object.is(a.perimeterMeters, e.perimeterMeters)).toBe(true);
  expect(Object.is(a.areaSquareMeters, e.areaSquareMeters)).toBe(true);
  expect(a.sideLengthsMeters).toHaveLength(e.sideLengthsMeters.length);
  for (let i = 0; i < e.sideLengthsMeters.length; i += 1) {
    expect(Object.is(a.sideLengthsMeters[i], e.sideLengthsMeters[i])).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Property D
// ---------------------------------------------------------------------------

describe('Property D: No fabricated quantities (Req 2.5, 3.3, 7.3)', () => {
  // 1. Calculation quantities. The only quantity channel is the
  //    calculateScaffoldMaterials Tool_Result, and that payload is exactly the
  //    deterministic engine output for the same input — no rounding/scaling and
  //    no value the model could fabricate (Req 2.5, 3.3).
  it('calculateScaffoldMaterials surfaces exactly the engine output, with no transformation, across both providers', async () => {
    await fc.assert(
      fc.asyncProperty(validInputArb, async (input) => {
        // The engine is the single source of truth for quantities.
        const engine = calculateScaffoldMaterials(input);
        expect(engine.ok).toBe(true);
        if (!engine.ok) return;
        const expected: ScaffoldCalculationOutput = engine.output;

        for (const factory of contextFactories) {
          const context = factory.make();
          const dispatch = createToolDispatch(context);

          // The model can only obtain quantities by invoking the tool through
          // the shared dispatch — the same call both providers make.
          const result: ToolResult = await executeTool(
            dispatch,
            context,
            'calculateScaffoldMaterials',
            input,
          );

          // A quantity reaches the model only via a successful Tool_Result.
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const surfaced = result.data as ScaffoldCalculationOutput;

          // Whole payload identical: nothing rounded, scaled, or transformed.
          expect(surfaced).toEqual(expected);

          // Pin each scalar quantity with strict identity.
          expect(
            Object.is(
              surfaced.totalScaffoldLengthMeters,
              expected.totalScaffoldLengthMeters,
            ),
          ).toBe(true);
          expect(Object.is(surfaced.numberOfBays, expected.numberOfBays)).toBe(true);
          expect(Object.is(surfaced.numberOfLevels, expected.numberOfLevels)).toBe(
            true,
          );

          // Every material-list quantity is exactly the engine's quantity.
          expect(surfaced.materialList).toHaveLength(expected.materialList.length);
          for (let i = 0; i < expected.materialList.length; i += 1) {
            const surfacedItem = surfaced.materialList[i];
            const expectedItem = expected.materialList[i];
            expect(surfacedItem.id).toBe(expectedItem.id);
            expect(surfacedItem.unit).toBe(expectedItem.unit);
            expect(Object.is(surfacedItem.quantity, expectedItem.quantity)).toBe(true);
          }
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // 2. Geometry measurements / Scaffold_Length. Storing a perimeter through the
  //    setBuildingPerimeter tool surfaces measurements and Scaffold_Length that
  //    are identical to the Geometry_Engine's own computation for the same
  //    polygon, and identical to what the engine stored in the plan (Req 7.3).
  it('setBuildingPerimeter surfaces measurements and Scaffold_Length equal to the Geometry_Engine output for the same polygon', async () => {
    await fc.assert(
      fc.asyncProperty(validPolygonArb, async (polygon) => {
        // The generators only emit valid simple rings.
        expect(isValidPerimeter(polygon)).toBe(true);

        // Independent Geometry_Engine oracle for the SAME polygon. A freshly
        // created plan has no facade subset selected (null), so Scaffold_Length
        // is the full perimeter — matching the default state both tools see.
        const oracleMeasurements = measurePolygon(polygon);
        const oracleScaffoldLength = computeScaffoldLength(oracleMeasurements, null);

        for (const factory of contextFactories) {
          const context = factory.make();
          const dispatch = createToolDispatch(context);

          const result = await executeTool(
            dispatch,
            context,
            'setBuildingPerimeter',
            { polygon },
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const surfaced = result.data as {
            measurements: PolygonMeasurements | null;
            scaffoldLengthMeters: number | null;
          };

          // The surfaced measurements equal the engine's computation (Req 7.3).
          expectMeasurementsIdentical(surfaced.measurements, oracleMeasurements);
          expect(
            Object.is(surfaced.scaffoldLengthMeters, oracleScaffoldLength),
          ).toBe(true);

          // The surfaced values also equal exactly what the engine stored in the
          // plan: the tool relays the stored value, it does not recompute or
          // transform it (Req 3.3, 7.3).
          const plan = context.getScaffoldPlan();
          expectMeasurementsIdentical(surfaced.measurements, plan.measurements);
          expect(
            Object.is(surfaced.scaffoldLengthMeters, plan.scaffoldLengthMeters),
          ).toBe(true);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // 3. Read-back. getSelectedBuildingMeasurements surfaces exactly the values
  //    the Geometry_Engine already stored in the plan — a read tool transforms
  //    nothing it presents (Req 3.3, 7.3).
  it('getSelectedBuildingMeasurements surfaces exactly the engine values stored in the plan', async () => {
    await fc.assert(
      fc.asyncProperty(validPolygonArb, async (polygon) => {
        expect(isValidPerimeter(polygon)).toBe(true);

        for (const factory of contextFactories) {
          const context = factory.make();
          const dispatch = createToolDispatch(context);

          // Store a perimeter so the plan carries engine-computed values.
          const stored = await executeTool(
            dispatch,
            context,
            'setBuildingPerimeter',
            { polygon },
          );
          expect(stored.ok).toBe(true);

          const plan = context.getScaffoldPlan();

          const read = await executeTool(
            dispatch,
            context,
            'getSelectedBuildingMeasurements',
            {},
          );
          expect(read.ok).toBe(true);
          if (!read.ok) return;

          const surfaced = read.data as {
            measurements: PolygonMeasurements | null;
            scaffoldLengthMeters: number | null;
            selectedFacadeSideIndices: number[] | null;
          };

          // Surfaced read-back values are identical to the stored engine values.
          expectMeasurementsIdentical(surfaced.measurements, plan.measurements);
          expect(
            Object.is(surfaced.scaffoldLengthMeters, plan.scaffoldLengthMeters),
          ).toBe(true);
          expect(surfaced.selectedFacadeSideIndices).toEqual(
            plan.selectedFacadeSideIndices,
          );
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
