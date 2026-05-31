"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { AppShell } from "@/components/layout/AppShell";
import { MapView, type MapCoordinate } from "@/components/map/MapView";
import { AddressSearch } from "@/components/map/AddressSearch";
import { BuildingFootprintLayer } from "@/components/map/BuildingFootprintLayer";
import { ScaffoldOverlayLayer } from "@/components/map/ScaffoldOverlayLayer";
import { PolygonEditor } from "@/components/map/PolygonEditor";
import { CadPreviewPanel } from "@/components/cad/CadPreviewPanel";
import { MeasurementPanel } from "@/components/map/MeasurementPanel";
import { ScaffoldSystemSelector } from "@/components/scaffold/ScaffoldSystemSelector";
import { ScaffoldCalculatorForm } from "@/components/scaffold/ScaffoldCalculatorForm";
import { MaterialList } from "@/components/scaffold/MaterialList";
import { ExportButtons } from "@/components/scaffold/ExportButtons";
import { AiChatPanel } from "@/components/ai/AiChatPanel";

import { projectStateController } from "@/lib/state/projectStateController";
import { calculateScaffoldMaterials } from "@/lib/scaffold/scaffoldCalculator";
import type { BuildingCandidate } from "@/lib/osm/buildingSelection";
import {
  appendMessage,
  buildChatRequest,
  fetchAiAuthStatus,
  sendChatRequest,
  startAiChatGptSignIn,
} from "@/lib/ai/chatClient";
import type {
  AiAuthSignInResponse,
  AiAuthStatusResponse,
} from "@/lib/ai/authStatus";
import type { AiToolResult } from "@/app/api/ai/chat/route";
import type {
  ChatMessage,
  GeoJsonPolygon,
  GeocodingResult,
  ScaffoldCalculationInput,
  ScaffoldSystemId,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// External-store bindings (Req 17.1, 17.2)
// ---------------------------------------------------------------------------
//
// The whole UI reads from the single application-wide `projectStateController`
// (the single source of truth, Req 17.1). `useSyncExternalStore` subscribes to
// it so every consumer in this tree re-renders from the same `Project_State`
// snapshot whenever any update is applied, and the values each component sees
// stay identical to the controller's state (Req 17.2, 17.3). Because the state
// lives in the module-level singleton rather than React state, it also survives
// navigation between the map, calculator, and assistant panels (Req 17.4).
//
// These bindings are module-level constants so their identity is stable across
// renders (a changing `subscribe` identity would otherwise force re-subscribes).

const subscribeToState = (onStoreChange: () => void): (() => void) =>
  projectStateController.subscribe(() => onStoreChange());

const getStateSnapshot = () => projectStateController.getState();

/** Fallback message when building footprints cannot be fetched (Req 4.5). */
const FOOTPRINT_ERROR_MESSAGE =
  "Building footprints could not be loaded. You can draw the perimeter manually.";

/** Message shown when no footprints exist near the coordinate (Req 4.6). */
const FOOTPRINT_EMPTY_MESSAGE =
  "No building footprints were found nearby. Draw the perimeter manually.";

/** Default system used to satisfy the calculation input when none is selected. */
const DEFAULT_SYSTEM_ID: ScaffoldSystemId = "generic-frame";

/**
 * Default working height (meters) applied on the first address selection so an
 * estimate appears immediately. It is a visible, editable starting point (about
 * a two-storey facade), not a fixed value — the user adjusts it and the
 * estimate recomputes. The disclaimer still requires professional verification.
 */
const DEFAULT_WORKING_HEIGHT_METERS = 6;

/** Response shape of the `/api/overpass/buildings` route (subset used here). */
interface OverpassBuildingsBody {
  buildings?: GeoJsonPolygon[];
  empty?: boolean;
  error?: string;
}

/**
 * Picks the candidate footprint nearest to the selected coordinate by comparing
 * each ring's centroid, so selecting an address auto-targets the building the
 * user actually searched for rather than an arbitrary neighbour.
 */
function pickNearestCandidate(
  candidates: BuildingCandidate[],
  lat: number,
  lon: number,
): BuildingCandidate | null {
  let best: BuildingCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const ring = candidate.polygon.coordinates[0] ?? [];
    if (ring.length === 0) continue;

    // Average the ring vertices (ignoring the closing duplicate) for a cheap,
    // robust centroid; exact centroid is unnecessary for a nearest pick.
    const vertices = ring.slice(0, -1).length > 0 ? ring.slice(0, -1) : ring;
    let sumLon = 0;
    let sumLat = 0;
    for (const [vLon, vLat] of vertices) {
      sumLon += vLon;
      sumLat += vLat;
    }
    const centroidLon = sumLon / vertices.length;
    const centroidLat = sumLat / vertices.length;

    // Squared planar distance in degrees is fine for ranking nearby footprints.
    const dLon = centroidLon - lon;
    const dLat = centroidLat - lat;
    const distance = dLon * dLon + dLat * dLat;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * `StillasCalculatorApp` — the single client container that wires every feature
 * to the one `projectStateController` (task 18.1).
 *
 * It subscribes to the controller so the map, address search, footprint layer,
 * polygon editor, measurement panel, scaffold selector/form, material list,
 * export buttons, and AI chat all read identical `Project_State` and see updates
 * propagate (Req 17.1-17.4). Each component's callbacks are wired to the matching
 * controller setters, completing the address → estimate → export flow (Req 1.5):
 *
 *   address search → setAddress + map marker → footprint lookup
 *   footprint / polygon editor → setPerimeter (or clearPerimeter on reset)
 *   measurement controls → setDecimalPlaces / setWasteFactor / setSelectedFacades
 *   scaffold selector/form → setScaffoldSystem / setDimension / setWorkingHeight
 *   calculate → calculateScaffoldMaterials(engine) + applyCalculation
 *   material list → setMaterialQuantity
 *   export → projectStateController.getState()
 *   AI chat → sendChatRequest, replies appended via setAiMessages
 */
export function StillasCalculatorApp() {
  // The single source of truth, observed via the external store (Req 17.1).
  const state = useSyncExternalStore(
    subscribeToState,
    getStateSnapshot,
    getStateSnapshot,
  );

  // ----- Local, non-Project_State UI concerns -----------------------------
  // The MapLibre instance (set once the map loads) so the footprint layer and
  // polygon editor can attach to the same shared map.
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  // Nearby building footprints fetched from Overpass and the singleton
  // selection among them (Req 4.3, 4.4). These are transient lookup results,
  // not part of the persistent Project_State.
  const [candidates, setCandidates] = useState<BuildingCandidate[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    null,
  );
  const [editablePolygon, setEditablePolygon] =
    useState<GeoJsonPolygon | null>(null);
  const [footprintMessage, setFootprintMessage] = useState<string | null>(null);

  // Calculation error surfaced when the engine rejects the current inputs.
  const [calcError, setCalcError] = useState<string | null>(null);

  // AI chat request state (Req 12.3, 12.7, 12.8). The conversation itself lives
  // in Project_State; these flags track only the in-flight request lifecycle.
  const [aiToolResults, setAiToolResults] = useState<AiToolResult[]>([]);
  const [aiPending, setAiPending] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAuthStatus, setAiAuthStatus] =
    useState<AiAuthStatusResponse | null>(null);
  const [aiAuthStatusPending, setAiAuthStatusPending] = useState(false);
  const [aiAuthActionPending, setAiAuthActionPending] = useState(false);
  const [aiAuthActionMessage, setAiAuthActionMessage] = useState<string | null>(
    null,
  );
  const [aiAuthDeviceAuth, setAiAuthDeviceAuth] = useState<
    AiAuthSignInResponse["deviceAuth"] | null
  >(null);

  // Monotonic id source for chat messages so each has a stable unique key.
  const messageSeq = useRef(0);
  const aiSessionId = useRef(`session-${Date.now()}`);
  const makeMessageId = useCallback(
    () => `msg-${Date.now()}-${messageSeq.current++}`,
    [],
  );

  // The single map marker, derived from the selected address. Memoized on the
  // coordinate so MapView only recenters when the address actually moves
  // (Req 2.3, 3.4) rather than on every render.
  const marker = useMemo<MapCoordinate | null>(
    () =>
      state.address
        ? { lat: state.address.lat, lon: state.address.lon }
        : null,
    [state.address],
  );

  const refreshAiAuthStatus = useCallback(async () => {
    setAiAuthStatusPending(true);
    const status = await fetchAiAuthStatus();
    setAiAuthStatus(status);
    if (status) {
      setAiUnavailable(!status.canUseAssistant);
    }
    setAiAuthStatusPending(false);
  }, []);

  useEffect(() => {
    void refreshAiAuthStatus();
  }, [refreshAiAuthStatus]);

  const handleStartAiSignIn = useCallback(async () => {
    setAiAuthActionPending(true);
    setAiAuthActionMessage(null);
    setAiAuthDeviceAuth(null);
    const result = await startAiChatGptSignIn();
    setAiAuthActionMessage(result.message);
    setAiAuthDeviceAuth(result.deviceAuth ?? null);
    setAiAuthActionPending(false);
    void refreshAiAuthStatus();
  }, [refreshAiAuthStatus]);

  useEffect(() => {
    if (!aiAuthDeviceAuth || aiAuthStatus?.canUseAssistant) return;
    const intervalId = window.setInterval(() => {
      void refreshAiAuthStatus();
    }, 4_000);
    return () => window.clearInterval(intervalId);
  }, [aiAuthDeviceAuth, aiAuthStatus?.canUseAssistant, refreshAiAuthStatus]);

  // ----- Address search → state + footprint lookup (Req 3.4, 3.5, 4.1) -----
  const fetchFootprints = useCallback(async (lat: number, lon: number) => {
    setCandidates([]);
    setSelectedBuildingId(null);
    setFootprintMessage(null);
    try {
      const response = await fetch(
        `/api/overpass/buildings?lat=${lat}&lon=${lon}`,
      );
      const body = (await response.json()) as OverpassBuildingsBody;
      const buildings = Array.isArray(body.buildings) ? body.buildings : [];
      // Convert the route's GeoJSON polygons into selectable candidates with a
      // stable id per footprint (Req 4.2, 4.4).
      const nextCandidates: BuildingCandidate[] = buildings.map(
        (polygon, index) => ({ id: `building-${index}`, polygon }),
      );
      setCandidates(nextCandidates);

      if (body.error) {
        // Network error / non-success / timeout: offer manual drawing (Req 4.5).
        setFootprintMessage(FOOTPRINT_ERROR_MESSAGE);
        return;
      }
      if (body.empty || nextCandidates.length === 0) {
        // No footprints in radius: offer manual drawing (Req 4.6).
        setFootprintMessage(FOOTPRINT_EMPTY_MESSAGE);
        return;
      }

      // Auto-target the building nearest the searched coordinate so the
      // estimate flow starts without an extra tap; the user can still pick a
      // different footprint or edit/redraw the perimeter afterwards.
      const nearest = pickNearestCandidate(nextCandidates, lat, lon);
      if (nearest) {
        setSelectedBuildingId(nearest.id);
        setEditablePolygon(nearest.polygon);
        // Commit straight to Project_State so measurements appear immediately
        // (Req 5.5, 6.1-6.3) without waiting for a manual "Complete" action.
        projectStateController.setPerimeter(nearest.polygon);
        setFootprintMessage(
          "Nearest building selected automatically. Tap another footprint or redraw to change it.",
        );
      }
    } catch {
      // Transport failure: retain the coordinate and offer manual drawing.
      setCandidates([]);
      setFootprintMessage(FOOTPRINT_ERROR_MESSAGE);
    }
  }, []);

  const handleSelectAddress = useCallback(
    (result: GeocodingResult) => {
      // Store the address (Req 3.4, 3.5) and look up nearby footprints (Req 4.1).
      projectStateController.setAddress(result);

      // Seed sensible, visible defaults on first use so an estimate can appear
      // as soon as a building is measured: a default scaffold system (loads its
      // bay/width/lift, Req 7.2) and a default working height. Both are fully
      // editable and only seeded when still unset, so they never overwrite a
      // value the user already entered.
      const current = projectStateController.getState();
      if (current.scaffoldSystemId === null) {
        projectStateController.setScaffoldSystem(DEFAULT_SYSTEM_ID);
      }
      if (current.workingHeightMeters === null) {
        projectStateController.setWorkingHeight(DEFAULT_WORKING_HEIGHT_METERS);
      }

      void fetchFootprints(result.lat, result.lon);
    },
    [fetchFootprints],
  );

  // ----- Footprint selection → editable perimeter (Req 4.4, 5.4) ----------
  const handleSelectBuilding = useCallback(
    (id: string | null) => {
      setSelectedBuildingId(id);
      if (id === null) {
        return;
      }
      const candidate = candidates.find((item) => item.id === id);
      if (candidate) {
        // Load the selected footprint as the editable perimeter; the polygon
        // editor commits it to Project_State via onCommitPerimeter (Req 5.4, 5.5).
        setEditablePolygon(candidate.polygon);
      }
    },
    [candidates],
  );

  // ----- Polygon editor → setPerimeter / clearPerimeter (Req 5.3, 5.5) ----
  const handleCommitPerimeter = useCallback(
    (polygon: GeoJsonPolygon) => projectStateController.setPerimeter(polygon),
    [],
  );

  const handleResetPerimeter = useCallback(() => {
    projectStateController.clearPerimeter();
    setSelectedBuildingId(null);
    setEditablePolygon(null);
  }, []);

  // ----- Calculate → engine + applyCalculation (Req 9, 11.7) --------------
  //
  // `runCalculation` is the single calculation path. It reads the live snapshot,
  // runs the deterministic engine, and (on success) applies the result so the
  // material list updates. It returns whether it produced an estimate so both
  // the manual "Calculate" button and the auto-calculate effect can share it.
  const runCalculation = useCallback((): boolean => {
    const current = projectStateController.getState();

    // Need a positive scaffold length (a measured perimeter/facade) plus a
    // working height before an estimate is meaningful.
    if (
      current.scaffoldLengthMeters === null ||
      current.scaffoldLengthMeters <= 0 ||
      current.workingHeightMeters === null
    ) {
      return false;
    }

    const input: ScaffoldCalculationInput = {
      scaffoldLengthMeters: current.scaffoldLengthMeters,
      workingHeightMeters: current.workingHeightMeters,
      bayLengthMeters: current.bayLengthMeters ?? 0,
      liftHeightMeters: current.liftHeightMeters ?? 0,
      scaffoldWidthMeters: current.scaffoldWidthMeters ?? 0,
      scaffoldSystemId: current.scaffoldSystemId ?? DEFAULT_SYSTEM_ID,
      wasteFactorPercent: current.wasteFactorPercent,
    };
    const result = calculateScaffoldMaterials(input);
    if (result.ok) {
      // Applying the result replaces any prior manual quantity edits (Req 11.7).
      projectStateController.applyCalculation(result.output);
      setCalcError(null);
      return true;
    }
    setCalcError(result.error.message);
    return false;
  }, []);

  // Manual "Calculate" button: surfaces the missing-input message when inputs
  // are incomplete, otherwise produces the estimate.
  const handleCalculate = useCallback(() => {
    const produced = runCalculation();
    if (!produced) {
      const current = projectStateController.getState();
      if (
        current.scaffoldLengthMeters === null ||
        current.scaffoldLengthMeters <= 0
      ) {
        setCalcError(
          "Select or draw a building perimeter first so the scaffold length can be measured.",
        );
      } else if (current.workingHeightMeters === null) {
        setCalcError("Enter a working height to calculate the estimate.");
      }
    }
  }, [runCalculation]);

  // Auto-calculate: once a perimeter is measured and a working height is set,
  // recompute the estimate automatically whenever the relevant inputs change,
  // so the material list appears (and stays current) without a manual click.
  // The button remains available and does the same thing. Calculation is pure
  // and deterministic (Req 9.5), so recomputing on change is safe.
  useEffect(() => {
    runCalculation();
  }, [
    runCalculation,
    state.scaffoldLengthMeters,
    state.workingHeightMeters,
    state.bayLengthMeters,
    state.liftHeightMeters,
    state.scaffoldWidthMeters,
    state.scaffoldSystemId,
    state.wasteFactorPercent,
  ]);

  // ----- AI chat → sendChatRequest + setAiMessages (Req 12, 13) -----------
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Append the user message to the conversation in Project_State (Req 12.1).
      const userMessage: ChatMessage = {
        id: makeMessageId(),
        role: "user",
        content,
        timestamp: Date.now(),
      };
      const withUser = appendMessage(
        projectStateController.getState().aiMessages,
        userMessage,
      );
      projectStateController.setAiMessages(withUser);

      setAiPending(true);
      setAiError(null);

      const request = buildChatRequest(
        withUser,
        projectStateController.getState(),
        aiSessionId.current,
      );
      const outcome = await sendChatRequest(request);

      setAiPending(false);

      if (outcome.status === "unavailable") {
        setAiUnavailable(true);
        void refreshAiAuthStatus();
        return;
      }
      if (outcome.status === "rejected" || outcome.status === "error") {
        setAiError(
          outcome.message ?? "The AI request could not be completed.",
        );
        return;
      }

      if (outcome.scaffoldPlan) {
        projectStateController.applyScaffoldPlan(outcome.scaffoldPlan);
      }

      // Success: append the assistant reply and surface the deterministic
      // tool-call results (Req 13.1).
      setAiUnavailable(false);
      if (outcome.reply.trim().length > 0) {
        const assistantMessage: ChatMessage = {
          id: makeMessageId(),
          role: "assistant",
          content: outcome.reply,
          timestamp: Date.now(),
        };
        projectStateController.setAiMessages(
          appendMessage(
            projectStateController.getState().aiMessages,
            assistantMessage,
          ),
        );
      }
      setAiToolResults(outcome.toolResults);

      // When the assistant produced a report summary, store it so the PDF
      // export can include it (Req 14.6).
      const producedSummary = outcome.toolResults.some(
        (toolResult) =>
          toolResult.tool === "generateReportSummary" && toolResult.ok,
      );
      if (producedSummary && outcome.reply.trim().length > 0) {
        projectStateController.setAiSummary(outcome.reply);
      }
    },
    [makeMessageId, refreshAiAuthStatus],
  );

  // ----- Slot content ------------------------------------------------------

  const mapSlot = (
    <MapView marker={marker} onMapReady={setMapInstance} className="h-full w-full">
      {/* Address search overlays the map; offset from the mobile full-screen
          toggle (which sits at top-left). On selection it centers the map and
          places the single marker (Req 3.4, 3.5). */}
      <div className="absolute left-14 right-2 top-2 z-20 md:left-2 md:max-w-md">
        <AddressSearch onSelectAddress={handleSelectAddress} />
      </div>

      {/* Imperative footprint layer (renders no DOM); selecting a footprint
          drives the singleton selection (Req 4.3, 4.4, 4.8). */}
      <BuildingFootprintLayer
        map={mapInstance}
        candidates={candidates}
        selectedId={selectedBuildingId}
        onSelect={handleSelectBuilding}
      />
      <ScaffoldOverlayLayer
        map={mapInstance}
        overlay={state.drawing.overlayGeoJson}
      />
    </MapView>
  );

  const scaffoldInputsSlot = (
    <div className="flex flex-col gap-6">
      {/* Perimeter editing: draw/edit/reset on the shared map; a selected OSM
          footprint loads as an editable perimeter (Req 5). */}
      <div className="flex flex-col gap-2">
        {footprintMessage ? (
          <p
            role="status"
            data-testid="footprint-message"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            {footprintMessage}
          </p>
        ) : null}
        <PolygonEditor
          map={mapInstance}
          initialPolygon={editablePolygon}
          onCommitPerimeter={handleCommitPerimeter}
          onReset={handleResetPerimeter}
        />
      </div>

      {/* Live measurements + decimal places / waste factor / facade subset. */}
      <MeasurementPanel
        measurements={state.measurements}
        decimalPlaces={state.decimalPlaces}
        wasteFactorPercent={state.wasteFactorPercent}
        selectedFacadeSideIndices={state.selectedFacadeSideIndices}
        onDecimalPlacesChange={(places) =>
          projectStateController.setDecimalPlaces(places)
        }
        onWasteFactorChange={(percent) =>
          projectStateController.setWasteFactor(percent)
        }
        onSelectedFacadesChange={(sides) =>
          projectStateController.setSelectedFacades(sides)
        }
      />

      {/* Scaffold system + its dimensions (system-editor range, Req 7.3). */}
      <ScaffoldSystemSelector
        selectedSystemId={state.scaffoldSystemId}
        bayLengthMeters={state.bayLengthMeters}
        liftHeightMeters={state.liftHeightMeters}
        scaffoldWidthMeters={state.scaffoldWidthMeters}
        onSelectSystem={(systemId) =>
          projectStateController.setScaffoldSystem(systemId)
        }
        onChangeDimension={(field, value) =>
          projectStateController.setDimension(field, value, "systemEditor")
        }
      />

      {/* Working height + calculator-range dimensions, and the calculate gate. */}
      <ScaffoldCalculatorForm
        values={{
          workingHeightMeters: state.workingHeightMeters,
          bayLengthMeters: state.bayLengthMeters,
          liftHeightMeters: state.liftHeightMeters,
          scaffoldWidthMeters: state.scaffoldWidthMeters,
          scaffoldLengthMeters: state.scaffoldLengthMeters,
        }}
        onWorkingHeightCommit={(meters) =>
          projectStateController.setWorkingHeight(meters)
        }
        onDimensionCommit={(field, value) =>
          projectStateController.setDimension(field, value, "calculator")
        }
        onCalculate={handleCalculate}
      />

      {calcError ? (
        <p
          role="alert"
          data-testid="calculation-error"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {calcError}
        </p>
      ) : null}

      <CadPreviewPanel cad={state.cad} />
    </div>
  );

  const materialListSlot = (
    <MaterialList
      calculation={state.calculation}
      materialListAdjusted={state.materialListAdjusted}
      scaffoldLengthMeters={state.scaffoldLengthMeters}
      decimalPlaces={state.decimalPlaces}
      onQuantityChange={(itemId, qty) =>
        projectStateController.setMaterialQuantity(itemId, qty)
      }
    />
  );

  const aiAssistantSlot = (
    <AiChatPanel
      messages={state.aiMessages}
      toolResults={aiToolResults}
      onSendMessage={handleSendMessage}
      pending={aiPending}
      unavailable={aiUnavailable}
      authStatus={aiAuthStatus}
      authStatusPending={aiAuthStatusPending}
      onRefreshAuthStatus={refreshAiAuthStatus}
      authActionPending={aiAuthActionPending}
      authActionMessage={aiAuthActionMessage}
      authActionDeviceAuth={aiAuthDeviceAuth}
      onStartChatGptSignIn={handleStartAiSignIn}
      errorMessage={aiError}
      decimalPlaces={state.decimalPlaces}
    />
  );

  // Export reads the live snapshot at click time so the latest stored
  // quantities are serialized (Req 14.1, 14.2).
  const exportSlot = <ExportButtons getState={getStateSnapshot} />;

  return (
    <AppShell
      map={mapSlot}
      scaffoldInputs={scaffoldInputsSlot}
      materialList={materialListSlot}
      aiAssistant={aiAssistantSlot}
      exportActions={exportSlot}
    />
  );
}

export default StillasCalculatorApp;
