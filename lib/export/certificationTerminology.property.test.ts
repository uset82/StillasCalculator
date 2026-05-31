// Feature: stillas-calculator, Property 31: Outputs never use certification terminology
//
// Property 31 (design.md): *For any* exported report and *for any* material-list
// copy, the forbidden terms describing a scaffold as "certified", "approved",
// or "safe for use" never appear; planning-estimate terminology is used instead.
//
// Validates: Requirements 15.6
//
// Strategy: generate random Project_State snapshots that DO contain a
// Material_List (so neither export is refused), then serialize the CSV and
// build the PDF ReportContent and assert that the APP-GENERATED text never
// contains the case-insensitive substrings "certified", "approved", or
// "safe for use".
//
// IMPORTANT: user-provided strings (item names, units, notes, address labels,
// AI summaries) could legitimately contain those words, and Req 15.6 only
// constrains how the APP describes outputs (the disclaimer, the report title,
// scaffold-system display names, units, etc.). To target only app-generated
// copy, the generators draw user-controlled strings from a safe alphabet
// (letters, digits, spaces) that cannot spell any forbidden term, so any
// occurrence in the output must originate from app-authored copy.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  MaterialItem,
  ProjectState,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from '../types';
import { serializeMaterialListCsv } from './csvExport';
import { buildReportContent, type ReportContent } from './pdfExport';

// --- Forbidden terminology (Req 15.6) --------------------------------------

/** Case-insensitive forbidden substrings describing a scaffold (Req 15.6). */
const FORBIDDEN_TERMS = ['certified', 'approved', 'safe for use'];

/** Asserts a single app-generated string carries no forbidden terminology. */
function expectNoForbiddenTerms(text: string): void {
  const haystack = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(haystack).not.toContain(term);
  }
}

// --- Generators ------------------------------------------------------------

const SCAFFOLD_SYSTEM_IDS: ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

// A "safe" alphabet for user-controlled strings: letters, digits, and spaces.
// It deliberately cannot spell any forbidden term, so the only way a forbidden
// term can appear in the output is through app-authored copy (the disclaimer,
// title, system names, units, etc.), which is exactly what Req 15.6 governs.
const safeText = (opts: { minLength?: number; maxLength?: number }) =>
  fc.string({
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split(
        ''
      )
    ),
    minLength: opts.minLength,
    maxLength: opts.maxLength,
  });

/** A single Material_List item with safe, app-neutral name/unit/notes. */
const materialItemArb: fc.Arbitrary<MaterialItem> = fc.record({
  id: safeText({ minLength: 1, maxLength: 12 }),
  itemName: safeText({ minLength: 1, maxLength: 40 }),
  quantity: fc.nat({ max: 100000 }),
  unit: safeText({ minLength: 1, maxLength: 8 }),
  notes: fc.option(safeText({ maxLength: 40 }), { nil: undefined }),
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
 * Builds a Project_State snapshot guaranteed to contain a Material_List, with
 * the optional address / measurements / system / AI-summary fields
 * independently present or absent. All user-controlled strings are drawn from
 * the safe alphabet.
 */
const projectStateWithMaterialListArb: fc.Arbitrary<ProjectState> = fc
  .record({
    materialList: materialListArb,
    placement: fc.constantFrom('calculation', 'adjusted', 'both'),
    decimalPlaces: fc.integer({ min: 0, max: 3 }),
    address: fc.option(
      fc.record({
        label: safeText({ minLength: 1, maxLength: 60 }),
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
    aiSummary: fc.option(safeText({ maxLength: 120 }), { nil: null }),
    warnings: fc.array(safeText({ maxLength: 40 }), { maxLength: 4 }),
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

/** Collects every string field of the PDF ReportContent for inspection. */
function reportContentStrings(content: ReportContent): string[] {
  const strings: string[] = [content.title, content.disclaimer];
  if (content.address !== null) strings.push(content.address);
  if (content.perimeter !== null) strings.push(content.perimeter);
  if (content.selectedSystem !== null) strings.push(content.selectedSystem);
  if (content.aiSummary !== null) strings.push(content.aiSummary);
  for (const row of content.materialRows) {
    strings.push(row.name, row.unit);
    if (row.notes !== undefined) strings.push(row.notes);
  }
  return strings;
}

// --- Property --------------------------------------------------------------

describe('Property 31: Outputs never use certification terminology', () => {
  it('app-generated CSV and PDF report copy never use "certified", "approved", or "safe for use"', () => {
    fc.assert(
      fc.property(projectStateWithMaterialListArb, (state) => {
        // CSV export: the whole serialized document is app-generated copy
        // (the disclaimer, headers) plus safe-alphabet user values (Req 15.6).
        const csvResult = serializeMaterialListCsv(state);
        expect(csvResult.ok).toBe(true);
        if (csvResult.ok) {
          expectNoForbiddenTerms(csvResult.csv);
        }

        // PDF report content model: every string field that gets rendered into
        // the PDF must be free of the forbidden terms (Req 15.6).
        const content = buildReportContent(state);
        expect(content).not.toBeNull();
        if (content !== null) {
          for (const text of reportContentStrings(content)) {
            expectNoForbiddenTerms(text);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
