import { describe, it, expect } from 'vitest';

import { createScaffoldPlan, parseScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { buildScaffoldOpenScad } from '@/lib/cad/scaffoldOpenScadTemplate';
import { buildScaffoldOverlay } from '@/lib/drawing/scaffoldOverlay';
import type { ScaffoldCalculationOutput } from '@/lib/types';

describe('ScaffoldPlan', () => {
  it('round-trips through JSON with drawing and cad defaults', () => {
    const plan = createScaffoldPlan();
    const parsed = parseScaffoldPlan(JSON.parse(JSON.stringify(plan)));
    expect(parsed.drawing.overlayGeoJson).toBeNull();
    expect(parsed.cad.openScadSource).toBeNull();
    expect(parsed.version).toBe(plan.version);
  });
});

describe('scaffoldOpenScadTemplate', () => {
  it('produces OpenSCAD when calculation is complete', () => {
    const calculation: ScaffoldCalculationOutput = {
      totalScaffoldLengthMeters: 24,
      numberOfBays: 8,
      numberOfLevels: 3,
      materialList: [],
      warnings: [],
    };
    const plan = createScaffoldPlan({
      scaffoldLengthMeters: 24,
      workingHeightMeters: 6,
      bayLengthMeters: 3,
      liftHeightMeters: 2,
      scaffoldWidthMeters: 1.2,
      scaffoldSystemId: 'generic-frame',
      calculation,
    });
    const scad = buildScaffoldOpenScad(plan);
    expect(scad).toContain('num_bays = 8');
    expect(scad).toContain('num_levels = 3');
  });
});

describe('scaffoldOverlay', () => {
  it('returns empty collection without valid measurements', () => {
    const overlay = buildScaffoldOverlay(createScaffoldPlan());
    expect(overlay.features).toHaveLength(0);
  });
});
