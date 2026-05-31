// Unit/integration tests for AI tool-dispatch behavior branches (task 9.7).
//
// These tests exercise `createToolDispatch` (lib/ai/tools.ts) at the trust-
// boundary branches the design relies on, using a STUB ToolContext so no real
// Project_State controller and no network are involved:
//
//   * A tool given missing/invalid data returns { ok:false, error } whose
//     message IDENTIFIES the specific missing value and never fabricates or
//     substitutes one (Req 13.5). Covered for:
//       - calculateScaffoldMaterials with a missing required input,
//       - generateMaterialList with missing engine-computed bays/levels,
//       - getSelectedBuildingMeasurements with no valid measurements,
//       - updateWorkingHeight with a non-numeric height.
//   * updateWorkingHeight with an out-of-range value returns { ok:false } and
//     the injected ToolContext.setWorkingHeight rejection means the existing
//     Project_State is preserved — the validated-updater path the AI tool call
//     flows through (Req 12.4, 12.5). The success path returns ok:true and the
//     value the controller accepted.
//
// Requirements: 12.4, 13.5

import { describe, it, expect } from 'vitest';

import {
  createToolDispatch,
  type PlanToolContext,
  type ToolResult,
} from './toolExecutor';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type {
  GeoJsonPolygon,
  ProjectState,
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
  ScaffoldSystemId,
  UpdateResult,
  ValidationError,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Stub ProjectState + ToolContext
// ---------------------------------------------------------------------------

/** A minimal, empty Project_State snapshot (no measurements, no calculation). */
function emptyProjectState(): ProjectState {
  return {
    address: null,
    perimeterPolygon: null,
    measurements: null,
    selectedFacadeSideIndices: null,
    scaffoldLengthMeters: null,
    decimalPlaces: 2,
    wasteFactorPercent: 0,
    scaffoldSystemId: null,
    bayLengthMeters: null,
    liftHeightMeters: null,
    scaffoldWidthMeters: null,
    workingHeightMeters: null,
    calculation: null,
    materialListAdjusted: null,
    aiMessages: [],
    aiSummary: null,
  };
}

/**
 * Builds a stub ToolContext around a mutable Project_State whose
 * `setWorkingHeight` enforces the documented 0.01..100 range (Req 8.1, 12.5).
 * Valid values are committed to the snapshot; out-of-range values are rejected
 * and the snapshot is left untouched, mirroring the real validated updater so
 * the test can assert state preservation (Req 12.4).
 *
 * `getState` exposes the live snapshot so a test can confirm nothing changed
 * after a rejected update.
 */
function makeStubContext(initial?: Partial<ProjectState>): {
  context: PlanToolContext;
  getState: () => ScaffoldPlan;
  setWorkingHeightCalls: number[];
} {
  let state: ScaffoldPlan = createScaffoldPlan(initial);
  const setWorkingHeightCalls: number[] = [];

  const context: PlanToolContext = {
    getScaffoldPlan: () => state,
    setWorkingHeight: (heightMeters: number): UpdateResult => {
      setWorkingHeightCalls.push(heightMeters);
      const inRange =
        Number.isFinite(heightMeters) && heightMeters >= 0.01 && heightMeters <= 100;
      if (!inRange) {
        const error: ValidationError = {
          field: 'workingHeightMeters',
          message: 'Working height must be between 0.01 and 100 meters.',
          permittedRange: '0.01 to 100',
        };
        return { ok: false, error };
      }
      state = { ...state, workingHeightMeters: heightMeters };
      return { ok: true };
    },
    setPerimeter: () => ({ ok: true }),
    setSelectedFacades: () => ({ ok: true }),
    setScaffoldSystem: () => ({ ok: true }),
    setDimension: () => ({ ok: true }),
    applyCalculation: (result: ScaffoldCalculationOutput) => {
      state = {
        ...state,
        calculation: result,
        materialListAdjusted: result.materialList.map((item) => ({ ...item })),
      };
    },
    setDrawingOverlay: () => {},
    clearDrawingOverlay: () => {},
    setCadModel: () => {},
    addCadExport: () => {},
  };

  return { context, getState: () => state, setWorkingHeightCalls };
}

// ---------------------------------------------------------------------------
// Missing / invalid data is reported without fabrication (Req 13.5)
// ---------------------------------------------------------------------------

describe('createToolDispatch: missing/invalid data is identified without fabrication (Req 13.5)', () => {
  it('calculateScaffoldMaterials returns ok:false identifying the missing required value', () => {
    const { context } = makeStubContext();
    const dispatch = createToolDispatch(context);

    // workingHeightMeters omitted on purpose; the others are valid.
    const args = {
      scaffoldLengthMeters: 40,
      bayLengthMeters: 3,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 1,
      scaffoldSystemId: 'generic-frame',
    } as unknown as ScaffoldCalculationInput;

    const result: ToolResult = dispatch.calculateScaffoldMaterials(args);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The error identifies the specific missing value (Req 13.5) — no figure
    // is invented in its place.
    expect(result.error.toLowerCase()).toContain('working height');
    expect(result.error.toLowerCase()).toContain('missing');
  });

  it('generateMaterialList returns ok:false when engine-computed bays/levels are missing', () => {
    const { context } = makeStubContext();
    const dispatch = createToolDispatch(context);

    // numberOfLevels omitted: the tool must refuse rather than guess a count.
    const result = dispatch.generateMaterialList({
      numberOfBays: 5,
      scaffoldSystemId: 'generic-frame',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('numberofbays and numberoflevels');
  });

  it('getSelectedBuildingMeasurements returns ok:false when no valid measurements exist', () => {
    const { context } = makeStubContext(); // measurements: null
    const dispatch = createToolDispatch(context);

    const result = dispatch.getSelectedBuildingMeasurements({ projectId: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The tool asks the user to provide the perimeter rather than inventing one.
    expect(result.error.toLowerCase()).toContain('perimeter');
  });

  it('updateWorkingHeight returns ok:false when no numeric height is supplied', () => {
    const { context, setWorkingHeightCalls } = makeStubContext();
    const dispatch = createToolDispatch(context);

    const result = dispatch.updateWorkingHeight({ heightMeters: 'tall' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('numeric working height');
    // A non-numeric argument never reaches the state updater (no fabrication).
    expect(setWorkingHeightCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateWorkingHeight routes through the validated updater (Req 12.4, 12.5)
// ---------------------------------------------------------------------------

describe('createToolDispatch: updateWorkingHeight uses the validated ToolContext updater (Req 12.4, 12.5)', () => {
  it('rejects an out-of-range value and preserves the existing Project_State', () => {
    const { context, getState, setWorkingHeightCalls } = makeStubContext({
      workingHeightMeters: 12, // an existing, valid value
    });
    const dispatch = createToolDispatch(context);

    const result = dispatch.updateWorkingHeight({ heightMeters: 250 }); // > 100

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The rejection reason is surfaced (so the assistant can re-ask) ...
    expect(result.error.toLowerCase()).toContain('working height');
    // ... the value was routed through the validated updater ...
    expect(setWorkingHeightCalls).toEqual([250]);
    // ... and the existing Project_State value is preserved (Req 12.5).
    expect(getState().workingHeightMeters).toBe(12);
  });

  it('accepts an in-range value and commits it through the updater (12.4 path)', () => {
    const { context, getState, setWorkingHeightCalls } = makeStubContext({
      workingHeightMeters: 12,
    });
    const dispatch = createToolDispatch(context);

    const result = dispatch.updateWorkingHeight({ heightMeters: 18.5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ workingHeightMeters: 18.5 });
    expect(setWorkingHeightCalls).toEqual([18.5]);
    // The tool-call updated the corresponding Project_State value (Req 12.4).
    expect(getState().workingHeightMeters).toBe(18.5);
  });
});
