// OSM (Overpass) → GeoJSON conversion (Req 4.2).
//
// The `/api/overpass/buildings` route queries Overpass for building `way` and
// `relation` elements within 50 m of a coordinate using `out geom;`, which
// embeds each way's vertex coordinates inline as a `geometry` array of
// `{ lat, lon }` points (and, for relations, on each member way). This module
// is the PURE, deterministic adapter that turns those raw Overpass elements
// into closed GeoJSON polygon rings ready for the map and the Geometry_Engine.
//
// Property 19 (OSM-to-GeoJSON conversion produces valid polygons) requires that
// every produced ring is closed (first coordinate equals last) and preserves
// the source vertex coordinates in order. GeoJSON positions are [lon, lat]
// whereas Overpass reports { lat, lon }, so coordinates are re-ordered but not
// otherwise altered.

import type { GeoJsonPolygon } from '@/lib/types';

// ---------------------------------------------------------------------------
// Minimal local Overpass element shapes
// ---------------------------------------------------------------------------
//
// These describe only the fields this converter relies on from an Overpass
// JSON response produced with `out geom;`. They are intentionally permissive
// (most fields optional) because external responses are untrusted and may omit
// data; the converter defends against missing/short geometry rather than
// assuming a well-formed payload.

/** A single inline coordinate as reported by Overpass `out geom;`. */
export interface OverpassLatLon {
  lat: number;
  lon: number;
}

/** An Overpass `way` element with inline geometry. */
export interface OverpassWay {
  type: 'way';
  id?: number;
  /** Vertices in source order; closed buildings repeat the first point last. */
  geometry?: OverpassLatLon[];
  tags?: Record<string, string>;
}

/** A member of an Overpass `relation` (only `way` members carry geometry). */
export interface OverpassRelationMember {
  type: 'way' | 'node' | 'relation';
  ref?: number;
  /** Multipolygon role: 'outer' (or unset) for shells, 'inner' for holes. */
  role?: string;
  geometry?: OverpassLatLon[];
}

/** An Overpass `relation` element (e.g. a `type=multipolygon` building). */
export interface OverpassRelation {
  type: 'relation';
  id?: number;
  members?: OverpassRelationMember[];
  tags?: Record<string, string>;
}

/**
 * Any element appearing in an Overpass response. Elements other than `way` and
 * `relation` (e.g. bare `node`s) carry no footprint geometry and are ignored.
 *
 * The catch-all member only requires a discriminating `type` field rather than
 * an index signature, so concrete Overpass element interfaces declared
 * elsewhere (e.g. the server route's element shape) — which have specific
 * fields but no `[key: string]` index signature — remain assignable here.
 */
export type OverpassElement =
  | OverpassWay
  | OverpassRelation
  | { type: string };

// A GeoJSON position [lon, lat]; a ring is an ordered list of positions.
type Position = number[];
type Ring = Position[];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert Overpass `way`/`relation` elements into closed GeoJSON polygons.
 *
 * - A `way` with inline geometry becomes a single polygon whose outer ring is
 *   the way's vertices (in source order), closed if necessary.
 * - A `relation` (multipolygon) has its member ways stitched into rings by
 *   shared endpoints; `outer` rings become polygon shells and `inner` rings
 *   become holes assigned to the shell that contains them.
 *
 * The function is pure: it allocates new structures and never mutates the
 * input. Degenerate geometry (fewer than three distinct vertices) is dropped
 * so every returned polygon has a valid, closed outer ring.
 */
export function osmToGeoJSON(elements: OverpassElement[]): GeoJsonPolygon[] {
  if (!Array.isArray(elements)) {
    return [];
  }

  const polygons: GeoJsonPolygon[] = [];

  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      continue;
    }

    if (element.type === 'way') {
      const polygon = wayToPolygon(element as OverpassWay);
      if (polygon) {
        polygons.push(polygon);
      }
    } else if (element.type === 'relation') {
      polygons.push(...relationToPolygons(element as OverpassRelation));
    }
  }

  return polygons;
}

// ---------------------------------------------------------------------------
// Way conversion
// ---------------------------------------------------------------------------

function wayToPolygon(way: OverpassWay): GeoJsonPolygon | null {
  const ring = closeRing(geometryToRing(way.geometry));
  if (!isValidRing(ring)) {
    return null;
  }
  return { type: 'Polygon', coordinates: [ring] };
}

// ---------------------------------------------------------------------------
// Relation (multipolygon) conversion
// ---------------------------------------------------------------------------

function relationToPolygons(relation: OverpassRelation): GeoJsonPolygon[] {
  const members = Array.isArray(relation.members) ? relation.members : [];

  const outerSegments: Ring[] = [];
  const innerSegments: Ring[] = [];

  for (const member of members) {
    if (!member || member.type !== 'way') {
      continue;
    }
    const segment = geometryToRing(member.geometry);
    if (segment.length < 2) {
      continue;
    }
    // Unset/empty role defaults to 'outer', matching OSM multipolygon usage.
    if (member.role === 'inner') {
      innerSegments.push(segment);
    } else {
      outerSegments.push(segment);
    }
  }

  const outerRings = assembleRings(outerSegments).filter(isValidRing);
  const innerRings = assembleRings(innerSegments).filter(isValidRing);

  if (outerRings.length === 0) {
    return [];
  }

  // Each outer ring is a polygon shell; copy so later hole pushes never alias.
  const polygons: GeoJsonPolygon[] = outerRings.map((ring) => ({
    type: 'Polygon',
    coordinates: [ring],
  }));

  for (const hole of innerRings) {
    const shellIndex = findContainingShellIndex(outerRings, hole);
    polygons[shellIndex].coordinates.push(hole);
  }

  return polygons;
}

// ---------------------------------------------------------------------------
// Ring helpers
// ---------------------------------------------------------------------------

/** Map Overpass `{ lat, lon }` vertices to GeoJSON `[lon, lat]`, in order. */
function geometryToRing(geometry: OverpassLatLon[] | undefined): Ring {
  if (!Array.isArray(geometry)) {
    return [];
  }
  const ring: Ring = [];
  for (const point of geometry) {
    if (
      point &&
      typeof point.lat === 'number' &&
      typeof point.lon === 'number'
    ) {
      ring.push([point.lon, point.lat]);
    }
  }
  return ring;
}

/** Ensure the ring is closed by repeating the first position at the end. */
function closeRing(ring: Ring): Ring {
  if (ring.length === 0) {
    return ring;
  }
  if (isClosed(ring)) {
    return ring;
  }
  return [...ring, [...ring[0]]];
}

function isClosed(ring: Ring): boolean {
  if (ring.length < 2) {
    return false;
  }
  return positionsEqual(ring[0], ring[ring.length - 1]);
}

/** A valid closed polygon ring needs >= 3 distinct vertices (>= 4 with close). */
function isValidRing(ring: Ring): boolean {
  return ring.length >= 4 && isClosed(ring);
}

function positionsEqual(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Stitch open way segments into closed rings by joining shared endpoints.
 *
 * A relation's outer/inner boundary can be split across several member ways;
 * Overpass returns them in arbitrary order and direction. This greedily grows
 * a ring by appending any segment that shares an endpoint with the current
 * tail (reversing the segment when joined at its end), preserving each
 * segment's internal vertex order. Already-closed segments (a complete way)
 * pass through untouched.
 */
function assembleRings(segments: Ring[]): Ring[] {
  const remaining = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Ring[] = [];

  while (remaining.length > 0) {
    let ring = remaining.shift() as Ring;

    let joined = true;
    while (joined && !isClosed(ring)) {
      joined = false;
      const tail = ring[ring.length - 1];

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];

        if (positionsEqual(tail, segStart)) {
          // Append the segment, skipping its shared first vertex.
          ring = ring.concat(seg.slice(1));
          remaining.splice(i, 1);
          joined = true;
          break;
        }
        if (positionsEqual(tail, segEnd)) {
          // Append the segment reversed, skipping its shared last vertex.
          ring = ring.concat(seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          joined = true;
          break;
        }
      }
    }

    rings.push(closeRing(ring));
  }

  return rings;
}

/**
 * Pick the outer shell that contains a hole's first vertex (ray casting). The
 * first containing shell wins; if none contains it, the hole is attached to the
 * first shell so it is never silently dropped.
 */
function findContainingShellIndex(shells: Ring[], hole: Ring): number {
  const probe = hole[0];
  for (let i = 0; i < shells.length; i++) {
    if (pointInRing(probe, shells[i])) {
      return i;
    }
  }
  return 0;
}

/** Standard even-odd ray-casting point-in-polygon test on [lon, lat] rings. */
function pointInRing(point: Position, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
