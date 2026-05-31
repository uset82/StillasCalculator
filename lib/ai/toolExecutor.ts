import type {
  CalculationResult,
  DimensionField,
  GeoJsonPolygon,
  MaterialItem,
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
  ScaffoldSystem,
  ScaffoldSystemId,
  UpdateResult,
} from '@/lib/types';
import { exportCadFormat, type CadExportFormat } from '@/lib/cad/cadExportService';
import {
  buildScaffoldOpenScad,
  extractOpenScadParameters,
  parametersToRecord,
} from '@/lib/cad/scaffoldOpenScadTemplate';
import { buildScaffoldOverlay } from '@/lib/drawing/scaffoldOverlay';
import { calculateScaffoldMaterials } from '@/lib/scaffold/scaffoldCalculator';
import { buildMaterialList } from '@/lib/scaffold/materialRules';
import {
  getAllScaffoldSystems,
} from '@/lib/scaffold/scaffoldSystems';
import { buildReportSummary, type ReportSummary } from '@/lib/ai/reportSummary';
import type { JsonSchema } from '@/lib/ai/schemas';
import {
  CALCULATE_SCAFFOLD_MATERIALS_PARAMS,
  CLEAR_SCAFFOLD_DRAWING_PARAMS,
  EXPORT_CAD_FORMAT_PARAMS,
  GENERATE_CAD_MODEL_PARAMS,
  GENERATE_MATERIAL_LIST_PARAMS,
  GENERATE_REPORT_SUMMARY_PARAMS,
  GENERATE_SCAFFOLD_DRAWING_PARAMS,
  GET_AVAILABLE_SCAFFOLD_SYSTEMS_PARAMS,
  GET_SCAFFOLD_PLAN_PARAMS,
  GET_SELECTED_BUILDING_MEASUREMENTS_PARAMS,
  RETRIEVE_BUILDING_FOOTPRINTS_PARAMS,
  SELECT_FACADE_SIDES_PARAMS,
  SET_BUILDING_PERIMETER_PARAMS,
  SET_BUILDING_PERIMETER_FROM_LOCATION_PARAMS,
  SET_SCAFFOLD_DIMENSIONS_PARAMS,
  SET_SCAFFOLD_SYSTEM_PARAMS,
  UPDATE_WORKING_HEIGHT_PARAMS,
} from '@/lib/ai/schemas';
import {
  pickFootprintCandidate,
  retrieveBuildingFootprints,
  type RetrieveFootprintsArgs,
  type FootprintSelectionStrategy,
} from '@/lib/ai/buildingFootprints';

export type ToolName =
  | 'calculateScaffoldMaterials'
  | 'getSelectedBuildingMeasurements'
  | 'getAvailableScaffoldSystems'
  | 'updateWorkingHeight'
  | 'generateMaterialList'
  | 'generateReportSummary'
  | 'getScaffoldPlan'
  | 'setBuildingPerimeter'
  | 'setBuildingPerimeterFromLocation'
  | 'selectFacadeSides'
  | 'setScaffoldSystem'
  | 'setScaffoldDimensions'
  | 'generateScaffoldDrawing'
  | 'clearScaffoldDrawing'
  | 'generateCadModel'
  | 'exportCadFormat'
  | 'retrieveBuildingFootprints';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: JsonSchema;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type ToolExecutorFn = (args: unknown) => ToolResult;

/**
 * Mutable ScaffoldPlan access for deterministic tool execution.
 * Implementations: in-memory controller adapter or plan-file adapter (MCP).
 */
export interface PlanToolContext {
  getScaffoldPlan(): ScaffoldPlan;
  setWorkingHeight(heightMeters: number): UpdateResult;
  setPerimeter(polygon: GeoJsonPolygon): UpdateResult;
  setSelectedFacades(sideIndices: number[] | null): UpdateResult;
  setScaffoldSystem(systemId: ScaffoldSystemId): UpdateResult;
  setDimension(field: DimensionField, value: number): UpdateResult;
  applyCalculation(result: ScaffoldCalculationOutput): void;
  setDrawingOverlay(overlay: ReturnType<typeof buildScaffoldOverlay>): void;
  clearDrawingOverlay(): void;
  setCadModel(source: string, parameters: Record<string, number>): void;
  addCadExport(format: CadExportFormat, pathOrUrl: string): void;
  /** Session id for CAD export paths (optional for file-only contexts). */
  getCadSessionId?(): string;
  getCadExportDir?(): string;
}

export const AI_TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    name: 'getScaffoldPlan',
    description:
      'Read the full ScaffoldPlan JSON: address, footprint, measurements, scaffold config, calculation, drawing overlay, and CAD metadata. Use before any action.',
    parameters: GET_SCAFFOLD_PLAN_PARAMS,
  },
  {
    name: 'calculateScaffoldMaterials',
    description:
      'Run the deterministic scaffold calculator. Returns bays, levels, material list, warnings. The only source of scaffold quantities.',
    parameters: CALCULATE_SCAFFOLD_MATERIALS_PARAMS,
  },
  {
    name: 'getSelectedBuildingMeasurements',
    description: 'Read perimeter, area, side lengths, and scaffold length from the plan.',
    parameters: GET_SELECTED_BUILDING_MEASUREMENTS_PARAMS,
  },
  {
    name: 'getAvailableScaffoldSystems',
    description: 'List selectable scaffold systems and default dimensions.',
    parameters: GET_AVAILABLE_SCAFFOLD_SYSTEMS_PARAMS,
  },
  {
    name: 'updateWorkingHeight',
    description: 'Set working height (0.01–100 m). Rejected values preserve existing state.',
    parameters: UPDATE_WORKING_HEIGHT_PARAMS,
  },
  {
    name: 'setBuildingPerimeter',
    description:
      'Set the building footprint polygon (GeoJSON Polygon). Validates ring; rejects invalid geometry.',
    parameters: SET_BUILDING_PERIMETER_PARAMS,
  },
  {
    name: 'setBuildingPerimeterFromLocation',
    description:
      'Resolve an address or coordinate to nearby building footprints, deterministically choose the nearest or largest candidate, and store that footprint as the app perimeter through the same validated geometry engine used by setBuildingPerimeter.',
    parameters: SET_BUILDING_PERIMETER_FROM_LOCATION_PARAMS,
  },
  {
    name: 'selectFacadeSides',
    description:
      'Select which facade sides receive scaffold. Pass null for whole perimeter, or an array of side indices.',
    parameters: SELECT_FACADE_SIDES_PARAMS,
  },
  {
    name: 'setScaffoldSystem',
    description: 'Select a scaffold system and load its default dimensions.',
    parameters: SET_SCAFFOLD_SYSTEM_PARAMS,
  },
  {
    name: 'setScaffoldDimensions',
    description: 'Set bay length, lift height, and/or scaffold width (calculator range 0.01–5 m).',
    parameters: SET_SCAFFOLD_DIMENSIONS_PARAMS,
  },
  {
    name: 'generateMaterialList',
    description: 'Derive material list from engine-computed bay/level counts.',
    parameters: GENERATE_MATERIAL_LIST_PARAMS,
  },
  {
    name: 'generateReportSummary',
    description: 'Planning-estimate summary for export.',
    parameters: GENERATE_REPORT_SUMMARY_PARAMS,
  },
  {
    name: 'generateScaffoldDrawing',
    description:
      'Generate 2D scaffold overlay GeoJSON from the current plan and store it on ScaffoldPlan.drawing.',
    parameters: GENERATE_SCAFFOLD_DRAWING_PARAMS,
  },
  {
    name: 'clearScaffoldDrawing',
    description: 'Remove the 2D scaffold drawing overlay from the plan.',
    parameters: CLEAR_SCAFFOLD_DRAWING_PARAMS,
  },
  {
    name: 'generateCadModel',
    description:
      'Build deterministic OpenSCAD source from ScaffoldPlan (CADAM-style parametric template).',
    parameters: GENERATE_CAD_MODEL_PARAMS,
  },
  {
    name: 'exportCadFormat',
    description: 'Export CAD as scad, stl, or dxf. Requires generateCadModel or completed calculation.',
    parameters: EXPORT_CAD_FORMAT_PARAMS,
  },
  {
    name: 'retrieveBuildingFootprints',
    description:
      'Resolve an address (or coordinate) to candidate building footprints within 60 m, server-side, via the geocoding and Overpass services. Returns candidates for inspection; does not store a perimeter. To draw a selected house immediately, prefer setBuildingPerimeterFromLocation.',
    parameters: RETRIEVE_BUILDING_FOOTPRINTS_PARAMS,
  },
] as const);

export function getToolDefinitions(): readonly ToolDefinition[] {
  return AI_TOOLS;
}

function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPolygon(record: Record<string, unknown>, key: string): GeoJsonPolygon | null {
  const value = record[key];
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as GeoJsonPolygon).type === 'Polygon' &&
    Array.isArray((value as GeoJsonPolygon).coordinates)
  ) {
    return value as GeoJsonPolygon;
  }
  return null;
}

export function createToolDispatch(
  context: PlanToolContext,
): Record<ToolName, ToolExecutorFn> {
  return {
    getScaffoldPlan: () => ({ ok: true, data: context.getScaffoldPlan() }),

    calculateScaffoldMaterials: (args) => {
      const record = asRecord(args);
      const input: ScaffoldCalculationInput = {
        scaffoldLengthMeters: readNumber(record, 'scaffoldLengthMeters') as number,
        workingHeightMeters: readNumber(record, 'workingHeightMeters') as number,
        bayLengthMeters: readNumber(record, 'bayLengthMeters') as number,
        liftHeightMeters: readNumber(record, 'liftHeightMeters') as number,
        scaffoldWidthMeters: readNumber(record, 'scaffoldWidthMeters') as number,
        scaffoldSystemId: record.scaffoldSystemId as ScaffoldSystemId,
        wasteFactorPercent: readNumber(record, 'wasteFactorPercent'),
      };
      const result: CalculationResult = calculateScaffoldMaterials(input);
      if (!result.ok) {
        return { ok: false, error: result.error.message };
      }
      context.applyCalculation(result.output);
      return { ok: true, data: result.output };
    },

    getSelectedBuildingMeasurements: () => {
      const plan = context.getScaffoldPlan();
      if (!plan.measurements?.valid) {
        return {
          ok: false,
          error:
            'No valid building measurements. Set or draw the building perimeter first.',
        };
      }
      return {
        ok: true,
        data: {
          measurements: plan.measurements,
          scaffoldLengthMeters: plan.scaffoldLengthMeters,
          selectedFacadeSideIndices: plan.selectedFacadeSideIndices,
        },
      };
    },

    getAvailableScaffoldSystems: () => {
      const systems: readonly ScaffoldSystem[] = getAllScaffoldSystems();
      return { ok: true, data: { systems } };
    },

    updateWorkingHeight: (args) => {
      const heightMeters = readNumber(asRecord(args), 'heightMeters');
      if (heightMeters === undefined) {
        return { ok: false, error: 'A numeric working height in meters is required.' };
      }
      const update = context.setWorkingHeight(heightMeters);
      return update.ok
        ? { ok: true, data: { workingHeightMeters: heightMeters } }
        : {
            ok: false,
            error: update.error?.message ?? 'Working height rejected.',
          };
    },

    setBuildingPerimeter: (args) => {
      const polygon = readPolygon(asRecord(args), 'polygon');
      if (!polygon) {
        return { ok: false, error: 'A valid GeoJSON Polygon is required.' };
      }
      const update = context.setPerimeter(polygon);
      return update.ok
        ? {
            ok: true,
            data: {
              measurements: context.getScaffoldPlan().measurements,
              scaffoldLengthMeters: context.getScaffoldPlan().scaffoldLengthMeters,
            },
        }
        : { ok: false, error: update.error?.message ?? 'Perimeter rejected.' };
    },

    setBuildingPerimeterFromLocation: () => ({
      ok: false,
      error:
        'Use executeTool() for setBuildingPerimeterFromLocation — it requires async I/O.',
    }),

    selectFacadeSides: (args) => {
      const record = asRecord(args);
      const raw = record.sideIndices;
      const sideIndices =
        raw === null ? null : Array.isArray(raw) ? (raw as number[]) : undefined;
      if (sideIndices === undefined) {
        return {
          ok: false,
          error: 'sideIndices must be null (whole perimeter) or an array of side indices.',
        };
      }
      const update = context.setSelectedFacades(sideIndices);
      if (!update.ok) {
        return {
          ok: false,
          error: update.error?.message ?? 'Facade selection rejected.',
        };
      }
      return {
        ok: true,
        data: { scaffoldLengthMeters: context.getScaffoldPlan().scaffoldLengthMeters },
      };
    },

    setScaffoldSystem: (args) => {
      const systemId = asRecord(args).scaffoldSystemId as ScaffoldSystemId;
      if (!systemId) {
        return { ok: false, error: 'scaffoldSystemId is required.' };
      }
      const update = context.setScaffoldSystem(systemId);
      if (!update.ok) {
        return { ok: false, error: update.error?.message ?? 'System rejected.' };
      }
      const plan = context.getScaffoldPlan();
      return {
        ok: true,
        data: {
          scaffoldSystemId: plan.scaffoldSystemId,
          bayLengthMeters: plan.bayLengthMeters,
          liftHeightMeters: plan.liftHeightMeters,
          scaffoldWidthMeters: plan.scaffoldWidthMeters,
        },
      };
    },

    setScaffoldDimensions: (args) => {
      const record = asRecord(args);
      const fields: DimensionField[] = [
        'bayLengthMeters',
        'liftHeightMeters',
        'scaffoldWidthMeters',
      ];
      for (const field of fields) {
        const value = readNumber(record, field);
        if (value !== undefined) {
          const update = context.setDimension(field, value);
          if (!update.ok) {
            return { ok: false, error: update.error?.message ?? `${field} rejected.` };
          }
        }
      }
      const plan = context.getScaffoldPlan();
      return {
        ok: true,
        data: {
          bayLengthMeters: plan.bayLengthMeters,
          liftHeightMeters: plan.liftHeightMeters,
          scaffoldWidthMeters: plan.scaffoldWidthMeters,
        },
      };
    },

    generateMaterialList: (args) => {
      const record = asRecord(args);
      const numberOfBays = readNumber(record, 'numberOfBays');
      const numberOfLevels = readNumber(record, 'numberOfLevels');
      const systemId = record.scaffoldSystemId as ScaffoldSystemId;
      if (numberOfBays === undefined || numberOfLevels === undefined) {
        return {
          ok: false,
          error: 'numberOfBays and numberOfLevels from a prior calculation are required.',
        };
      }
      const { items, warnings } = buildMaterialList(
        numberOfBays,
        numberOfLevels,
        systemId,
      );
      return { ok: true, data: { materialList: items, warnings } };
    },

    generateReportSummary: () => {
      const summary: ReportSummary = buildReportSummary(context.getScaffoldPlan());
      return { ok: true, data: summary };
    },

    generateScaffoldDrawing: () => {
      const plan = context.getScaffoldPlan();
      if (!plan.calculation) {
        return {
          ok: false,
          error: 'Run calculateScaffoldMaterials before generating a drawing.',
        };
      }
      const overlay = buildScaffoldOverlay(plan);
      context.setDrawingOverlay(overlay);
      return {
        ok: true,
        data: {
          featureCount: overlay.features.length,
          overlayGeoJson: overlay,
        },
      };
    },

    clearScaffoldDrawing: () => {
      context.clearDrawingOverlay();
      return { ok: true, data: { cleared: true } };
    },

    generateCadModel: () => {
      const plan = context.getScaffoldPlan();
      const source = buildScaffoldOpenScad(plan);
      if (!source) {
        return {
          ok: false,
          error: 'Complete scaffold calculation and dimensions before generating CAD.',
        };
      }
      const params = extractOpenScadParameters(plan);
      context.setCadModel(source, params ? parametersToRecord(params) : {});
      return {
        ok: true,
        data: {
          openScadSource: source,
          parameters: params ? parametersToRecord(params) : {},
        },
      };
    },

    exportCadFormat: () => ({
      ok: false,
      error: 'Use executeTool() for exportCadFormat — it requires async I/O.',
    }),

    retrieveBuildingFootprints: () => ({
      ok: false,
      error: 'Use executeTool() for retrieveBuildingFootprints — it requires async I/O.',
    }),
  };
}

async function runExportCadFormat(
  context: PlanToolContext,
  args: unknown,
): Promise<ToolResult> {
  const format = asRecord(args).format as CadExportFormat;
  if (format !== 'scad' && format !== 'stl' && format !== 'dxf') {
    return { ok: false, error: 'format must be scad, stl, or dxf.' };
  }
  const sessionId = context.getCadSessionId?.() ?? 'default';
  const exportDir = context.getCadExportDir?.() ?? '';
  if (!exportDir) {
    return { ok: false, error: 'CAD export directory is not configured.' };
  }
  const plan = context.getScaffoldPlan();
  const result = await exportCadFormat(plan, format, exportDir, sessionId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  context.addCadExport(format, result.downloadUrl);
  return {
    ok: true,
    data: { format: result.format, downloadUrl: result.downloadUrl },
  };
}

/** Human-readable messages for the footprint retrieval failure reasons. */
const FOOTPRINT_ERROR_MESSAGES: Record<string, string> = {
  'address-not-found':
    'The address could not be located. Offer manual drawing, or ask for a more specific address or coordinate.',
  'overpass-failed':
    'The building footprint service did not respond. The project state is unchanged — offer manual drawing.',
};

async function runRetrieveBuildingFootprints(args: unknown): Promise<ToolResult> {
  const result = await retrieveBuildingFootprints(asRecord(args) as RetrieveFootprintsArgs);
  if (!result.ok) {
    const message =
      FOOTPRINT_ERROR_MESSAGES[result.error] ?? `Footprint retrieval failed: ${result.error}.`;
    return { ok: false, error: message };
  }
  return { ok: true, data: result.data };
}

function readFootprintSelectionStrategy(value: unknown): FootprintSelectionStrategy {
  return value === 'largest' ? 'largest' : 'nearest';
}

async function runSetBuildingPerimeterFromLocation(
  context: PlanToolContext,
  args: unknown,
): Promise<ToolResult> {
  const record = asRecord(args);
  const selectionStrategy = readFootprintSelectionStrategy(record.selectionStrategy);
  const result = await retrieveBuildingFootprints(record as RetrieveFootprintsArgs);
  if (!result.ok) {
    const message =
      FOOTPRINT_ERROR_MESSAGES[result.error] ?? `Footprint retrieval failed: ${result.error}.`;
    return { ok: false, error: message };
  }

  const selected = pickFootprintCandidate(
    result.data.candidates,
    result.data.coordinate,
    selectionStrategy,
  );
  if (!selected) {
    return {
      ok: false,
      error:
        'No usable building footprint was found near that location. Draw the perimeter manually or provide a more specific address.',
    };
  }

  const update = context.setPerimeter(selected.polygon);
  if (!update.ok) {
    return { ok: false, error: update.error?.message ?? 'Perimeter rejected.' };
  }

  const plan = context.getScaffoldPlan();
  return {
    ok: true,
    data: {
      coordinate: result.data.coordinate,
      candidateCount: result.data.candidates.length,
      selectedIndex: selected.index,
      selectionStrategy,
      selectedCandidate: {
        index: selected.index,
        perimeterMeters: selected.perimeterMeters,
        areaSquareMeters: selected.areaSquareMeters,
      },
      measurements: plan.measurements,
      scaffoldLengthMeters: plan.scaffoldLengthMeters,
    },
  };
}

/** Executes a tool; handles async tools that need filesystem or network I/O. */
export async function executeTool(
  dispatch: Record<ToolName, ToolExecutorFn>,
  context: PlanToolContext,
  name: ToolName,
  args: unknown,
): Promise<ToolResult> {
  if (name === 'exportCadFormat') {
    return runExportCadFormat(context, args);
  }
  if (name === 'retrieveBuildingFootprints') {
    return runRetrieveBuildingFootprints(args);
  }
  if (name === 'setBuildingPerimeterFromLocation') {
    return runSetBuildingPerimeterFromLocation(context, args);
  }
  // Resolve the executor as an OWN property only. `dispatch` is a plain object
  // literal, so a bare `dispatch[name]` lookup walks the prototype chain — an
  // unknown name colliding with an Object.prototype member ("toString",
  // "constructor", "valueOf", "hasOwnProperty", ...) would otherwise resolve to
  // the inherited function and be invoked. Both providers cast untrusted model
  // input to ToolName (MCP `request.params.name`, OpenAI `call.name`), so such a
  // name can reach here at runtime. Guarding on an own, callable property makes
  // every unknown tool inert: it returns an error naming the tool, runs no
  // engine function, and leaves Project_State unchanged (Req 1.4, 9.5).
  const executor = Object.prototype.hasOwnProperty.call(dispatch, name)
    ? dispatch[name]
    : undefined;
  if (typeof executor !== 'function') {
    return { ok: false, error: `Unknown tool "${name}".` };
  }
  return executor(args);
}

export type { MaterialItem, ReportSummary };
