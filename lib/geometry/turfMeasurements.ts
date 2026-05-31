// Geometry Engine — pure, deterministic measurements over GeoJSON polygons.
//
// This module is the trustworthy geometric core of StillasCalculator. Every
// function here is pure: it has no I/O, no randomness, and no dependence on the
// clock, so the same input always yields the same output. It uses Turf.js for
// the underlying geodesic math (perimeter, area, side lengths) and works only
// over a single closed linear ring expressed as [longitude, latitude] pairs.
//
// Task 2.1 implements:
//   - isValidPerimeter(polygon): validates a ring is closed, has >=3 distinct
//     vertices, and has no self-intersecting sides (Req 5.5, 5.7, 5.8, 6.1).
//   - measurePolygon(polygon): returns perimeter (m), area (m^2), and per-side
//     lengths in ring order for a valid ring, or { valid: false } otherwise
//     (Req 6.1, 6.2, 6.3, 6.10).
//
// Task 2.3 implements:
//   - computeScaffoldLength(measurements, selectedSideIndices): the run length
//     of scaffold derived from a measured polygon — the sum of the selected
//     side lengths, the full perimeter when no subset is selected, or 0 when
//     the selected subset is empty or sums to 0 (Req 6.7, 6.8, 6.9).

import * as turf from '@turf/turf';
import type { GeoJsonPolygon, PolygonMeasurements } from '@/lib/types';

/**
 * The empty/invalid measurement result. Returned by `measurePolygon` whenever
 * the supplied polygon fails validation, so callers can distinguish "no valid
 * measurement" (valid: false) from a genuine zero-length measurement (Req 6.10).
 */
const INVALID_MEASUREMENTS: PolygonMeasurements = {
  perimeterMeters: 0,
  areaSquareMeters: 0,
  sideLengthsMeters: [],
  valid: false,
};

/**
 * Type guard for a finite [lon, lat] coordinate pair.
 */
function isFiniteCoordinate(point: unknown): point is number[] {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    typeof point[0] === 'number' &&
    typeof point[1] === 'number' &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

/**
 * Extracts the outer ring from a GeoJSON polygon, returning `null` when the
 * structure is missing or malformed. Only the outer (first) ring is used as the
 * building perimeter; the editor never produces holes.
 */
function getOuterRing(polygon: GeoJsonPolygon): number[][] | null {
  if (
    !polygon ||
    polygon.type !== 'Polygon' ||
    !Array.isArray(polygon.coordinates) ||
    !Array.isArray(polygon.coordinates[0])
  ) {
    return null;
  }
  return polygon.coordinates[0];
}

/**
 * Validates a perimeter ring (Req 5.5, 5.7, 5.8, 6.1).
 *
 * A ring is valid when it is:
 *   - well-formed: an array of finite [lon, lat] coordinate pairs;
 *   - closed: its first and last coordinates are identical;
 *   - substantial: it contains at least 3 distinct vertices (a closed ring of
 *     >=3 distinct vertices needs at least 4 coordinate entries); and
 *   - simple: it has no self-intersecting sides (detected with `turf.kinks`).
 *
 * Returns `false` for any malformed, degenerate, or self-intersecting input
 * rather than throwing, so callers can treat invalid polygons as a normal
 * branch (Req 6.10).
 */
export function isValidPerimeter(polygon: GeoJsonPolygon): boolean {
  try {
    const ring = getOuterRing(polygon);
    // A closed ring with >=3 distinct vertices needs >=4 entries
    // (the last entry repeats the first to close the ring).
    if (!ring || ring.length < 4) {
      return false;
    }

    // Every entry must be a finite coordinate pair.
    if (!ring.every(isFiniteCoordinate)) {
      return false;
    }

    // The ring must be closed: first coordinate equals the last.
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return false;
    }

    // Require at least 3 distinct vertices, ignoring the closing duplicate.
    const distinctVertices = new Set(
      ring.slice(0, -1).map((point) => `${point[0]},${point[1]}`),
    );
    if (distinctVertices.size < 3) {
      return false;
    }

    // Reject self-intersecting (non-simple) rings.
    const selfIntersections = turf.kinks(turf.polygon(polygon.coordinates));
    if (selfIntersections.features.length > 0) {
      return false;
    }

    return true;
  } catch {
    // Any unexpected malformed input is treated as invalid, never thrown.
    return false;
  }
}

/**
 * Measures a perimeter polygon (Req 6.1, 6.2, 6.3, 6.10).
 *
 * For a valid ring this returns:
 *   - `perimeterMeters`: the perimeter in meters (Req 6.1);
 *   - `areaSquareMeters`: the enclosed area in square meters (Req 6.2);
 *   - `sideLengthsMeters`: one length in meters per polygon edge, in ring order
 *     (Req 6.3); and
 *   - `valid: true`.
 *
 * Side lengths are computed per edge with `turf.distance` (meters) and the
 * perimeter is their sum, so the side lengths always sum exactly to the
 * reported perimeter. For an invalid polygon the function reports
 * `{ valid: false }` and produces no measurements (Req 6.10).
 */
export function measurePolygon(polygon: GeoJsonPolygon): PolygonMeasurements {
  if (!isValidPerimeter(polygon)) {
    return { ...INVALID_MEASUREMENTS, sideLengthsMeters: [] };
  }

  try {
    const ring = polygon.coordinates[0];

    // One side per polygon edge, in ring order. The ring is closed, so the
    // edges are the consecutive pairs (i, i+1) for i in [0, ring.length - 2],
    // which includes the closing edge back to the first vertex.
    const sideLengthsMeters: number[] = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const segmentLength = turf.distance(ring[i], ring[i + 1], {
        units: 'meters',
      });
      sideLengthsMeters.push(segmentLength);
    }

    // Perimeter is the sum of the side lengths, keeping the two consistent.
    const perimeterMeters = sideLengthsMeters.reduce(
      (total, length) => total + length,
      0,
    );

    // Enclosed area in square meters (Turf returns square meters).
    const areaSquareMeters = turf.area(turf.polygon(polygon.coordinates));

    return {
      perimeterMeters,
      areaSquareMeters,
      sideLengthsMeters,
      valid: true,
    };
  } catch {
    // Defensive: if Turf rejects the (already validated) ring for any reason,
    // report an invalid measurement rather than throwing.
    return { ...INVALID_MEASUREMENTS, sideLengthsMeters: [] };
  }
}

/**
 * Computes the Scaffold_Length — the total run length of scaffold derived from
 * a measured polygon (Req 6.7, 6.8, 6.9).
 *
 * Behavior:
 *   - When `selectedSideIndices` is `null`, no facade subset is selected, so the
 *     Scaffold_Length is the full polygon perimeter (Req 6.8).
 *   - When `selectedSideIndices` is a non-empty list, the Scaffold_Length is the
 *     sum of the selected side lengths (Req 6.7). The selection is treated as a
 *     set of side indices: out-of-range or non-integer indices are ignored and
 *     a repeated index is counted at most once, so it never double-counts a
 *     side.
 *   - When the selection is empty, or the selected sides sum to 0 meters, the
 *     Scaffold_Length is 0 (Req 6.9).
 *
 * If the measurements are absent or invalid there are no sides to sum, so the
 * Scaffold_Length is 0 (consistent with the invalid-measurement branch of
 * `measurePolygon`, Req 6.10).
 */
export function computeScaffoldLength(
  measurements: PolygonMeasurements,
  selectedSideIndices: number[] | null,
): number {
  // Without a valid measurement there are no side lengths to aggregate.
  if (!measurements || measurements.valid !== true) {
    return 0;
  }

  const sideLengths = measurements.sideLengthsMeters;
  if (!Array.isArray(sideLengths) || sideLengths.length === 0) {
    return 0;
  }

  // No subset selected -> the full polygon perimeter (Req 6.8).
  if (selectedSideIndices === null) {
    return measurements.perimeterMeters;
  }

  // An empty selection contributes nothing (Req 6.9).
  if (selectedSideIndices.length === 0) {
    return 0;
  }

  // Sum the selected sides (Req 6.7). Treat the selection as a set: ignore
  // out-of-range / non-integer indices and count each side at most once so a
  // repeated index never double-counts a side. When the selected sides sum to
  // 0 the result is 0 (Req 6.9).
  const uniqueIndices = new Set<number>();
  for (const index of selectedSideIndices) {
    if (Number.isInteger(index) && index >= 0 && index < sideLengths.length) {
      uniqueIndices.add(index);
    }
  }

  let total = 0;
  for (const index of uniqueIndices) {
    total += sideLengths[index];
  }
  return total;
}
