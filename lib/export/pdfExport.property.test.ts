// Feature: stillas-calculator, Property 27: PDF report content inclusion
//
// Property-based test for the PDF report content model (task 10.4).
//
// Property 27 (PDF report content inclusion): for any Project_State that
// contains a Material_List, the report includes the address (whenever an
// address exists, independent of whether a perimeter was computed), the
// computed perimeter, the selected scaffold system, every current
// Material_List item quantity, and the AI-generated summary whenever one
// exists.
//
// The PDF serializer (`serializeReportPdf`) renders exactly the pure content
// model returned by `buildReportContent`, which exists expressly so this
// property can assert content inclusion WITHOUT decoding PDF byte streams. We
// therefore drive the property against `buildReportContent`.
//
// Validates: Requirements 14.1, 14.5, 14.6

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { buildReportContent } from "./pdfExport";
import { formatMeasurement } from "../format/measurement";
import { getScaffoldSystem } from "../scaffold/scaffoldSystems";
import type {
  AddressSelection,
  MaterialItem,
  PolygonMeasurements,
  ProjectState,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from "../types";

// The exactly-five selectable scaffold systems (Req 7.1); each is present in
// the Scaffold_Library, so a selected id always resolves to a display name.
const SYSTEM_IDS: ScaffoldSystemId[] = [
  "generic-frame",
  "haki",
  "layher",
  "instant-alufase",
  "custom",
];

// --- Generators ------------------------------------------------------------

/** A single Material_List item: non-empty name/unit, non-negative quantity. */
const materialItemArb: fc.Arbitrary<MaterialItem> = fc.record({
  id: fc.string({ minLength: 1 }),
  itemName: fc.string({ minLength: 1 }),
  quantity: fc.nat({ max: 100_000 }),
  unit: fc.string({ minLength: 1 }),
  notes: fc.option(fc.string(), { nil: undefined }),
});

/** A non-empty Material_List (export requires at least one item). */
const nonEmptyMaterialListArb: fc.Arbitrary<MaterialItem[]> = fc.array(
  materialItemArb,
  { minLength: 1, maxLength: 12 }
);

/** A possibly-empty Material_List. */
const maybeEmptyMaterialListArb: fc.Arbitrary<MaterialItem[]> = fc.array(
  materialItemArb,
  { minLength: 0, maxLength: 12 }
);

/** A geocoded address selection (Req 14.5). */
const addressArb: fc.Arbitrary<AddressSelection> = fc.record({
  label: fc.string({ minLength: 1 }),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

/** Polygon measurements with a finite perimeter (Req 6.1). */
const measurementsArb: fc.Arbitrary<PolygonMeasurements> = fc.record({
  perimeterMeters: fc.double({ min: 0, max: 100_000, noNaN: true }),
  areaSquareMeters: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  sideLengthsMeters: fc.array(
    fc.double({ min: 0, max: 100_000, noNaN: true }),
    { minLength: 0, maxLength: 8 }
  ),
  valid: fc.boolean(),
});

/**
 * An AI summary that exercises every meaningful case: absent (null), present
 * but blank ("" / whitespace), and present with content. Only a non-empty
 * (after trimming) summary should be included (Req 14.6).
 */
const aiSummaryArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(""),
  fc.constant("   "),
  fc.string(),
  fc.string({ minLength: 1 })
);

/** Wraps a Material_List into a minimal, well-formed calculation output. */
function makeCalculation(list: MaterialItem[]): ScaffoldCalculationOutput {
  return {
    totalScaffoldLengthMeters: 0,
    numberOfBays: 1,
    numberOfLevels: 1,
    materialList: list,
    warnings: [],
  };
}

/**
 * The selection rule mirrored from the serializer: the adjusted overrides win
 * when non-empty, otherwise the calculation's list is used. Returns the list
 * whose quantities are "currently stored" and therefore rendered.
 */
function expectedStoredList(
  adjusted: MaterialItem[] | null,
  calcList: MaterialItem[] | null
): MaterialItem[] {
  if (adjusted && adjusted.length > 0) return adjusted;
  if (calcList && calcList.length > 0) return calcList;
  throw new Error("generator must guarantee a non-empty stored list");
}

/**
 * Produces the two list-bearing fields such that the resulting Project_State
 * always carries a Material_List, covering both selection branches:
 *  - the adjusted overrides hold the list (calculation may be absent/empty);
 *  - the calculation holds the list while overrides are absent or empty.
 */
const listSourceArb: fc.Arbitrary<{
  materialListAdjusted: MaterialItem[] | null;
  calculation: ScaffoldCalculationOutput | null;
}> = fc.oneof(
  // Branch A: adjusted overrides carry the (non-empty) list.
  fc
    .record({
      adjusted: nonEmptyMaterialListArb,
      calcList: fc.option(maybeEmptyMaterialListArb, { nil: null }),
    })
    .map(({ adjusted, calcList }) => ({
      materialListAdjusted: adjusted,
      calculation: calcList === null ? null : makeCalculation(calcList),
    })),
  // Branch B: calculation carries the (non-empty) list; overrides absent/empty.
  fc
    .record({
      adjusted: fc.oneof(
        fc.constant<MaterialItem[] | null>(null),
        fc.constant<MaterialItem[]>([])
      ),
      calcList: nonEmptyMaterialListArb,
    })
    .map(({ adjusted, calcList }) => ({
      materialListAdjusted: adjusted,
      calculation: makeCalculation(calcList),
    }))
);

/** A Project_State snapshot guaranteed to contain a Material_List. */
const projectStateWithListArb: fc.Arbitrary<ProjectState> = fc
  .record({
    address: fc.option(addressArb, { nil: null }),
    measurements: fc.option(measurementsArb, { nil: null }),
    scaffoldSystemId: fc.option(fc.constantFrom(...SYSTEM_IDS), { nil: null }),
    aiSummary: aiSummaryArb,
    decimalPlaces: fc.integer({ min: 0, max: 3 }),
    listSource: listSourceArb,
  })
  .map((parts): ProjectState => ({
    address: parts.address,
    perimeterPolygon: null,
    measurements: parts.measurements,
    selectedFacadeSideIndices: null,
    scaffoldLengthMeters: null,
    decimalPlaces: parts.decimalPlaces,
    wasteFactorPercent: 0,
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

describe("Property 27: PDF report content inclusion", () => {
  it("includes address (when present), perimeter, system, every quantity, and AI summary (when present)", () => {
    fc.assert(
      fc.property(projectStateWithListArb, (state) => {
        const content = buildReportContent(state);

        // A Material_List is always present, so a content model must be built.
        expect(content).not.toBeNull();
        if (content === null) return;

        // Address: included iff an address exists, independent of perimeter
        // (Req 14.5).
        if (state.address !== null) {
          expect(content.address).toBe(state.address.label);
        } else {
          expect(content.address).toBeNull();
        }

        // Perimeter: present (formatted in meters) exactly when measurements
        // exist (Req 14.1).
        if (state.measurements !== null) {
          const expectedPerimeter = `${formatMeasurement(
            state.measurements.perimeterMeters,
            state.decimalPlaces
          )} m`;
          expect(content.perimeter).toBe(expectedPerimeter);
        } else {
          expect(content.perimeter).toBeNull();
        }

        // Selected scaffold system: reflects scaffoldSystemId via the library
        // display name (Req 14.1).
        if (state.scaffoldSystemId !== null) {
          const system = getScaffoldSystem(state.scaffoldSystemId);
          const expectedName = system
            ? system.displayName
            : state.scaffoldSystemId;
          expect(content.selectedSystem).toBe(expectedName);
        } else {
          expect(content.selectedSystem).toBeNull();
        }

        // Material rows: one row per stored item, carrying every current
        // quantity (and name/unit) in order (Req 14.1).
        const stored = expectedStoredList(
          state.materialListAdjusted,
          state.calculation ? state.calculation.materialList : null
        );
        expect(content.materialRows).toHaveLength(stored.length);
        for (let i = 0; i < stored.length; i++) {
          expect(content.materialRows[i].quantity).toBe(stored[i].quantity);
          expect(content.materialRows[i].name).toBe(stored[i].itemName);
          expect(content.materialRows[i].unit).toBe(stored[i].unit);
        }

        // AI summary: included iff a non-empty (after trimming) summary exists
        // (Req 14.6).
        const hasSummary =
          state.aiSummary !== null && state.aiSummary.trim().length > 0;
        if (hasSummary) {
          expect(content.aiSummary).toBe(state.aiSummary);
        } else {
          expect(content.aiSummary).toBeNull();
        }
      }),
      { numRuns: 200 }
    );
  });
});
