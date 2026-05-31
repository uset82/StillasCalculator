import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProjectStateController } from './projectStateController';
import { buildMaterialList } from '@/lib/scaffold/materialRules';
import type {
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from '@/lib/types';

// Feature: stillas-calculator, Property 17: New calculation replaces manual quantity adjustments
//
// Property 17 (design.md): For any prior set of manually adjusted quantities and
// for any new completed calculation, every displayed/stored quantity after the
// calculation equals the newly computed quantity rather than the prior manual
// value. In this controller, `applyCalculation(result)` snapshots
// `result.materialList` into `materialListAdjusted`, discarding whatever manual
// overrides `setMaterialQuantity` had written. So after a fresh calculation,
// `getState().materialListAdjusted` must equal the new output's material list
// exactly — never the previously edited values.
//
// **Validates: Requirements 11.7**

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** The five selectable scaffold systems (the rule table is system-agnostic). */
const SYSTEM_IDS = fc.constantFrom<ScaffoldSystemId>(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

/** Usable bay counts B >= 1 (the calculator always emits positive integers). */
const baysArb = fc.integer({ min: 1, max: 50 });

/** Usable level counts L >= 1. */
const levelsArb = fc.integer({ min: 1, max: 20 });

/**
 * Builds a realistic, completed calculation output from a bay/level count using
 * the same deterministic material rules the engine uses, so the test exercises
 * the genuine Material_List shape rather than a hand-rolled stub.
 */
function makeOutput(
  bays: number,
  levels: number,
  systemId: ScaffoldSystemId,
): ScaffoldCalculationOutput {
  const { items, warnings } = buildMaterialList(bays, levels, systemId);
  return {
    totalScaffoldLengthMeters: bays * 2.5,
    numberOfBays: bays,
    numberOfLevels: levels,
    materialList: items,
    warnings,
  };
}

// buildMaterialList always emits the same 10 line items (9 derived + wall ties),
// in a fixed order, so item ids and positions line up between calculations.
const ITEM_COUNT = buildMaterialList(1, 1, 'generic-frame').items.length;

/**
 * A non-empty set of manual adjustments keyed by item index (unique indices),
 * each an arbitrary valid quantity (integer 0..999999). "One or more" manual
 * edits per Property 17.
 */
const adjustmentsArb = fc.uniqueArray(
  fc.record({
    index: fc.integer({ min: 0, max: ITEM_COUNT - 1 }),
    qty: fc.integer({ min: 0, max: 999999 }),
  }),
  { minLength: 1, maxLength: ITEM_COUNT, selector: (a) => a.index },
);

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

describe('ProjectStateController — Property 17: new calculation replaces manual quantity adjustments', () => {
  it('after a new calculation every stored quantity equals the newly computed value, not the prior manual one', () => {
    fc.assert(
      fc.property(
        baysArb,
        levelsArb,
        baysArb,
        levelsArb,
        SYSTEM_IDS,
        adjustmentsArb,
        (initialBays, initialLevels, newBays, newLevels, systemId, adjustments) => {
          const controller = createProjectStateController();

          // (1) Apply an initial calculation; this seeds materialListAdjusted.
          const initial = makeOutput(initialBays, initialLevels, systemId);
          controller.applyCalculation(initial);

          const itemIds = initial.materialList.map((item) => item.id);

          // (2) Manually adjust one or more quantities to arbitrary valid values.
          const manualById = new Map<string, number>();
          for (const { index, qty } of adjustments) {
            const itemId = itemIds[index];
            const result = controller.setMaterialQuantity(itemId, qty);
            expect(result.ok, 'a valid manual adjustment must be accepted').toBe(
              true,
            );
            manualById.set(itemId, qty);
          }

          // Sanity: the manual edits really landed in state before recalculating.
          const adjustedBefore = controller.getState().materialListAdjusted!;
          for (const item of adjustedBefore) {
            if (manualById.has(item.id)) {
              expect(item.quantity).toBe(manualById.get(item.id));
            }
          }

          // (3) Apply a NEW calculation with (generally) different quantities.
          const next = makeOutput(newBays, newLevels, systemId);
          controller.applyCalculation(next);

          // (4) Every stored quantity equals the newly computed value.
          const storedAfter = controller.getState().materialListAdjusted!;
          expect(storedAfter).toEqual(next.materialList);

          for (let i = 0; i < storedAfter.length; i += 1) {
            const stored = storedAfter[i];
            const computed = next.materialList[i];
            expect(stored.id).toBe(computed.id);
            expect(stored.quantity).toBe(computed.quantity);

            // Where the manual value differed from the new computed value, the
            // stored value must be the computed one — proving the manual edit
            // was replaced rather than retained.
            const manual = manualById.get(stored.id);
            if (manual !== undefined && manual !== computed.quantity) {
              expect(stored.quantity).not.toBe(manual);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
