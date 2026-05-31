import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MapView, OPENFREEMAP_STYLE_URL, type MapCoordinate } from "./MapView";

/**
 * Unit/integration tests for the Map system's behavior (task 13.4).
 *
 * Validates: Requirements 2.1, 2.3, 3.5
 *
 * MapLibre GL JS uses WebGL and the real DOM canvas APIs, neither of which jsdom
 * implements, so the library cannot run in this environment. We therefore mock
 * `maplibre-gl` with lightweight `Map`/`Marker`/`NavigationControl` stand-ins
 * that record the constructor options and spy on the methods MapView calls
 * (`on`, `addControl`, `flyTo`, `remove`, `resize`, `setStyle`, `getCanvas` for
 * the map; `setLngLat`, `addTo`, `remove` for the marker). This lets us assert
 * MapView's wiring — the OpenFreeMap style is requested (Req 2.1) and a single
 * marker is replaced + recentered when the coordinate changes (Req 2.3, 3.5) —
 * without rendering actual tiles.
 */

// Shared mock state and classes. Declared with `vi.hoisted` so they are
// available to the hoisted `vi.mock` factory below as well as to the tests.
const mocks = vi.hoisted(() => {
  interface MockMapOptions {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    [key: string]: unknown;
  }

  const mapInstances: MockMap[] = [];
  const markerInstances: MockMarker[] = [];
  const navControlInstances: MockNavigationControl[] = [];

  class MockMap {
    options: MockMapOptions;
    handlers: Record<string, Array<(e?: unknown) => void>> = {};
    on = vi.fn((event: string, cb: (e?: unknown) => void) => {
      (this.handlers[event] ??= []).push(cb);
      // Fire `load` synchronously so any onMapReady wiring resolves, mirroring a
      // map that finishes initializing immediately in this mocked environment.
      if (event === "load") cb();
      return this;
    });
    addControl = vi.fn();
    flyTo = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    setStyle = vi.fn();
    getCanvas = vi.fn(() => document.createElement("canvas"));

    constructor(options: MockMapOptions) {
      this.options = options;
      mapInstances.push(this);
    }
  }

  class MockMarker {
    lngLat: [number, number] | null = null;
    addedTo: MockMap | null = null;
    setLngLat = vi.fn((coords: [number, number]) => {
      this.lngLat = coords;
      return this;
    });
    addTo = vi.fn((map: MockMap) => {
      this.addedTo = map;
      return this;
    });
    remove = vi.fn();

    constructor() {
      markerInstances.push(this);
    }
  }

  class MockNavigationControl {
    options: unknown;
    constructor(options?: unknown) {
      this.options = options;
      navControlInstances.push(this);
    }
  }

  return {
    mapInstances,
    markerInstances,
    navControlInstances,
    MockMap,
    MockMarker,
    MockNavigationControl,
  };
});

vi.mock("maplibre-gl", () => ({
  Map: mocks.MockMap,
  Marker: mocks.MockMarker,
  NavigationControl: mocks.MockNavigationControl,
}));

const OSLO: MapCoordinate = { lat: 59.9139, lon: 10.7522 };
const BERGEN: MapCoordinate = { lat: 60.3913, lon: 5.3221 };

beforeEach(() => {
  // Each test starts from a clean ledger of constructed instances.
  mocks.mapInstances.length = 0;
  mocks.markerInstances.length = 0;
  mocks.navControlInstances.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("MapView MapLibre + OpenFreeMap initialization (Req 2.1)", () => {
  it("initializes exactly one MapLibre map using the OpenFreeMap style URL", () => {
    render(<MapView />);

    expect(mocks.mapInstances).toHaveLength(1);
    // The basemap requested is the zero-key OpenFreeMap style (Req 2.1, 2.5).
    expect(mocks.mapInstances[0].options.style).toBe(OPENFREEMAP_STYLE_URL);
  });

  it("defaults to the documented OpenFreeMap liberty style constant", () => {
    // Guards against the default basemap silently changing to a paid provider.
    expect(OPENFREEMAP_STYLE_URL).toBe(
      "https://tiles.openfreemap.org/styles/liberty",
    );
  });

  it("adds zoom/pan navigation controls to the map (Req 2.2)", () => {
    render(<MapView />);

    expect(mocks.navControlInstances).toHaveLength(1);
    expect(mocks.mapInstances[0].addControl).toHaveBeenCalledTimes(1);
    // The control instance handed to addControl is the NavigationControl.
    const [control] = mocks.mapInstances[0].addControl.mock.calls[0];
    expect(control).toBe(mocks.navControlInstances[0]);
  });

  it("honors an explicit styleUrl prop when provided", () => {
    const custom = "https://tiles.example.org/styles/custom";
    render(<MapView styleUrl={custom} />);

    expect(mocks.mapInstances[0].options.style).toBe(custom);
  });
});

describe("MapView single-marker replacement and recentering (Req 2.3, 3.5)", () => {
  it("does not create a marker when no coordinate is provided", () => {
    render(<MapView />);

    expect(mocks.markerInstances).toHaveLength(0);
    expect(mocks.mapInstances[0].flyTo).not.toHaveBeenCalled();
  });

  it("places a single marker and centers the viewport on the selected coordinate", () => {
    render(<MapView marker={OSLO} />);

    expect(mocks.markerInstances).toHaveLength(1);
    const marker = mocks.markerInstances[0];
    // MapLibre expects [lon, lat] order.
    expect(marker.setLngLat).toHaveBeenCalledWith([OSLO.lon, OSLO.lat]);
    expect(marker.addTo).toHaveBeenCalledWith(mocks.mapInstances[0]);
    expect(marker.remove).not.toHaveBeenCalled();

    // The map recenters so the marker sits at the viewport center (Req 2.3).
    expect(mocks.mapInstances[0].flyTo).toHaveBeenCalledTimes(1);
    expect(mocks.mapInstances[0].flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [OSLO.lon, OSLO.lat] }),
    );
  });

  it("replaces the previous marker when the coordinate changes (single-marker invariant)", () => {
    const { rerender } = render(<MapView marker={OSLO} />);
    expect(mocks.markerInstances).toHaveLength(1);

    rerender(<MapView marker={BERGEN} />);

    // Exactly two markers were ever constructed: the original and its replacement.
    expect(mocks.markerInstances).toHaveLength(2);
    const [previous, current] = mocks.markerInstances;

    // The previous marker is removed before the new one is shown, so at most one
    // marker exists at a time (Req 2.3, 3.5).
    expect(previous.remove).toHaveBeenCalledTimes(1);
    expect(current.setLngLat).toHaveBeenCalledWith([BERGEN.lon, BERGEN.lat]);
    expect(current.addTo).toHaveBeenCalledWith(mocks.mapInstances[0]);
    expect(current.remove).not.toHaveBeenCalled();

    // The map recenters on the new coordinate.
    expect(mocks.mapInstances[0].flyTo).toHaveBeenCalledTimes(2);
    expect(mocks.mapInstances[0].flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [BERGEN.lon, BERGEN.lat] }),
    );
  });

  it("removes the marker when the coordinate is cleared", () => {
    const { rerender } = render(<MapView marker={OSLO} />);
    const marker = mocks.markerInstances[0];

    rerender(<MapView marker={null} />);

    // No new marker is created and the existing one is removed.
    expect(mocks.markerInstances).toHaveLength(1);
    expect(marker.remove).toHaveBeenCalledTimes(1);
  });
});
