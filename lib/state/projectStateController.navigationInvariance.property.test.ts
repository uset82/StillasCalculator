import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createProjectStateController,
  type ProjectStateController,
} from './projectStateController';
import type {
  AddressSelection,
  GeoJsonPolygon,
  ScaffoldCalculationOutput,
  ScaffoldSystemId,
} from '@/lib/types';

// Feature: stillas-calculator, Property 33: State is invariant under navigation
//
// Property 33 (design.md): For any Project_State and for any sequence of
// navigations between the map, calculator, and assistant views, the
// Project_State values are unchanged afterward.
//
// **Validates: Requirements 17.4**
//
// In this architecture every view reads its slice of Project_State through a
// read-only selector on the controller (selectMap, selectCalculator,
// selectMaterialList, selectAi, selectExport). Reading a selector models
// "navigating to" that view: the act of viewing must NEVER mutate the shared
// Project_State. We therefore:
//   1. seed a fresh controller with some valid state (address, scaffold system,
//      a perimeter, and a completed calculation);
//   2. snapshot getState() via structuredClone (a deep, detached copy);
//   3. apply an arbitrary random sequence of selector reads drawn from the five
//      selectors (modeling arbitrary navigation between views); and
//   4. assert getState() still deeply equals the pre-navigation snapshot.

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A valid geocoded address: non-empty label, in-range finite coordinates.
const addressArb: fc.Arbitrary<AddressSelection> = fc.record({
  label: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

// The five selectable scaffold systems (Req 7.1).
const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
);

// A small closed, non-self-intersecting square ring near an arbitrary origin.
// Kept inside valid coordinate bounds so setPerimeter accepts it and stores
// measurements + Scaffold_Length, giving the snapshot non-trivial geometry.
const perimeterArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon: fc.double({ min: -179, max: 179, noNaN: true }),
    lat: fc.double({ min: -89, max: 89, noNaN: true }),
    size: fc.double({ min: 0.0005, max: 0.005, noNaN: true }),
  })
  .map(({ lon, lat, size }) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  }));

// A completed calculation output with a small Material_List. The exact numbers
// are irrelevant to navigation invariance; we only need a structurally valid
// result so applyCalculation populates calculation + materialListAdjusted.
const calculationArb: fc.Arbitrary<ScaffoldCalculationOutput> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
    minLength: 1,
    maxLength: 5,
  })
  .chain((ids) =>
    fc.record({
      totalScaffoldLengthMeters: fc.double({ min: 0, max: 500, noNaN: true }),
      numberOfBays: fc.integer({ min: 1, max: 100 }),
      numberOfLevels: fc.integer({ min: 1, max: 50 }),
      warnings: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
      materialList: fc.tuple(
        ...ids.map((id) =>
          fc.record({
            id: fc.constant(id),
            itemName: fc
              .string({ minLength: 1, maxLength: 12 })
              .filter((s) => s.trim().length > 0),
            quantity: fc.integer({ min: 0, max: 9999 }),
            unit: fc
              .string({ minLength: 1, maxLength: 4 })
              .filter((s) => s.trim().length > 0),
          }),
        ),
      ),
    }),
  );

// One of the five read-only view selectors. The number is its arity for the
// navigation sequence; the label aids debugging counterexamples.
type SelectorName =
  | 'map'
  | 'calculator'
  | 'materialList'
  | 'ai'
  | 'export';

const navSequenceArb: fc.Arbitrary<SelectorName[]> = fc.array(
  fc.constantFrom<SelectorName>(
    'map',
    'calculator',
    'materialList',
    'ai',
    'export',
  ),
  { minLength: 1, maxLength: 40 },
);

function readSelector(
  controller: ProjectStateController,
  name: SelectorName,
): unknown {
  switch (name) {
    case 'map':
      return controller.selectMap();
    case 'calculator':
      return controller.selectCalculator();
    case 'materialList':
      return controller.selectMaterialList();
    case 'ai':
      return controller.selectAi();
    case 'export':
      return controller.selectExport();
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('projectStateController — Property 33: state invariant under navigation', () => {
  it('leaves Project_State unchanged after any sequence of view navigations', () => {
    fc.assert(
      fc.property(
        addressArb,
        systemIdArb,
        perimeterArb,
        calculationArb,
        navSequenceArb,
        (address, systemId, perimeter, calculation, navSequence) => {
          // (1) Seed a fresh controller with some valid state.
          const controller = createProjectStateController();
          controller.setAddress(address);
          controller.setScaffoldSystem(systemId);
          // setPerimeter validates the ring; the generated square is always
          // valid, but guard so a rejected ring never invalidates the test.
          controller.setPerimeter(perimeter);
          controller.applyCalculation(calculation);

          // (2) Snapshot the post-seed Project_State as a detached deep copy.
          const snapshot = structuredClone(controller.getState());

          // (3) Apply an arbitrary navigation sequence (selector reads only).
          for (const name of navSequence) {
            readSelector(controller, name);
          }

          // (4) Project_State is unchanged afterward (Req 17.4): the live state
          //     still deeply equals the pre-navigation snapshot.
          expect(controller.getState()).toStrictEqual(snapshot);
        },
      ),
      { numRuns: 200 },
    );
  });
});
