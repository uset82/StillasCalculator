import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { osmToGeoJSON, type OverpassLatLon, type OverpassWay } from './osmToGeoJSON';

// Feature: stillas-calculator, Property 19: OSM-to-GeoJSON conversion produces valid polygons
//
// Property 19 (design.md): For any set of valid OSM building ways/relations,
// conversion to GeoJSON yields polygon features whose rings are closed and
// preserve the source vertex coordinates in order.
//
// **Validates: Requirements 4.2**
//
// This test focuses on Overpass `way` elements with inline `out geom;`
// geometry (arrays of { lat, lon }). For every produced polygon it asserts:
//   1. the outer ring is closed (first position deep-equals the last), and
//   2. the source vertex coordinates are preserved in order as GeoJSON
//      [lon, lat] positions (Overpass reports { lat, lon }).

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A single inline Overpass vertex with finite, in-range lat/lon.
const latLonArb: fc.Arbitrary<OverpassLatLon> = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
});

// A valid building way geometry: at least 3 pairwise-distinct vertices so the
// closed ring always has >= 4 positions. `closed` decides whether the source
// already repeats its first vertex at the end (as real OSM footprints do).
const wayGeometryArb: fc.Arbitrary<{
  points: OverpassLatLon[];
  closed: boolean;
}> = fc
  .record({
    points: fc.uniqueArray(latLonArb, {
      minLength: 3,
      maxLength: 12,
      selector: (p) => `${p.lat},${p.lon}`,
    }),
    closed: fc.boolean(),
  })
  .map(({ points, closed }) => ({
    // When `closed`, append a copy of the first vertex (source already closed).
    points: closed ? [...points, { ...points[0] }] : points,
    closed,
  }));

// A valid Overpass `way` element built from generated geometry.
const wayArb: fc.Arbitrary<OverpassWay> = fc
  .record({
    id: fc.integer({ min: 1, max: 1_000_000 }),
    geometry: wayGeometryArb,
  })
  .map(({ id, geometry }) => ({
    type: 'way' as const,
    id,
    geometry: geometry.points,
  }));

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function ringIsClosed(ring: number[][]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

describe('osmToGeoJSON — Property 19: conversion produces valid polygons', () => {
  it('produces closed rings preserving source vertex order for ways', () => {
    fc.assert(
      fc.property(fc.array(wayArb, { minLength: 1, maxLength: 6 }), (ways) => {
        const polygons = osmToGeoJSON(ways);

        // Every valid way yields exactly one polygon, pushed in input order.
        expect(polygons).toHaveLength(ways.length);

        ways.forEach((way, index) => {
          const polygon = polygons[index];
          expect(polygon.type).toBe('Polygon');

          const ring = polygon.coordinates[0];

          // (1) A valid GeoJSON polygon ring has >= 4 positions and is closed.
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ringIsClosed(ring)).toBe(true);

          // (2) Source { lat, lon } vertices are preserved in order as
          // [lon, lat] positions.
          const source = way.geometry ?? [];
          source.forEach((vertex, vertexIndex) => {
            expect(ring[vertexIndex][0]).toBe(vertex.lon);
            expect(ring[vertexIndex][1]).toBe(vertex.lat);
          });
        });
      }),
      { numRuns: 200 },
    );
  });
});
