// Feature: stillas-calculator, Property 29: Export refused without a material list
//
// Property 29 (design.md): *For any* Project_State that lacks a Material_List,
// requesting a PDF or CSV export produces no file and surfaces a message that a
// calculation must be completed first.
//
// Validates: Requirements 14.4
//
// Req 14.4: "IF a report export is requested while no Material_List exists in
// the Project_State, THEN THE StillasCalculator SHALL display a message stating
// that a calculation must be completed before export and SHALL NOT produce a
// PDF or CSV file."
//
// Both serializers read the Material_List from the same snapshot, preferring a
// non-empty `materialListAdjusted` override and otherwise falling back to a
// non-empty `calculation.materialList`. A Project_State "lacks a Material_List"
// exactly when BOTH of those sources are absent or empty. This test generates
// random snapshots in that no-material-list space while varying every other
// field (address, measurements, selected system, AI summary, decimal places,
// waste factor) and asserts BOTH `serializeMaterialListCsv` (sync) and
// `serializeReportPdf` (async) return `{ ok: false, reason }` where `reason` is
// the shared "complete a calculation first" message and NO file payload (`csv`
// / `pdf`) is present on the result.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  serializeMaterialListCsv,
  NO_MATERIAL_LIST_MESSAGE as CSV_NO_MATERIAL_LIST_MESSAGE,
} from "./csvExport";
import {
  serializeReportPdf,
  NO_MATERIAL_LIST_MESSAGE as PDF_NO_MATERIAL_LIST_MESSAGE,
} from "./pdfExport";
import type {
  AddressSelection,
  MaterialItem,
  PolygonMeasurements,
  ProjectState,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from "../types";

// The exactly-five selectable scaffold systems (Req 7.1).
const SYSTEM_IDS: ScaffoldSystemId[] = [
  "generic-frame",
  "haki",
  "layher",
  "instant-alufase",
  "custom",
];

// --- Generators ------------------------------------------------------------

/** A geocoded address selection (Req 14.5) — varied but irrelevant to refusal. */
const addressArb: fc.Arbitrary<AddressSelection> = fc.record({
  label: fc.string({ minLength: 1 }),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

/** Polygon measurements with finite values — present even without a list. */
const measurementsArb: fc.Arbitrary<PolygonMeasurements> = fc.record({
  perimeterMeters: fc.double({ min: 0, max: 100_000, noNaN: true }),
  areaSquareMeters: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  sideLengthsMeters: fc.array(fc.double({ min: 0, max: 100_000, noNaN: true }), {
    maxLength: 8,
  }),
  valid: fc.boolean(),
});

/**
 * The two list-bearing fields constrained to the "no Material_List" space:
 *  - `materialListAdjusted` is either null or an EMPTY array;
 *  - `calculation` is either null or a calculation whose `materialList` is EMPTY.
 *
 * This covers every combination the serializers treat as "no list", because an
 * empty override falls through and an empty calculation list is not selected.
 */
const noListSourceArb: fc.Arbitrary<{
  materialListAdjusted: MaterialItem[] | null;
  calculation: ScaffoldCalculationOutput | null;
}> = fc.record({
  materialListAdjusted: fc.constantFrom<MaterialItem[] | null>(null, []),
  calculation: fc.option(
    fc
      .record({
        totalScaffoldLengthMeters: fc.double({ min: 0, max: 10_000, noNaN: true }),
        numberOfBays: fc.integer({ min: 1, max: 100 }),
        numberOfLevels: fc.integer({ min: 1, max: 100 }),
        warnings: fc.array(fc.string(), { maxLength: 3 }),
      })
      .map((calc): ScaffoldCalculationOutput => ({
        ...calc,
        // Empty material list => no Material_List available to export.
        materialList: [],
      })),
    { nil: null }
  ),
});

/**
 * A Project_State snapshot guaranteed to LACK a Material_List, with every other
 * field varied to show the refusal is independent of the rest of the state.
 */
const noMaterialListStateArb: fc.Arbitrary<ProjectState> = fc
  .record({
    address: fc.option(addressArb, { nil: null }),
    measurements: fc.option(measurementsArb, { nil: null }),
    scaffoldSystemId: fc.option(fc.constantFrom(...SYSTEM_IDS), { nil: null }),
    aiSummary: fc.option(fc.string(), { nil: null }),
    decimalPlaces: fc.integer({ min: 0, max: 3 }),
    wasteFactorPercent: fc.integer({ min: 0, max: 100 }),
    scaffoldLengthMeters: fc.option(
      fc.double({ min: 0, max: 10_000, noNaN: true }),
      { nil: null }
    ),
    listSource: noListSourceArb,
  })
  .map((parts): ProjectState => ({
    address: parts.address,
    perimeterPolygon: null,
    measurements: parts.measurements,
    selectedFacadeSideIndices: null,
    scaffoldLengthMeters: parts.scaffoldLengthMeters,
    decimalPlaces: parts.decimalPlaces,
    wasteFactorPercent: parts.wasteFactorPercent,
    scaffoldSystemId: parts.scaffoldSystemId,
    bayLengthMeters: null,
    liftHeightMeters: null,
    scaffoldWidthMeters: null,
    workingHeightMeters: null,
    calculation: parts.listSource.calculation,
    materialListAdjusted: parts.listSource.materialListAdjusted,
    aiMessages: [],
    aiSummary: parts.aiSummary,
  }));

// --- Property --------------------------------------------------------------

describe("Property 29: Export refused without a material list (Req 14.4)", () => {
  it("CSV and PDF both refuse with the 'complete a calculation first' message and produce no file", async () => {
    await fc.assert(
      fc.asyncProperty(noMaterialListStateArb, async (state) => {
        // CSV serializer (sync): refuses, no `csv` payload (Req 14.4).
        const csvResult = serializeMaterialListCsv(state);
        expect(csvResult.ok).toBe(false);
        if (csvResult.ok === false) {
          expect(csvResult.reason).toBe(CSV_NO_MATERIAL_LIST_MESSAGE);
          expect(csvResult.reason.length).toBeGreaterThan(0);
        }
        // No file payload was produced on the refusal result.
        expect("csv" in csvResult).toBe(false);

        // PDF serializer (async): refuses, no `pdf` payload (Req 14.4).
        const pdfResult = await serializeReportPdf(state);
        expect(pdfResult.ok).toBe(false);
        if (pdfResult.ok === false) {
          expect(pdfResult.reason).toBe(PDF_NO_MATERIAL_LIST_MESSAGE);
          expect(pdfResult.reason.length).toBeGreaterThan(0);
        }
        // No file payload was produced on the refusal result.
        expect("pdf" in pdfResult).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
