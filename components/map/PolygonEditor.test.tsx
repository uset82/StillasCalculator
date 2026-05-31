import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PolygonEditor,
  TOO_FEW_VERTICES_MESSAGE,
  SELF_INTERSECTION_MESSAGE,
} from "./PolygonEditor";
import type { GeoJsonPolygon } from "@/lib/types";

/**
 * Unit tests for the PolygonEditor's validation messaging (task 14.3).
 *
 * Validates: Requirements 5.7, 5.8
 *
 * Req 5.7 — completing/editing a polygon with fewer than 3 vertices is
 *   rejected, nothing is stored in Project_State, and a "requires at least 3
 *   vertices" message is shown.
 * Req 5.8 — a self-intersecting polygon is rejected, nothing is stored, and a
 *   "sides must not cross" message is shown.
 *
 * NOTE ON MapLibre IN JSDOM:
 * `maplibre-gl` cannot run in jsdom (it needs WebGL/canvas), so it is mocked.
 * Only the `Marker` value import is used at runtime by the editor; the `Map`
 * type is erased at compile time. We therefore mock `Marker` with a chainable
 * no-op and pass a hand-rolled fake map object as the `map` prop. The fake map
 * captures the `click` handler the editor registers via `map.on("click", ...)`
 * so the test can simulate map taps that place perimeter vertices.
 */

// Mock maplibre-gl: the editor only constructs `Marker` at runtime.
vi.mock("maplibre-gl", () => {
  class MockMarker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {
      return this;
    }
    remove() {
      return this;
    }
    getLngLat() {
      return { lng: 0, lat: 0 };
    }
  }
  return { Marker: MockMarker };
});

/** A minimal in-memory stand-in for the MapLibre map used by the editor. */
interface FakeMap {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  isStyleLoaded: () => boolean;
  addSource: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  /** Test helper: fire every registered map "click" handler with a lng/lat. */
  fireClick: (lng: number, lat: number) => void;
}

/**
 * Builds a fake MapLibre map. The style is reported as already loaded so the
 * editor adds its preview source/layers synchronously, and `click` handlers
 * registered through `map.on` are captured for the test to drive vertex
 * placement.
 */
function createFakeMap(): FakeMap {
  const clickHandlers: Array<(event: { lngLat: { lng: number; lat: number } }) => void> =
    [];
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();

  return {
    on: vi.fn((event: string, handler: (e: { lngLat: { lng: number; lat: number } }) => void) => {
      if (event === "click") clickHandlers.push(handler);
    }),
    off: vi.fn(),
    once: vi.fn(),
    isStyleLoaded: () => true,
    addSource: vi.fn((id: string) => {
      sources.set(id, { setData: vi.fn() });
    }),
    getSource: vi.fn((id: string) => sources.get(id)),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    fireClick(lng: number, lat: number) {
      clickHandlers.forEach((handler) => handler({ lngLat: { lng, lat } }));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PolygonEditor validation messaging", () => {
  it("rejects completing a perimeter with fewer than 3 vertices and shows the ≥3-vertex message (Req 5.7)", async () => {
    const user = userEvent.setup();
    const onCommitPerimeter = vi.fn();
    const map = createFakeMap();

    render(
      // The fake map satisfies the runtime surface the editor touches.
      <PolygonEditor
        map={map as unknown as never}
        onCommitPerimeter={onCommitPerimeter}
      />,
    );

    // Enter draw mode, then place only two vertices via simulated map taps.
    await user.click(screen.getByTestId("polygon-editor-draw"));
    act(() => {
      map.fireClick(10.0, 60.0);
      map.fireClick(10.001, 60.0);
    });

    // Try to finalize the (too-small) perimeter.
    await user.click(screen.getByTestId("polygon-editor-complete"));

    const message = screen.getByTestId("polygon-editor-message");
    expect(message).toHaveTextContent(TOO_FEW_VERTICES_MESSAGE);
    // The perimeter must not be stored in Project_State (Req 5.7).
    expect(onCommitPerimeter).not.toHaveBeenCalled();
  });

  it("rejects a self-intersecting (bowtie) polygon and shows the crossing message (Req 5.8)", async () => {
    const onCommitPerimeter = vi.fn();
    const map = createFakeMap();

    // A bowtie quadrilateral: visiting the corners in the order BL → TR → BR →
    // TL makes the BL→TR and BR→TL sides cross, so the ring self-intersects.
    const bowtie: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0], // BL
          [1, 1], // TR
          [1, 0], // BR
          [0, 1], // TL
          [0, 0], // closing vertex
        ],
      ],
    };

    render(
      <PolygonEditor
        map={map as unknown as never}
        initialPolygon={bowtie}
        onCommitPerimeter={onCommitPerimeter}
      />,
    );

    // Loading the self-intersecting polygon surfaces the crossing message.
    const message = await screen.findByTestId("polygon-editor-message");
    expect(message).toHaveTextContent(SELF_INTERSECTION_MESSAGE);
    // The perimeter must not be stored in Project_State (Req 5.8).
    expect(onCommitPerimeter).not.toHaveBeenCalled();
  });
});
