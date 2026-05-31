"use client";

import { useEffect, useRef } from "react";
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  MapLayerMouseEvent,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";

import {
  createBuildingSelection,
  selectBuilding,
  type BuildingCandidate,
} from "@/lib/osm/buildingSelection";

/**
 * Source and layer identifiers owned by this component. They are namespaced so
 * they never collide with the OpenFreeMap basemap's own sources/layers, which
 * keeps the footprint fill/outline visually distinguishable from the base map
 * (Req 4.3) and lets us tear everything down cleanly on unmount.
 */
const SOURCE_ID = "stillas-building-footprints";
const FILL_LAYER_ID = "stillas-building-fill";
const OUTLINE_LAYER_ID = "stillas-building-outline";
const SELECTED_FILL_LAYER_ID = "stillas-building-selected-fill";
const SELECTED_OUTLINE_LAYER_ID = "stillas-building-selected-outline";

/** Match expression isolating the currently selected footprint feature. */
const SELECTED_FILTER = ["==", ["get", "selected"], true] as const;
/** Complementary filter for the unselected footprints. */
const UNSELECTED_FILTER = ["!=", ["get", "selected"], true] as const;

export interface BuildingFootprintLayerProps {
  /**
   * The loaded MapLibre map instance (exposed by {@link MapView} via
   * `onMapReady`). The layer attaches its source/layers to this map rather than
   * owning a map of its own, so it can be composed alongside the marker and
   * polygon editor.
   */
  map: MapLibreMap | null;
  /**
   * Nearby building footprints to render (Req 4.3). Each candidate carries a
   * stable `id` (e.g. the OSM element id) and a closed GeoJSON ring produced by
   * `osmToGeoJSON` (Req 4.2).
   */
  candidates: readonly BuildingCandidate[];
  /**
   * The id of the currently selected building, or `null` when none is selected.
   * Drives the distinct selected-building styling (Req 4.8). This is a
   * controlled prop so the single selection lives in `Project_State` (wired in
   * task 18.1).
   */
  selectedId?: string | null;
  /**
   * Invoked when the user taps/clicks a footprint. Receives the id of the
   * single building that should now be selected, computed through the singleton
   * selection model so any previously selected building is deselected
   * (Req 4.4). Reports `null` only when the singleton model yields no selection.
   */
  onSelect?: (selectedId: string | null) => void;
}

/**
 * Renders OpenStreetMap building footprints on the map and drives single
 * building selection (Req 4.3, 4.4, 4.8).
 *
 * Responsibilities:
 * - Adds a GeoJSON source plus fill+outline layers styled distinctly from the
 *   OpenFreeMap basemap so nearby footprints stand out (Req 4.3).
 * - Renders the selected footprint with its own fill+outline style so it is
 *   visually distinct from the unselected footprints (Req 4.8).
 * - On tap/click of a footprint, runs the candidate set through the singleton
 *   selection model (`selectBuilding`) so exactly one building becomes selected
 *   and any prior selection is cleared (Req 4.4), reporting the result via
 *   `onSelect`.
 *
 * This component renders no DOM of its own; it manages map state imperatively.
 */
export function BuildingFootprintLayer({
  map,
  candidates,
  selectedId = null,
  onSelect,
}: BuildingFootprintLayerProps) {
  // Keep the latest props in refs so the click/hover handlers (registered once)
  // always see current values without being torn down and re-registered.
  const candidatesRef = useRef(candidates);
  const selectedIdRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  candidatesRef.current = candidates;
  selectedIdRef.current = selectedId;
  onSelectRef.current = onSelect;

  // Setup/teardown of the source, layers, and interaction handlers. Runs when
  // the map instance changes (i.e. once it becomes available).
  useEffect(() => {
    if (!map) return;

    // A footprint tap selects exactly one building and deselects any other, via
    // the singleton selection model (Req 4.4). The handler reads the tapped
    // feature's id, asks the model for the next selection, and reports it up.
    const handleFootprintClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const rawId = feature?.properties?.id;
      if (rawId === undefined || rawId === null) return;

      const tappedId = String(rawId);
      const state = createBuildingSelection(
        candidatesRef.current,
        selectedIdRef.current,
      );
      const next = selectBuilding(state, tappedId);
      onSelectRef.current?.(next.selectedId);
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    // Adding sources/layers requires a loaded style. `onMapReady` fires after
    // the style loads, but guard anyway and re-attach after any style reload
    // (e.g. the tile-error retry in MapView re-applies the style, Req 2.6).
    const setup = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: buildFootprintFeatureCollection(
            candidatesRef.current,
            selectedIdRef.current,
          ),
        });
      }

      // Unselected footprints: translucent fill + solid outline, clearly
      // distinct from the basemap (Req 4.3).
      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          filter: UNSELECTED_FILTER as unknown as never,
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.25,
          },
        });
      }
      if (!map.getLayer(OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: OUTLINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          filter: UNSELECTED_FILTER as unknown as never,
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 2,
          },
        });
      }

      // Selected footprint: a distinct amber fill + thicker outline drawn on top
      // so the chosen building reads as visually distinct (Req 4.8).
      if (!map.getLayer(SELECTED_FILL_LAYER_ID)) {
        map.addLayer({
          id: SELECTED_FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          filter: SELECTED_FILTER as unknown as never,
          paint: {
            "fill-color": "#f59e0b",
            "fill-opacity": 0.45,
          },
        });
      }
      if (!map.getLayer(SELECTED_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: SELECTED_OUTLINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          filter: SELECTED_FILTER as unknown as never,
          paint: {
            "line-color": "#b45309",
            "line-width": 3,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.once("load", setup);
    }
    // Re-add our source/layers if the basemap style is reloaded underneath us.
    map.on("styledata", setup);

    // Taps on either fill layer count as selecting that footprint (Req 4.4).
    map.on("click", FILL_LAYER_ID, handleFootprintClick);
    map.on("click", SELECTED_FILL_LAYER_ID, handleFootprintClick);
    map.on("mouseenter", FILL_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", FILL_LAYER_ID, handleMouseLeave);
    map.on("mouseenter", SELECTED_FILL_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", SELECTED_FILL_LAYER_ID, handleMouseLeave);

    return () => {
      map.off("styledata", setup);
      map.off("click", FILL_LAYER_ID, handleFootprintClick);
      map.off("click", SELECTED_FILL_LAYER_ID, handleFootprintClick);
      map.off("mouseenter", FILL_LAYER_ID, handleMouseEnter);
      map.off("mouseleave", FILL_LAYER_ID, handleMouseLeave);
      map.off("mouseenter", SELECTED_FILL_LAYER_ID, handleMouseEnter);
      map.off("mouseleave", SELECTED_FILL_LAYER_ID, handleMouseLeave);

      // Style may already be gone if the map itself is being removed; guard.
      if (!map.getStyle()) return;
      for (const layerId of [
        SELECTED_OUTLINE_LAYER_ID,
        SELECTED_FILL_LAYER_ID,
        OUTLINE_LAYER_ID,
        FILL_LAYER_ID,
      ]) {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      }
      if (map.getSource(SOURCE_ID)) {
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map]);

  // Keep the rendered footprints and the selected styling in sync whenever the
  // candidate set or the selected building changes (Req 4.3, 4.8).
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildFootprintFeatureCollection(candidates, selectedId));
  }, [map, candidates, selectedId]);

  return null;
}

/**
 * Build the GeoJSON `FeatureCollection` rendered by the layer. Each feature
 * carries its building `id` (used to resolve taps back to a candidate) and a
 * `selected` flag (used by the layer filters to style the selected building
 * distinctly, Req 4.8). Pure: it allocates new structures and never mutates the
 * inputs, so it is straightforward to unit test.
 */
export function buildFootprintFeatureCollection(
  candidates: readonly BuildingCandidate[],
  selectedId: string | null,
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = candidates.map((candidate) => ({
    type: "Feature",
    properties: {
      id: candidate.id,
      selected: candidate.id === selectedId,
    },
    geometry: {
      type: "Polygon",
      coordinates: candidate.polygon.coordinates,
    },
  }));

  return { type: "FeatureCollection", features };
}

export default BuildingFootprintLayer;
