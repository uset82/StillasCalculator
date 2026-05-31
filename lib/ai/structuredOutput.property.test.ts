// Feature: stillas-calculator, Property 26: Structured outputs round-trip and nonconforming output is rejected
//
// Property 26 (design.md): *For any* generated Material_List or report summary,
// serializing it as a Structured Output validates against the defined JSON
// Schema and parses back to an equivalent object; and *for any* output that does
// not conform to the schema, the AI Assistant rejects it and preserves the
// existing Project_State.
//
// Validates: Requirements 13.3, 13.4
//
// The rejection mechanism that backs Req 13.4 is `validateAgainstSchema`
// (lib/ai/validateStructuredOutput.ts) — the exact validator the /api/ai/chat
// route runs over every Material_List / report summary before it can be
// surfaced. When it returns errors the route throws and returns an error signal
// without mutating the Project_State (Req 13.4). This test exercises that
// validator directly:
//
//   * Conforming side: generated MATERIAL_LIST_SCHEMA / REPORT_SUMMARY_SCHEMA
//     objects validate with no errors, and JSON.parse(JSON.stringify(x)) still
//     validates and is deeply equal to the original (round-trip equivalence).
//   * Nonconforming side: deliberately broken variants (missing required field,
//     wrong type, extra property, broken nested item) always yield a non-empty
//     error list, i.e. the output is rejected.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateAgainstSchema } from './validateStructuredOutput';
import { MATERIAL_LIST_SCHEMA, REPORT_SUMMARY_SCHEMA } from './schemas';

// ---------------------------------------------------------------------------
// Generators for schema-conforming values
// ---------------------------------------------------------------------------

// A finite number (the validator's `number` type rejects NaN/Infinity). `-0` is
// normalized to `0` because JSON serialization collapses `-0` to `0`, and we
// want generated values to round-trip to a deeply-equal object.
const finiteNumberArb: fc.Arbitrary<number> = fc
  .double({ min: -1e9, max: 1e9, noNaN: true })
  .map((n) => (Object.is(n, -0) ? 0 : n));

// A non-negative whole number for `quantity` (MATERIAL_ITEM_SCHEMA: integer >= 0).
const quantityArb: fc.Arbitrary<number> = fc.nat({ max: 1_000_000 });

// A plain integer for bay/level counts.
const countArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100_000 });

// A conforming MATERIAL_ITEM_SCHEMA object: every property present, `notes`
// expressed as a string or null (strict-mode nullable).
const materialItemArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  id: fc.string(),
  itemName: fc.string(),
  quantity: quantityArb,
  unit: fc.string(),
  notes: fc.option(fc.string(), { nil: null }),
});

// A conforming MATERIAL_LIST_SCHEMA object. `minItems` lets callers force at
// least one Material_List item so nested item mutations have something to break.
function materialListArb(minItems = 0): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    totalScaffoldLengthMeters: finiteNumberArb,
    numberOfBays: countArb,
    numberOfLevels: countArb,
    materialList: fc.array(materialItemArb, { minLength: minItems, maxLength: 8 }),
    warnings: fc.array(fc.string(), { maxLength: 5 }),
  });
}

// A conforming REPORT_SUMMARY_SCHEMA object. Nullable fields are exercised on
// both branches (a concrete value or null); `disclaimer` is a non-nullable
// string.
function reportSummaryArb(minItems = 0): fc.Arbitrary<Record<string, unknown>> {
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
// Mutators that produce a guaranteed-nonconforming variant
// ---------------------------------------------------------------------------
//
// Each mutator covers one of the three rejection categories named in the task —
// a missing required field, a wrong-typed field, or a disallowed extra property
// (plus the nested-item analogues) — and is constructed to ALWAYS introduce at
// least one schema violation, so the validator must return a non-empty error
// list for every one.

type Mutator = (obj: Record<string, unknown>) => void;

const materialListMutators: readonly Mutator[] = [
  // Missing required fields.
  (o) => delete o.totalScaffoldLengthMeters,
  (o) => delete o.numberOfBays,
  (o) => delete o.materialList,
  (o) => delete o.warnings,
  // Wrong-typed fields.
  (o) => { o.totalScaffoldLengthMeters = 'not-a-number'; },
  (o) => { o.numberOfBays = 'not-an-int'; },
  (o) => { o.numberOfLevels = 1.5; }, // a number, but not an integer
  (o) => { o.materialList = 123; }, // not an array
  (o) => { o.warnings = 'oops'; }, // not an array
  // Disallowed extra property (additionalProperties: false).
  (o) => { o.unexpected = true; },
  // Nested item violations (require at least one item).
  (o) => { (o.materialList as Record<string, unknown>[])[0].quantity = 'x'; },
  (o) => { delete (o.materialList as Record<string, unknown>[])[0].unit; },
  (o) => { (o.materialList as Record<string, unknown>[])[0].extra = 1; },
];

const reportSummaryMutators: readonly Mutator[] = [
  // Missing required fields.
  (o) => delete o.disclaimer,
  (o) => delete o.materialList,
  (o) => delete o.address,
  // Wrong-typed fields (including nullable fields given a non-null, wrong value).
  (o) => { o.disclaimer = null; }, // disclaimer is a non-nullable string
  (o) => { o.disclaimer = 42; },
  (o) => { o.address = 42; }, // string | null
  (o) => { o.perimeterMeters = 'x'; }, // number | null
  (o) => { o.numberOfBays = 'x'; }, // integer | null
  (o) => { o.materialList = {}; }, // not an array
  (o) => { o.warnings = 7; }, // not an array
  // Disallowed extra property.
  (o) => { o.unexpected = 'nope'; },
  // Nested item violations (require at least one item).
  (o) => { (o.materialList as Record<string, unknown>[])[0].quantity = -1.5; },
  (o) => { (o.materialList as Record<string, unknown>[])[0].notes = 5; },
];

const mutatorIndexArb = (count: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: count - 1 });

// ---------------------------------------------------------------------------
// Property 26 — conforming output validates and round-trips
// ---------------------------------------------------------------------------

describe('Property 26: Structured outputs round-trip and nonconforming output is rejected (Req 13.3, 13.4)', () => {
  it('a conforming Material_List validates and JSON round-trips to an equivalent object', () => {
    fc.assert(
      fc.property(materialListArb(), (obj) => {
        // Conforming output validates against the defined JSON Schema (Req 13.3).
        expect(validateAgainstSchema(obj, MATERIAL_LIST_SCHEMA)).toEqual([]);

        // Serializing as a Structured Output and parsing back yields an
        // equivalent object that still validates.
        const roundTripped = JSON.parse(JSON.stringify(obj));
        expect(validateAgainstSchema(roundTripped, MATERIAL_LIST_SCHEMA)).toEqual([]);
        expect(roundTripped).toEqual(obj);
      }),
      { numRuns: 200 },
    );
  });

  it('a conforming report summary validates and JSON round-trips to an equivalent object', () => {
    fc.assert(
      fc.property(reportSummaryArb(), (obj) => {
        expect(validateAgainstSchema(obj, REPORT_SUMMARY_SCHEMA)).toEqual([]);

        const roundTripped = JSON.parse(JSON.stringify(obj));
        expect(validateAgainstSchema(roundTripped, REPORT_SUMMARY_SCHEMA)).toEqual([]);
        expect(roundTripped).toEqual(obj);
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 26 — nonconforming output is rejected
  // -------------------------------------------------------------------------

  it('a nonconforming Material_List is rejected (non-empty error list)', () => {
    fc.assert(
      fc.property(
        materialListArb(1),
        mutatorIndexArb(materialListMutators.length),
        (obj, mutatorIndex) => {
          // Sanity: the unmutated object conforms.
          expect(validateAgainstSchema(obj, MATERIAL_LIST_SCHEMA)).toEqual([]);

          // Apply exactly one guaranteed-breaking mutation, then assert the
          // validator rejects it — the mechanism by which the route refuses the
          // output and preserves the existing Project_State (Req 13.4).
          materialListMutators[mutatorIndex](obj);
          const errors = validateAgainstSchema(obj, MATERIAL_LIST_SCHEMA);
          expect(errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a nonconforming report summary is rejected (non-empty error list)', () => {
    fc.assert(
      fc.property(
        reportSummaryArb(1),
        mutatorIndexArb(reportSummaryMutators.length),
        (obj, mutatorIndex) => {
          expect(validateAgainstSchema(obj, REPORT_SUMMARY_SCHEMA)).toEqual([]);

          reportSummaryMutators[mutatorIndex](obj);
          const errors = validateAgainstSchema(obj, REPORT_SUMMARY_SCHEMA);
          expect(errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Concrete named examples pinning the same Property 26 behavior
  // -------------------------------------------------------------------------

  it('accepts a concrete conforming Material_List and round-trips it', () => {
    const materialList = {
      totalScaffoldLengthMeters: 42.5,
      numberOfBays: 7,
      numberOfLevels: 3,
      materialList: [
        { id: 'std', itemName: 'Standard 3.0m', quantity: 24, unit: 'stk', notes: null },
        {
          id: 'tie',
          itemName: 'Wall tie',
          quantity: 8,
          unit: 'stk',
          notes: 'Verify tie/anchor placement manually.',
        },
      ],
      warnings: ['Wall ties require manual verification.'],
    };

    expect(validateAgainstSchema(materialList, MATERIAL_LIST_SCHEMA)).toEqual([]);
    const roundTripped = JSON.parse(JSON.stringify(materialList));
    expect(roundTripped).toEqual(materialList);
    expect(validateAgainstSchema(roundTripped, MATERIAL_LIST_SCHEMA)).toEqual([]);
  });

  it('rejects each named nonconforming Material_List category', () => {
    const base = {
      totalScaffoldLengthMeters: 10,
      numberOfBays: 2,
      numberOfLevels: 1,
      materialList: [{ id: 'a', itemName: 'Standard', quantity: 4, unit: 'stk', notes: null }],
      warnings: [],
    };

    // Missing required field.
    const missing = JSON.parse(JSON.stringify(base));
    delete missing.numberOfLevels;
    expect(validateAgainstSchema(missing, MATERIAL_LIST_SCHEMA).length).toBeGreaterThan(0);

    // Wrong type.
    const wrongType = JSON.parse(JSON.stringify(base));
    wrongType.numberOfBays = 'two';
    expect(validateAgainstSchema(wrongType, MATERIAL_LIST_SCHEMA).length).toBeGreaterThan(0);

    // Extra property.
    const extra = JSON.parse(JSON.stringify(base));
    extra.surprise = true;
    expect(validateAgainstSchema(extra, MATERIAL_LIST_SCHEMA).length).toBeGreaterThan(0);
  });
});
