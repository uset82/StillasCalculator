import {
  computeScaffoldLength,
  isValidPerimeter,
  measurePolygon,
} from '@/lib/geometry/turfMeasurements';
import { getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';
import type { ScaffoldPlan, UpdateResult } from '@/lib/types';
import type { PlanToolContext } from '@/lib/ai/toolExecutor';
import type { ProjectStateController } from '@/lib/state/projectStateController';
import { getCadExportDir } from '@/lib/ai/planFileSync';

/**
 * True only for a real, finite number (rejects `NaN`, `Infinity`, and any
 * non-number). The file-backed Plan_Updater must reject non-numeric values
 * exactly as `scaffoldPlanController` does (via its `isFiniteNumber` guard);
 * a bare `value < min || value > max` test would let `NaN` slip through both
 * comparisons and corrupt the plan, diverging from the controller (Req 3.2,
 * 3.5).
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates a facade subset against the stored perimeter's sides (Req 6.5,
 * 6.8). A `null` selection means "the whole perimeter" and is always accepted.
 * Otherwise every supplied index must be an integer in `[0, sideCount)`, where
 * `sideCount` is the number of sides of the currently stored, validly-measured
 * perimeter (0 when no valid perimeter is stored). Any non-integer, negative,
 * or out-of-range index — or any index at all when no perimeter is stored —
 * makes the subset invalid.
 *
 * Returns a rejecting {@link UpdateResult} naming the invalid subset when the
 * selection is out of range, or `null` when the selection is acceptable. This
 * is the shared gate both Plan_Updater implementations apply so the OpenAI and
 * MCP paths reject identical facade subsets and retain the existing selection
 * on rejection.
 */
function validateFacadeSelection(
  plan: ScaffoldPlan,
  sideIndices: number[] | null,
): UpdateResult | null {
  // Passing null selects the whole perimeter (Req 6.5) — always valid.
  if (sideIndices === null) {
    return null;
  }

  const sideCount = plan.measurements?.valid
    ? plan.measurements.sideLengthsMeters.length
    : 0;

  const invalid = sideIndices.filter(
    (index) => !Number.isInteger(index) || index < 0 || index >= sideCount,
  );

  if (invalid.length > 0) {
    const permittedRange =
      sideCount > 0
        ? `0 to ${sideCount - 1}`
        : 'no perimeter is stored, so no facade side index is valid';
    return {
      ok: false,
      error: {
        field: 'selectedFacadeSideIndices',
        message: `Facade side ${invalid.length === 1 ? 'index' : 'indices'} ${invalid.join(
          ', ',
        )} reference sides outside the stored perimeter's range (${permittedRange}).`,
        permittedRange,
      },
    };
  }

  return null;
}

export function createControllerPlanContext(
  controller: ProjectStateController,
  cadSessionId: string,
): PlanToolContext {
  return {
    getScaffoldPlan: () => controller.getScaffoldPlan(),
    setWorkingHeight: (h) => controller.setWorkingHeight(h),
    setPerimeter: (p) => controller.setPerimeter(p),
    setSelectedFacades: (s) => {
      const rejection = validateFacadeSelection(controller.getScaffoldPlan(), s);
      if (rejection) {
        return rejection;
      }
      return controller.setSelectedFacades(s);
    },
    setScaffoldSystem: (id) => controller.setScaffoldSystem(id),
    setDimension: (f, v) => controller.setDimension(f, v),
    applyCalculation: (r) => controller.applyCalculation(r),
    setDrawingOverlay: (o) => controller.setDrawingOverlay(o),
    clearDrawingOverlay: () => controller.clearDrawingOverlay(),
    setCadModel: (s, p) => controller.setCadModel(s, p),
    addCadExport: (f, u) => controller.addCadExport(f, u),
    getCadSessionId: () => cadSessionId,
    getCadExportDir: () => getCadExportDir(cadSessionId),
  };
}

export function createFilePlanContext(
  getPlan: () => ScaffoldPlan,
  setPlan: (plan: ScaffoldPlan) => void,
  cadSessionId: string,
): PlanToolContext {
  const mutate = (fn: (plan: ScaffoldPlan) => ScaffoldPlan): void => {
    setPlan(fn(getPlan()));
  };

  return {
    getScaffoldPlan: getPlan,
    setWorkingHeight: (h) => {
      // Mirror scaffoldPlanController.setWorkingHeight exactly: accept iff a
      // finite number in 0.01–100 m. A non-numeric or out-of-range value is
      // rejected with a field-named error and no partial update (Req 3.2, 3.5).
      if (!isFiniteNumber(h) || h < 0.01 || h > 100) {
        return {
          ok: false,
          error: {
            field: 'workingHeightMeters',
            message: 'The working height must be a number between 0.01 and 100 meters.',
            permittedRange: '0.01 to 100',
          },
        };
      }
      mutate((plan) => ({ ...plan, workingHeightMeters: h, version: plan.version + 1 }));
      return { ok: true };
    },
    setPerimeter: (polygon) => {
      // Store an AI-produced (candidate) polygon only after Geometry_Engine
      // validation. On rejection the plan is left untouched, so the last valid
      // perimeter is retained (or none when none was previously stored). On
      // acceptance the new perimeter replaces any prior one and the engine
      // recomputes measurements + Scaffold_Length (Req 6.1, 6.4, 7.1, 8.1).
      if (!isValidPerimeter(polygon)) {
        return {
          ok: false,
          error: {
            field: 'perimeterPolygon',
            message: 'Invalid perimeter polygon.',
          },
        };
      }
      mutate((plan) => {
        const measurements = measurePolygon(polygon);
        const scaffoldLengthMeters = computeScaffoldLength(
          measurements,
          plan.selectedFacadeSideIndices,
        );
        return {
          ...plan,
          perimeterPolygon: polygon,
          measurements,
          scaffoldLengthMeters,
          version: plan.version + 1,
        };
      });
      return { ok: true };
    },
    setSelectedFacades: (sideIndices) => {
      // Reject side indices outside the stored perimeter's range, retaining the
      // existing facade selection; null selects the whole perimeter (Req 6.5,
      // 6.8). This is the same gate the controller-backed context applies.
      const rejection = validateFacadeSelection(getPlan(), sideIndices);
      if (rejection) {
        return rejection;
      }
      mutate((plan) => {
        const selection = sideIndices === null ? null : [...sideIndices];
        const scaffoldLengthMeters = plan.measurements?.valid
          ? computeScaffoldLength(plan.measurements, selection)
          : null;
        return {
          ...plan,
          selectedFacadeSideIndices: selection,
          scaffoldLengthMeters,
          version: plan.version + 1,
        };
      });
      return { ok: true };
    },
    setScaffoldSystem: (systemId) => {
      const system = getScaffoldSystem(systemId);
      if (!system) {
        return {
          ok: false,
          error: {
            field: 'scaffoldSystemId',
            message: `Unknown scaffold system "${systemId}".`,
          },
        };
      }
      mutate((plan) => ({
        ...plan,
        scaffoldSystemId: system.id,
        bayLengthMeters: system.defaultBayLengthMeters,
        scaffoldWidthMeters: system.defaultScaffoldWidthMeters,
        liftHeightMeters: system.defaultLiftHeightMeters,
        version: plan.version + 1,
      }));
      return { ok: true };
    },
    setDimension: (field, value) => {
      // Mirror scaffoldPlanController.setDimension in the calculator context
      // exactly: accept iff a finite number in 0.01–5 m. The AI tool path uses
      // the calculator range (the >0..100 m system-editor range is a manual-UI
      // context not reachable through this updater). Non-numeric/out-of-range
      // values are rejected with a field-named error and no partial update
      // (Req 3.2, 3.5).
      if (!isFiniteNumber(value) || value < 0.01 || value > 5) {
        return {
          ok: false,
          error: {
            field,
            message: `The ${field} must be a number between 0.01 and 5 meters.`,
            permittedRange: '0.01 to 5',
          },
        };
      }
      mutate((plan) => ({ ...plan, [field]: value, version: plan.version + 1 }));
      return { ok: true };
    },
    applyCalculation: (result) => {
      mutate((plan) => ({
        ...plan,
        calculation: result,
        materialListAdjusted: result.materialList.map((item) => ({ ...item })),
        version: plan.version + 1,
      }));
    },
    setDrawingOverlay: (overlay) => {
      mutate((plan) => ({
        ...plan,
        drawing: { overlayGeoJson: overlay, lastGeneratedAt: Date.now() },
        version: plan.version + 1,
      }));
    },
    clearDrawingOverlay: () => {
      mutate((plan) => ({
        ...plan,
        drawing: { overlayGeoJson: null, lastGeneratedAt: null },
        version: plan.version + 1,
      }));
    },
    setCadModel: (source, parameters) => {
      mutate((plan) => ({
        ...plan,
        cad: {
          ...plan.cad,
          openScadSource: source,
          parameters: { ...parameters },
          lastGeneratedAt: Date.now(),
        },
        version: plan.version + 1,
      }));
    },
    addCadExport: (format, pathOrUrl) => {
      mutate((plan) => ({
        ...plan,
        cad: {
          ...plan.cad,
          exports: [...plan.cad.exports, { format, pathOrUrl }],
        },
        version: plan.version + 1,
      }));
    },
    getCadSessionId: () => cadSessionId,
    getCadExportDir: () => getCadExportDir(cadSessionId),
  };
}
