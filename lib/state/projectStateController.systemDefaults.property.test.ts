// Feature: stillas-calculator, Property 15: Selecting a system loads its defaults
//
// Property 15 (design.md): For any scaffold system in the library, selecting it
// loads that system's default Bay_Length, Scaffold_Width, and Lift_Height into
// the Project_State.
//
// **Validates: Requirements 7.2**
//
// The unit under test is `ProjectStateController.setScaffoldSystem(systemId)`
// (lib/state/projectStateController.ts), which looks the system up in the
// Scaffold_Library (lib/scaffold/scaffoldSystems.ts) and copies its three
// default dimensions into `Project_State`. We draw a system id from the five
// library systems, apply it to a fresh controller, and assert the stored
// `scaffoldSystemId` plus the three dimension fields equal that system's
// declared defaults. A fresh `createProjectStateController()` per case keeps
// the property free of cross-case state.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createProjectStateController } from './projectStateController';
import {
  SCAFFOLD_SYSTEMS,
  getScaffoldSystem,
} from '@/lib/scaffold/scaffoldSystems';
import type { ScaffoldSystemId } from '@/lib/types';

// ---------------------------------------------------------------------------
// Generator — a system id drawn from the five library systems
// ---------------------------------------------------------------------------

// Derive the ids from the library itself so the generator stays aligned with
// the data even if the (exactly five) systems change.
const systemIdArb: fc.Arbitrary<ScaffoldSystemId> = fc.constantFrom(
  ...SCAFFOLD_SYSTEMS.map((system) => system.id),
);

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

describe('Property 15: selecting a system loads its defaults (Req 7.2)', () => {
  it('loads the selected system id and its default bay/width/lift into Project_State', () => {
    fc.assert(
      fc.property(systemIdArb, (systemId) => {
        const controller = createProjectStateController();

        const result = controller.setScaffoldSystem(systemId);
        expect(result.ok).toBe(true);

        const system = getScaffoldSystem(systemId);
        // The id came from the library, so the lookup must succeed.
        expect(system).toBeDefined();
        if (!system) return;

        const state = controller.getState();
        expect(state.scaffoldSystemId).toBe(systemId);
        expect(state.bayLengthMeters).toBe(system.defaultBayLengthMeters);
        expect(state.scaffoldWidthMeters).toBe(
          system.defaultScaffoldWidthMeters,
        );
        expect(state.liftHeightMeters).toBe(system.defaultLiftHeightMeters);
      }),
      { numRuns: 100 },
    );
  });

  // Concrete example pinning Property 15 on a representative system.
  it('loads Generic Frame defaults on a fresh controller', () => {
    const controller = createProjectStateController();
    controller.setScaffoldSystem('generic-frame');

    const system = getScaffoldSystem('generic-frame');
    expect(system).toBeDefined();
    if (!system) return;

    const state = controller.getState();
    expect(state.scaffoldSystemId).toBe('generic-frame');
    expect(state.bayLengthMeters).toBe(system.defaultBayLengthMeters);
    expect(state.scaffoldWidthMeters).toBe(system.defaultScaffoldWidthMeters);
    expect(state.liftHeightMeters).toBe(system.defaultLiftHeightMeters);
  });
});
