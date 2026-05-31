"use client";

import { useEffect, useRef, useState } from "react";
import {
  Marker,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import * as turf from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Polygon,
} from "geojson";
import type { GeoJsonPolygon, UpdateResult } from "@/lib/types";
import { isValidPerimeter } from "@/lib/geometry/turfMeasurements";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other map/scaffold components.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GeoJSON source + layer ids used by the editor's perimeter preview. */
const SOURCE_ID = "polygon-editor-source";
const FILL_LAYER_ID = "polygon-editor-fill";
const LINE_LAYER_ID = "polygon-editor-line";

/** Message shown when the user tries to finalize a perimeter with <3 vertices (Req 5.7). */
export const TOO_FEW_VERTICES_MESSAGE =
  "A perimeter requires at least 3 vertices.";

/** Message shown when a completed/edited perimeter self-intersects (Req 5.8). */
export const SELF_INTERSECTION_MESSAGE =
  "The perimeter sides must not cross.";

/** Fallback message when the state controller rejects an otherwise-valid ring. */
const COMMIT_REJECTED_MESSAGE = "The perimeter could not be saved.";

/** A vertex expressed as a [longitude, latitude] pair. */
type Vertex = [number, number];

// ---------------------------------------------------------------------------
// Pure geometry helpers (module-level so they stay testable and stable)
// ---------------------------------------------------------------------------

/** Counts distinct vertices, ignoring exact duplicates. */
function distinctVertexCount(vertices: Vertex[]): number {
  return new Set(vertices.map((v) => `${v[0]},${v[1]}`)).size;
}

/**
 * Builds a closed GeoJSON polygon from an open list of vertices by repeating
 * the first vertex as the closing coordinate (Req 5.5).
 */
function closedPolygon(vertices: Vertex[]): GeoJsonPolygon {
  const ring: number[][] = vertices.map((v) => [v[0], v[1]]);
  ring.push([vertices[0][0], vertices[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

/** True when any pair of the polygon's sides cross (self-intersection, Req 5.8). */
function hasSelfIntersection(polygon: GeoJsonPolygon): boolean {
  try {
    const kinks = turf.kinks(turf.polygon(polygon.coordinates));
    return kinks.features.length > 0;
  } catch {
    // A ring Turf refuses to process is treated as non-simple.
    return true;
  }
}

/**
 * Evaluates a vertex list against the perimeter rules (Req 5.5, 5.7, 5.8).
 *
 * Returns the validation message to display (or `null` when valid) and, when
 * valid, the closed polygon ready to commit. The order of checks lets the
 * caller surface the correct message: the ≥3-vertex rule (Req 5.7) is reported
 * before the non-self-intersection rule (Req 5.8).
 */
function evaluatePerimeter(vertices: Vertex[]): {
  message: string | null;
  polygon: GeoJsonPolygon | null;
} {
  if (vertices.length < 3 || distinctVertexCount(vertices) < 3) {
    return { message: TOO_FEW_VERTICES_MESSAGE, polygon: null };
  }
  const polygon = closedPolygon(vertices);
  if (hasSelfIntersection(polygon)) {
    return { message: SELF_INTERSECTION_MESSAGE, polygon: null };
  }
  // Final gate through the Geometry Engine so the editor and the state
  // controller agree on exactly what counts as a valid ring.
  if (!isValidPerimeter(polygon)) {
    return { message: SELF_INTERSECTION_MESSAGE, polygon: null };
  }
  return { message: null, polygon };
}

/** Produces the source data that previews the in-progress/committed perimeter. */
function buildFeatureCollection(vertices: Vertex[]): FeatureCollection {
  const features: Feature[] = [];
  if (vertices.length >= 3) {
    const ring: number[][] = [
      ...vertices.map((v) => [v[0], v[1]]),
      [vertices[0][0], vertices[0][1]],
    ];
    const geometry: Polygon = { type: "Polygon", coordinates: [ring] };
    features.push({ type: "Feature", properties: {}, geometry });
  } else if (vertices.length === 2) {
    const geometry: LineString = {
      type: "LineString",
      coordinates: vertices.map((v) => [v[0], v[1]]),
    };
    features.push({ type: "Feature", properties: {}, geometry });
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PolygonEditorProps {
  /**
   * The MapLibre map instance, typically obtained from
   * {@link MapView}'s `onMapReady` callback. The editor attaches its preview
   * source/layers and draggable vertex markers to this map. `null` until the
   * map has loaded.
   */
  map: MapLibreMap | null;
  /**
   * A polygon to load as an editable perimeter — e.g. the building footprint
   * the user selected from OpenStreetMap (Req 5.4). When this prop changes to a
   * new polygon, its outer ring is loaded as movable vertices and, if valid,
   * committed via {@link PolygonEditorProps.onCommitPerimeter}.
   */
  initialPolygon?: GeoJsonPolygon | null;
  /**
   * Commits a validated, closed perimeter ring (Req 5.5). Wire this to
   * `projectStateController.setPerimeter`. The returned {@link UpdateResult}
   * lets the editor surface a controller-side rejection.
   */
  onCommitPerimeter?: (polygon: GeoJsonPolygon) => UpdateResult | void;
  /**
   * Invoked when the user resets the editor (Req 5.3). Wire this to clear the
   * stored perimeter in `Project_State` so no perimeter remains.
   */
  onReset?: () => void;
  /** Disables every editor control (e.g. while another action is in flight). */
  disabled?: boolean;
  /** Extra classes for the control panel container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `PolygonEditor` — draw, edit, and reset the building perimeter (Req 5).
 *
 * Behaviour:
 * - In draw mode, tapping/clicking the map places perimeter vertices; this
 *   works with both touch and pointer input (Req 5.1, 5.6).
 * - Every vertex renders as a draggable marker, so the user can move existing
 *   vertices to adjust the perimeter via touch or pointer (Req 5.2, 5.6).
 * - Reset clears all vertices, removes the preview, and asks the parent to drop
 *   the stored perimeter, returning the editor to an empty state (Req 5.3).
 * - A selected OpenStreetMap polygon supplied via `initialPolygon` is loaded as
 *   an editable perimeter with movable vertices (Req 5.4).
 * - Completing or editing a polygon validates it: fewer than 3 vertices shows
 *   the ≥3-vertex message (Req 5.7) and self-intersecting sides show the
 *   crossing message (Req 5.8); neither is stored. A valid ring is committed as
 *   a closed GeoJSON polygon through `onCommitPerimeter` (Req 5.5).
 *
 * The component is controlled at its boundaries: it owns the in-progress vertex
 * list and its MapLibre markers/source, but defers persistence to the supplied
 * callbacks so it can be wired to the single `Project_State` (task 18.1).
 */
export function PolygonEditor({
  map,
  initialPolygon = null,
  onCommitPerimeter,
  onReset,
  disabled = false,
  className,
}: PolygonEditorProps) {
  // The open vertex list (no closing duplicate) is the editor's source of
  // truth for rendering. Imperative map handlers read `verticesRef` to avoid
  // stale closures, while `vertices` state drives marker/source re-rendering.
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const verticesRef = useRef<Vertex[]>([]);

  // Whether the editor is currently placing new vertices on map taps.
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);

  // Whether a valid perimeter has been committed; once committed, vertex drags
  // re-validate immediately so an edit that breaks the ring is rejected (Req 5.8).
  const committedRef = useRef(false);

  // The current validation message (≥3 vertices / crossing / commit rejection).
  const [message, setMessage] = useState<string | null>(null);

  // Marker instances, one per vertex, kept for cleanup/rebuild.
  const markersRef = useRef<Marker[]>([]);
  // Whether the preview source/layers have been added to the map yet.
  const [sourceReady, setSourceReady] = useState(false);
  // Tracks which `initialPolygon` reference has already been loaded.
  const loadedPolygonRef = useRef<GeoJsonPolygon | null>(null);

  // Callbacks in refs so changing them never re-runs the map-bound effects.
  const onCommitPerimeterRef = useRef(onCommitPerimeter);
  const onResetRef = useRef(onReset);
  onCommitPerimeterRef.current = onCommitPerimeter;
  onResetRef.current = onReset;

  /** Updates both the render state and the imperative ref in lock-step. */
  function applyVertices(next: Vertex[]): void {
    verticesRef.current = next;
    setVertices(next);
  }

  /** Writes the current vertices to the preview source without a re-render. */
  function pushSourceData(verts: Vertex[]): void {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(buildFeatureCollection(verts));
  }

  /**
   * Validates `next` and, when valid, commits the closed ring through
   * `onCommitPerimeter` (Req 5.5). Sets the appropriate message for the ≥3
   * (Req 5.7) or non-self-intersection (Req 5.8) rule otherwise. Returns whether
   * a commit succeeded.
   */
  function validateAndCommit(next: Vertex[]): boolean {
    const { message: validationMessage, polygon } = evaluatePerimeter(next);
    if (!polygon) {
      setMessage(validationMessage);
      return false;
    }

    const result = onCommitPerimeterRef.current?.(polygon);
    if (result && result.ok === false) {
      setMessage(result.error?.message ?? COMMIT_REJECTED_MESSAGE);
      return false;
    }

    setMessage(null);
    committedRef.current = true;
    setDrawing(false);
    drawingRef.current = false;
    return true;
  }

  // -- Preview source + layers lifecycle ------------------------------------
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const addSourceAndLayers = () => {
      if (cancelled) return;
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: buildFeatureCollection(verticesRef.current),
        });
        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          filter: ["==", "$type", "Polygon"],
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: { "line-color": "#2563eb", "line-width": 2 },
        });
      }
      setSourceReady(true);
    };

    if (map.isStyleLoaded()) {
      addSourceAndLayers();
    } else {
      map.once("load", addSourceAndLayers);
    }

    return () => {
      cancelled = true;
      setSourceReady(false);
      try {
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // The style may already be torn down; nothing to clean up.
      }
    };
  }, [map]);

  // -- Map tap/click adds vertices while drawing (touch + pointer, Req 5.1, 5.6)
  useEffect(() => {
    if (!map) return;

    const handleClick = (event: MapMouseEvent) => {
      if (!drawingRef.current) return;
      const next: Vertex[] = [
        ...verticesRef.current,
        [event.lngLat.lng, event.lngLat.lat],
      ];
      applyVertices(next);
      // While drawing, defer validation until the user completes the perimeter;
      // a committed perimeter re-validates on every change (Req 5.5, 5.8).
      if (committedRef.current) {
        validateAndCommit(next);
      } else {
        setMessage(null);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // -- Rebuild draggable vertex markers whenever the vertex list changes -----
  useEffect(() => {
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    vertices.forEach((coord, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.setAttribute("aria-label", `Perimeter vertex ${index + 1}`);
      element.dataset.testid = `polygon-vertex-${index}`;
      // A circular handle with a touch-friendly hit area; `touch-action: none`
      // ensures pointer/touch drags are captured rather than scrolling the map.
      Object.assign(element.style, {
        width: "18px",
        height: "18px",
        borderRadius: "9999px",
        backgroundColor: "#2563eb",
        border: "2px solid #ffffff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        cursor: "grab",
        touchAction: "none",
        padding: "0",
      } satisfies Partial<CSSStyleDeclaration>);

      const marker = new Marker({
        element,
        draggable: !disabled,
        anchor: "center",
      })
        .setLngLat(coord)
        .addTo(map);

      // Live-preview the ring while dragging without churning React state.
      marker.on("drag", () => {
        const lngLat = marker.getLngLat();
        const preview = verticesRef.current.map<Vertex>((v, i) =>
          i === index ? [lngLat.lng, lngLat.lat] : v,
        );
        pushSourceData(preview);
      });

      // On drag end, persist the moved vertex and re-validate the edit.
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        const next = verticesRef.current.map<Vertex>((v, i) =>
          i === index ? [lngLat.lng, lngLat.lat] : v,
        );
        applyVertices(next);
        if (committedRef.current) {
          validateAndCommit(next); // re-commit, or reject a crossing edit (Req 5.8)
        } else {
          setMessage(null);
        }
      });

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices, map, disabled]);

  // -- Keep the preview source in sync with the committed vertex state -------
  useEffect(() => {
    if (!sourceReady) return;
    pushSourceData(vertices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices, sourceReady]);

  // -- Load a selected OSM polygon as an editable perimeter (Req 5.4) --------
  useEffect(() => {
    if (!initialPolygon) return;
    if (loadedPolygonRef.current === initialPolygon) return;
    loadedPolygonRef.current = initialPolygon;

    const ring = initialPolygon.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) return;

    // Drop the closing duplicate so each vertex is editable exactly once.
    const open: Vertex[] = ring
      .slice(0, -1)
      .map((point) => [point[0], point[1]] as Vertex);

    applyVertices(open);
    validateAndCommit(open); // store it when valid (Req 5.5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPolygon]);

  // -- Control handlers ------------------------------------------------------

  /** Enables vertex placement on map taps (Req 5.1). */
  function handleStartDraw(): void {
    setDrawing(true);
    drawingRef.current = true;
    setMessage(null);
  }

  /** Finalizes the current perimeter, validating before committing (Req 5.5, 5.7, 5.8). */
  function handleComplete(): void {
    validateAndCommit(verticesRef.current);
  }

  /** Clears the perimeter and returns the editor to an empty state (Req 5.3). */
  function handleReset(): void {
    applyVertices([]);
    setMessage(null);
    setDrawing(false);
    drawingRef.current = false;
    committedRef.current = false;
    loadedPolygonRef.current = null;
    pushSourceData([]);
    onResetRef.current?.();
  }

  const vertexCount = vertices.length;

  return (
    <div
      data-testid="polygon-editor"
      className={cn("flex flex-col gap-3", className)}
      aria-label="Perimeter editor"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleStartDraw}
          disabled={disabled || drawing}
          aria-pressed={drawing}
          data-testid="polygon-editor-draw"
          className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-base font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {drawing ? "Drawing…" : "Draw perimeter"}
        </button>
        <button
          type="button"
          onClick={handleComplete}
          disabled={disabled || vertexCount === 0}
          data-testid="polygon-editor-complete"
          className="min-h-[44px] rounded-lg border border-blue-600 px-4 py-2 text-base font-semibold text-blue-700 shadow-sm hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
        >
          Complete perimeter
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={disabled || (vertexCount === 0 && !message)}
          data-testid="polygon-editor-reset"
          className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          Reset
        </button>
      </div>

      {/* Instructional status: how many vertices are placed and what to do. */}
      <p data-testid="polygon-editor-status" className="text-sm text-gray-600">
        {drawing
          ? `Tap the map to place vertices (${vertexCount} placed). Drag a vertex to move it.`
          : vertexCount > 0
            ? `${vertexCount} vertices placed. Drag a vertex to adjust, or complete the perimeter.`
            : "Tap “Draw perimeter”, then tap the map to place at least 3 vertices."}
      </p>

      {/* Validation message for the ≥3-vertex (Req 5.7) and crossing (Req 5.8) rules. */}
      {message && (
        <p
          role="alert"
          data-testid="polygon-editor-message"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {message}
        </p>
      )}
    </div>
  );
}

export default PolygonEditor;
