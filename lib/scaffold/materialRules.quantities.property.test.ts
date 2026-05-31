import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildMaterialList } from './materialRules';
import type { MaterialItem } from '@/lib/types';

// Feature: stillas-calculator, Property 13: Material quantities follow the deterministic rules
//
// Property 13 (design.md): For any number of bays B and levels L (with
// V = B + 1), each Material_List quantity equals its rule evaluated at (B, L):
//   frames/standards    = V * L
//   base plates         = V
//   adjustable base jacks = V
//   ledgers/horizontals = B * L * 2
//   platforms/decks     = B * L
//   guardrails          = B * L * 2
//   toe boards          = B * L
//   diagonal braces     = V * L
//   ladders/access      = L
//   wall ties/anchors   = 0
//
// **Validates: Requirements 10.4**
//
// `buildMaterialList(bays, levels, systemId)` is the implementation under test.
// Item ids are stable strings; this test looks each item up by id and asserts
// its quantity equals the deterministic rule evaluated at (B, L, V).

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Positive-integer counts: the scaffold calculator always produces bays >= 1
// and levels >= 1 (Req 9.2, 9.4). The upper bound keeps the products well
// within safe-integer range while exercising many input combinations.
const countArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 1000 });

// A valid scaffold system id. The rule table is system-agnostic, but a known
// system avoids the unknown-system warning path so we exercise the pure rules.
const SYSTEM_ID = 'generic-frame' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quantityById(items: MaterialItem[], id: string): number {
  const item = items.find((entry) => entry.id === id);
  expect(item, `expected a material item with id "${id}"`).toBeDefined();
  return item!.quantity;
}

describe('buildMaterialList — Property 13: material quantities follow the deterministic rules', () => {
  it('derives every quantity from its rule evaluated at (B, L, V = B + 1)', () => {
    fc.assert(
      fc.property(countArb, countArb, (bays, levels) => {
        const B = bays;
        const L = levels;
        const V = B + 1;

        const { items } = buildMaterialList(B, L, SYSTEM_ID);

        expect(quantityById(items, 'frames-standards')).toBe(V * L);
        expect(quantityById(items, 'base-plates')).toBe(V);
        expect(quantityById(items, 'base-jacks')).toBe(V);
        expect(quantityById(items, 'ledgers-horizontals')).toBe(B * L * 2);
        expect(quantityById(items, 'platforms-decks')).toBe(B * L);
        expect(quantityById(items, 'guardrails')).toBe(B * L * 2);
        expect(quantityById(items, 'toe-boards')).toBe(B * L);
        expect(quantityById(items, 'diagonal-braces')).toBe(V * L);
        expect(quantityById(items, 'ladders-access')).toBe(L);
        expect(quantityById(items, 'wall-ties-anchors')).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
