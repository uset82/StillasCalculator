import { describe, expect, it, vi } from 'vitest';

import {
  retrieveBuildingFootprints,
  type FootprintRetrievalDeps,
  type RetrieveFootprintsArgs,
} from '@/lib/ai/buildingFootprints';
import type { OverpassBuildingsResponse } from '@/app/api/overpass/buildings/route';
import { measurePolygon } from '@/lib/geometry/turfMeasurements';
import type { GeocodeOutcome } from '@/lib/geocoding/photonServer';
import type { GeoJsonPolygon } from '@/lib/types';

// Integration test for Property M — Footprint retrieval fallback.
//
// Validates Requirements 5.4, 5.5, 5.7 (plus the success path of 5.3) for the
// net-new `retrieveBuildingFootprints` Geometry_Tool. The tool composes two
// EXISTING server-side services (Geocoding_Service + Overpass_Service); these
// tests inject stub `deps` so no real network I/O occurs and each fallback
// branch is exercised in isolation:
//
//   - Geocoding no-match / service error / missing input -> `address-not-found`
//     with `offerManual: true` (Req 5.7); the Overpass step is never reached.
//   - Overpass non-success / network error / timeout       -> `overpass-failed`
//     with `offerManual: true` (Req 5.5).
//   - No footprints within 60 m (empty signal OR empty list) -> a successful
//     result with `candidates: []`, `empty: true`, `offerManual: true`
//     (Req 5.4).
//   - One or more footprints                                 -> a successful
//     result whose candidates carry engine-previewed measurements (Req 5.3).
//
// `retrieveBuildingFootprints` takes no Project_State and never mutates one, so
// "Project_State preserved" (Req 5.5, 5.7) is asserted as: the function returns
// the documented failure shape and performs no side effect beyond the stubbed
// calls (e.g. the Overpass step is not invoked when geocoding fails).

const OSLO = { lat: 59.9139, lon: 10.7522 };

/** A small, well-formed building footprint near Oslo (closed [lon,lat] ring). */
const SQUARE_BUILDING: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10.7522, 59.9139],
      [10.7524, 59.9139],
      [10.7524, 59.9141],
      [10.7522, 59.9141],
      [10.7522, 59.9139],
    ],
  ],
};

/** A second, distinct footprint to confirm stable candidate indexing. */
const SECOND_BUILDING: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10.753, 59.914],
      [10.7532, 59.914],
      [10.7532, 59.9142],
      [10.753, 59.9142],
      [10.753, 59.914],
    ],
  ],
};

function geocodeMatch(lat: number, lon: number): GeocodeOutcome {
  return { results: [{ label: 'Stub Street 1, Oslo', lat, lon }], noMatch: false };
}

const GEOCODE_NO_MATCH: GeocodeOutcome = { results: [], noMatch: true };

function overpassResponse(
  partial: Partial<OverpassBuildingsResponse>,
): OverpassBuildingsResponse {
  return {
    buildings: [],
    lat: OSLO.lat,
    lon: OSLO.lon,
    ...partial,
  };
}

/**
 * Build a full `FootprintRetrievalDeps` from overrides. By default geocoding
 * resolves to Oslo, Overpass returns the empty signal, and `measure` is the
 * real Geometry_Engine so candidates carry real preview measurements.
 */
function buildDeps(
  overrides: Partial<FootprintRetrievalDeps> = {},
): FootprintRetrievalDeps {
  return {
    geocode: vi.fn(async () => geocodeMatch(OSLO.lat, OSLO.lon)),
    queryOverpassBuildings: vi.fn(async () =>
      overpassResponse({ empty: true }),
    ),
    measure: measurePolygon,
    ...overrides,
  };
}

describe('retrieveBuildingFootprints — fallback branches (Property M)', () => {
  // --- Req 5.7: geocoding could not resolve the address ------------------
  describe('address could not be located -> address-not-found (Req 5.7)', () => {
    it('returns address-not-found with offerManual when geocoding reports noMatch', async () => {
      const queryOverpassBuildings = vi.fn();
      const deps = buildDeps({
        geocode: vi.fn(async () => GEOCODE_NO_MATCH),
        queryOverpassBuildings,
      });

      const result = await retrieveBuildingFootprints({ address: 'nowhere' }, deps);

      expect(result).toEqual({
        ok: false,
        error: 'address-not-found',
        offerManual: true,
      });
      // Project_State preserved: the Overpass step is never reached on a
      // geocoding failure, so no further side effect can occur (Req 5.7).
      expect(queryOverpassBuildings).not.toHaveBeenCalled();
    });

    it('returns address-not-found when the Geocoding_Service throws (service error)', async () => {
      const queryOverpassBuildings = vi.fn();
      const deps = buildDeps({
        geocode: vi.fn(async () => {
          throw new Error('geocoding service unavailable');
        }),
        queryOverpassBuildings,
      });

      const result = await retrieveBuildingFootprints(
        { address: 'Storgata 1, Oslo' },
        deps,
      );

      expect(result).toEqual({
        ok: false,
        error: 'address-not-found',
        offerManual: true,
      });
      expect(queryOverpassBuildings).not.toHaveBeenCalled();
    });

    it('returns address-not-found when neither an address nor a usable coordinate is supplied', async () => {
      const geocode = vi.fn();
      const queryOverpassBuildings = vi.fn();
      const deps = buildDeps({ geocode, queryOverpassBuildings });

      const result = await retrieveBuildingFootprints(
        {} as RetrieveFootprintsArgs,
        deps,
      );

      expect(result).toEqual({
        ok: false,
        error: 'address-not-found',
        offerManual: true,
      });
      // No geocoding is attempted with no address, and Overpass is never hit.
      expect(geocode).not.toHaveBeenCalled();
      expect(queryOverpassBuildings).not.toHaveBeenCalled();
    });
  });

  // --- Req 5.5: Overpass step failed -------------------------------------
  describe('Overpass step failed -> overpass-failed (Req 5.5)', () => {
    it('returns overpass-failed with offerManual when Overpass surfaces an error signal', async () => {
      const deps = buildDeps({
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({ error: 'overpass-failed' }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(result).toEqual({
        ok: false,
        error: 'overpass-failed',
        offerManual: true,
      });
    });

    it('returns overpass-failed when the Overpass_Service throws (network error / timeout)', async () => {
      const deps = buildDeps({
        queryOverpassBuildings: vi.fn(async () => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(result).toEqual({
        ok: false,
        error: 'overpass-failed',
        offerManual: true,
      });
    });
  });

  // --- Req 5.4: no footprints within the 60 m radius ---------------------
  describe('no footprint in 60 m -> empty success (Req 5.4)', () => {
    it('returns an empty candidate list when Overpass signals empty', async () => {
      const deps = buildDeps({
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({ empty: true }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(result).toEqual({
        ok: true,
        data: {
          coordinate: { lat: OSLO.lat, lon: OSLO.lon },
          candidates: [],
          empty: true,
          offerManual: true,
        },
      });
    });

    it('returns an empty candidate list when Overpass returns no buildings', async () => {
      const deps = buildDeps({
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({ buildings: [] }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.candidates).toEqual([]);
        expect(result.data.empty).toBe(true);
        expect(result.data.offerManual).toBe(true);
      }
    });
  });

  // --- Req 5.3: footprints found -> candidates with engine measurements --
  describe('footprints found -> candidates with engine-previewed measurements (Req 5.3)', () => {
    it('returns candidates whose perimeter/area come from the Geometry_Engine', async () => {
      const deps = buildDeps({
        geocode: vi.fn(async () => geocodeMatch(OSLO.lat, OSLO.lon)),
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({
            buildings: [SQUARE_BUILDING, SECOND_BUILDING],
            empty: false,
          }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { address: 'Storgata 1, Oslo' },
        deps,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data } = result;
      expect(data.coordinate).toEqual({ lat: OSLO.lat, lon: OSLO.lon });
      expect(data.empty).toBeUndefined();
      expect(data.candidates).toHaveLength(2);

      data.candidates.forEach((candidate, expectedIndex) => {
        // Stable indices over the surviving candidates (Req 5.3).
        expect(candidate.index).toBe(expectedIndex);
        // Engine-ready closed ring.
        expect(candidate.polygon.type).toBe('Polygon');
        // Preview figures equal the deterministic Geometry_Engine output for
        // the candidate's polygon — never AI-invented (Req 7).
        const engine = measurePolygon(candidate.polygon);
        expect(engine.valid).toBe(true);
        expect(candidate.perimeterMeters).toBe(engine.perimeterMeters);
        expect(candidate.areaSquareMeters).toBe(engine.areaSquareMeters);
        expect(candidate.perimeterMeters).toBeGreaterThan(0);
        expect(candidate.areaSquareMeters).toBeGreaterThan(0);
      });
    });

    it('echoes a directly supplied coordinate without geocoding', async () => {
      const geocode = vi.fn();
      const deps = buildDeps({
        geocode,
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({ buildings: [SQUARE_BUILDING], empty: false }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(geocode).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.coordinate).toEqual({ lat: OSLO.lat, lon: OSLO.lon });
        expect(result.data.candidates).toHaveLength(1);
      }
    });

    it('drops degenerate footprints and reports empty when none survive (Req 5.4)', async () => {
      // A way with fewer than 3 distinct vertices is rejected by the engine.
      const degenerate: GeoJsonPolygon = {
        type: 'Polygon',
        coordinates: [
          [
            [10.7522, 59.9139],
            [10.7522, 59.9139],
          ],
        ],
      };
      const deps = buildDeps({
        queryOverpassBuildings: vi.fn(async () =>
          overpassResponse({ buildings: [degenerate], empty: false }),
        ),
      });

      const result = await retrieveBuildingFootprints(
        { lat: OSLO.lat, lon: OSLO.lon },
        deps,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.candidates).toEqual([]);
        expect(result.data.empty).toBe(true);
        expect(result.data.offerManual).toBe(true);
      }
    });
  });
});
