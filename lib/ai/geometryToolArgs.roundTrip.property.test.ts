// Feature: ai-agent-building-drawing, Property H: Geometry tool round-trip preserves measurements
//
// Property H (design.md "Correctness Properties" / Req 12.5):
//   For all valid Perimeter_Polygons, measuring the polygon obtained by parsing
//   the serialized form of a stored perimeter equals measuring the original.
//   This is the parser/serializer round-trip required for geometry passed
//   across the tool boundary.
//
// Validates: Requirements 12.5
//
// Mechanism under test — the tool-boundary round-trip:
//
//   1. A valid perimeter polygon is "stored" (the engine measures it).
//   2. `serializePolygonRing` emits the stored ring's exact ordered [lon, lat]
//      pairs for return to the model (lib/ai/geometryToolArgs.ts).
//   3. `coordinatesToClosedRing` re-closes those pairs back into a polygon when
//      the model passes them across the tool boundary again.
//   4. The Geometry_Engine (lib/geometry/turfMeasurements.ts) measures the
//      re-closed polygon.
//
// Because the serializer preserves every coordinate value exactly and the ring
// it serializes is already closed, the re-closing pass is a no-op, so the
// round-trip polygon is identical to the original and the deterministic engine
// produces identical measurements and Scaffold_Length.
//
// Strategy: two complementary generators of valid (closed, >=3 distinct
// vertices, non-self-intersecting) rings, mirroring the existing geometry
// property tests:
//   1. Axis-aligned rectangles with random position and extent.
//   2. Star-shaped polygons whose vertices sit at strictly increasing angles
//      around a center, which is simple (non-self-intersecting) for any radii.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  coordinatesToClosedRing,
  serializePolygonRing,
} from './geometryToolArgs';
import {
  measurePolygon,
  isValidPerimeter,
  computeScaffoldLength,
} from '@/lib/geometry/turfMeasurements';
import type { GeoJsonPolygon } from '@/lib/types';

const MIN_RUNS = 300;

// ---------------------------------------------------------------------------
// Generators for valid Perimeter_Polygons
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
 * increasing angles around (clon, clat), each at a positive radius. Confining
 * each vertex to its own angular sector guarantees the ring never
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

// A facade selection over a polygon with `sideCount` sides: drawn to include
// duplicates and out-of-range indices so the round-trip is exercised against
// the same (messy) selection on both the original and the re-closed polygon.
function selectionArb(sideCount: number): fc.Arbitrary<number[] | null> {
  return fc.oneof(
    fc.constant<number[] | null>(null),
    fc.array(fc.integer({ min: -2, max: sideCount + 2 }), { maxLength: 12 }),
  );
}

// ---------------------------------------------------------------------------
// Property H — geometry tool round-trip preserves measurements
// ---------------------------------------------------------------------------

describe('Property H: Geometry tool round-trip preserves measurements (Req 12.5)', () => {
  it('measuring the serialized-then-reclosed perimeter equals measuring the original', () => {
    fc.assert(
      fc.property(validPolygonArb, (original) => {
        // The generators only ever produce valid simple rings.
        expect(isValidPerimeter(original)).toBe(true);

        // Engine measurement of the originally stored perimeter.
        const originalMeasurements = measurePolygon(original);
        expect(originalMeasurements.valid).toBe(true);

        // Tool-boundary round-trip: serialize the stored ring to the exact
        // ordered pairs the model receives, then re-close them into a polygon.
        const serialized = serializePolygonRing(original);
        const reclosed = coordinatesToClosedRing(serialized);
        expect(reclosed.ok).toBe(true);
        if (!reclosed.ok) return;

        // The round-trip must still be a valid perimeter.
        expect(isValidPerimeter(reclosed.polygon)).toBe(true);

        // Engine measurement of the round-tripped perimeter.
        const roundTripMeasurements = measurePolygon(reclosed.polygon);

        // Property H: measurements are preserved exactly. Because the serializer
        // preserves every coordinate value and the deterministic engine maps
        // identical input to identical output, equality is exact (not merely
        // within tolerance).
        expect(roundTripMeasurements).toEqual(originalMeasurements);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('preserves the engine Scaffold_Length for any facade selection across the round-trip', () => {
    const polygonAndSelectionArb = validPolygonArb.chain((polygon) =>
      selectionArb(polygon.coordinates[0].length - 1).map((selection) => ({
        polygon,
        selection,
      })),
    );

    fc.assert(
      fc.property(polygonAndSelectionArb, ({ polygon, selection }) => {
        const originalMeasurements = measurePolygon(polygon);
        const originalLength = computeScaffoldLength(
          originalMeasurements,
          selection,
        );

        const reclosed = coordinatesToClosedRing(serializePolygonRing(polygon));
        expect(reclosed.ok).toBe(true);
        if (!reclosed.ok) return;

        const roundTripMeasurements = measurePolygon(reclosed.polygon);
        const roundTripLength = computeScaffoldLength(
          roundTripMeasurements,
          selection,
        );

        // Scaffold_Length is derived only from preserved measurements, so it is
        // preserved exactly across the tool-boundary round-trip (Req 12.5).
        expect(roundTripLength).toBe(originalLength);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // Concrete named example pinning the same Property H behavior
  // -------------------------------------------------------------------------

  it('round-trips a concrete rectangle with identical measurements', () => {
    const rectangle = buildRectangle(10.0, 59.0, 0.002, 0.003);

    const before = measurePolygon(rectangle);
    expect(before.valid).toBe(true);

    const reclosed = coordinatesToClosedRing(serializePolygonRing(rectangle));
    expect(reclosed.ok).toBe(true);
    if (!reclosed.ok) return;

    // The serialized ring is already closed, so re-closing reproduces the exact
    // same polygon, value-for-value.
    expect(reclosed.polygon).toEqual(rectangle);

    const after = measurePolygon(reclosed.polygon);
    expect(after).toEqual(before);
  });
});
