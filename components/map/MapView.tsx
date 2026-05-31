"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A geographic coordinate used throughout the map system. Expressed as
 * separate latitude/longitude fields (rather than a GeoJSON `[lon, lat]`
 * tuple) so callers and `Project_State` consumers can read it unambiguously.
 */
export interface MapCoordinate {
  lat: number;
  lon: number;
}

/**
 * The zero-key OpenFreeMap basemap style (Req 2.1, 2.5). OpenFreeMap provides
 * tiles only — geocoding and footprints are separate services — so this is
 * exclusively the basemap. No Google/paid tile service is used (Req 2.5).
 */
export const OPENFREEMAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

/** Viewport breakpoint below which the mobile full-screen toggle is offered
 *  (Req 2.4). Matches the app-wide 768px breakpoint. */
const MOBILE_BREAKPOINT_PX = 768;

/** Default map center used until an address/marker is selected. Oslo, Norway. */
const DEFAULT_CENTER: MapCoordinate = { lat: 59.9139, lon: 10.7522 };
const DEFAULT_ZOOM = 11;
/** Zoom used when centering on a freshly selected marker (Req 2.3, 3.4). */
const DEFAULT_MARKER_ZOOM = 17;

export interface MapViewProps {
  /**
   * The single selected coordinate. When set, the map places exactly one
   * marker here (replacing any previous marker) and centers the viewport on it
   * (Req 2.3). `null`/omitted means no marker is shown.
   */
  marker?: MapCoordinate | null;
  /** Initial center used before a marker is selected. Defaults to Oslo. */
  initialCenter?: MapCoordinate;
  /** Initial zoom level. Defaults to {@link DEFAULT_ZOOM}. */
  initialZoom?: number;
  /** Zoom applied when centering on a selected marker (Req 2.3). */
  markerZoom?: number;
  /** Basemap style URL. Defaults to the OpenFreeMap style (Req 2.1). */
  styleUrl?: string;
  /**
   * Invoked when the user clicks/taps the map, with the tapped coordinate.
   * Lets a parent (later wired to `Project_State`, task 18.1) drive selection.
   */
  onMapClick?: (coordinate: MapCoordinate) => void;
  /**
   * Invoked once the underlying MapLibre map instance has loaded. Exposes the
   * map so sibling features (address search 13.2, footprint layer 13.3) can
   * attach sources/layers without MapView owning them.
   */
  onMapReady?: (map: MapLibreMap) => void;
  /** Extra classes for the outer container. */
  className?: string;
  /** Optional overlay content rendered above the map canvas (e.g. search). */
  children?: ReactNode;
}

/**
 * Interactive open-source map (Req 2).
 *
 * Responsibilities owned here:
 * - Initializes MapLibre GL JS with the OpenFreeMap basemap style (Req 2.1).
 * - Adds zoom/pan navigation controls (Req 2.2).
 * - Manages a single marker: any new `marker` prop replaces the previous one
 *   and the map re-centers so the marker sits at the viewport center (Req 2.3).
 * - Below 768px, offers a full-screen toggle that makes the map occupy 100% of
 *   the viewport width and height (Req 2.4).
 * - Detects tile/style load failures and shows an error indication with a retry
 *   control that reloads the basemap (Req 2.6).
 *
 * Marker selection, address search, and footprint layers are intentionally not
 * owned here; this component accepts a coordinate prop and callbacks so it can
 * be wired to `Project_State` later (task 18.1) and composed with 13.2/13.3.
 */
export function MapView({
  marker = null,
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
  markerZoom = DEFAULT_MARKER_ZOOM,
  styleUrl = OPENFREEMAP_STYLE_URL,
  onMapClick,
  onMapReady,
  className,
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  // Callbacks are kept in refs so changing them never re-initializes the map.
  const onMapClickRef = useRef(onMapClick);
  const onMapReadyRef = useRef(onMapReady);
  onMapClickRef.current = onMapClick;
  onMapReadyRef.current = onMapReady;

  const [tileError, setTileError] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Track whether the viewport is below the mobile breakpoint so the
  // full-screen toggle is only offered on small screens (Req 2.4).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  // Initialize the MapLibre map exactly once on mount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      center: [initialCenter.lon, initialCenter.lat],
      zoom: initialZoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // Zoom + pan controls (Req 2.2). Pan/drag is enabled by default; the
    // navigation control adds explicit zoom buttons and a compass.
    map.addControl(new NavigationControl({ showCompass: true }), "top-right");

    map.on("click", (e) => {
      onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    map.on("load", () => {
      onMapReadyRef.current?.(map);
    });

    // Any style/tile load failure surfaces the error indication (Req 2.6).
    map.on("error", () => {
      setTileError(true);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // styleUrl/initialCenter/initialZoom are read once at init; subsequent
    // changes are intentionally not re-applied here to avoid re-creating the
    // map. Marker-driven recentering is handled in a dedicated effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single-marker management: replace any prior marker and recenter (Req 2.3).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove any existing marker first so at most one marker ever exists.
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!marker) return;

    markerRef.current = new Marker()
      .setLngLat([marker.lon, marker.lat])
      .addTo(map);

    // Center the viewport on the marker (Req 2.3, 3.4).
    map.flyTo({ center: [marker.lon, marker.lat], zoom: markerZoom });
  }, [marker, markerZoom]);

  // When toggling full-screen the container size changes; MapLibre needs an
  // explicit resize to repaint the canvas at the new dimensions.
  useEffect(() => {
    mapRef.current?.resize();
  }, [isFullScreen]);

  // Reloading the style re-requests tiles; used by the retry control (Req 2.6).
  const handleRetry = useCallback(() => {
    setTileError(false);
    mapRef.current?.setStyle(styleUrl, { diff: false });
  }, [styleUrl]);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen((prev) => !prev);
  }, []);

  return (
    <div
      data-testid="map-view"
      className={[
        "relative h-full w-full",
        // Full-screen mode occupies 100% of the viewport (Req 2.4).
        isFullScreen
          ? "fixed inset-0 z-[60] h-[100dvh] w-[100vw]"
          : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* The MapLibre canvas mounts into this element. */}
      <div
        ref={containerRef}
        data-testid="map-canvas"
        className="h-full w-full"
      />

      {/* Optional overlay content (e.g. address search) sits above the map. */}
      {children}

      {/* Mobile-only full-screen toggle (Req 2.4). Hidden at >=768px and a
          >=44x44 CSS px touch target (Req 16.4). */}
      {isMobile && (
        <button
          type="button"
          onClick={toggleFullScreen}
          data-testid="map-fullscreen-toggle"
          aria-pressed={isFullScreen}
          aria-label={isFullScreen ? "Exit full-screen map" : "Full-screen map"}
          className="absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 bg-white/90 text-lg shadow-md"
        >
          <span aria-hidden="true">{isFullScreen ? "🗗" : "⛶"}</span>
        </button>
      )}

      {/* Tile-load error indication with a retry control (Req 2.6). */}
      {tileError && (
        <div
          data-testid="map-tile-error"
          role="alert"
          className="absolute inset-x-2 top-2 z-20 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-md"
        >
          <span>Map tiles failed to load.</span>
          <button
            type="button"
            onClick={handleRetry}
            data-testid="map-tile-retry"
            className="flex min-h-9 items-center rounded-md bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default MapView;
