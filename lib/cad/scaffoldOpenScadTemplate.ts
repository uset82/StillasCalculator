import type { ScaffoldPlan } from '@/lib/types';

export interface OpenScadParameters {
  bayLength: number;
  numBays: number;
  numLevels: number;
  scaffoldWidth: number;
  liftHeight: number;
  workingHeight: number;
  scaffoldLength: number;
}

export function extractOpenScadParameters(plan: ScaffoldPlan): OpenScadParameters | null {
  const calc = plan.calculation;
  if (
    !calc ||
    plan.bayLengthMeters === null ||
    plan.liftHeightMeters === null ||
    plan.scaffoldWidthMeters === null ||
    plan.workingHeightMeters === null ||
    plan.scaffoldLengthMeters === null
  ) {
    return null;
  }
  return {
    bayLength: plan.bayLengthMeters,
    numBays: calc.numberOfBays,
    numLevels: calc.numberOfLevels,
    scaffoldWidth: plan.scaffoldWidthMeters,
    liftHeight: plan.liftHeightMeters,
    workingHeight: plan.workingHeightMeters,
    scaffoldLength: plan.scaffoldLengthMeters,
  };
}

/**
 * Deterministic OpenSCAD template from ScaffoldPlan (CADAM-inspired parametric model).
 * Geometry is template-based — not LLM-generated.
 */
export function buildScaffoldOpenScad(plan: ScaffoldPlan): string | null {
  const p = extractOpenScadParameters(plan);
  if (!p) return null;

  return `// StillasCalculator — deterministic scaffold model
// Parameters sourced from scaffoldCalculator.ts / ScaffoldPlan

bay_length = ${p.bayLength};
num_bays = ${p.numBays};
num_levels = ${p.numLevels};
scaffold_width = ${p.scaffoldWidth};
lift_height = ${p.liftHeight};
working_height = ${p.workingHeight};
run_length = ${p.scaffoldLength};

tube_r = 0.025;
board_t = 0.05;

module vertical_standard(h) {
  cylinder(h = h, r = tube_r, $fn = 16);
}

module ledger(len) {
  rotate([0, 90, 0])
    cylinder(h = len, r = tube_r, $fn = 16);
}

module bay_frame() {
  for (z = [0 : lift_height : working_height - 0.001]) {
    translate([0, 0, z]) {
      vertical_standard(lift_height + tube_r * 2);
    }
    for (y = [0, scaffold_width]) {
      translate([0, y, z + lift_height / 2])
        ledger(bay_length);
    }
    translate([0, scaffold_width / 2, z + lift_height - board_t])
      cube([bay_length, scaffold_width, board_t]);
  }
}

for (i = [0 : num_bays - 1]) {
  translate([i * bay_length, 0, 0])
    bay_frame();
}
`;
}

export function parametersToRecord(p: OpenScadParameters): Record<string, number> {
  return {
    bayLength: p.bayLength,
    numBays: p.numBays,
    numLevels: p.numLevels,
    scaffoldWidth: p.scaffoldWidth,
    liftHeight: p.liftHeight,
    workingHeight: p.workingHeight,
    scaffoldLength: p.scaffoldLength,
  };
}
