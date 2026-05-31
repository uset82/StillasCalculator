// Feature: stillas-calculator, Property 1: Polygon measurement correctness
//
// Property 1 (design.md "Correctness Properties"):
//   For any valid perimeter polygon (a closed ring of at least 3 distinct
//   vertices with no self-intersecting sides), `measurePolygon` returns a
//   non-negative perimeter, a non-negative area, and one side length per
//   polygon edge, where every side length is non-negative and the side lengths
//   sum (within floating-point tolerance) to the perimeter.
//
// Validates: Requirements 6.1, 6.2, 6.3
//
// Strategy: two complementary generators feed the same property.
//   1. Axis-aligned rectangles — analytically checkable: a rectangle has
//      exactly 4 sides, its two vertical (meridian) sides are exactly equal in
//      length, and its geodesic area closely matches average-width * height.
//   2. Random simple rings — star-shaped polygons built by placing vertices at
//      strictly increasing angles around a center at positive radii, which is
//      guaranteed to be simple (non-self-intersecting) for any radii.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as turf from '@turf/turf';
import { measurePolygon, isValidPerimeter } from './turfMeasurements';
import type { GeoJsonPolygon } from '@/lib/types';

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Builds an axis-aligned rectangle ring with bottom-left corner (lon0, lat0)
 * and degree extents (w, h), wound counter-clockwise and closed:
 *   bottom -> right -> top -> left -> (close)
 * The two vertical sides (right, left) lie on meridians spanning the same
 * latitude delta, so their geodesic lengths are exactly equal.
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
    // Bounded away from the antimeridian and poles so lon0 + w / lat0 + h stay
    // comfortably in range and the geodesic math is well-conditioned.
    lon0: fc.double({ min: -179, max: 178, noNaN: true }),
    lat0: fc.double({ min: -60, max: 59, noNaN: true }),
    w: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
    h: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
  })
  .map(({ lon0, lat0, w, h }) => buildRectangle(lon0, lat0, w, h));

/**
 * Builds a star-shaped (hence simple) polygon: n vertices placed at strictly
 * increasing angles around (clon, clat), each at a positive radius. Because the
 * angle of vertex i is confined to the i-th angular sector, the angles are
 * strictly increasing and the polygon never self-intersects regardless of the
 * radii chosen.
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
    // fraction in (0, 1) keeps angle inside sector [i, i+1) / n * 2π.
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
        // Confined to (0, 1) so each vertex stays strictly inside its sector.
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

/** Number of edges in a closed ring = number of coordinate entries minus 1. */
function edgeCount(polygon: GeoJsonPolygon): number {
  return polygon.coordinates[0].length - 1;
}

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: Polygon measurement correctness', () => {
  it('returns non-negative perimeter/area, one non-negative side per edge, and sides summing to the perimeter', () => {
    fc.assert(
      fc.property(validPolygonArb, (polygon) => {
        // The generators only produce valid simple rings.
        expect(isValidPerimeter(polygon)).toBe(true);

        const m = measurePolygon(polygon);
        expect(m.valid).toBe(true);

        // Non-negative perimeter and area (Req 6.1, 6.2).
        expect(Number.isFinite(m.perimeterMeters)).toBe(true);
        expect(m.perimeterMeters).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(m.areaSquareMeters)).toBe(true);
        expect(m.areaSquareMeters).toBeGreaterThanOrEqual(0);

        // Exactly one side length per polygon edge (Req 6.3).
        expect(m.sideLengthsMeters).toHaveLength(edgeCount(polygon));

        // Every side length is finite and non-negative (Req 6.3).
        for (const side of m.sideLengthsMeters) {
          expect(Number.isFinite(side)).toBe(true);
          expect(side).toBeGreaterThanOrEqual(0);
        }

        // Side lengths sum to the perimeter within floating-point tolerance.
        const sum = m.sideLengthsMeters.reduce((a, b) => a + b, 0);
        const tolerance = 1e-6 * (1 + m.perimeterMeters);
        expect(Math.abs(sum - m.perimeterMeters)).toBeLessThanOrEqual(tolerance);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('measures axis-aligned rectangles to their analytically expected geometry', () => {
    fc.assert(
      fc.property(rectangleArb, (rectangle) => {
        const m = measurePolygon(rectangle);
        expect(m.valid).toBe(true);

        // A rectangle has exactly four edges in ring order: bottom, right,
        // top, left.
        expect(m.sideLengthsMeters).toHaveLength(4);
        const [bottom, right, top, left] = m.sideLengthsMeters;

        // The two vertical (meridian) sides span the same latitude delta at
        // constant longitude, so they are exactly equal in geodesic length.
        const verticalTol = 1e-6 * (1 + right);
        expect(Math.abs(right - left)).toBeLessThanOrEqual(verticalTol);

        // All sides have positive length for a non-degenerate rectangle.
        for (const side of [bottom, right, top, left]) {
          expect(side).toBeGreaterThan(0);
        }

        // Geodesic area closely matches the planar trapezoid estimate
        // (average horizontal length * vertical length).
        const expectedArea = ((bottom + top) / 2) * right;
        const referenceArea = turf.area(turf.polygon(rectangle.coordinates));
        const areaTol = 0.02 * expectedArea; // 2% relative tolerance
        expect(Math.abs(m.areaSquareMeters - expectedArea)).toBeLessThanOrEqual(
          areaTol,
        );
        // The reported area also matches Turf's geodesic area for the ring.
        expect(Math.abs(m.areaSquareMeters - referenceArea)).toBeLessThanOrEqual(
          1e-6 * (1 + referenceArea),
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
