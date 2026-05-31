import type {
  ProjectState,
  ScaffoldPlan,
  ScaffoldPlanCad,
  ScaffoldPlanDrawing,
} from '@/lib/types';

export const SCAFFOLD_PLAN_VERSION = 1;

export function createEmptyDrawing(): ScaffoldPlanDrawing {
  return {
    overlayGeoJson: null,
    lastGeneratedAt: null,
  };
}

export function createEmptyCad(): ScaffoldPlanCad {
  return {
    openScadSource: null,
    parameters: {},
    exports: [],
    lastGeneratedAt: null,
  };
}

/** Builds a fresh ScaffoldPlan from a partial plan. */
export function createScaffoldPlan(core: Partial<ScaffoldPlan> = {}): ScaffoldPlan {
  return {
    address: core.address ?? null,
    perimeterPolygon: core.perimeterPolygon ?? null,
    measurements: core.measurements ?? null,
    selectedFacadeSideIndices: core.selectedFacadeSideIndices ?? null,
    scaffoldLengthMeters: core.scaffoldLengthMeters ?? null,
    decimalPlaces: core.decimalPlaces ?? 2,
    wasteFactorPercent: core.wasteFactorPercent ?? 0,
    scaffoldSystemId: core.scaffoldSystemId ?? null,
    bayLengthMeters: core.bayLengthMeters ?? null,
    liftHeightMeters: core.liftHeightMeters ?? null,
    scaffoldWidthMeters: core.scaffoldWidthMeters ?? null,
    workingHeightMeters: core.workingHeightMeters ?? null,
    calculation: core.calculation ?? null,
    materialListAdjusted: core.materialListAdjusted ?? null,
    aiMessages: core.aiMessages ?? [],
    aiSummary: core.aiSummary ?? null,
    version: core.version ?? SCAFFOLD_PLAN_VERSION,
    drawing: core.drawing ?? createEmptyDrawing(),
    cad: core.cad ?? createEmptyCad(),
  };
}

/** Strips drawing/cad/version for consumers that only need ProjectState. */
export function toProjectState(plan: ScaffoldPlan): ProjectState {
  const {
    version: _version,
    drawing: _drawing,
    cad: _cad,
    ...projectState
  } = plan;
  return projectState;
}

/** Parses JSON from disk/network into a ScaffoldPlan with defaults for new fields. */
export function parseScaffoldPlan(raw: unknown): ScaffoldPlan {
  if (typeof raw !== 'object' || raw === null) {
    return createScaffoldPlan();
  }
  const record = raw as Record<string, unknown>;
  const base = createScaffoldPlan(record as Partial<ProjectState>);
  const drawing =
    typeof record.drawing === 'object' && record.drawing !== null
      ? { ...createEmptyDrawing(), ...(record.drawing as ScaffoldPlanDrawing) }
      : createEmptyDrawing();
  const cad =
    typeof record.cad === 'object' && record.cad !== null
      ? { ...createEmptyCad(), ...(record.cad as ScaffoldPlanCad) }
      : createEmptyCad();
  return {
    ...base,
    version:
      typeof record.version === 'number' && Number.isFinite(record.version)
        ? record.version
        : SCAFFOLD_PLAN_VERSION,
    drawing,
    cad,
  };
}
