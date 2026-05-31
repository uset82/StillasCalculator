import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProjectStateController } from './projectStateController';
import { buildMaterialList } from '@/lib/scaffold/materialRules';
import type { ScaffoldCalculationOutput } from '@/lib/types';

// Feature: stillas-calculator, Property 18: Valid manual quantity adjustment persists
//
// Property 18 (design.md): For any Material_List item and any integer quantity
// within 0 to 999999, applying the adjustment results in that exact value being
// retained in the Project_State and used for display and export.
//
// Whereas Property 14 exercises the full accept/reject biconditional, this
// property focuses solely on the *persistence* of a *valid* adjustment: once a
// valid integer quantity is applied to an existing item, that exact integer is
// what every downstream view observes — the live Project_State
// (`getState().materialListAdjusted`), the material-list display projection
// (`selectMaterialList().materialListAdjusted`), and the export projection
// (`selectExport().materialListAdjusted`).
//
// **Validates: Requirements 11.4**

// A representative computed calculation used to seed the adjusted Material_List
// before each manual edit. `buildMaterialList` yields the full ten-item list
// (the nine derived components plus wall ties/anchors), giving us a stable,
// real set of item ids to adjust.
const SEED_OUTPUT: ScaffoldCalculationOutput = {
  totalScaffoldLengthMeters: 12,
  numberOfBays: 3,
  numberOfLevels: 2,
  materialList: buildMaterialList(3, 2, 'generic-frame').items,
  warnings: [],
};
const SEED_ITEM_IDS: string[] = SEED_OUTPUT.materialList.map((item) => item.id);

// Any integer quantity in the valid inclusive range 0..999999, biased to hit
// the boundaries as well as interior values.
const validQuantity: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: 999999 }),
  fc.constantFrom(0, 1, 999999),
);

describe('ProjectStateController — Property 18: valid manual quantity adjustment persists', () => {
  it('retains an applied valid integer quantity exactly for state, display, and export', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SEED_ITEM_IDS.length - 1 }),
        validQuantity,
        (itemIndex, qty) => {
          // Fresh controller per case; seed the adjusted Material_List.
          const controller = createProjectStateController();
          controller.applyCalculation(SEED_OUTPUT);

          const itemId = SEED_ITEM_IDS[itemIndex];
          const result = controller.setMaterialQuantity(itemId, qty);

          // The valid adjustment is accepted.
          expect(result.ok).toBe(true);

          // Retained exactly in the live Project_State.
          const stateItems = controller.getState().materialListAdjusted;
          expect(stateItems).not.toBeNull();
          const fromState = stateItems!.find((item) => item.id === itemId);
          expect(fromState?.quantity).toBe(qty);

          // Retained exactly in the material-list display projection (Req 11.4).
          const displayItems =
            controller.selectMaterialList().materialListAdjusted;
          const fromDisplay = displayItems!.find((item) => item.id === itemId);
          expect(fromDisplay?.quantity).toBe(qty);

          // Retained exactly in the export projection (Req 11.4).
          const exportItems = controller.selectExport().materialListAdjusted;
          const fromExport = exportItems!.find((item) => item.id === itemId);
          expect(fromExport?.quantity).toBe(qty);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('persists the last value across successive valid adjustments to the same item', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SEED_ITEM_IDS.length - 1 }),
        fc.array(validQuantity, { minLength: 1, maxLength: 10 }),
        (itemIndex, quantities) => {
          const controller = createProjectStateController();
          controller.applyCalculation(SEED_OUTPUT);
          const itemId = SEED_ITEM_IDS[itemIndex];

          for (const qty of quantities) {
            expect(controller.setMaterialQuantity(itemId, qty).ok).toBe(true);
          }

          // The most recently applied valid quantity is the retained value, and
          // all three views agree on it.
          const last = quantities[quantities.length - 1];
          const fromState = controller
            .getState()
            .materialListAdjusted!.find((item) => item.id === itemId);
          const fromDisplay = controller
            .selectMaterialList()
            .materialListAdjusted!.find((item) => item.id === itemId);
          const fromExport = controller
            .selectExport()
            .materialListAdjusted!.find((item) => item.id === itemId);

          expect(fromState?.quantity).toBe(last);
          expect(fromDisplay?.quantity).toBe(last);
          expect(fromExport?.quantity).toBe(last);
        },
      ),
      { numRuns: 200 },
    );
  });
});
