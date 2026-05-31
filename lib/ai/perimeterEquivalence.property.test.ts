// Feature: ai-agent-building-drawing, Property I: AI-drawn geometry equals
// manually-drawn geometry in the pipeline.
//
// Property I (design.md "Correctness Properties", Task 5.3):
//   Storing a perimeter via the AI tool path (`setBuildingPerimeter` through
//   `createToolDispatch`/`executeTool` over a `PlanToolContext`) produces
//   measurements, area, per-side lengths, and Scaffold_Length identical to
//   storing the SAME coordinates via the manual-drawing path
//   (`scaffoldPlanController.setPerimeter` directly). Both go through the
//   Geometry_Engine.
//
// **Validates: Requirements 7.1, 8.1, 8.3**
//
// Req 7.1: a perimeter stored through `setBuildingPerimeter` is measured by the
//   Geometry_Engine to values equal to those it produces for a manually drawn
//   perimeter with identical coordinates.
// Req 8.1: every AI-produced perimeter is stored through the same validated
//   `setPerimeter` Plan_Updater used for manual drawing — `scaffoldPlanController
//   .setPerimeter` on the OpenAI path and the `createFilePlanContext`
//   `setPerimeter` on the MCP path — both validating the ring via the engine.
// Req 8.3: editing/recomputation always flows through the Geometry_Engine, so
//   AI-supplied geometry never bypasses it.
//
// Strategy: generate valid simple rings (axis-aligned rectangles and
// star-shaped polygons — both guaranteed simple, the same constructions used by
// the stillas-calculator perimeter property). For each polygon, store the SAME
// coordinates three ways and assert the resulting ScaffoldPlan geometry is
// identical:
//   1. Manual path  — a fresh controller, `controller.setPerimeter(polygon)`.
//   2. AI / OpenAI path — `createControllerPlanContext` over a fresh controller,
//      dispatched through `createToolDispatch` + `executeTool` with the
//      `setBuildingPerimeter` tool.
//   3. AI / MCP path — `createFilePlanContext` over a fresh plain ScaffoldPlan,
//      dispatched the same way (the file-backed Plan_Updater of Req 8.1).
// All three must agree on perimeter, area, per-side lengths, and Scaffold_Length
// because all three run the identical Geometry_Engine over identical input.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { createToolDispatch, executeTool } from './toolExecutor';
import { createControllerPlanContext, createFilePlanContext } from './planToolContext';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { isValidPerimeter } from '@/lib/geometry/turfMeasurements';
import type { GeoJsonPolygon, PolygonMeasurements, ScaffoldPlan } from '@/lib/types';

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Valid-ring generators (closed, >=3 distinct vertices, simple)
// ---------------------------------------------------------------------------

/**
 * Builds an axis-aligned rectangle ring with bottom-left corner (lon0, lat0)
 * and degree extents (w, h), wound counter-clockwise and closed.
 */
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
 * Builds a star-shaped (hence simple) polygon: n vertices at strictly
 * increasing angles around (clon, clat), each at a positive radius. Confining
 * vertex i to the i-th angular sector keeps the angles strictly increasing, so
 * the ring never self-intersects regardless of the radii chosen.
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
    const lon = clon + radii[i] * Math.cos(angle);
    const lat = clat + radii[i] * Math.sin(angle);
    ring.push([lon, lat]);
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
 * perimeter, area, and per-side lengths (element-for-element, by strict
 * identity to rule out any float-level rounding/scaling).
 */
function expectMeasurementsIdentical(
  actual: PolygonMeasurements | null,
  expected: PolygonMeasurements | null,
): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
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
// Property I
// ---------------------------------------------------------------------------

describe('Property I: AI-drawn geometry equals manually-drawn geometry in the pipeline (Req 7.1, 8.1, 8.3)', () => {
  it('storing a perimeter via the setBuildingPerimeter tool yields the same measurements, area, per-side lengths, and Scaffold_Length as the manual controller.setPerimeter path', async () => {
    await fc.assert(
      fc.asyncProperty(validPolygonArb, async (polygon) => {
        // Sanity: the generators only emit valid simple rings.
        expect(isValidPerimeter(polygon)).toBe(true);

        // 1. Manual-drawing path: the controller's setPerimeter updater (Req 8.1).
        const manualController = createProjectStateController();
        const manualUpdate = manualController.setPerimeter(polygon);
        expect(manualUpdate.ok).toBe(true);
        const manualPlan = manualController.getScaffoldPlan();
        expectMeasurementsIdentical(manualPlan.measurements, manualPlan.measurements);

        // 2. AI / OpenAI path: the same coordinates routed through the shared
        //    tool dispatch over a controller-backed PlanToolContext (Req 7.1, 8.1).
        const aiController = createProjectStateController();
        const controllerContext = createControllerPlanContext(
          aiController,
          'session-test',
        );
        const controllerDispatch = createToolDispatch(controllerContext);
        const controllerToolResult = await executeTool(
          controllerDispatch,
          controllerContext,
          'setBuildingPerimeter',
          { polygon },
        );
        expect(controllerToolResult.ok).toBe(true);
        const aiControllerPlan = aiController.getScaffoldPlan();

        // 3. AI / MCP path: the same coordinates routed through the file-backed
        //    Plan_Updater of Req 8.1 (createFilePlanContext.setPerimeter).
        let filePlan: ScaffoldPlan = createScaffoldPlan();
        const fileContext = createFilePlanContext(
          () => filePlan,
          (next) => {
            filePlan = next;
          },
          'session-test',
        );
        const fileDispatch = createToolDispatch(fileContext);
        const fileToolResult = await executeTool(
          fileDispatch,
          fileContext,
          'setBuildingPerimeter',
          { polygon },
        );
        expect(fileToolResult.ok).toBe(true);

        // The AI (OpenAI) path stores geometry identical to the manual path: the
        // engine produced the same perimeter, area, and per-side lengths (Req 7.1).
        expectMeasurementsIdentical(
          aiControllerPlan.measurements,
          manualPlan.measurements,
        );
        expect(
          Object.is(
            aiControllerPlan.scaffoldLengthMeters,
            manualPlan.scaffoldLengthMeters,
          ),
        ).toBe(true);

        // The AI (MCP) file-backed Plan_Updater is equally identical (Req 8.1):
        // both AI paths and the manual path agree on the whole pipeline output.
        expectMeasurementsIdentical(filePlan.measurements, manualPlan.measurements);
        expect(
          Object.is(filePlan.scaffoldLengthMeters, manualPlan.scaffoldLengthMeters),
        ).toBe(true);

        // The tool result surfaces exactly the engine-computed measurements and
        // Scaffold_Length that landed in the plan — no transformation (Req 8.3).
        if (controllerToolResult.ok) {
          const data = controllerToolResult.data as {
            measurements: PolygonMeasurements | null;
            scaffoldLengthMeters: number | null;
          };
          expectMeasurementsIdentical(data.measurements, manualPlan.measurements);
          expect(
            Object.is(data.scaffoldLengthMeters, manualPlan.scaffoldLengthMeters),
          ).toBe(true);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
