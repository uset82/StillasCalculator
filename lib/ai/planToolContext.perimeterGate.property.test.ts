// Feature: ai-agent-building-drawing, Property F: Perimeter validation gate
//
// Property F (design.md "Correctness Properties", Task 5.2):
//   `setPerimeter` stores a polygon ONLY IF the Geometry_Engine accepts it. An
//   invalid polygon (fewer than 3 distinct vertices, not a closed ring, or
//   self-intersecting) is rejected, the last valid perimeter is retained (or
//   none if none existed), and an error is returned. A valid polygon is stored
//   and replaces any prior one.
//
// Validates: Requirements 6.1, 6.4
//
// Req 6.1: "WHEN the AI_Agent has a candidate footprint or an ordered set of
// perimeter vertices ..., THE AI_Agent SHALL store the perimeter by calling the
// setBuildingPerimeter Geometry_Tool, which validates the Perimeter_Polygon with
// the Geometry_Engine before storing it through the Plan_Updater ..."
// Req 6.4: "IF a Perimeter_Polygon ... has fewer than 3 distinct vertices, is
// not a closed ring, or has self-intersecting sides, THEN THE Geometry_Tool
// SHALL reject the polygon via the Geometry_Engine, retain the last valid
// perimeter in the Project_State (or leave the Project_State with no perimeter
// when none was previously stored), and return an error ..."
//
// Strategy: the gate is the `setPerimeter` updater exposed by BOTH Plan_Updater
// implementations — `createControllerPlanContext` (OpenAI / in-process path) and
// `createFilePlanContext` (Codex / MCP file path). The design requires the two
// to behave identically, so every property below is exercised against both
// contexts via a shared factory list, and the core gate property additionally
// asserts the two contexts AGREE on the same input. The oracle for acceptance
// is the Geometry_Engine's own `isValidPerimeter`, so the test proves the gate
// admits exactly the polygons the engine accepts — no more, no fewer.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createControllerPlanContext,
  createFilePlanContext,
} from '@/lib/ai/planToolContext';
import type { PlanToolContext } from '@/lib/ai/toolExecutor';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { isValidPerimeter } from '@/lib/geometry/turfMeasurements';
import type { GeoJsonPolygon, ScaffoldPlan } from '@/lib/types';

const MIN_RUNS = 200;
const SESSION_ID = 'perimeter-gate-test';

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
// Valid-ring generators (closed, >=3 distinct vertices, simple)
// ---------------------------------------------------------------------------

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
 * around (clon, clat), each at a positive radius. Confining vertex i to the
 * i-th angular sector keeps the angles strictly increasing, so the ring never
 * self-intersects regardless of the radii chosen.
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
// Invalid-ring generators — each covers one clause of Req 6.4.
// ---------------------------------------------------------------------------

/** Fewer than 3 distinct vertices: one or two distinct points (Req 6.4). */
const degenerateRingArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    aLon: fc.double({ min: -170, max: 170, noNaN: true }),
    aLat: fc.double({ min: -60, max: 60, noNaN: true }),
    dLon: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
    dLat: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
    distinctCount: fc.constantFrom(1, 2),
  })
  .map(({ aLon, aLat, dLon, dLat, distinctCount }) => {
    const a: number[] = [aLon, aLat];
    if (distinctCount === 1) {
      const ring = [[...a], [...a], [...a], [...a]];
      return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
    }
    const b: number[] = [aLon + dLon, aLat + dLat];
    const ring = [[...a], [...b], [...a]];
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

/**
 * Not a closed ring (Req 6.4): four distinct rectangle corners with no closing
 * duplicate, so the first and last coordinates differ.
 */
const openRingArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon0: fc.double({ min: -170, max: 170, noNaN: true }),
    lat0: fc.double({ min: -60, max: 60, noNaN: true }),
    w: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
    h: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
  })
  .map(({ lon0, lat0, w, h }) => {
    const ring = [
      [lon0, lat0],
      [lon0 + w, lat0],
      [lon0 + w, lat0 + h],
      [lon0, lat0 + h], // no closing duplicate -> first !== last
    ];
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

/**
 * Self-intersecting "bowtie" quadrilateral (Req 6.4). Ordering the four
 * rectangle corners as BL -> TR -> BR -> TL makes the diagonals cross at the
 * center for any positive (w, h), so the ring is non-simple.
 */
const bowtieArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon0: fc.double({ min: -170, max: 170, noNaN: true }),
    lat0: fc.double({ min: -60, max: 60, noNaN: true }),
    w: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
    h: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
  })
  .map(({ lon0, lat0, w, h }) => {
    const bl = [lon0, lat0];
    const br = [lon0 + w, lat0];
    const tr = [lon0 + w, lat0 + h];
    const tl = [lon0, lat0 + h];
    const ring = [bl, tr, br, tl, [...bl]];
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

const invalidPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.oneof(
  degenerateRingArb,
  openRingArb,
  bowtieArb,
);

/** Any polygon the gate might see: a mix of valid and invalid rings. */
const anyPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.oneof(
  validPolygonArb,
  invalidPolygonArb,
);

// ---------------------------------------------------------------------------
// Property F
// ---------------------------------------------------------------------------

describe('Property F: Perimeter validation gate (Req 6.1, 6.4)', () => {
  // Core gate property: for ANY polygon, every Plan_Updater stores it iff the
  // Geometry_Engine accepts it, and the two implementations agree exactly.
  it('stores a polygon iff the Geometry_Engine accepts it, identically across both contexts', () => {
    fc.assert(
      fc.property(anyPolygonArb, (polygon) => {
        // The Geometry_Engine is the oracle for acceptance (Req 6.1, 6.4).
        const accepted = isValidPerimeter(polygon);

        for (const factory of contextFactories) {
          const context = factory.make();

          // Each context starts with no perimeter stored.
          expect(context.getScaffoldPlan().perimeterPolygon).toBeNull();

          const result = context.setPerimeter(polygon);

          // The gate admits exactly the polygons the engine accepts.
          expect(result.ok).toBe(accepted);

          const plan = context.getScaffoldPlan();
          if (accepted) {
            // A valid polygon is stored with engine-computed measurements.
            expect(plan.perimeterPolygon).toEqual(polygon);
            expect(plan.measurements?.valid).toBe(true);
          } else {
            // An invalid polygon is rejected: nothing stored, error returned,
            // and no perimeter exists because none did before (Req 6.4).
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error?.field).toBe('perimeterPolygon');
            }
            expect(plan.perimeterPolygon).toBeNull();
            expect(plan.measurements).toBeNull();
            expect(plan.scaffoldLengthMeters).toBeNull();
          }
        }

        // Prove the two implementations are observationally identical for the
        // same input: same outcome, same stored perimeter, same measurements.
        const controllerCtx = contextFactories[0].make();
        const fileCtx = contextFactories[1].make();
        const controllerResult = controllerCtx.setPerimeter(polygon);
        const fileResult = fileCtx.setPerimeter(polygon);
        expect(controllerResult.ok).toBe(fileResult.ok);
        expect(controllerCtx.getScaffoldPlan().perimeterPolygon).toEqual(
          fileCtx.getScaffoldPlan().perimeterPolygon,
        );
        expect(controllerCtx.getScaffoldPlan().measurements).toEqual(
          fileCtx.getScaffoldPlan().measurements,
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // An invalid polygon applied after a valid one retains the LAST VALID
  // perimeter unchanged and returns an error (Req 6.4).
  it('retains the last valid perimeter when a later invalid polygon is rejected', () => {
    fc.assert(
      fc.property(validPolygonArb, invalidPolygonArb, (valid, invalid) => {
        expect(isValidPerimeter(valid)).toBe(true);
        expect(isValidPerimeter(invalid)).toBe(false);

        for (const factory of contextFactories) {
          const context = factory.make();

          // Store a valid perimeter first.
          expect(context.setPerimeter(valid).ok).toBe(true);
          const afterValid = context.getScaffoldPlan();
          const storedPerimeter = afterValid.perimeterPolygon;
          const storedMeasurements = afterValid.measurements;
          const storedScaffoldLength = afterValid.scaffoldLengthMeters;
          expect(storedPerimeter).toEqual(valid);

          // Now apply an invalid polygon: it must be rejected with an error.
          const result = context.setPerimeter(invalid);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error?.field).toBe('perimeterPolygon');
          }

          // The last valid perimeter and its derived values are untouched.
          const afterInvalid = context.getScaffoldPlan();
          expect(afterInvalid.perimeterPolygon).toEqual(storedPerimeter);
          expect(afterInvalid.measurements).toEqual(storedMeasurements);
          expect(afterInvalid.scaffoldLengthMeters).toEqual(storedScaffoldLength);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // A valid polygon replaces any previously stored perimeter (Req 6.1, 6.4).
  it('replaces a previously stored perimeter when a new valid polygon is stored', () => {
    fc.assert(
      fc.property(validPolygonArb, validPolygonArb, (first, second) => {
        expect(isValidPerimeter(first)).toBe(true);
        expect(isValidPerimeter(second)).toBe(true);

        for (const factory of contextFactories) {
          const context = factory.make();

          expect(context.setPerimeter(first).ok).toBe(true);
          expect(context.getScaffoldPlan().perimeterPolygon).toEqual(first);

          // Storing a second valid polygon supersedes the first.
          expect(context.setPerimeter(second).ok).toBe(true);
          const plan = context.getScaffoldPlan();
          expect(plan.perimeterPolygon).toEqual(second);
          expect(plan.measurements?.valid).toBe(true);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
