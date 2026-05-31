// Feature: stillas-calculator, Property 4: Invalid polygon is not measured
//
// Property 4 (design.md "Correctness Properties"):
//   For any invalid polygon, `measurePolygon` reports `valid: false`, no new
//   measurements are produced, and the last valid measurements in the
//   Project_State are retained.
//
// Validates: Requirements 6.10
//
// Strategy: drive the property through the state controller, the public entry
// point that decides what reaches the Project_State.
//   1. Seed a fresh controller with a VALID perimeter (an axis-aligned
//      rectangle or star-shaped ring, both guaranteed simple). This produces a
//      valid measurement that becomes the "last valid" snapshot to defend.
//   2. Attempt to overwrite it with an INVALID polygon (a degenerate ring with
//      fewer than 3 distinct vertices, or a self-intersecting "bowtie"). The
//      Geometry Engine must report the invalid polygon as `valid: false`, the
//      controller must reject the update (ok: false), and the previously stored
//      valid measurements and perimeter must remain byte-for-byte unchanged
//      (Req 6.10).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProjectStateController } from './projectStateController';
import { measurePolygon, isValidPerimeter } from '@/lib/geometry/turfMeasurements';
import type { GeoJsonPolygon } from '@/lib/types';

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
// Invalid-ring generators (<3 distinct vertices, or self-intersecting)
// ---------------------------------------------------------------------------

/**
 * Builds a degenerate ring with fewer than 3 distinct vertices (Req 5.7):
 * either a single repeated point or two distinct points wound into a closed
 * ring. Neither encloses an area, so both must be rejected.
 */
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
      // One distinct vertex repeated into a closed ring (size 1 < 3).
      const ring = [[...a], [...a], [...a], [...a]];
      return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
    }
    // Two distinct vertices wound into a closed ring (size 2 < 3).
    const b: number[] = [aLon + dLon, aLat + dLat];
    const ring = [[...a], [...b], [...a]];
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

/**
 * Builds a self-intersecting "bowtie" quadrilateral (Req 5.8). Ordering the
 * four rectangle corners as BL -> TR -> BR -> TL makes the diagonals BL->TR and
 * BR->TL cross at the center for any positive (w, h), so the ring is non-simple
 * regardless of the size chosen.
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
    // BL -> TR -> BR -> TL -> BL: the two diagonals cross at the center.
    const ring = [bl, tr, br, tl, [...bl]];
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

const invalidPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.oneof(
  degenerateRingArb,
  bowtieArb,
);

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Property 4: Invalid polygon is not measured', () => {
  it('rejects an invalid polygon and retains the last valid measurements and perimeter', () => {
    fc.assert(
      fc.property(validPolygonArb, invalidPolygonArb, (valid, invalid) => {
        // Sanity: the generators emit exactly what their names promise.
        expect(isValidPerimeter(valid)).toBe(true);
        expect(isValidPerimeter(invalid)).toBe(false);

        // (1) Seed a fresh controller with a VALID perimeter so the state holds
        // a valid measurement to defend.
        const controller = createProjectStateController();
        const seeded = controller.setPerimeter(valid);
        expect(seeded.ok).toBe(true);

        // Capture the last valid snapshot (deep clones so later mutation of the
        // controller's state cannot retroactively change what we compare to).
        const lastValidMeasurements = structuredClone(
          controller.getState().measurements,
        );
        const lastValidPerimeter = structuredClone(
          controller.getState().perimeterPolygon,
        );
        const lastValidScaffoldLength =
          controller.getState().scaffoldLengthMeters;
        expect(lastValidMeasurements?.valid).toBe(true);

        // (2) The Geometry Engine itself reports the invalid polygon as invalid
        // and produces no measurement (Req 6.10).
        const invalidMeasurement = measurePolygon(invalid);
        expect(invalidMeasurement.valid).toBe(false);

        // (3) Attempting to store the invalid polygon is rejected.
        const result = controller.setPerimeter(invalid);
        expect(result.ok).toBe(false);
        expect(result.error?.field).toBe('perimeterPolygon');

        // (4) No new measurements are produced: the last valid measurements,
        // perimeter, and scaffold length all remain exactly as before (Req 6.10).
        const state = controller.getState();
        expect(state.measurements).toEqual(lastValidMeasurements);
        expect(state.measurements?.valid).toBe(true);
        expect(state.perimeterPolygon).toEqual(lastValidPerimeter);
        expect(state.scaffoldLengthMeters).toBe(lastValidScaffoldLength);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
