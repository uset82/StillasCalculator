"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

import type { GeoJsonFeatureCollection } from "@/lib/types";

const SOURCE_ID = "stillas-scaffold-overlay";
const LINE_LAYER_ID = "stillas-scaffold-overlay-line";
const FILL_LAYER_ID = "stillas-scaffold-overlay-fill";

export interface ScaffoldOverlayLayerProps {
  map: MapLibreMap | null;
  overlay: GeoJsonFeatureCollection | null;
}

export function ScaffoldOverlayLayer({ map, overlay }: ScaffoldOverlayLayerProps) {
  const attachedRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    const ensureLayers = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(LINE_LAYER_ID)) {
        map.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": "#2563eb",
            "line-width": 2,
          },
        });
      }
      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.12,
          },
        });
      }
      attachedRef.current = true;
    };

    if (map.isStyleLoaded()) {
      ensureLayers();
    } else {
      map.once("load", ensureLayers);
    }

    return () => {
      if (!map.isStyleLoaded()) return;
      for (const layerId of [FILL_LAYER_ID, LINE_LAYER_ID]) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      attachedRef.current = false;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !attachedRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      (overlay ?? { type: "FeatureCollection", features: [] }) as GeoJSON.GeoJSON,
    );
  }, [map, overlay]);

  return null;
}

export default ScaffoldOverlayLayer;
