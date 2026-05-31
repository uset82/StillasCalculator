// Feature: ai-agent-building-drawing, Property J: AI cannot write derived
// values directly.
//
// Property J (Req 8.4, 8.5): the AI_Agent writes building geometry to
//   Project_State ONLY as a Perimeter_Polygon or facade selection submitted
//   through a Geometry_Tool, and obtains every measurement / Scaffold_Length /
//   material quantity ONLY as deterministic engine output. There is no tool
//   path that lets the model set a measurement, scaffold length, or material
//   quantity directly.
//
// **Validates: Requirements 8.4, 8.5**
//
// Req 8.4: "THE AI_Agent SHALL write building geometry to the Project_State
//   only as a Perimeter_Polygon or facade selection submitted through a
//   Geometry_Tool."
// Req 8.5: "THE AI_Agent SHALL obtain every measurement, Scaffold_Length, and
//   Material_List quantity it presents only as a deterministic output of the
//   Geometry_Engine or the calculation engines, with no rounding, scaling, or
//   other transformation applied to the obtained value."
//
// This is a STRUCTURAL + BEHAVIORAL test. It has two halves:
//
//   1. Source inspection — read `lib/ai/toolExecutor.ts` from disk and assert
//      that each stateful tool's dispatch entry forwards ONLY its declared
//      geometry/config input (polygon / side-indices / height / system /
//      dimension) to the validated Plan_Updater, and that NO dispatch entry
//      reads a derived value (measurements, scaffold length, area, per-side
//      lengths, material quantity, bay/level counts) out of the caller-supplied
//      args. A quoted arg key like `'scaffoldLengthMeters'` would prove the
//      tool reads a derived value from the model; a bare `.scaffoldLengthMeters`
//      property read off `context.getScaffoldPlan()` is an engine read and is
//      allowed.
//
//   2. Behavioral injection — drive the shared `createToolDispatch` /
//      `executeTool` over BOTH Plan_Updater implementations and try to inject
//      bogus derived values (`measurements`, `scaffoldLengthMeters`,
//      `areaSquareMeters`, a fake `materialList` / `quantity`, fake bay/level
//      counts) alongside the legitimate inputs. The stored and surfaced derived
//      values must equal the Geometry_Engine / calculation-engine output for the
//      same inputs — never the injected values.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createToolDispatch,
  executeTool,
  type PlanToolContext,
} from './toolExecutor';
import {
  createControllerPlanContext,
  createFilePlanContext,
} from './planToolContext';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { calculateScaffoldMaterials } from '@/lib/scaffold/scaffoldCalculator';
import {
  computeScaffoldLength,
  isValidPerimeter,
  measurePolygon,
} from '@/lib/geometry/turfMeasurements';
import type {
  GeoJsonPolygon,
  PolygonMeasurements,
  ScaffoldCalculationInput,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
} from '@/lib/types';

const SESSION_ID = 'no-direct-derived-writes-test';

// Repo root, derived from this file's location (lib/ai/...structural.test.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL_EXECUTOR_RELATIVE_PATH = 'lib/ai/toolExecutor.ts';

/** Reads a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Extracts the balanced body (`{ ... }`) of a `<toolName>: (args) => { ... }`
 * dispatch entry from the toolExecutor source by brace-matching. Template
 * literals like `` `${field} rejected.` `` stay balanced (each `${` is closed),
 * so the matcher returns the entry's full body.
 */
function extractDispatchEntry(source: string, toolName: string): string {
  const marker = `${toolName}: (args) =>`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`dispatch entry for "${toolName}" not found`);
  }
  const braceStart = source.indexOf('{', start + marker.length);
  if (braceStart === -1) {
    throw new Error(`opening brace for "${toolName}" not found`);
  }
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error(`closing brace for "${toolName}" not found`);
}

/**
 * Quoted arg keys that would indicate a tool reads a derived value out of the
 * caller-supplied args. A bare dotted property read (`.scaffoldLengthMeters`)
 * off the plan is fine; a quoted literal means the tool pulled it from args.
 */
const FORBIDDEN_DERIVED_ARG_KEYS = [
  "'measurements'",
  "'scaffoldLengthMeters'",
  "'areaSquareMeters'",
  "'sideLengthsMeters'",
  "'perimeterMeters'",
  "'materialList'",
  "'numberOfBays'",
  "'numberOfLevels'",
  "'quantity'",
];

/** A small valid axis-aligned rectangle ring, closed. */
function buildRectangle(
  lon0: number,
  lat0: number,
  w: number,
  h: number,
): GeoJsonPolygon {
  const ring: number[][] = [
    [lon0, lat0],
    [lon0 + w, lat0],
    [lon0 + w, lat0 + h],
    [lon0, lat0 + h],
    [lon0, lat0],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

/** A deliberately wrong measurements object the model might try to inject. */
function bogusMeasurements(): PolygonMeasurements {
  return {
    perimeterMeters: 1,
    areaSquareMeters: 2,
    sideLengthsMeters: [9, 9, 9, 9],
    valid: true,
  };
}

interface ContextFactory {
  readonly name: string;
  make(): PlanToolContext;
}

const contextFactories: readonly ContextFactory[] = [
  {
    name: 'controller-backed (createControllerPlanContext)',
    make: () =>
      createControllerPlanContext(createProjectStateController(), SESSION_ID),
  },
  {
    name: 'file-backed (createFilePlanContext)',
    make: () => {
      let plan: ScaffoldPlan = createScaffoldPlan();
      return createFilePlanContext(
        () => plan,
        (next) => {
          plan = next;
        },
        SESSION_ID,
      );
    },
  },
];

// ---------------------------------------------------------------------------
// 1. Structural: stateful tools forward only their declared input to the
//    validated Plan_Updater, and read no derived value from args (Req 8.4, 8.5).
// ---------------------------------------------------------------------------

describe('toolExecutor dispatch source: no direct derived-value writes (Property J, Req 8.4, 8.5)', () => {
  const source = readRepoFile(TOOL_EXECUTOR_RELATIVE_PATH);

  // For each stateful tool: the single Plan_Updater method it must forward to,
  // and the allowed input arg key(s) it is permitted to read.
  const statefulTools: ReadonlyArray<{
    tool: string;
    forwardsTo: string;
    allowedArgKeys: string[];
  }> = [
    { tool: 'setBuildingPerimeter', forwardsTo: 'context.setPerimeter(', allowedArgKeys: ["'polygon'"] },
    { tool: 'selectFacadeSides', forwardsTo: 'context.setSelectedFacades(', allowedArgKeys: ['sideIndices'] },
    { tool: 'updateWorkingHeight', forwardsTo: 'context.setWorkingHeight(', allowedArgKeys: ["'heightMeters'"] },
    { tool: 'setScaffoldSystem', forwardsTo: 'context.setScaffoldSystem(', allowedArgKeys: ['scaffoldSystemId'] },
    { tool: 'setScaffoldDimensions', forwardsTo: 'context.setDimension(', allowedArgKeys: ['bayLengthMeters'] },
  ];

  for (const { tool, forwardsTo, allowedArgKeys } of statefulTools) {
    describe(`${tool}`, () => {
      const body = extractDispatchEntry(source, tool);

      it('forwards its input through the validated Plan_Updater', () => {
        expect(body).toContain(forwardsTo);
      });

      it('reads its declared geometry/config input', () => {
        for (const key of allowedArgKeys) {
          expect(body).toContain(key);
        }
      });

      it('reads no derived value (measurement / scaffold length / area / quantity) from caller args', () => {
        for (const forbidden of FORBIDDEN_DERIVED_ARG_KEYS) {
          expect(body).not.toContain(forbidden);
        }
      });
    });
  }

  // calculateScaffoldMaterials legitimately accepts scaffoldLengthMeters as an
  // engine INPUT, but it must never read the derived OUTPUT (material list, bay
  // or level counts) from args — those are computed by the engine (Req 8.5).
  it('calculateScaffoldMaterials does not read engine OUTPUT (materialList / bay / level counts) from args', () => {
    const body = extractDispatchEntry(source, 'calculateScaffoldMaterials');
    for (const forbidden of ["'materialList'", "'numberOfBays'", "'numberOfLevels'"]) {
      expect(body).not.toContain(forbidden);
    }
    // It does forward through the deterministic calculation engine.
    expect(body).toContain('calculateScaffoldMaterials(input)');
    expect(body).toContain('context.applyCalculation(');
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioral: injected derived values are ignored; stored/surfaced derived
//    values equal the deterministic engine output (Req 8.4, 8.5).
// ---------------------------------------------------------------------------

describe('Property J behavioral: injected derived values are ignored across providers (Req 8.4, 8.5)', () => {
  const polygon = buildRectangle(10.0, 59.0, 0.001, 0.0008);

  it('the example rectangle is a valid perimeter', () => {
    expect(isValidPerimeter(polygon)).toBe(true);
  });

  for (const factory of contextFactories) {
    describe(factory.name, () => {
      it('setBuildingPerimeter stores engine measurements, not an injected measurements/scaffoldLengthMeters/area', async () => {
        // The Geometry_Engine oracle for the SAME polygon (no facade subset).
        const oracleMeasurements = measurePolygon(polygon);
        const oracleScaffoldLength = computeScaffoldLength(oracleMeasurements, null);

        const context = factory.make();
        const dispatch = createToolDispatch(context);

        // Submit the valid polygon PLUS bogus derived values the model might
        // try to slip in alongside it.
        const result = await executeTool(dispatch, context, 'setBuildingPerimeter', {
          polygon,
          scaffoldLengthMeters: 99999,
          areaSquareMeters: 12345,
          measurements: bogusMeasurements(),
          perimeterMeters: 7,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const surfaced = result.data as {
          measurements: PolygonMeasurements | null;
          scaffoldLengthMeters: number | null;
        };

        // The injected values must NOT appear anywhere.
        expect(surfaced.scaffoldLengthMeters).not.toBe(99999);
        expect(surfaced.measurements?.perimeterMeters).not.toBe(1);
        expect(surfaced.measurements?.areaSquareMeters).not.toBe(2);
        expect(surfaced.measurements?.sideLengthsMeters).not.toEqual([9, 9, 9, 9]);

        // The surfaced + stored values equal the engine computation exactly.
        expect(surfaced.measurements?.perimeterMeters).toBe(
          oracleMeasurements.perimeterMeters,
        );
        expect(surfaced.measurements?.areaSquareMeters).toBe(
          oracleMeasurements.areaSquareMeters,
        );
        expect(surfaced.measurements?.sideLengthsMeters).toEqual(
          oracleMeasurements.sideLengthsMeters,
        );
        expect(surfaced.scaffoldLengthMeters).toBe(oracleScaffoldLength);

        const plan = context.getScaffoldPlan();
        expect(plan.measurements?.perimeterMeters).toBe(
          oracleMeasurements.perimeterMeters,
        );
        expect(plan.scaffoldLengthMeters).toBe(oracleScaffoldLength);
      });

      it('selectFacadeSides recomputes Scaffold_Length from the engine, ignoring an injected scaffoldLengthMeters', async () => {
        const context = factory.make();
        const dispatch = createToolDispatch(context);

        // A perimeter must exist before facade indices are valid.
        const stored = await executeTool(dispatch, context, 'setBuildingPerimeter', {
          polygon,
        });
        expect(stored.ok).toBe(true);

        const measurements = context.getScaffoldPlan().measurements as PolygonMeasurements;
        const expectedForSide0 = computeScaffoldLength(measurements, [0]);

        const result = await executeTool(dispatch, context, 'selectFacadeSides', {
          sideIndices: [0],
          scaffoldLengthMeters: 88888,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const surfaced = result.data as { scaffoldLengthMeters: number | null };
        expect(surfaced.scaffoldLengthMeters).not.toBe(88888);
        expect(surfaced.scaffoldLengthMeters).toBe(expectedForSide0);
        expect(context.getScaffoldPlan().scaffoldLengthMeters).toBe(expectedForSide0);
      });

      it('updateWorkingHeight ignores injected measurements/scaffoldLengthMeters and leaves derived state untouched', async () => {
        const context = factory.make();
        const dispatch = createToolDispatch(context);

        const result = await executeTool(dispatch, context, 'updateWorkingHeight', {
          heightMeters: 10,
          scaffoldLengthMeters: 7777,
          measurements: bogusMeasurements(),
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const plan = context.getScaffoldPlan();
        // The legitimate input was applied ...
        expect(plan.workingHeightMeters).toBe(10);
        // ... but no derived value was written (no perimeter was ever set).
        expect(plan.measurements).toBeNull();
        expect(plan.scaffoldLengthMeters).toBeNull();
      });

      it('calculateScaffoldMaterials surfaces the engine output, ignoring an injected materialList/quantity/bay/level counts', async () => {
        const validInput: ScaffoldCalculationInput = {
          scaffoldLengthMeters: 40,
          workingHeightMeters: 12,
          bayLengthMeters: 3,
          liftHeightMeters: 2,
          scaffoldWidthMeters: 1,
          scaffoldSystemId: 'generic-frame',
        };

        // Engine oracle for the legitimate inputs only.
        const engine = calculateScaffoldMaterials(validInput);
        expect(engine.ok).toBe(true);
        if (!engine.ok) return;
        const expected: ScaffoldCalculationOutput = engine.output;

        const context = factory.make();
        const dispatch = createToolDispatch(context);

        // Inject fabricated derived OUTPUT alongside the legitimate inputs.
        const injected = {
          ...validInput,
          materialList: [
            { id: 'fake', itemName: 'Bogus part', quantity: 99999, unit: 'pcs' },
          ],
          numberOfBays: 99999,
          numberOfLevels: 88888,
          totalScaffoldLengthMeters: 12345,
          warnings: ['fabricated'],
        };

        const result = await executeTool(
          dispatch,
          context,
          'calculateScaffoldMaterials',
          injected,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const surfaced = result.data as ScaffoldCalculationOutput;

        // None of the fabricated derived values survive.
        expect(surfaced.numberOfBays).not.toBe(99999);
        expect(surfaced.numberOfLevels).not.toBe(88888);
        expect(surfaced.totalScaffoldLengthMeters).not.toBe(12345);
        expect(surfaced.materialList.some((item) => item.id === 'fake')).toBe(false);

        // The surfaced output is exactly the deterministic engine output.
        expect(surfaced).toEqual(expected);

        // The plan stored the engine output, not the injected quantities.
        const plan = context.getScaffoldPlan();
        expect(plan.calculation).toEqual(expected);
        expect(plan.materialListAdjusted).toEqual(expected.materialList);
        expect(plan.materialListAdjusted?.some((item) => item.id === 'fake')).toBe(
          false,
        );
      });
    });
  }
});
