// Singleton building selection model (Req 4.4, Property 20).
//
// When the user taps or clicks a building footprint, exactly one building must
// become the selected building and any previously selected building must be
// deselected (Req 4.4). This module captures that rule as a small, PURE,
// framework-agnostic state model so it can be tested in isolation and reused by
// the React map layer (BuildingFootprintLayer, task 13.3) without pulling in
// MapLibre or React.
//
// The core invariant (Property 20): for any set of candidate buildings and any
// sequence of taps drawn from that set, afterwards exactly one building is
// selected and it is the most recently tapped one.

import type { GeoJsonPolygon } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single candidate building footprint the user can tap to select. `id` is the
 * stable identifier used to address the building (e.g. the OSM element id); the
 * `polygon` is the closed GeoJSON ring produced by `osmToGeoJSON` (Req 4.2).
 */
export interface BuildingCandidate {
  id: string;
  polygon: GeoJsonPolygon;
}

/**
 * The immutable selection state: the available candidate buildings and the id
 * of the currently selected one (or `null` when nothing is selected yet).
 *
 * Invariant: `selectedId` is always either `null` or the id of a building that
 * exists in `candidates`. Every function in this module preserves it.
 */
export interface BuildingSelectionState {
  candidates: readonly BuildingCandidate[];
  selectedId: string | null;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build an initial selection state from a set of candidate buildings.
 *
 * No building is selected by default (`selectedId: null`). If an
 * `initialSelectedId` is supplied it is honored only when it refers to an
 * existing candidate; otherwise it is ignored so the invariant holds.
 */
export function createBuildingSelection(
  candidates: readonly BuildingCandidate[],
  initialSelectedId: string | null = null,
): BuildingSelectionState {
  const selectedId =
    initialSelectedId !== null && hasCandidate(candidates, initialSelectedId)
      ? initialSelectedId
      : null;

  return { candidates, selectedId };
}

// ---------------------------------------------------------------------------
// Selection reducer (Req 4.4)
// ---------------------------------------------------------------------------

/**
 * Apply a tap on the building identified by `id`.
 *
 * This sets that building as the single selected building and deselects any
 * previously selected building (Req 4.4). Because the selection is stored as a
 * single `selectedId`, selecting one building inherently deselects every other.
 *
 * Taps on an id that is not among the candidates are ignored: the state is
 * returned unchanged so `selectedId` keeps referencing a real candidate. Taps
 * always reference a rendered footprint in practice, so this only guards
 * against stray input.
 *
 * The function is pure: it returns a new state object and never mutates the
 * input.
 */
export function selectBuilding(
  state: BuildingSelectionState,
  id: string,
): BuildingSelectionState {
  if (!hasCandidate(state.candidates, id)) {
    return state;
  }

  if (state.selectedId === id) {
    return state;
  }

  return { candidates: state.candidates, selectedId: id };
}

/**
 * Clear the current selection so no building is selected.
 *
 * Pure: returns a new state (or the same state when nothing was selected).
 */
export function deselectBuilding(
  state: BuildingSelectionState,
): BuildingSelectionState {
  if (state.selectedId === null) {
    return state;
  }

  return { candidates: state.candidates, selectedId: null };
}

// ---------------------------------------------------------------------------
// Selectors (read the currently selected building)
// ---------------------------------------------------------------------------

/**
 * Return the currently selected building, or `null` when nothing is selected.
 */
export function getSelectedBuilding(
  state: BuildingSelectionState,
): BuildingCandidate | null {
  if (state.selectedId === null) {
    return null;
  }

  return (
    state.candidates.find((candidate) => candidate.id === state.selectedId) ??
    null
  );
}

/**
 * Whether the building identified by `id` is the currently selected one. Useful
 * for the map layer to render the selected footprint distinctly (Req 4.8).
 */
export function isSelected(state: BuildingSelectionState, id: string): boolean {
  return state.selectedId !== null && state.selectedId === id;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hasCandidate(
  candidates: readonly BuildingCandidate[],
  id: string,
): boolean {
  return candidates.some((candidate) => candidate.id === id);
}
