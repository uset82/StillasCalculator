// Feature: stillas-calculator, Property 30: Verification disclaimer always present in exports
//
// Property 30 (design.md): *For any* exported PDF and *for any* exported CSV,
// the output contains the Verification_Disclaimer text.
//
// Validates: Requirements 14.3, 15.2, 15.3
//
// Strategy: generate random Project_State snapshots that DO contain a
// Material_List (so neither export is refused), then assert that:
//   - the serialized CSV string contains the VERIFICATION_DISCLAIMER text
//     (Req 15.3);
//   - buildReportContent(state).disclaimer === VERIFICATION_DISCLAIMER, i.e.
//     the disclaimer is part of the PDF content model that gets rendered
//     (Req 14.3, 15.2); and
//   - serializeReportPdf succeeds (ok: true), confirming the disclaimer-bearing
//     content is actually rendered into a PDF rather than refused.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  MaterialItem,
  ProjectState,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
  VERIFICATION_DISCLAIMER,
} from '../types';
import { serializeMaterialListCsv } from './csvExport';
import { buildReportContent, serializeReportPdf } from './pdfExport';

// --- Generators ------------------------------------------------------------

const SCAFFOLD_SYSTEM_IDS: ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

/** A single Material_List item with a non-empty name/unit and a non-negative quantity. */
const materialItemArb: fc.Arbitrary<MaterialItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  itemName: fc.string({ minLength: 1, maxLength: 40 }),
  quantity: fc.nat({ max: 100000 }),
  unit: fc.string({ minLength: 1, maxLength: 8 }),
  notes: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
});

/** One or more Material_List items so the export is never refused. */
const materialListArb: fc.Arbitrary<MaterialItem[]> = fc.array(materialItemArb, {
  minLength: 1,
  maxLength: 6,
});

/** A finite, non-negative double suitable for measurement-style fields. */
const nonNegDouble = fc.double({
  min: 0,
  max: 100000,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Builds a Project_State snapshot that is guaranteed to contain a
 * Material_List. The list is placed in `calculation`, in `materialListAdjusted`,
 * or in both, and the optional address / measurements / system / AI-summary
 * fields are independently present or absent.
 */
const projectStateWithMaterialListArb: fc.Arbitrary<ProjectState> = fc
  .record({
    materialList: materialListArb,
    placement: fc.constantFrom('calculation', 'adjusted', 'both'),
    decimalPlaces: fc.integer({ min: 0, max: 3 }),
    address: fc.option(
      fc.record({
        label: fc.string({ minLength: 1, maxLength: 60 }),
        lat: fc.double({ min: -90, max: 90, noNaN: true }),
        lon: fc.double({ min: -180, max: 180, noNaN: true }),
      }),
      { nil: null }
    ),
    measurements: fc.option(
      fc.record({
        perimeterMeters: nonNegDouble,
        areaSquareMeters: nonNegDouble,
        sideLengthsMeters: fc.array(nonNegDouble, { maxLength: 8 }),
        valid: fc.boolean(),
      }),
      { nil: null }
    ),
    scaffoldSystemId: fc.option(fc.constantFrom(...SCAFFOLD_SYSTEM_IDS), {
      nil: null,
    }),
    aiSummary: fc.option(fc.string({ maxLength: 120 }), { nil: null }),
    warnings: fc.array(fc.string({ maxLength: 40 }), { maxLength: 4 }),
  })
  .map(
    ({
      materialList,
      placement,
      decimalPlaces,
      address,
      measurements,
      scaffoldSystemId,
      aiSummary,
      warnings,
    }) => {
      const calculation: ScaffoldCalculationOutput | null =
        placement === 'calculation' || placement === 'both'
          ? {
              totalScaffoldLengthMeters: 42,
              numberOfBays: 1,
              numberOfLevels: 1,
              materialList,
              warnings,
            }
          : null;

      const materialListAdjusted: MaterialItem[] | null =
        placement === 'adjusted' || placement === 'both' ? materialList : null;

      const state: ProjectState = {
        address,
        perimeterPolygon: null,
        measurements,
        selectedFacadeSideIndices: null,
        scaffoldLengthMeters: null,
        decimalPlaces,
        wasteFactorPercent: 0,
        scaffoldSystemId,
        bayLengthMeters: null,
        liftHeightMeters: null,
        scaffoldWidthMeters: null,
        workingHeightMeters: null,
        calculation,
        materialListAdjusted,
        aiMessages: [],
        aiSummary,
      };
      return state;
    }
  );

// --- Property --------------------------------------------------------------

describe('Property 30: Verification disclaimer always present in exports', () => {
  it('every exported CSV and PDF (with a material list) carries the Verification_Disclaimer', async () => {
    await fc.assert(
      fc.asyncProperty(projectStateWithMaterialListArb, async (state) => {
        // CSV export always embeds the disclaimer text (Req 15.3).
        const csvResult = serializeMaterialListCsv(state);
        expect(csvResult.ok).toBe(true);
        if (csvResult.ok) {
          expect(csvResult.csv).toContain(VERIFICATION_DISCLAIMER);
        }

        // PDF content model always carries the disclaimer (Req 14.3, 15.2).
        const content = buildReportContent(state);
        expect(content).not.toBeNull();
        expect(content?.disclaimer).toBe(VERIFICATION_DISCLAIMER);

        // The disclaimer-bearing content is actually rendered into a PDF.
        const pdfResult = await serializeReportPdf(state);
        expect(pdfResult.ok).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
