// Server-side footprint composition for the `retrieveBuildingFootprints`
// Geometry_Tool (Req 5).
//
// This module is the net-new capability of this feature: given an address or a
// coordinate, it resolves an address to a coordinate via the Geocoding_Service
// and obtains candidate building footprints within a 60 m radius via the
// Overpass_Service — composing the two EXISTING server-side routes rather than
// introducing any new network stack (Req 5.1, 5.6).
//
//   - Geocoding reuses `geocodeWithFallback` (the server-side core of
//     `/api/geocoding/photon`: Photon with a single Nominatim fallback). A
//     no-match or service error maps to `address-not-found` (Req 5.7).
//   - Footprints reuse the `/api/overpass/buildings` route handler (60 m radius,
//     25 s deadline, mirror failover, OSM→GeoJSON conversion, and the
//     `empty`/`error: 'overpass-failed'` signals). A network error, non-success
//     response, or timeout maps to `overpass-failed` (Req 5.5); no footprints in
//     the radius maps to `{ empty: true, candidates: [] }` (Req 5.4).
//
// The tool only RETRIEVES candidates; it never stores a perimeter. Selecting a
// candidate is a separate step the model performs by calling
// `setBuildingPerimeter` with the chosen candidate's polygon (Req 6.2), so
// footprint selection inherits all of Req 6/7/8's correctness guarantees.
//
// Each candidate's polygon is rebuilt into an engine-ready closed ring via
// `coordinatesToClosedRing` (Req 12) and previewed with the deterministic
// Geometry_Engine (`measurePolygon`) so the model sees real perimeter/area
// figures — never AI-invented ones (Req 7).
//
// All work here is server-side: the Overpass and geocoding endpoints are never
// exposed to the client (Req 5.6).

import { GET as overpassBuildingsRoute } from '@/app/api/overpass/buildings/route';
import type { OverpassBuildingsResponse } from '@/app/api/overpass/buildings/route';
import { coordinatesToClosedRing } from '@/lib/ai/geometryToolArgs';
import { measurePolygon } from '@/lib/geometry/turfMeasurements';
import {
  geocodeWithFallback,
  type GeocodeOutcome,
} from '@/lib/geocoding/photonServer';
import type { GeoJsonPolygon, PolygonMeasurements } from '@/lib/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Arguments accepted by the tool: an address OR a coordinate (Req 5.1). */
export interface RetrieveFootprintsArgs {
  /** Free-text address to geocode. Null/absent when a coordinate is supplied. */
  address?: string | null;
  /** Latitude (-90..90). Null/absent when an address is supplied. */
  lat?: number | null;
  /** Longitude (-180..180). Null/absent when an address is supplied. */
  lon?: number | null;
}

/** A single candidate footprint, previewed by the Geometry_Engine. */
export interface FootprintCandidate {
  /** Stable index the model references when confirming a selection. */
  index: number;
  /** Closed [lon, lat] ring, engine-ready for `setBuildingPerimeter`. */
  polygon: GeoJsonPolygon;
  /** Perimeter in meters, from the Geometry_Engine (preview only). */
  perimeterMeters: number;
  /** Enclosed area in square meters, from the Geometry_Engine (preview only). */
  areaSquareMeters: number;
}

/** Successful Tool_Result payload (Req 5.3, 5.4). */
export interface RetrieveFootprintsData {
  /** Resolved (geocoded) or echoed (supplied) coordinate. */
  coordinate: { lat: number; lon: number };
  /** Candidate footprints for the model to confirm with the user (Req 5.3). */
  candidates: FootprintCandidate[];
  /** True when no footprint was found within 60 m (Req 5.4). */
  empty?: boolean;
  /** Hint that the model should offer manual drawing/dimensions. */
  offerManual?: boolean;
}

/** Failure reasons, mirroring the underlying services' fallback signals. */
export type FootprintRetrievalError = 'address-not-found' | 'overpass-failed';

/** Deterministic footprint auto-selection strategy used by app tools. */
export type FootprintSelectionStrategy = 'nearest' | 'largest';

/**
 * Discriminated outcome of {@link retrieveBuildingFootprints}. Failures carry
 * `offerManual: true` so the caller/model knows to offer manual drawing while
 * the existing Project_State is preserved (Req 5.5, 5.7).
 */
export type FootprintRetrievalResult =
  | { ok: true; data: RetrieveFootprintsData }
  | { ok: false; error: FootprintRetrievalError; offerManual: true };

/**
 * Injectable dependencies, defaulting to the real server-side services. Tests
 * supply stubs to exercise the geocoding/Overpass fallback branches without
 * real network I/O (Property M, task 3.3).
 */
export interface FootprintRetrievalDeps {
  geocode: (query: string) => Promise<GeocodeOutcome>;
  queryOverpassBuildings: (
    lat: number,
    lon: number,
  ) => Promise<OverpassBuildingsResponse>;
  measure: (polygon: GeoJsonPolygon) => PolygonMeasurements;
}

// ---------------------------------------------------------------------------
// Defaults (real server-side services)
// ---------------------------------------------------------------------------

/**
 * Calls the existing `/api/overpass/buildings` route handler in-process (60 m
 * radius, 25 s deadline, mirror failover) and returns its parsed JSON body.
 * Composing the route keeps a single source of truth for the Overpass contract
 * and stays entirely server-side (Req 5.1, 5.6).
 */
async function defaultQueryOverpassBuildings(
  lat: number,
  lon: number,
): Promise<OverpassBuildingsResponse> {
  const url =
    `http://localhost/api/overpass/buildings` +
    `?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`;
  const response = await overpassBuildingsRoute(new Request(url));
  return (await response.json()) as OverpassBuildingsResponse;
}

const DEFAULT_DEPS: FootprintRetrievalDeps = {
  geocode: (query) => geocodeWithFallback(query),
  queryOverpassBuildings: defaultQueryOverpassBuildings,
  measure: measurePolygon,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A coordinate is usable only when both components are finite and in range. */
function isUsableCoordinate(lat: unknown, lon: unknown): lat is number {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    (lon as number) >= -180 &&
    (lon as number) <= 180
  );
}

/**
 * Resolve the search coordinate from the tool arguments.
 *
 *   - A usable supplied coordinate is echoed directly (no geocoding).
 *   - Otherwise a non-empty address is geocoded; the first result is used.
 *   - A no-match, service error, or absent input yields `null` so the caller
 *     surfaces `address-not-found` (Req 5.7).
 */
async function resolveCoordinate(
  args: RetrieveFootprintsArgs,
  deps: FootprintRetrievalDeps,
): Promise<{ lat: number; lon: number } | null> {
  // A directly supplied, in-range coordinate is used as-is (Req 5.1).
  if (isUsableCoordinate(args.lat, args.lon)) {
    return { lat: args.lat as number, lon: args.lon as number };
  }

  const address = typeof args.address === 'string' ? args.address.trim() : '';
  if (address.length === 0) {
    // Neither a usable coordinate nor an address to geocode.
    return null;
  }

  let outcome: GeocodeOutcome;
  try {
    outcome = await deps.geocode(address);
  } catch {
    // Treat any geocoding service error as a no-match (Req 5.7).
    return null;
  }

  if (outcome.noMatch || outcome.results.length === 0) {
    return null;
  }

  const first = outcome.results[0];
  if (!isUsableCoordinate(first.lat, first.lon)) {
    return null;
  }
  return { lat: first.lat, lon: first.lon };
}

/**
 * Convert an Overpass building polygon's outer ring into an engine-ready closed
 * ring (Req 12) and preview it with the Geometry_Engine. Returns `null` when the
 * ring is malformed or the engine rejects it, so degenerate footprints are
 * dropped rather than surfaced with bogus measurements.
 */
function toCandidate(
  building: GeoJsonPolygon,
  index: number,
  deps: FootprintRetrievalDeps,
): FootprintCandidate | null {
  const outerRing =
    building &&
    building.type === 'Polygon' &&
    Array.isArray(building.coordinates) &&
    Array.isArray(building.coordinates[0])
      ? building.coordinates[0]
      : null;

  if (!outerRing) {
    return null;
  }

  const closed = coordinatesToClosedRing(outerRing);
  if (!closed.ok) {
    return null;
  }

  const measurements = deps.measure(closed.polygon);
  if (!measurements.valid) {
    return null;
  }

  return {
    index,
    polygon: closed.polygon,
    perimeterMeters: measurements.perimeterMeters,
    areaSquareMeters: measurements.areaSquareMeters,
  };
}

function squaredCentroidDistance(
  candidate: FootprintCandidate,
  coordinate: { lat: number; lon: number },
): number {
  const ring = candidate.polygon.coordinates[0] ?? [];
  if (ring.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const vertices = ring.slice(0, -1).length > 0 ? ring.slice(0, -1) : ring;
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of vertices) {
    sumLon += lon;
    sumLat += lat;
  }

  const centroidLon = sumLon / vertices.length;
  const centroidLat = sumLat / vertices.length;
  const dLon = centroidLon - coordinate.lon;
  const dLat = centroidLat - coordinate.lat;
  return dLon * dLon + dLat * dLat;
}

/** Selects a footprint candidate deterministically, without model arithmetic. */
export function pickFootprintCandidate(
  candidates: readonly FootprintCandidate[],
  coordinate: { lat: number; lon: number },
  strategy: FootprintSelectionStrategy = 'nearest',
): FootprintCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  if (strategy === 'largest') {
    return candidates.reduce((best, candidate) =>
      candidate.areaSquareMeters > best.areaSquareMeters ? candidate : best,
    );
  }

  return candidates.reduce((best, candidate) =>
    squaredCentroidDistance(candidate, coordinate) <
    squaredCentroidDistance(best, coordinate)
      ? candidate
      : best,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an address/coordinate to candidate building footprints within 60 m
 * (Req 5). Both the geocoding and Overpass calls run server-side.
 *
 * Outcomes:
 *   - Geocoding no-match / service error / missing input → `address-not-found`
 *     with `offerManual` (Req 5.7).
 *   - Overpass network error / non-success / timeout → `overpass-failed` with
 *     `offerManual` (Req 5.5).
 *   - No footprints in 60 m → `{ ok: true, empty: true, candidates: [] }`
 *     (Req 5.4).
 *   - One or more footprints → `{ ok: true, candidates: [...] }` (Req 5.3).
 *
 * The Project_State is never mutated here; this tool only retrieves candidates.
 */
export async function retrieveBuildingFootprints(
  args: RetrieveFootprintsArgs,
  deps: FootprintRetrievalDeps = DEFAULT_DEPS,
): Promise<FootprintRetrievalResult> {
  const coordinate = await resolveCoordinate(args, deps);
  if (!coordinate) {
    return { ok: false, error: 'address-not-found', offerManual: true };
  }

  let response: OverpassBuildingsResponse;
  try {
    response = await deps.queryOverpassBuildings(coordinate.lat, coordinate.lon);
  } catch {
    // Any thrown error from the Overpass step is a failure (Req 5.5).
    return { ok: false, error: 'overpass-failed', offerManual: true };
  }

  // The route surfaces a non-success / network / timeout failure as an `error`
  // signal (e.g. 'overpass-failed' or 'invalid-coordinate'); either way the
  // retrieval failed (Req 5.5).
  if (response.error) {
    return { ok: false, error: 'overpass-failed', offerManual: true };
  }

  const buildings = Array.isArray(response.buildings) ? response.buildings : [];

  // No footprints within the radius (Req 5.4).
  if (response.empty || buildings.length === 0) {
    return {
      ok: true,
      data: { coordinate, candidates: [], empty: true, offerManual: true },
    };
  }

  // Build engine-ready candidates, dropping any degenerate footprint and
  // assigning stable indices over the surviving candidates (Req 5.3, 7).
  const candidates: FootprintCandidate[] = [];
  for (const building of buildings) {
    const candidate = toCandidate(building, candidates.length, deps);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Every footprint was degenerate: treat as no usable footprint (Req 5.4).
  if (candidates.length === 0) {
    return {
      ok: true,
      data: { coordinate, candidates: [], empty: true, offerManual: true },
    };
  }

  return { ok: true, data: { coordinate, candidates } };
}
