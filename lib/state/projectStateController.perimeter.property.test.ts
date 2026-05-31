// Feature: stillas-calculator, Property 2: Perimeter validation and normalization
//
// Property 2 (design.md "Correctness Properties"):
//   For any sequence of vertices: if it forms a valid simple polygon of at
//   least 3 distinct vertices with no self-intersecting sides, then storing it
//   yields a closed GeoJSON ring containing those vertices; otherwise (fewer
//   than 3 distinct vertices, or self-intersecting) the polygon is rejected and
//   nothing is stored in the Project_State.
//
// Validates: Requirements 5.5, 5.7, 5.8
//
// Strategy: the property is exercised through the state controller's
// `setPerimeter` updater (the public entry point that decides what reaches the
// Project_State). Two complementary families of generators feed it:
//   1. Valid simple rings — axis-aligned rectangles and star-shaped polygons
//      (the same constructions used by Property 1, both guaranteed simple).
//      Storing one must succeed (ok: true) and leave a closed ring in the
//      Project_State that contains every input vertex (Req 5.5).
//   2. Invalid rings — degenerate rings with fewer than 3 distinct vertices
//      (Req 5.7) and self-intersecting "bowtie" quadrilaterals (Req 5.8).
//      Storing one must be rejected (ok: false) and leave perimeterPolygon
//      (and measurements / scaffold length) untouched at their initial null.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProjectStateController } from './projectStateController';
import { isValidPerimeter } from '@/lib/geometry/turfMeasurements';
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
    // A strictly non-zero offset so b is genuinely distinct from a.
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
// Helpers
// ---------------------------------------------------------------------------

/** True when `ring` contains an exact [lon, lat] match for `vertex`. */
function ringContainsVertex(ring: number[][], vertex: number[]): boolean {
  return ring.some(
    (point) => point[0] === vertex[0] && point[1] === vertex[1],
  );
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: Perimeter validation and normalization', () => {
  it('stores a valid simple ring as a closed GeoJSON ring containing its vertices', () => {
    fc.assert(
      fc.property(validPolygonArb, (polygon) => {
        // Sanity: the generators only emit valid simple rings.
        expect(isValidPerimeter(polygon)).toBe(true);

        const controller = createProjectStateController();
        // Nothing stored before the update.
        expect(controller.getState().perimeterPolygon).toBeNull();

        const result = controller.setPerimeter(polygon);
        // A valid ring is accepted (Req 5.5).
        expect(result.ok).toBe(true);

        const stored = controller.getState().perimeterPolygon;
        expect(stored).not.toBeNull();

        const storedRing = stored!.coordinates[0];
        // The stored ring is closed: first coordinate equals the last.
        const first = storedRing[0];
        const last = storedRing[storedRing.length - 1];
        expect(first[0]).toBe(last[0]);
        expect(first[1]).toBe(last[1]);

        // The stored ring contains every input vertex (Req 5.5).
        for (const vertex of polygon.coordinates[0]) {
          expect(ringContainsVertex(storedRing, vertex)).toBe(true);
        }

        // A measurement was produced for the stored ring.
        expect(controller.getState().measurements?.valid).toBe(true);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('rejects an invalid ring (<3 distinct vertices or self-intersecting) and stores nothing', () => {
    fc.assert(
      fc.property(invalidPolygonArb, (polygon) => {
        // Sanity: the generators only emit invalid rings.
        expect(isValidPerimeter(polygon)).toBe(false);

        const controller = createProjectStateController();
        // Capture the untouched initial state.
        expect(controller.getState().perimeterPolygon).toBeNull();

        const result = controller.setPerimeter(polygon);
        // An invalid ring is rejected (Req 5.7, 5.8).
        expect(result.ok).toBe(false);
        expect(result.error?.field).toBe('perimeterPolygon');

        // Nothing is stored: perimeter, measurements, and scaffold length all
        // remain at their initial null (Req 5.7, 5.8).
        const state = controller.getState();
        expect(state.perimeterPolygon).toBeNull();
        expect(state.measurements).toBeNull();
        expect(state.scaffoldLengthMeters).toBeNull();
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
