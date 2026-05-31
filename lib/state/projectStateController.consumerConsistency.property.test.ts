import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createProjectStateController,
  type ProjectStateController,
} from './projectStateController';
import type {
  AddressSelection,
  DimensionField,
  GeoJsonPolygon,
  MaterialItem,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from '../types';

// Feature: stillas-calculator, Property 32: Project_State consistency across consumers
//
// Property 32 (design.md): For any update applied to the Project_State, every
// consuming view selector (map, calculator, material list, AI assistant,
// export) returns values deeply-equal to the Project_State, including values
// that were changed through the AI Assistant.
//
// **Validates: Requirements 17.2, 17.3**
//
// The Project_State controller is the single source of truth (Req 17.1).
// `getState()` returns that source of truth; the five per-consumer selectors
// (`selectMap`, `selectCalculator`, `selectMaterialList`, `selectAi`,
// `selectExport`) each project a slice of it. This property generates a random
// sequence of *valid* updates — including a `setWorkingHeight`, which is the
// exact path the AI `updateWorkingHeight` tool uses (Req 17.3) — applies them
// to a fresh controller, and then asserts that every field returned by every
// selector is deeply-equal to the corresponding field of `getState()`. Whether
// each individual update is accepted or rejected, the selectors must always
// stay consistent with the single source of truth (Req 17.2, 17.3).

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A valid geocoded address: non-empty label, finite lat/lon within bounds.
const addressArb: fc.Arbitrary<AddressSelection> = fc.record({
  label: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0),
  lat: fc.double({ min: -89, max: 89, noNaN: true }),
  lon: fc.double({ min: -179, max: 179, noNaN: true }),
});

// A valid, simple (non-self-intersecting) closed perimeter polygon. We build a
// convex regular-ish polygon by placing N vertices in angular order around a
// center, which guarantees a closed ring of >=3 distinct vertices with no
// crossing sides (the conditions `isValidPerimeter` enforces).
const perimeterArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon0: fc.double({ min: -150, max: 150, noNaN: true }),
    lat0: fc.double({ min: -70, max: 70, noNaN: true }),
    radius: fc.double({ min: 0.0005, max: 0.01, noNaN: true }),
    sides: fc.integer({ min: 3, max: 8 }),
  })
  .map(({ lon0, lat0, radius, sides }) => {
    const ring: number[][] = [];
    for (let i = 0; i < sides; i += 1) {
      const theta = (2 * Math.PI * i) / sides;
      ring.push([lon0 + radius * Math.cos(theta), lat0 + radius * Math.sin(theta)]);
    }
    ring.push([...ring[0]]); // close the ring
    return { type: 'Polygon', coordinates: [ring] } as GeoJsonPolygon;
  });

const scaffoldSystemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

const dimensionFieldArb: fc.Arbitrary<DimensionField> = fc.constantFrom(
  'bayLengthMeters',
  'liftHeightMeters',
  'scaffoldWidthMeters',
);

// A small, shared pool of material ids so `applyCalculation` and
// `setMaterialQuantity` occasionally reference the same item.
const materialIdArb = fc.constantFrom('tube', 'board', 'coupler', 'baseplate');

const materialItemArb: fc.Arbitrary<MaterialItem> = fc.record({
  id: materialIdArb,
  itemName: fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => s.trim().length > 0),
  quantity: fc.integer({ min: 0, max: 9999 }),
  unit: fc.constantFrom('pcs', 'm', 'kg'),
});

const calculationArb: fc.Arbitrary<ScaffoldCalculationOutput> = fc.record({
  totalScaffoldLengthMeters: fc.double({ min: 0, max: 1000, noNaN: true }),
  numberOfBays: fc.integer({ min: 1, max: 500 }),
  numberOfLevels: fc.integer({ min: 1, max: 50 }),
  materialList: fc.uniqueArray(materialItemArb, {
    minLength: 1,
    maxLength: 4,
    selector: (item) => item.id,
  }),
  warnings: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
});

// A single valid update command against the controller. Each is independently
// valid; `setWorkingHeight` models the AI-originated change (Req 17.3).
type UpdateCommand =
  | { kind: 'setAddress'; address: AddressSelection }
  | { kind: 'setPerimeter'; polygon: GeoJsonPolygon }
  | { kind: 'setSelectedFacades'; sides: number[] | null }
  | { kind: 'setWasteFactor'; percent: number }
  | { kind: 'setDecimalPlaces'; places: number }
  | { kind: 'setWorkingHeight'; meters: number } // AI tool path (Req 17.3)
  | { kind: 'setScaffoldSystem'; systemId: ScaffoldSystemId }
  | { kind: 'setDimension'; field: DimensionField; value: number }
  | { kind: 'applyCalculation'; result: ScaffoldCalculationOutput }
  | { kind: 'setMaterialQuantity'; itemId: string; qty: number };

const commandArb: fc.Arbitrary<UpdateCommand> = fc.oneof(
  addressArb.map((address) => ({ kind: 'setAddress', address }) as const),
  perimeterArb.map((polygon) => ({ kind: 'setPerimeter', polygon }) as const),
  fc
    .option(fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 8 }), {
      nil: null,
    })
    .map((sides) => ({ kind: 'setSelectedFacades', sides }) as const),
  fc
    .double({ min: 0, max: 100, noNaN: true })
    .map((percent) => ({ kind: 'setWasteFactor', percent }) as const),
  fc
    .integer({ min: 0, max: 3 })
    .map((places) => ({ kind: 'setDecimalPlaces', places }) as const),
  // The AI Assistant's updateWorkingHeight tool routes through setWorkingHeight.
  fc
    .double({ min: 0.01, max: 100, noNaN: true })
    .map((meters) => ({ kind: 'setWorkingHeight', meters }) as const),
  scaffoldSystemIdArb.map(
    (systemId) => ({ kind: 'setScaffoldSystem', systemId }) as const,
  ),
  fc
    .record({ field: dimensionFieldArb, value: fc.double({ min: 0.01, max: 5, noNaN: true }) })
    .map(({ field, value }) => ({ kind: 'setDimension', field, value }) as const),
  calculationArb.map(
    (result) => ({ kind: 'applyCalculation', result }) as const,
  ),
  fc
    .record({ itemId: materialIdArb, qty: fc.integer({ min: 0, max: 999999 }) })
    .map(({ itemId, qty }) => ({ kind: 'setMaterialQuantity', itemId, qty }) as const),
);

// A sequence of updates that always contains at least one setWorkingHeight, so
// every generated case exercises an AI-originated change (Req 17.3).
const sequenceArb: fc.Arbitrary<UpdateCommand[]> = fc
  .record({
    before: fc.array(commandArb, { maxLength: 12 }),
    workingHeight: fc.double({ min: 0.01, max: 100, noNaN: true }),
    after: fc.array(commandArb, { maxLength: 12 }),
  })
  .map(({ before, workingHeight, after }) => [
    ...before,
    { kind: 'setWorkingHeight', meters: workingHeight } as UpdateCommand,
    ...after,
  ]);

function applyCommand(
  controller: ProjectStateController,
  command: UpdateCommand,
): void {
  switch (command.kind) {
    case 'setAddress':
      controller.setAddress(command.address);
      break;
    case 'setPerimeter':
      controller.setPerimeter(command.polygon);
      break;
    case 'setSelectedFacades':
      controller.setSelectedFacades(command.sides);
      break;
    case 'setWasteFactor':
      controller.setWasteFactor(command.percent);
      break;
    case 'setDecimalPlaces':
      controller.setDecimalPlaces(command.places);
      break;
    case 'setWorkingHeight':
      controller.setWorkingHeight(command.meters);
      break;
    case 'setScaffoldSystem':
      controller.setScaffoldSystem(command.systemId);
      break;
    case 'setDimension':
      controller.setDimension(command.field, command.value);
      break;
    case 'applyCalculation':
      controller.applyCalculation(command.result);
      break;
    case 'setMaterialQuantity':
      controller.setMaterialQuantity(command.itemId, command.qty);
      break;
    default: {
      // Exhaustiveness guard: a new command kind must be handled here.
      const _exhaustive: never = command;
      throw new Error(`Unhandled command: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Property 32
// ---------------------------------------------------------------------------

describe('projectStateController — Property 32: Project_State consistency across consumers', () => {
  it('every consumer selector returns values deeply-equal to Project_State, including AI-originated changes', () => {
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const controller = createProjectStateController();
        for (const command of commands) {
          applyCommand(controller, command);
        }

        // getState() is the single source of truth (Req 17.1).
        const state = controller.getState();

        // selectMap projection (Req 17.2).
        const map = controller.selectMap();
        expect(map.address).toStrictEqual(state.address);
        expect(map.perimeterPolygon).toStrictEqual(state.perimeterPolygon);
        expect(map.measurements).toStrictEqual(state.measurements);
        expect(map.selectedFacadeSideIndices).toStrictEqual(
          state.selectedFacadeSideIndices,
        );
        expect(map.scaffoldLengthMeters).toStrictEqual(state.scaffoldLengthMeters);

        // selectCalculator projection (Req 17.2, 17.3 — workingHeightMeters).
        const calculator = controller.selectCalculator();
        expect(calculator.scaffoldLengthMeters).toStrictEqual(
          state.scaffoldLengthMeters,
        );
        expect(calculator.workingHeightMeters).toStrictEqual(
          state.workingHeightMeters,
        );
        expect(calculator.bayLengthMeters).toStrictEqual(state.bayLengthMeters);
        expect(calculator.liftHeightMeters).toStrictEqual(state.liftHeightMeters);
        expect(calculator.scaffoldWidthMeters).toStrictEqual(
          state.scaffoldWidthMeters,
        );
        expect(calculator.scaffoldSystemId).toStrictEqual(state.scaffoldSystemId);
        expect(calculator.wasteFactorPercent).toStrictEqual(
          state.wasteFactorPercent,
        );
        expect(calculator.decimalPlaces).toStrictEqual(state.decimalPlaces);

        // selectMaterialList projection (Req 17.2).
        const materialList = controller.selectMaterialList();
        expect(materialList.calculation).toStrictEqual(state.calculation);
        expect(materialList.materialListAdjusted).toStrictEqual(
          state.materialListAdjusted,
        );
        expect(materialList.scaffoldLengthMeters).toStrictEqual(
          state.scaffoldLengthMeters,
        );
        expect(materialList.decimalPlaces).toStrictEqual(state.decimalPlaces);

        // selectAi projection (Req 17.2, 17.3 — the AI sees its own change).
        const ai = controller.selectAi();
        expect(ai.aiMessages).toStrictEqual(state.aiMessages);
        expect(ai.aiSummary).toStrictEqual(state.aiSummary);
        expect(ai.measurements).toStrictEqual(state.measurements);
        expect(ai.scaffoldLengthMeters).toStrictEqual(state.scaffoldLengthMeters);
        expect(ai.scaffoldSystemId).toStrictEqual(state.scaffoldSystemId);
        expect(ai.workingHeightMeters).toStrictEqual(state.workingHeightMeters);

        // selectExport projection (Req 17.2). perimeterMeters is derived from
        // the valid measurements, so it must match that derivation exactly.
        const exportSel = controller.selectExport();
        const expectedPerimeterMeters =
          state.measurements && state.measurements.valid
            ? state.measurements.perimeterMeters
            : null;
        expect(exportSel.address).toStrictEqual(state.address);
        expect(exportSel.perimeterMeters).toStrictEqual(expectedPerimeterMeters);
        expect(exportSel.scaffoldSystemId).toStrictEqual(state.scaffoldSystemId);
        expect(exportSel.calculation).toStrictEqual(state.calculation);
        expect(exportSel.materialListAdjusted).toStrictEqual(
          state.materialListAdjusted,
        );
        expect(exportSel.aiSummary).toStrictEqual(state.aiSummary);
      }),
      { numRuns: 200 },
    );
  });
});
