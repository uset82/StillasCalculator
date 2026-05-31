// Geometry tool argument round-trip integrity (Req 12).
//
// The AI model passes building geometry across the tool boundary as an ordered
// list of [longitude, latitude] coordinate pairs. This module is the single,
// pure adapter that:
//
//   - converts that coordinate list into a CLOSED GeoJSON polygon ring,
//     appending a copy of the first pair as the final pair only when the first
//     and last pairs are not already numerically identical (Req 12.1, 12.3);
//   - preserves every input coordinate value EXACTLY — no rounding, truncation,
//     scaling, reprojection, or reordering — so malformed geometry is deferred
//     to the Geometry_Engine for rejection rather than silently repaired
//     (Req 12.4);
//   - rejects obviously malformed input (more than 10,000 pairs, or any pair
//     that is not exactly two finite numbers) with an error that identifies the
//     malformed coordinate input, leaving the Project_State unchanged
//     (Req 12.6);
//   - serializes a stored ring back into the exact ordered pairs that define it
//     for return to the model (Req 12.2), which — combined with the closing
//     rule above — gives a lossless round-trip for any ring the Geometry_Engine
//     accepts (Req 12.5).
//
// The function is pure: no I/O, no clock, no randomness. It never mutates its
// input; every produced pair is a fresh copy of the corresponding input values.

import type { GeoJsonPolygon } from '@/lib/types';

/**
 * Maximum number of coordinate pairs accepted in a single geometry argument.
 * Inputs larger than this are rejected outright (Req 12.6).
 */
export const MAX_COORDINATE_PAIRS = 10_000;

/**
 * Result of {@link coordinatesToClosedRing}. On success, `polygon` is a closed
 * single-ring GeoJSON polygon ready for the Geometry_Engine validation step. On
 * failure, `error` names the malformed coordinate input (Req 12.6).
 */
export type ClosedRingResult =
  | { ok: true; polygon: GeoJsonPolygon }
  | { ok: false; error: string };

/**
 * Type guard for an exact [lon, lat] pair: an array of EXACTLY two finite
 * numbers (Req 12.6). Pairs of any other shape — wrong length, non-numeric, or
 * non-finite (NaN/±Infinity) — are rejected.
 */
function isExactFinitePair(pair: unknown): pair is [number, number] {
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    typeof pair[0] === 'number' &&
    typeof pair[1] === 'number' &&
    Number.isFinite(pair[0]) &&
    Number.isFinite(pair[1])
  );
}

/** Two coordinate pairs are numerically identical when both components match. */
function pairsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Convert an ordered list of [lon, lat] pairs into a closed GeoJSON polygon ring
 * (Req 12.1, 12.3, 12.4, 12.6).
 *
 * Behavior:
 *   - More than {@link MAX_COORDINATE_PAIRS} pairs, or any pair that is not
 *     exactly two finite numbers, is rejected with an identifying error and no
 *     polygon is produced (Req 12.6).
 *   - Every accepted coordinate value is preserved exactly; the result is built
 *     from fresh copies in input order (Req 12.4).
 *   - The ring is closed by appending a copy of the first pair as the last pair
 *     ONLY when the first and last pairs are not already numerically identical
 *     (Req 12.1); an already-closed list is returned unchanged (Req 12.3).
 *   - Degenerate-but-well-formed input (e.g. fewer than 3 distinct vertices) is
 *     NOT rejected here; it is converted faithfully and left for the
 *     Geometry_Engine to reject (Req 12.4).
 */
export function coordinatesToClosedRing(coordinates: unknown): ClosedRingResult {
  if (!Array.isArray(coordinates)) {
    return {
      ok: false,
      error:
        'Malformed coordinate input: expected an array of [longitude, latitude] pairs.',
    };
  }

  if (coordinates.length > MAX_COORDINATE_PAIRS) {
    return {
      ok: false,
      error: `Malformed coordinate input: ${coordinates.length} coordinate pairs exceeds the maximum of ${MAX_COORDINATE_PAIRS}.`,
    };
  }

  // Copy each pair exactly, rejecting the first malformed pair encountered so
  // the error can identify where the input went wrong (Req 12.6).
  const ring: number[][] = [];
  for (let i = 0; i < coordinates.length; i += 1) {
    const pair = coordinates[i];
    if (!isExactFinitePair(pair)) {
      return {
        ok: false,
        error: `Malformed coordinate input: pair at index ${i} is not exactly two finite numbers.`,
      };
    }
    // Preserve the exact numeric values, in order (Req 12.4).
    ring.push([pair[0], pair[1]]);
  }

  // Close the ring only when it is not already closed (Req 12.1, 12.3). An
  // empty list has no first pair to copy and is left empty for the engine to
  // reject; a single-pair list is already "closed" (first === last) and is also
  // left for the engine to reject as degenerate.
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!pairsEqual(first, last)) {
      ring.push([first[0], first[1]]);
    }
  }

  return { ok: true, polygon: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Serialize a stored Perimeter_Polygon back into the exact ordered [lon, lat]
 * pairs that define its outer ring, for return to the model (Req 12.2).
 *
 * Each emitted value is identical to the corresponding stored value (the pairs
 * are copied, not transformed), so parsing the serialized form back through
 * {@link coordinatesToClosedRing} reproduces the same ring and therefore the
 * same Geometry_Engine measurements for any valid polygon (Req 12.5).
 */
export function serializePolygonRing(polygon: GeoJsonPolygon): number[][] {
  const ring =
    polygon &&
    polygon.type === 'Polygon' &&
    Array.isArray(polygon.coordinates) &&
    Array.isArray(polygon.coordinates[0])
      ? polygon.coordinates[0]
      : [];

  const serialized: number[][] = [];
  for (const pair of ring) {
    if (isExactFinitePair(pair)) {
      serialized.push([pair[0], pair[1]]);
    }
  }
  return serialized;
}
