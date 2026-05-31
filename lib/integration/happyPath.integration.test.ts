// Integration test — happy-path flow (task 18.3).
//
// Exercises the full address → footprint → measurement → calculation →
// material list → PDF/CSV export pipeline end-to-end against an isolated
// `projectStateController` instance, mirroring how `StillasCalculatorApp` wires
// each feature to the single source of truth.
//
// A full DOM render of `StillasCalculatorApp` (with MapLibre) is heavy in
// jsdom, so this test drives the same data/state flow through the controller
// and the real engine/export modules instead. Only the EXTERNAL responses are
// mocked, as inline fixtures:
//   - geocoding (Photon/Nominatim) → a fixture `GeocodingResult`;
//   - Overpass buildings           → a fixture `out geom;` element set;
//   - OpenAI (AI assistant)        → a fixture assistant reply + report summary.
// The geometry engine, scaffold calculator, state controller, and the PDF/CSV
// serializers all run for real.
//
// Validates: Requirements 1.5 (address→estimate→export flow) and 17.2 (every
// consumer observes values identical to the single Project_State).

import { describe, it, expect } from "vitest";

import { createProjectStateController } from "@/lib/state/projectStateController";
import { osmToGeoJSON, type OverpassElement } from "@/lib/osm/osmToGeoJSON";
import { calculateScaffoldMaterials } from "@/lib/scaffold/scaffoldCalculator";
import {
  serializeMaterialListCsv,
  CSV_HEADER,
} from "@/lib/export/csvExport";
import {
  serializeReportPdf,
  buildReportContent,
} from "@/lib/export/pdfExport";
import { VERIFICATION_DISCLAIMER } from "@/lib/types";
import type {
  ChatMessage,
  GeocodingResult,
  ScaffoldCalculationInput,
  ScaffoldSystemId,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Inline external fixtures (the only mocked inputs)
// ---------------------------------------------------------------------------

// 1) Geocoding: a single normalized suggestion, as the `/api/geocoding/photon`
//    route would return after the user picks an address (Req 3).
const GEOCODING_FIXTURE: GeocodingResult = {
  label: "Storgata 1, 0155 Oslo, Norway",
  lat: 59.91,
  lon: 10.75,
};

// 2) Overpass: an `out geom;` response with one building `way`. The inline
//    geometry is a ~20 m × ~10 m rectangle in { lat, lon } order, the shape the
//    `/api/overpass/buildings` route forwards for conversion (Req 4).
const OVERPASS_FIXTURE: OverpassElement[] = [
  {
    type: "way",
    id: 1001,
    tags: { building: "yes" },
    geometry: [
      { lat: 59.91, lon: 10.75 },
      { lat: 59.91, lon: 10.7503584 },
      { lat: 59.9100898, lon: 10.7503584 },
      { lat: 59.9100898, lon: 10.75 },
      { lat: 59.91, lon: 10.75 }, // closing vertex
    ],
  } as OverpassElement,
];

// 3) OpenAI: a fixture assistant reply that also produced a report summary, as
//    the `/api/ai/chat` route would return after a `generateReportSummary`
//    tool call (Req 13/14.6). It is applied through the controller exactly the
//    way the app does after a successful chat outcome.
const AI_REPLY_FIXTURE =
  "Estimated 20 bays across 6 levels for the selected facade run.";

const WORKING_HEIGHT_METERS = 12;
const DEFAULT_SYSTEM_ID: ScaffoldSystemId = "generic-frame";

describe("happy-path integration: address → footprint → measurement → calculation → material list → export", () => {
  it("flows a project from address selection through PDF/CSV export with one consistent Project_State", async () => {
    const controller = createProjectStateController();

    // -- Step 1: address selection (Req 3) --------------------------------
    // The app calls projectStateController.setAddress with the picked result.
    const addressResult = controller.setAddress(GEOCODING_FIXTURE);
    expect(addressResult.ok).toBe(true);
    expect(controller.getState().address).toEqual(GEOCODING_FIXTURE);

    // -- Step 2: footprint selection → perimeter → measurement (Req 4, 5, 6)
    // Convert the mocked Overpass element set into GeoJSON building polygons,
    // pick the (singleton) building, and commit it as the perimeter.
    const buildings = osmToGeoJSON(OVERPASS_FIXTURE);
    expect(buildings).toHaveLength(1);
    const selectedBuilding = buildings[0];

    const perimeterResult = controller.setPerimeter(selectedBuilding);
    expect(perimeterResult.ok).toBe(true);

    // Measurements are computed by the real geometry engine (Req 6).
    const measurements = controller.getState().measurements;
    expect(measurements).not.toBeNull();
    expect(measurements?.valid).toBe(true);
    expect(measurements!.perimeterMeters).toBeGreaterThan(0);
    expect(measurements!.areaSquareMeters).toBeGreaterThan(0);
    // One side length per rectangle edge (4), summing to the perimeter.
    expect(measurements!.sideLengthsMeters).toHaveLength(4);
    const sideSum = measurements!.sideLengthsMeters.reduce((a, b) => a + b, 0);
    expect(sideSum).toBeCloseTo(measurements!.perimeterMeters, 6);

    // No facade subset selected → Scaffold_Length is the whole perimeter (Req 6.8).
    expect(controller.getState().scaffoldLengthMeters).toBeCloseTo(
      measurements!.perimeterMeters,
      6,
    );

    // -- Step 3: scaffold system + working height → calculate (Req 9, 11.7) --
    // Selecting a system loads its defaults (bay/width/lift) into state (Req 7.2).
    expect(controller.setScaffoldSystem(DEFAULT_SYSTEM_ID).ok).toBe(true);
    expect(controller.setWorkingHeight(WORKING_HEIGHT_METERS).ok).toBe(true);

    const current = controller.getState();
    expect(current.bayLengthMeters).toBe(3.0);
    expect(current.liftHeightMeters).toBe(2.0);

    // Build the engine input from the controller's current state, exactly as
    // StillasCalculatorApp.handleCalculate does.
    const input: ScaffoldCalculationInput = {
      scaffoldLengthMeters: current.scaffoldLengthMeters ?? 0,
      workingHeightMeters: current.workingHeightMeters ?? 0,
      bayLengthMeters: current.bayLengthMeters ?? 0,
      liftHeightMeters: current.liftHeightMeters ?? 0,
      scaffoldWidthMeters: current.scaffoldWidthMeters ?? 0,
      scaffoldSystemId: current.scaffoldSystemId ?? DEFAULT_SYSTEM_ID,
      wasteFactorPercent: current.wasteFactorPercent,
    };

    const calc = calculateScaffoldMaterials(input);
    expect(calc.ok).toBe(true);
    if (!calc.ok) return; // type narrowing for the rest of the test

    // Derived bays/levels follow the deterministic formulas (Req 9.2, 9.4).
    const expectedBays = Math.ceil(
      input.scaffoldLengthMeters / input.bayLengthMeters,
    );
    const expectedLevels = Math.ceil(
      input.workingHeightMeters / input.liftHeightMeters,
    );
    expect(calc.output.numberOfBays).toBe(expectedBays);
    expect(calc.output.numberOfLevels).toBe(expectedLevels);
    expect(expectedLevels).toBe(6); // 12 m / 2 m lift

    // Applying the result replaces any prior manual edits (Req 11.7).
    controller.applyCalculation(calc.output);

    // -- Step 4a: material list present in state (Req 11) -----------------
    const afterCalc = controller.getState();
    expect(afterCalc.calculation).not.toBeNull();
    expect(afterCalc.materialListAdjusted).not.toBeNull();
    // Nine derived components + the always-present wall ties/anchors item.
    expect(afterCalc.materialListAdjusted).toHaveLength(10);
    for (const item of afterCalc.materialListAdjusted!) {
      expect(item.itemName.length).toBeGreaterThan(0);
      expect(item.unit.length).toBeGreaterThan(0);
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(0);
    }
    const wallTies = afterCalc.materialListAdjusted!.find(
      (i) => i.id === "wall-ties-anchors",
    );
    expect(wallTies?.quantity).toBe(0);

    // -- Step 4b: every consumer reflects identical Project_State (Req 17.2) --
    // Each per-consumer selector projects the SAME values held in the single
    // Project_State; assert deep equality against getState() across consumers.
    const state = controller.getState();
    const map = controller.selectMap();
    const calculator = controller.selectCalculator();
    const materialList = controller.selectMaterialList();
    const ai = controller.selectAi();
    const exportSel = controller.selectExport();

    expect(map.address).toEqual(state.address);
    expect(map.measurements).toEqual(state.measurements);
    expect(map.scaffoldLengthMeters).toBe(state.scaffoldLengthMeters);

    expect(calculator.scaffoldLengthMeters).toBe(state.scaffoldLengthMeters);
    expect(calculator.workingHeightMeters).toBe(state.workingHeightMeters);
    expect(calculator.bayLengthMeters).toBe(state.bayLengthMeters);
    expect(calculator.liftHeightMeters).toBe(state.liftHeightMeters);
    expect(calculator.scaffoldSystemId).toBe(state.scaffoldSystemId);

    expect(materialList.calculation).toEqual(state.calculation);
    expect(materialList.materialListAdjusted).toEqual(
      state.materialListAdjusted,
    );

    expect(ai.scaffoldLengthMeters).toBe(state.scaffoldLengthMeters);
    expect(ai.measurements).toEqual(state.measurements);

    // The export selector exposes the same address, computed perimeter,
    // selected system, calculation, and material list as the live state.
    expect(exportSel.address).toEqual(state.address);
    expect(exportSel.perimeterMeters).toBe(state.measurements!.perimeterMeters);
    expect(exportSel.scaffoldSystemId).toBe(state.scaffoldSystemId);
    expect(exportSel.calculation).toEqual(state.calculation);
    expect(exportSel.materialListAdjusted).toEqual(state.materialListAdjusted);

    // -- Step 4c: apply the mocked OpenAI reply/summary (Req 13, 14.6) ----
    // Mirrors the app: append the assistant message and store the summary so
    // the PDF export can include it.
    const assistantMessage: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: AI_REPLY_FIXTURE,
      timestamp: Date.now(),
    };
    controller.setAiMessages([assistantMessage]);
    controller.setAiSummary(AI_REPLY_FIXTURE);
    expect(controller.getState().aiSummary).toBe(AI_REPLY_FIXTURE);

    // -- Step 5: export CSV + PDF for real (Req 14) -----------------------
    const finalState = controller.getState();

    // CSV: header + one data row per item + the Verification_Disclaimer.
    const csvResult = serializeMaterialListCsv(finalState);
    expect(csvResult.ok).toBe(true);
    if (!csvResult.ok) return;

    const csvLines = csvResult.csv.split("\n");
    expect(csvLines[0]).toBe(CSV_HEADER);
    // Exactly one data row per material item between the header and the
    // blank-separator/disclaimer trailer.
    const dataRows = csvLines.slice(1, 1 + finalState.materialListAdjusted!.length);
    expect(dataRows).toHaveLength(10);
    expect(csvResult.csv).toContain(VERIFICATION_DISCLAIMER);

    // The report content model includes the address, perimeter, selected
    // system, every current item quantity, the mocked AI summary, and the
    // disclaimer (Req 14.1, 14.5, 14.6, 14.3).
    const reportContent = buildReportContent(finalState);
    expect(reportContent).not.toBeNull();
    expect(reportContent!.address).toBe(GEOCODING_FIXTURE.label);
    expect(reportContent!.perimeter).not.toBeNull();
    expect(reportContent!.selectedSystem).toBe("Generic Frame");
    expect(reportContent!.materialRows).toHaveLength(10);
    expect(reportContent!.aiSummary).toBe(AI_REPLY_FIXTURE);
    expect(reportContent!.disclaimer).toBe(VERIFICATION_DISCLAIMER);

    // PDF: resolves ok with non-empty PDF bytes.
    const pdfResult = await serializeReportPdf(finalState);
    expect(pdfResult.ok).toBe(true);
    if (!pdfResult.ok) return;
    expect(pdfResult.pdf).toBeInstanceOf(Uint8Array);
    expect(pdfResult.pdf.length).toBeGreaterThan(0);
  });
});
