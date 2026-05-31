import type { MaterialItem, ProjectState, ScaffoldPlan } from '@/lib/types';
import { VERIFICATION_DISCLAIMER } from '@/lib/types';
import { getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';

export interface ReportSummary {
  address: string | null;
  perimeterMeters: number | null;
  areaSquareMeters: number | null;
  scaffoldLengthMeters: number | null;
  scaffoldSystem: string | null;
  numberOfBays: number | null;
  numberOfLevels: number | null;
  materialList: MaterialItem[];
  warnings: string[];
  disclaimer: string;
}

export function buildReportSummary(state: ProjectState | ScaffoldPlan): ReportSummary {
  const measurements =
    state.measurements && state.measurements.valid ? state.measurements : null;

  let scaffoldSystem: string | null = null;
  if (state.scaffoldSystemId !== null) {
    const system = getScaffoldSystem(state.scaffoldSystemId);
    scaffoldSystem = system ? system.displayName : state.scaffoldSystemId;
  }

  const materialList: MaterialItem[] =
    state.materialListAdjusted && state.materialListAdjusted.length > 0
      ? state.materialListAdjusted
      : state.calculation
        ? state.calculation.materialList
        : [];

  return {
    address: state.address ? state.address.label : null,
    perimeterMeters: measurements ? measurements.perimeterMeters : null,
    areaSquareMeters: measurements ? measurements.areaSquareMeters : null,
    scaffoldLengthMeters: state.scaffoldLengthMeters,
    scaffoldSystem,
    numberOfBays: state.calculation ? state.calculation.numberOfBays : null,
    numberOfLevels: state.calculation ? state.calculation.numberOfLevels : null,
    materialList,
    warnings: state.calculation ? state.calculation.warnings : [],
    disclaimer: VERIFICATION_DISCLAIMER,
  };
}
