// Material rules: the deterministic mapping from a computed scaffold geometry
// (number of bays and levels) to an estimated Material_List (Req 10).
//
// `buildMaterialList` is a pure function of the number of bays B, the number of
// levels L, and the derived number of vertical lines V = B + 1. Every quantity
// is a non-negative integer derived from the design's quote-grade rule table
// (Req 10.4); these are planning estimates, not an engineering sign-off.
//
// The output always contains all ten line items, regardless of input validity
// (Req 10.1, 10.6): the nine derived components plus a wall ties/anchors item
// that always carries quantity 0 and a "verify manually" note (Req 10.3).
// When a quantity rule lacks a usable input, the affected item is still present
// with a derivable quantity (or 0) and a warning identifying the item and the
// missing/invalid input is added (Req 10.5).

import type { MaterialItem, ScaffoldSystemId } from '@/lib/types';
import { getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';

/** Every estimated material is counted in whole pieces (Req 10.2). */
const UNIT = 'pcs';

/** Note attached to the always-present wall ties/anchors item (Req 10.3). */
const WALL_TIES_NOTE = 'Verify manually';

/** Stable id of the wall ties/anchors line item (Req 10.3). */
const WALL_TIES_ID = 'wall-ties-anchors';

/** The count inputs a material rule can depend on. */
type RuleInput = 'bays' | 'levels';

/**
 * A single deterministic material rule (Req 10.4). `dependsOn` lists the count
 * inputs the rule needs; `quantity` is evaluated only when every dependency is
 * a valid count, and receives the bays B, levels L, and vertical lines
 * V = B + 1.
 */
interface MaterialRule {
  id: string;
  itemName: string;
  dependsOn: RuleInput[];
  quantity: (bays: number, levels: number, verticals: number) => number;
}

/**
 * The nine derived material rules in display order, exactly matching the design
 * rule table (Req 10.1, 10.4). V = B + 1 vertical lines.
 *
 * | Component             | Rule    |
 * | --------------------- | ------- |
 * | Frames / standards    | V * L   |
 * | Base plates           | V       |
 * | Adjustable base jacks | V       |
 * | Ledgers / horizontals | B * L*2 |
 * | Platforms / decks     | B * L   |
 * | Guardrails            | B * L*2 |
 * | Toe boards            | B * L   |
 * | Diagonal braces       | V * L   |
 * | Ladders / access      | L       |
 */
const MATERIAL_RULES: readonly MaterialRule[] = [
  {
    id: 'frames-standards',
    itemName: 'Frames / standards',
    dependsOn: ['bays', 'levels'],
    quantity: (_bays, levels, verticals) => verticals * levels,
  },
  {
    id: 'base-plates',
    itemName: 'Base plates',
    dependsOn: ['bays'],
    quantity: (_bays, _levels, verticals) => verticals,
  },
  {
    id: 'base-jacks',
    itemName: 'Adjustable base jacks',
    dependsOn: ['bays'],
    quantity: (_bays, _levels, verticals) => verticals,
  },
  {
    id: 'ledgers-horizontals',
    itemName: 'Ledgers / horizontals',
    dependsOn: ['bays', 'levels'],
    quantity: (bays, levels) => bays * levels * 2,
  },
  {
    id: 'platforms-decks',
    itemName: 'Platforms / decks',
    dependsOn: ['bays', 'levels'],
    quantity: (bays, levels) => bays * levels,
  },
  {
    id: 'guardrails',
    itemName: 'Guardrails',
    dependsOn: ['bays', 'levels'],
    quantity: (bays, levels) => bays * levels * 2,
  },
  {
    id: 'toe-boards',
    itemName: 'Toe boards',
    dependsOn: ['bays', 'levels'],
    quantity: (bays, levels) => bays * levels,
  },
  {
    id: 'diagonal-braces',
    itemName: 'Diagonal braces',
    dependsOn: ['bays', 'levels'],
    quantity: (_bays, levels, verticals) => verticals * levels,
  },
  {
    id: 'ladders-access',
    itemName: 'Ladders / access',
    dependsOn: ['levels'],
    quantity: (_bays, levels) => levels,
  },
];

/**
 * A usable count input is a finite, whole number that is at least 1. The
 * scaffold calculator always produces positive-integer bays and levels
 * (Req 9.2, 9.4), so any other value (NaN, non-integer, zero, or negative)
 * indicates a missing or invalid input for the rules that depend on it.
 */
function isUsableCount(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

/** Human-readable label for a rule input, used in warning messages. */
function inputLabel(input: RuleInput): string {
  return input === 'bays' ? 'number of bays' : 'number of levels';
}

/**
 * Derives the estimated Material_List from the computed bays and levels using
 * the deterministic rule table (Req 10.4).
 *
 * The result always contains every line item (Req 10.1, 10.6): the nine derived
 * components followed by the wall ties/anchors item, which always carries
 * quantity 0 and the manual-verification note (Req 10.3). Each item has a
 * non-empty name, a non-empty `pcs` unit, and a non-negative integer quantity
 * (Req 10.2).
 *
 * When a rule's required count input (bays or levels) is missing or invalid,
 * that item is still emitted with quantity 0 and a warning identifying the item
 * and the offending input is added (Req 10.5).
 *
 * The rule table is currently identical for every scaffold system, so
 * `systemId` does not change any quantity; it is validated so an unknown system
 * surfaces a warning rather than silently producing a list.
 *
 * @param bays The number of scaffold bays B (expected positive integer).
 * @param levels The number of scaffold levels L (expected positive integer).
 * @param systemId The selected scaffold system (used for validation only).
 */
export function buildMaterialList(
  bays: number,
  levels: number,
  systemId: ScaffoldSystemId
): { items: MaterialItem[]; warnings: string[] } {
  const warnings: string[] = [];

  const baysUsable = isUsableCount(bays);
  const levelsUsable = isUsableCount(levels);

  // Normalize to safe integers for the derived quantities. Unusable inputs
  // collapse to 0 so dependent items default to 0 (Req 10.5, 10.6).
  const B = baysUsable ? bays : 0;
  const L = levelsUsable ? levels : 0;
  const V = baysUsable ? B + 1 : 0;

  const isUsable: Record<RuleInput, boolean> = {
    bays: baysUsable,
    levels: levelsUsable,
  };

  const items: MaterialItem[] = MATERIAL_RULES.map((rule) => {
    const missing = rule.dependsOn.filter((input) => !isUsable[input]);

    if (missing.length > 0) {
      // A required input is missing or invalid: keep the item but default its
      // quantity to 0 and report which input prevented derivation (Req 10.5).
      warnings.push(
        `${rule.itemName}: quantity could not be derived because the ` +
          `${missing.map(inputLabel).join(' and ')} ` +
          `${missing.length > 1 ? 'are' : 'is'} missing or invalid; ` +
          `defaulted to 0.`
      );
      return { id: rule.id, itemName: rule.itemName, quantity: 0, unit: UNIT };
    }

    return {
      id: rule.id,
      itemName: rule.itemName,
      quantity: rule.quantity(B, L, V),
      unit: UNIT,
    };
  });

  // The wall ties/anchors item is always present with quantity 0 and the
  // manual-verification note (Req 10.3).
  items.push({
    id: WALL_TIES_ID,
    itemName: 'Wall ties / anchors',
    quantity: 0,
    unit: UNIT,
    notes: WALL_TIES_NOTE,
  });

  // The rule table is system-agnostic today, but an unknown system id is still
  // an invalid input worth surfacing (Req 10.5).
  if (getScaffoldSystem(systemId) === undefined) {
    warnings.push(
      `Unknown scaffold system "${systemId}": material quantities were derived ` +
        `using the standard rule table.`
    );
  }

  return { items, warnings };
}
