import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonPolygon,
  ScaffoldPlan,
} from '@/lib/types';

/** Offset a lon/lat point by meters (approximate local projection). */
function offsetMeters(
  lon: number,
  lat: number,
  eastMeters: number,
  northMeters: number,
): [number, number] {
  const latRad = (lat * Math.PI) / 180;
  const dLon = eastMeters / (111_320 * Math.cos(latRad));
  const dLat = northMeters / 110_540;
  return [lon + dLon, lat + dLat];
}

function ringCentroid(ring: number[][]): [number, number] {
  let sumLon = 0;
  let sumLat = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    sumLon += ring[i][0];
    sumLat += ring[i][1];
  }
  return [sumLon / n, sumLat / n];
}

function sideEndpoints(
  ring: number[][],
  sideIndex: number,
): { start: [number, number]; end: [number, number] } {
  const n = ring.length - 1;
  const i = ((sideIndex % n) + n) % n;
  return {
    start: [ring[i][0], ring[i][1]],
    end: [ring[i + 1][0], ring[i + 1][1]],
  };
}

function selectedSideIndices(plan: ScaffoldPlan): number[] {
  if (!plan.measurements?.valid) return [];
  const count = plan.measurements.sideLengthsMeters.length;
  if (plan.selectedFacadeSideIndices === null) {
    return Array.from({ length: count }, (_, i) => i);
  }
  return plan.selectedFacadeSideIndices.filter((i) => i >= 0 && i < count);
}

/**
 * Builds a deterministic 2D GeoJSON overlay: facade run lines and bay tick marks.
 * All geometry derives from engine measurements and calculation — never from AI.
 */
export function buildScaffoldOverlay(plan: ScaffoldPlan): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  const polygon = plan.perimeterPolygon;
  const calc = plan.calculation;

  if (!polygon || !plan.measurements?.valid) {
    return { type: 'FeatureCollection', features: [] };
  }

  const ring = polygon.coordinates[0];
  const sides = selectedSideIndices(plan);
  const [cLon, cLat] = ringCentroid(ring);

  for (const sideIndex of sides) {
    const { start, end } = sideEndpoints(ring, sideIndex);
    const sideLen = plan.measurements.sideLengthsMeters[sideIndex] ?? 0;

    features.push({
      type: 'Feature',
      properties: { kind: 'facade-run', sideIndex, lengthMeters: sideLen },
      geometry: {
        type: 'LineString',
        coordinates: [start, end],
      },
    });

    if (calc && sideLen > 0 && calc.numberOfBays > 0) {
      const bayLen = sideLen / calc.numberOfBays;
      for (let b = 0; b <= calc.numberOfBays; b += 1) {
        const t = b / calc.numberOfBays;
        const lon = start[0] + t * (end[0] - start[0]);
        const lat = start[1] + t * (end[1] - start[1]);
        const outwardLon = lon - cLon;
        const outwardLat = lat - cLat;
        const mag = Math.hypot(outwardLon, outwardLat) || 1;
        const width = plan.scaffoldWidthMeters ?? 1;
        const tickEnd = offsetMeters(
          lon,
          lat,
          (outwardLon / mag) * width * 0.5,
          (outwardLat / mag) * width * 0.5,
        );
        features.push({
          type: 'Feature',
          properties: {
            kind: 'bay-tick',
            sideIndex,
            bayIndex: b,
            bayLengthMeters: bayLen,
          },
          geometry: {
            type: 'LineString',
            coordinates: [[lon, lat], tickEnd],
          },
        });
      }
    }
  }

  if (calc) {
    features.push({
      type: 'Feature',
      properties: {
        kind: 'scaffold-meta',
        numberOfBays: calc.numberOfBays,
        numberOfLevels: calc.numberOfLevels,
        totalScaffoldLengthMeters: calc.totalScaffoldLengthMeters,
      },
      geometry: polygonToFeatureGeometry(polygon),
    });
  }

  return { type: 'FeatureCollection', features };
}

function polygonToFeatureGeometry(polygon: GeoJsonPolygon): GeoJsonFeature['geometry'] {
  return {
    type: 'Polygon',
    coordinates: polygon.coordinates,
  };
}
