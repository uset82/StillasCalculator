import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  serializeReportPdf,
  type PdfExportResult,
} from "./pdfExport";
import {
  serializeMaterialListCsv,
  NO_MATERIAL_LIST_MESSAGE as CSV_NO_MATERIAL_LIST_MESSAGE,
  type CsvExportResult,
} from "./csvExport";
import { ProjectState } from "../types";

// Unit tests for export failure handling (task 10.8, Req 14.7).
//
// Req 14.7: "IF generation of a requested PDF or CSV export fails, THEN THE
// Report_Module SHALL display an error message indicating that the export could
// not be completed and SHALL preserve the existing Project_State values."
//
// The serializers honour this by being total functions: instead of throwing on
// a generation failure they return a discriminated `{ ok: false, reason }`
// result carrying a human-readable message, and they never mutate the
// Project_State snapshot they are handed. These tests force the PDF generation
// catch path (by making pdf-lib's document creation fail) and assert that the
// serializer surfaces an error message, never throws, and leaves the input
// Project_State byte-for-byte unchanged. The CSV serializer is total by
// construction (no throwing generation path), so we assert it likewise never
// throws and preserves state for both its success and refusal branches.

/**
 * Builds a complete Project_State whose Material_List is populated, so that
 * `serializeReportPdf` proceeds past the "no material list" refusal and reaches
 * the actual PDF generation step where the forced failure occurs.
 */
function makeStateWithMaterialList(): ProjectState {
  return {
    address: { label: "Storgata 1, Oslo", lat: 59.91, lon: 10.75 },
    perimeterPolygon: {
      type: "Polygon",
      coordinates: [
        [
          [10.75, 59.91],
          [10.7501, 59.91],
          [10.7501, 59.9101],
          [10.75, 59.9101],
          [10.75, 59.91],
        ],
      ],
    },
    measurements: {
      perimeterMeters: 42.5,
      areaSquareMeters: 110.25,
      sideLengthsMeters: [11.1, 10.2, 11.1, 10.1],
      valid: true,
    },
    selectedFacadeSideIndices: null,
    scaffoldLengthMeters: 42.5,
    decimalPlaces: 2,
    wasteFactorPercent: 0,
    scaffoldSystemId: "haki",
    bayLengthMeters: 3,
    liftHeightMeters: 2,
    scaffoldWidthMeters: 0.7,
    workingHeightMeters: 6,
    calculation: {
      totalScaffoldLengthMeters: 42.5,
      numberOfBays: 15,
      numberOfLevels: 3,
      materialList: [
        { id: "frames", itemName: "Frames", quantity: 48, unit: "pcs" },
        { id: "ledgers", itemName: "Ledgers", quantity: 90, unit: "pcs" },
        {
          id: "wall-ties",
          itemName: "Wall ties / anchors",
          quantity: 0,
          unit: "pcs",
          notes: "Verify manually",
        },
      ],
      warnings: [],
    },
    materialListAdjusted: null,
    aiMessages: [],
    aiSummary: "Estimated planning summary for the facade scaffold.",
  };
}

describe("export failure handling (Req 14.7)", () => {
  describe("serializeReportPdf", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns { ok: false, reason } with an error message instead of throwing when PDF generation fails", async () => {
      const createSpy = vi
        .spyOn(PDFDocument, "create")
        .mockRejectedValue(new Error("simulated PDF backend failure"));

      const state = makeStateWithMaterialList();

      // Must resolve (never reject/throw) even though generation failed.
      const result: PdfExportResult = await serializeReportPdf(state);

      expect(createSpy).toHaveBeenCalledOnce();
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        // A non-empty, human-readable error message is surfaced (Req 14.7).
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result.reason).toContain("simulated PDF backend failure");
      }
    });

    it("surfaces a generic failure message when a non-Error value is thrown", async () => {
      vi.spyOn(PDFDocument, "create").mockRejectedValue("not-an-error");

      const result = await serializeReportPdf(makeStateWithMaterialList());

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.reason).toBe("PDF export failed.");
      }
    });

    it("preserves the input Project_State unchanged (deep-equal before/after) on failure", async () => {
      vi.spyOn(PDFDocument, "create").mockRejectedValue(new Error("boom"));

      const state = makeStateWithMaterialList();
      const before = structuredClone(state);

      const result = await serializeReportPdf(state);

      expect(result.ok).toBe(false);
      // The serializer is a pure read over the snapshot: nothing is mutated.
      expect(state).toEqual(before);
    });

    it("does not throw even when generation fails repeatedly", async () => {
      vi.spyOn(PDFDocument, "create").mockRejectedValue(new Error("again"));
      const state = makeStateWithMaterialList();

      await expect(serializeReportPdf(state)).resolves.toMatchObject({
        ok: false,
      });
      await expect(serializeReportPdf(state)).resolves.toMatchObject({
        ok: false,
      });
    });
  });

  describe("serializeMaterialListCsv", () => {
    it("never throws and preserves the input Project_State for valid input", () => {
      const state = makeStateWithMaterialList();
      const before = structuredClone(state);

      let result: CsvExportResult | undefined;
      expect(() => {
        result = serializeMaterialListCsv(state);
      }).not.toThrow();

      expect(result?.ok).toBe(true);
      expect(state).toEqual(before);
    });

    it("refuses with an error message and preserves state when no material list exists", () => {
      const state = makeStateWithMaterialList();
      state.calculation = null;
      state.materialListAdjusted = null;
      const before = structuredClone(state);

      const result = serializeMaterialListCsv(state);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.reason).toBe(CSV_NO_MATERIAL_LIST_MESSAGE);
        expect(result.reason.length).toBeGreaterThan(0);
      }
      // Project_State is preserved when the export cannot be produced (Req 14.7).
      expect(state).toEqual(before);
    });
  });
});
