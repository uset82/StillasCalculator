import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createBuildingSelection,
  selectBuilding,
  getSelectedBuilding,
  isSelected,
  type BuildingCandidate,
} from './buildingSelection';
import type { GeoJsonPolygon } from '../types';

// Feature: stillas-calculator, Property 20: Building selection is a singleton
//
// Property 20 (design.md): For any set of building polygons and any sequence of
// selection taps, exactly one building is selected afterward, and it is the most
// recently tapped one.
//
// **Validates: Requirements 4.4**
//
// We generate a set of candidate buildings (each with a unique id and a simple
// closed GeoJSON polygon ring) and a random NON-EMPTY sequence of taps drawn
// from those candidate ids. Folding `selectBuilding` over the sequence, starting
// from `createBuildingSelection`, must leave exactly ONE building selected: the
// most recently tapped one. We assert this via `getSelectedBuilding` (returns
// that candidate) and `isSelected` (true only for that id).

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A simple closed square polygon ring around an arbitrary origin. The exact
// shape is irrelevant to selection; we only need a structurally valid
// GeoJsonPolygon so candidates resemble real OSM footprints.
function squarePolygon(originLon: number, originLat: number): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [originLon, originLat],
        [originLon + 0.0001, originLat],
        [originLon + 0.0001, originLat + 0.0001],
        [originLon, originLat + 0.0001],
        [originLon, originLat],
      ],
    ],
  };
}

// A non-empty set of candidate buildings with pairwise-unique ids. We build the
// candidates from a unique array of id strings so the singleton invariant is
// addressed by stable, distinct ids (matching real OSM element ids).
const candidatesArb: fc.Arbitrary<BuildingCandidate[]> = fc
  .uniqueArray(
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
    { minLength: 1, maxLength: 10 },
  )
  .map((ids) =>
    ids.map((id, index) => ({
      id,
      polygon: squarePolygon(index * 0.01, index * 0.01),
    })),
  );

// From a set of candidates, generate a non-empty sequence of taps drawn from the
// candidate ids (repeats allowed, since a user may tap the same footprint twice).
function tapSequenceArb(
  candidates: BuildingCandidate[],
): fc.Arbitrary<string[]> {
  const idArb = fc.constantFrom(...candidates.map((c) => c.id));
  return fc.array(idArb, { minLength: 1, maxLength: 30 });
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('buildingSelection — Property 20: selection is a singleton', () => {
  it('leaves exactly one building selected: the most recently tapped', () => {
    fc.assert(
      fc.property(
        candidatesArb.chain((candidates) =>
          tapSequenceArb(candidates).map((taps) => ({ candidates, taps })),
        ),
        ({ candidates, taps }) => {
          // Fold selectBuilding over the tap sequence from a fresh selection.
          const finalState = taps.reduce(
            (state, id) => selectBuilding(state, id),
            createBuildingSelection(candidates),
          );

          const lastTapped = taps[taps.length - 1];

          // (1) Exactly one building is selected and it is the most recently
          //     tapped id.
          expect(finalState.selectedId).toBe(lastTapped);

          // (2) getSelectedBuilding returns that candidate.
          const selected = getSelectedBuilding(finalState);
          expect(selected).not.toBeNull();
          expect(selected?.id).toBe(lastTapped);

          // (3) isSelected is true only for the most recently tapped id and
          //     false for every other candidate (singleton invariant).
          candidates.forEach((candidate) => {
            expect(isSelected(finalState, candidate.id)).toBe(
              candidate.id === lastTapped,
            );
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
