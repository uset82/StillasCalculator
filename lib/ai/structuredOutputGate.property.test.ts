// Feature: ai-agent-building-drawing, Property E: Structured output conformance gate
//
// Property E (design.md / task 8.2): *Any* candidate Structured Output with a
// missing required field, an extra/additional field, or a wrong-typed field is
// REJECTED — the gate throws `StructuredOutputError` and the underlying
// `validateAgainstSchema` returns a non-empty issue list — while a fully
// conforming candidate passes. This is the single, provider-agnostic gate every
// Material_List / report summary runs through before it can be presented or
// stored, identically on the OpenAI path (`buildStructuredOutput` per tool
// result) and the Codex path (`buildStructuredOutputForToolResults` over the
// collected MCP tool results).
//
// **Validates: Requirements 4.1, 4.2**
//
// Req 4.1: "WHEN any AI_Provider produces a Material_List or report summary as
// Structured_Output, THE AI_Agent SHALL validate that output against its defined
// strict JSON Schema ... rejecting any output that has a missing required field,
// an additional field not defined by the schema, or a field whose value type
// differs from the schema — before presenting or storing it."
// Req 4.2: "IF Structured_Output ... does not conform ... THEN THE AI_Agent
// SHALL neither present nor store that output, SHALL return an error indication
// that the output failed schema validation ...".
//
// Two complementary layers, both grounded in `lib/ai/structuredOutputGate.ts`:
//   * Layer A drives the real gate (`buildStructuredOutput` /
//     `buildStructuredOutputForToolResults`) with engine-shaped data: conforming
//     data passes and yields a schema-clean candidate; data mutated so the
//     defect survives the gate's normalization makes the gate throw
//     `StructuredOutputError`.
//   * Layer B confirms the conformance contract Property E names directly on
//     candidate Structured Output objects across all three rejection categories
//     (drop a required field, add an extra field, change a field's type).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  buildStructuredOutput,
  buildStructuredOutputForToolResults,
  StructuredOutputError,
} from './structuredOutputGate';
import { validateAgainstSchema } from './validateStructuredOutput';
import {
  MATERIAL_LIST_STRUCTURED_OUTPUT,
  REPORT_SUMMARY_STRUCTURED_OUTPUT,
} from './schemas';
import type { MaterialItem, ScaffoldCalculationOutput } from '@/lib/types';
import type { ReportSummary } from './reportSummary';

// ---------------------------------------------------------------------------
// Generators for engine-shaped (pre-normalization) data — Layer A
// ---------------------------------------------------------------------------

// A finite number; the validator's `number` type rejects NaN/Infinity.
const finiteNumberArb: fc.Arbitrary<number> = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
});

// A non-negative whole number for `quantity` and the bay/level counts.
const countArb: fc.Arbitrary<number> = fc.nat({ max: 1_000_000 });

// A valid engine MaterialItem: `notes` is the engine's optional `string |
// undefined` (the gate normalizes it to `string | null`).
const materialItemArb: fc.Arbitrary<MaterialItem> = fc.record({
  id: fc.string(),
  itemName: fc.string(),
  quantity: countArb,
  unit: fc.string(),
  notes: fc.option(fc.string(), { nil: undefined }),
});

function calculationOutputArb(minItems = 0): fc.Arbitrary<ScaffoldCalculationOutput> {
  return fc.record({
    totalScaffoldLengthMeters: finiteNumberArb,
    numberOfBays: countArb,
    numberOfLevels: countArb,
    materialList: fc.array(materialItemArb, { minLength: minItems, maxLength: 8 }),
    warnings: fc.array(fc.string(), { maxLength: 5 }),
  });
}

function reportSummaryArb(minItems = 0): fc.Arbitrary<ReportSummary> {
  return fc.record({
    address: fc.option(fc.string(), { nil: null }),
    perimeterMeters: fc.option(finiteNumberArb, { nil: null }),
    areaSquareMeters: fc.option(finiteNumberArb, { nil: null }),
    scaffoldLengthMeters: fc.option(finiteNumberArb, { nil: null }),
    scaffoldSystem: fc.option(fc.string(), { nil: null }),
    numberOfBays: fc.option(countArb, { nil: null }),
    numberOfLevels: fc.option(countArb, { nil: null }),
    materialList: fc.array(materialItemArb, { minLength: minItems, maxLength: 8 }),
    warnings: fc.array(fc.string(), { maxLength: 5 }),
    disclaimer: fc.string(),
  });
}

// ---------------------------------------------------------------------------
// Engine-data mutators (Layer A) — each introduces a defect that SURVIVES the
// gate's normalization, so `buildStructuredOutput` must throw. (The material
// list path rebuilds a fixed key set, so top-level extra-field defects cannot
// survive there — that category is covered through the report summary path,
// whose normalization spreads `...summary`, and again at the candidate level in
// Layer B.)
// ---------------------------------------------------------------------------

type Mutator = (obj: Record<string, unknown>) => void;

const calculationOutputMutators: readonly Mutator[] = [
  // Missing required field (normalized key becomes undefined → type mismatch).
  (o) => delete o.numberOfBays,
  (o) => delete o.numberOfLevels,
  // Wrong-typed fields.
  (o) => { o.totalScaffoldLengthMeters = 'not-a-number'; },
  (o) => { o.numberOfLevels = 1.5; }, // a number, but not an integer
  (o) => { o.warnings = 'oops'; }, // not an array
  // Nested item defects (require at least one item).
  (o) => { (o.materialList as Record<string, unknown>[])[0].quantity = 'x'; },
  (o) => { delete (o.materialList as Record<string, unknown>[])[0].unit; },
];

const reportSummaryMutators: readonly Mutator[] = [
  // Missing required field (the spread simply omits the deleted key).
  (o) => delete o.address,
  (o) => delete o.disclaimer,
  // Additional field not defined by the schema (survives `...summary`).
  (o) => { o.unexpected = true; },
  // Wrong-typed fields (including nullable fields given a non-null wrong value).
  (o) => { o.disclaimer = 42; },
  (o) => { o.disclaimer = null; }, // disclaimer is a non-nullable string
  (o) => { o.perimeterMeters = 'x'; }, // number | null
  (o) => { o.numberOfBays = 1.5; }, // integer | null
];

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Layer A — the gate accepts conforming data and rejects nonconforming data
// ---------------------------------------------------------------------------

describe('Property E: Structured output conformance gate (Req 4.1, 4.2)', () => {
  it('buildStructuredOutput passes a conforming Material_List and yields a schema-clean candidate', () => {
    fc.assert(
      fc.property(calculationOutputArb(), (output) => {
        const candidate = buildStructuredOutput('calculateScaffoldMaterials', output);
        // A conforming candidate is returned (not withheld) ...
        expect(candidate).not.toBeUndefined();
        // ... and it actually validates against the strict schema with no issues.
        expect(
          validateAgainstSchema(candidate, MATERIAL_LIST_STRUCTURED_OUTPUT.schema),
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutput passes a conforming report summary and yields a schema-clean candidate', () => {
    fc.assert(
      fc.property(reportSummaryArb(), (summary) => {
        const candidate = buildStructuredOutput('generateReportSummary', summary);
        expect(candidate).not.toBeUndefined();
        expect(
          validateAgainstSchema(candidate, REPORT_SUMMARY_STRUCTURED_OUTPUT.schema),
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutput throws StructuredOutputError for a nonconforming Material_List', () => {
    fc.assert(
      fc.property(
        calculationOutputArb(1),
        fc.integer({ min: 0, max: calculationOutputMutators.length - 1 }),
        (output, mutatorIndex) => {
          const broken = structuredClone(output) as unknown as Record<string, unknown>;
          calculationOutputMutators[mutatorIndex](broken);

          const error = captureThrow(() =>
            buildStructuredOutput('calculateScaffoldMaterials', broken),
          );
          expect(error).toBeInstanceOf(StructuredOutputError);
          const structuredError = error as StructuredOutputError;
          expect(structuredError.schemaName).toBe(MATERIAL_LIST_STRUCTURED_OUTPUT.name);
          expect(structuredError.issues.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutput throws StructuredOutputError for a nonconforming report summary', () => {
    fc.assert(
      fc.property(
        reportSummaryArb(1),
        fc.integer({ min: 0, max: reportSummaryMutators.length - 1 }),
        (summary, mutatorIndex) => {
          const broken = structuredClone(summary) as unknown as Record<string, unknown>;
          reportSummaryMutators[mutatorIndex](broken);

          const error = captureThrow(() =>
            buildStructuredOutput('generateReportSummary', broken),
          );
          expect(error).toBeInstanceOf(StructuredOutputError);
          const structuredError = error as StructuredOutputError;
          expect(structuredError.schemaName).toBe(REPORT_SUMMARY_STRUCTURED_OUTPUT.name);
          expect(structuredError.issues.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutput returns undefined for tools that produce no Structured Output', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('getScaffoldPlan', 'selectFacadeSides', 'generateScaffoldDrawing'),
        fc.anything(),
        (tool, data) => {
          // Non-Structured-Output tools never produce a candidate, so nothing is
          // surfaced and nothing can be (in)validated.
          expect(buildStructuredOutput(tool as never, data)).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  // -------------------------------------------------------------------------
  // The Codex_Provider path: buildStructuredOutputForToolResults runs the same
  // gate over an ordered collection of tool results.
  // -------------------------------------------------------------------------

  it('buildStructuredOutputForToolResults returns the last conforming candidate, skipping non-structured and failed results', () => {
    fc.assert(
      fc.property(calculationOutputArb(), reportSummaryArb(), (output, summary) => {
        const result = buildStructuredOutputForToolResults([
          { tool: 'getScaffoldPlan', ok: true, data: { anything: 1 } },
          { tool: 'calculateScaffoldMaterials', ok: false, data: { junk: true } },
          { tool: 'calculateScaffoldMaterials', ok: true, data: output },
          { tool: 'generateReportSummary', ok: true, data: summary },
        ]);
        // The last structured output (the report summary) is the one surfaced,
        // and it validates clean against its schema.
        expect(result).not.toBeUndefined();
        expect(
          validateAgainstSchema(result, REPORT_SUMMARY_STRUCTURED_OUTPUT.schema),
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutputForToolResults throws on the first nonconforming candidate', () => {
    fc.assert(
      fc.property(
        calculationOutputArb(1),
        fc.integer({ min: 0, max: calculationOutputMutators.length - 1 }),
        (output, mutatorIndex) => {
          const broken = structuredClone(output) as unknown as Record<string, unknown>;
          calculationOutputMutators[mutatorIndex](broken);

          const error = captureThrow(() =>
            buildStructuredOutputForToolResults([
              { tool: 'calculateScaffoldMaterials', ok: true, data: broken },
            ]),
          );
          expect(error).toBeInstanceOf(StructuredOutputError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('buildStructuredOutputForToolResults ignores failed (ok:false) results without validating their data', () => {
    // A failed tool result never contributes a candidate, so even garbage data
    // on it is neither validated nor surfaced.
    const result = buildStructuredOutputForToolResults([
      { tool: 'calculateScaffoldMaterials', ok: false, data: { totally: 'broken' } },
      { tool: 'generateReportSummary', ok: false, data: 12345 },
    ]);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Generators for already-normalized candidate Structured Outputs — Layer B
// ---------------------------------------------------------------------------

// A conforming candidate material item: `notes` is `string | null` (strict-mode
// nullable), matching the gate's normalized shape.
const materialItemCandidateArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  id: fc.string(),
  itemName: fc.string(),
  quantity: countArb,
  unit: fc.string(),
  notes: fc.option(fc.string(), { nil: null }),
});

function materialListCandidateArb(minItems = 0): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    totalScaffoldLengthMeters: finiteNumberArb,
    numberOfBays: countArb,
    numberOfLevels: countArb,
    materialList: fc.array(materialItemCandidateArb, { minLength: minItems, maxLength: 8 }),
    warnings: fc.array(fc.string(), { maxLength: 5 }),
  });
}

function reportSummaryCandidateArb(minItems = 0): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    address: fc.option(fc.string(), { nil: null }),
    perimeterMeters: fc.option(finiteNumberArb, { nil: null }),
    areaSquareMeters: fc.option(finiteNumberArb, { nil: null }),
    scaffoldLengthMeters: fc.option(finiteNumberArb, { nil: null }),
    scaffoldSystem: fc.option(fc.string(), { nil: null }),
    numberOfBays: fc.option(countArb, { nil: null }),
    numberOfLevels: fc.option(countArb, { nil: null }),
    materialList: fc.array(materialItemCandidateArb, { minLength: minItems, maxLength: 8 }),
    warnings: fc.array(fc.string(), { maxLength: 5 }),
    disclaimer: fc.string(),
  });
}

// Category mutators that always introduce exactly the named kind of defect.
const REQUIRED_KEYS: Record<'material_list' | 'report_summary', readonly string[]> = {
  material_list: MATERIAL_LIST_STRUCTURED_OUTPUT.schema.required ?? [],
  report_summary: REPORT_SUMMARY_STRUCTURED_OUTPUT.schema.required ?? [],
};

function dropRequiredField(obj: Record<string, unknown>, keys: readonly string[], pick: number): void {
  delete obj[keys[pick % keys.length]];
}

function addExtraField(obj: Record<string, unknown>): void {
  obj.__notInSchema = 'extra';
}

function changeFieldType(obj: Record<string, unknown>, keys: readonly string[], pick: number): void {
  const key = keys[pick % keys.length];
  // Replace the value with one of a type NO schema field accepts. Every field in
  // both schemas is a string, number/integer, array, or a nullable variant of
  // those — none accepts a boolean, so a boolean always introduces a genuine
  // type mismatch even for a nullable field currently holding `null` (where a
  // plain string substitution would still be schema-valid).
  obj[key] = true;
}

// ---------------------------------------------------------------------------
// Layer B — the conformance contract directly on candidate objects: a
// conforming candidate passes; any of the three mutation categories is rejected.
// ---------------------------------------------------------------------------

describe('Property E: candidate-level conformance across all three rejection categories (Req 4.1)', () => {
  const cases = [
    {
      label: 'Material_List',
      schema: MATERIAL_LIST_STRUCTURED_OUTPUT.schema,
      requiredKeys: REQUIRED_KEYS.material_list,
      arb: materialListCandidateArb(1),
    },
    {
      label: 'report summary',
      schema: REPORT_SUMMARY_STRUCTURED_OUTPUT.schema,
      requiredKeys: REQUIRED_KEYS.report_summary,
      arb: reportSummaryCandidateArb(1),
    },
  ] as const;

  for (const testCase of cases) {
    it(`a conforming ${testCase.label} candidate passes; dropping a required field, adding an extra field, or changing a field type is rejected`, () => {
      fc.assert(
        fc.property(
          testCase.arb,
          fc.constantFrom<'drop' | 'extra' | 'type'>('drop', 'extra', 'type'),
          fc.nat({ max: 1000 }),
          (candidate, category, pick) => {
            // Sanity: the unmutated candidate conforms.
            expect(validateAgainstSchema(candidate, testCase.schema)).toEqual([]);

            const broken = structuredClone(candidate);
            if (category === 'drop') {
              dropRequiredField(broken, testCase.requiredKeys, pick);
            } else if (category === 'extra') {
              addExtraField(broken);
            } else {
              changeFieldType(broken, testCase.requiredKeys, pick);
            }

            // Any of the three defect categories yields a non-empty issue list,
            // i.e. the candidate is rejected (Req 4.1).
            expect(validateAgainstSchema(broken, testCase.schema).length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 200 },
      );
    });
  }
});
