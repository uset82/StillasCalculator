// Server route: GET /api/overpass/buildings
//
// Building footprint lookup (Req 4.1, 4.5, 4.6, 4.7). This Next.js Route
// Handler queries the public Overpass API server-side for OpenStreetMap
// building ways AND relations within a 50 m radius of a selected coordinate,
// using a 25 s timeout. Running server-side keeps the rate-limited Overpass
// service off the client (Req 4.7).
//
// Trust boundary: the raw OSM elements returned by Overpass are untrusted and
// are never handed to the client as-is. This route owns the network/secrets
// concern (the rate-limited Overpass endpoint is reached only server-side, Req
// 4.7) and delegates the pure, deterministic OSM -> GeoJSON conversion to
// `lib/osm/osmToGeoJSON.ts` (task 7.2). The conversion runs here so the route
// returns ready-to-render GeoJSON building polygons (Req 4.1, 4.2), matching
// the `fetchBuildings(): Promise<GeoJsonPolygon[]>` service contract. Raw OSM
// elements are available only with `?debug=1` to keep production payloads small.
//
// Client fallback contract: rather than throwing, the route surfaces explicit
// signals so the client can fall back to manual perimeter drawing while
// retaining the selected coordinate:
//   - `error: 'overpass-failed'` on network error / non-success / timeout (Req 4.5)
//   - `empty: true` when no building footprints exist within the radius (Req 4.6)
// The selected `lat`/`lon` are echoed back in every response so the client can
// keep the coordinate and offer manual drawing (Req 4.5).

import { NextResponse } from 'next/server';

import { osmToGeoJSON } from '@/lib/osm/osmToGeoJSON';
import type {
  OverpassElement as OsmOverpassElement,
} from '@/lib/osm/osmToGeoJSON';
import type { GeoJsonPolygon } from '@/lib/types';

/**
 * Public Overpass mirrors (open-source, no key), tried in order. Server-side
 * only (Req 4.7). The main `overpass-api.de` host throttles aggressively, so we
 * fail over to community mirrors before giving up. Override the list with the
 * `OVERPASS_ENDPOINTS` env var (comma-separated) if you run your own instance.
 */
const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

function getOverpassEndpoints(): string[] {
  const override = process.env.OVERPASS_ENDPOINTS?.trim();
  if (override) {
    const list = override
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
    if (list.length > 0) return list;
  }
  return DEFAULT_OVERPASS_ENDPOINTS;
}

/** Search radius around the selected coordinate, in meters (Req 4.1). */
const SEARCH_RADIUS_METERS = 60;

/** Overall deadline across all mirror attempts, in milliseconds (Req 4.1). */
const REQUEST_TIMEOUT_MS = 25_000;

/** Per-endpoint timeout so a slow mirror fails over quickly to the next one. */
const PER_ENDPOINT_TIMEOUT_MS = 8_000;

/**
 * A descriptive User-Agent is required by the Overpass/OSM usage policy; the
 * main `overpass-api.de` mirror returns HTTP 406 for requests without one.
 * Override via the `OVERPASS_USER_AGENT` env var to add your own contact info.
 */
const OVERPASS_USER_AGENT =
  (typeof process !== 'undefined' && process.env?.OVERPASS_USER_AGENT) ||
  'StillasCalculator/1.0 (open-source scaffolding estimator)';

/**
 * A raw OpenStreetMap element as returned by Overpass `out geom;`. The route
 * forwards these untrusted elements to the pure converter
 * (`lib/osm/osmToGeoJSON.ts`), so the element shape is owned there and
 * re-exported here to keep a single source of truth for the contract.
 */
export type OverpassElement = OsmOverpassElement;

/**
 * Response contract for the buildings route. `buildings` holds the converted
 * GeoJSON polygons produced by `osmToGeoJSON` (Req 4.2); `elements` carries the
 * raw OSM elements the conversion was derived from for debugging/inspection.
 */
export interface OverpassBuildingsResponse {
  /** Converted GeoJSON building polygons, ready to render (Req 4.1, 4.2). */
  buildings: GeoJsonPolygon[];
  /** Raw OSM elements the polygons were derived from (on a successful query). */
  elements?: OverpassElement[];
  /** True when no building footprints were found in the radius (Req 4.6). */
  empty?: boolean;
  /** Error signal for client fallback to manual drawing (Req 4.5). */
  error?: 'overpass-failed';
  /** Selected coordinate, echoed so the client retains it (Req 4.5). */
  lat: number;
  lon: number;
}

/**
 * Build the Overpass QL query for building ways AND relations within the search
 * radius of (lat, lon). `out geom;` returns inline geometry so the downstream
 * converter has the coordinates it needs.
 */
function buildOverpassQuery(lat: number, lon: number): string {
  return (
    `[out:json][timeout:${Math.floor(PER_ENDPOINT_TIMEOUT_MS / 1000)}];` +
    '(' +
    `way["building"](around:${SEARCH_RADIUS_METERS},${lat},${lon});` +
    `relation["building"](around:${SEARCH_RADIUS_METERS},${lat},${lon});` +
    ');' +
    'out geom;'
  );
}

/** Parse and validate a coordinate query parameter. */
function parseCoordinate(
  raw: string | null,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const lat = parseCoordinate(searchParams.get('lat'), -90, 90);
  const lon = parseCoordinate(searchParams.get('lon'), -180, 180);
  const includeElements =
    searchParams.get('debug') === '1' ||
    searchParams.get('includeElements') === 'true';

  // Malformed client request: missing or out-of-range coordinates. This is a
  // caller error rather than a fallback scenario, so respond with 400.
  if (lat === null || lon === null) {
    return NextResponse.json(
      {
        buildings: [] as GeoJsonPolygon[],
        error: 'invalid-coordinate',
        message:
          'Query parameters "lat" (-90..90) and "lon" (-180..180) are required.',
      },
      { status: 400 },
    );
  }

  const query = buildOverpassQuery(lat, lon);
  const endpoints = getOverpassEndpoints();

  // Overall deadline across every mirror attempt (Req 4.1). Each endpoint also
  // has its own shorter timeout so one slow mirror fails over quickly.
  const overallController = new AbortController();
  const overallTimeout = setTimeout(
    () => overallController.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    let elements: OverpassElement[] | null = null;

    // Try each mirror in turn until one responds successfully. A non-success
    // status, parse failure, network error, or per-endpoint timeout simply
    // advances to the next mirror; only if all of them fail do we surface the
    // error signal so the client can fall back to manual drawing (Req 4.5).
    for (const endpoint of endpoints) {
      if (overallController.signal.aborted) break;

      const perEndpointController = new AbortController();
      const onOverallAbort = () => perEndpointController.abort();
      overallController.signal.addEventListener('abort', onOverallAbort);
      const perEndpointTimeout = setTimeout(
        () => perEndpointController.abort(),
        PER_ENDPOINT_TIMEOUT_MS,
      );

      try {
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Required by the Overpass/OSM usage policy; without it the main
            // mirror rejects the request with HTTP 406.
            'User-Agent': OVERPASS_USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: perEndpointController.signal,
        });

        if (!upstream.ok) {
          continue; // throttled / error from this mirror: try the next one
        }

        const data = (await upstream.json()) as { elements?: OverpassElement[] };
        elements = Array.isArray(data.elements) ? data.elements : [];
        break; // success: stop trying mirrors
      } catch {
        // Network error or per-endpoint/overall timeout: try the next mirror.
        continue;
      } finally {
        clearTimeout(perEndpointTimeout);
        overallController.signal.removeEventListener('abort', onOverallAbort);
      }
    }

    // Every mirror failed: surface the error signal so the client falls back to
    // manual drawing while retaining the coordinate (Req 4.5).
    if (elements === null) {
      return NextResponse.json(
        { buildings: [], error: 'overpass-failed', lat, lon },
        { status: 200 },
      );
    }

    // Keep only the building ways and relations (Overpass may also return node
    // members). The pure converter (task 7.2) turns these into closed GeoJSON
    // polygons preserving source vertex order (Req 4.2).
    const buildingElements = elements.filter(
      (element) => element.type === 'way' || element.type === 'relation',
    );

    // Convert the raw OSM ways/relations into ready-to-render GeoJSON polygons.
    // The converter is defensive: degenerate geometry is dropped, so the result
    // may be empty even when building elements were present.
    const buildings = osmToGeoJSON(buildingElements);

    // No usable footprints in the radius: signal empty so the client offers
    // manual drawing of the perimeter (Req 4.6). This covers both "no building
    // elements" and "elements present but no valid polygon could be built".
    if (buildings.length === 0) {
      return NextResponse.json(
        { buildings: [], empty: true, lat, lon },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        buildings,
        ...(includeElements ? { elements: buildingElements } : {}),
        empty: false,
        lat,
        lon,
      },
      { status: 200 },
    );
  } catch {
    // Defensive catch-all: any unexpected failure surfaces the error signal so
    // the client can fall back to manual drawing while retaining the
    // coordinate (Req 4.5).
    return NextResponse.json(
      { buildings: [], error: 'overpass-failed', lat, lon },
      { status: 200 },
    );
  } finally {
    clearTimeout(overallTimeout);
  }
}
