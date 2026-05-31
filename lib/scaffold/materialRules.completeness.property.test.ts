import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildMaterialList } from '@/lib/scaffold/materialRules';
import type { MaterialItem, ScaffoldSystemId } from '@/lib/types';

// Feature: stillas-calculator, Property 12: Material list is structurally complete
//
// Property 12 (design.md): For any completed calculation, the Material_List
// contains a line item for each of frames/standards, base plates, adjustable
// base jacks, ledgers/horizontals, platforms/decks, guardrails, toe boards,
// diagonal braces, and ladders/access, plus a wall ties/anchors item carrying
// a manual-verification note; and every item has a non-empty name, a non-empty
// unit, and a quantity that is a non-negative integer.
//
// **Validates: Requirements 10.1, 10.2, 10.3, 10.6**
//
// `buildMaterialList(bays, levels, systemId)` must always emit the full set of
// line items regardless of whether its inputs are valid (Req 10.1, 10.6). This
// test feeds it the full input space — valid positive integers as well as
// edge/invalid values (zero, negatives, non-integers, NaN, Infinity) and both
// known and unknown system ids — and asserts the structural completeness
// invariant on every result.

// ---------------------------------------------------------------------------
// Expected structure (from the design rule table, Req 10.1, 10.3)
// ---------------------------------------------------------------------------

// The nine derived components, keyed by their stable line-item id.
const REQUIRED_DERIVED_ITEM_IDS = [
  'frames-standards',
  'base-plates',
  'base-jacks',
  'ledgers-horizontals',
  'platforms-decks',
  'guardrails',
  'toe-boards',
  'diagonal-braces',
  'ladders-access',
] as const;

// The always-present wall ties/anchors item (Req 10.3).
const WALL_TIES_ID = 'wall-ties-anchors';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A count that spans the realistic engine output (positive integers) plus the
// edge/invalid values the rules must tolerate without throwing (Req 10.6).
const countArb: fc.Arbitrary<number> = fc.oneof(
  // Valid bays/levels as the scaffold calculator would produce them.
  fc.integer({ min: 1, max: 5000 }),
  // Edge: zero and negatives.
  fc.integer({ min: -100, max: 0 }),
  // Invalid: non-integers.
  fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  // Invalid: non-finite sentinels.
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

// Known system ids plus an unknown one (exercises the system-agnostic path and
// the unknown-system warning branch without affecting the required structure).
const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
  // Deliberately invalid id, cast to exercise the unknown-system branch.
  'unknown-system' as ScaffoldSystemId,
);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function expectWellFormedItem(item: MaterialItem): void {
  // Every item carries a non-empty name and unit (Req 10.2).
  expect(isNonEmptyString(item.itemName)).toBe(true);
  expect(isNonEmptyString(item.unit)).toBe(true);
  // Every quantity is a non-negative integer (Req 10.2).
  expect(isNonNegativeInteger(item.quantity)).toBe(true);
}

describe('buildMaterialList — Property 12: material list is structurally complete', () => {
  it('always emits every required line item incl. a wall-ties note, each well-formed', () => {
    fc.assert(
      fc.property(countArb, countArb, systemIdArb, (bays, levels, systemId) => {
        const { items } = buildMaterialList(bays, levels, systemId);

        const itemsById = new Map(items.map((item) => [item.id, item]));

        // (1) Each of the nine derived components is present (Req 10.1).
        for (const id of REQUIRED_DERIVED_ITEM_IDS) {
          expect(itemsById.has(id)).toBe(true);
        }

        // (2) The wall ties/anchors item is present and carries a non-empty
        // manual-verification note (Req 10.3).
        const wallTies = itemsById.get(WALL_TIES_ID);
        expect(wallTies).toBeDefined();
        expect(isNonEmptyString(wallTies?.notes)).toBe(true);

        // (3) Every item — derived and wall ties — is well formed: non-empty
        // name, non-empty unit, non-negative-integer quantity (Req 10.2, 10.6).
        for (const item of items) {
          expectWellFormedItem(item);
        }
      }),
      { numRuns: 200 },
    );
  });
});
