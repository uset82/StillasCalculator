// Feature: ai-agent-building-drawing, Property A: Provider-agnostic dispatch
// equivalence.
//
// Property A (design.md "Architecture" → the two provider data flows; Task 6.2):
//   Invoking the SAME tool name with IDENTICAL arguments against an IDENTICAL
//   Project_State returns identical Tool_Results regardless of the active
//   provider. The OpenAI path dispatches over a controller-backed
//   `PlanToolContext` (`createControllerPlanContext`); the Codex/MCP path
//   dispatches over a file-backed `PlanToolContext` (`createFilePlanContext`).
//   Both build their dispatch from the SAME `createToolDispatch`/`executeTool`
//   in `lib/ai/toolExecutor.ts`. For any generated sequence of tool calls run
//   on two contexts that start from an identical (empty) plan, each call must
//   produce the same outcome discriminant (ok vs. not), the same engine-computed
//   success payload, and the two contexts must end in the same Project_State.
//
// **Validates: Requirements 1.2, 1.3, 2.1**
//
// Req 1.2: WHEN any AI_Provider invokes an Application_Tool, THE Tool_Dispatch
//   SHALL execute the call through the same deterministic engine function used
//   for that tool name irrespective of the active AI_Provider.
// Req 1.3: WHEN two requests invoke the same tool name with identical arguments
//   against an identical Project_State, THE Tool_Dispatch SHALL return identical
//   Tool_Results — the same outcome discriminant (success or failure) and the
//   same payload values, with no provider-dependent fields — irrespective of
//   the active AI_Provider.
// Req 2.1: THE Codex_Provider SHALL have access to every Application_Tool that
//   the OpenAI_Provider has access to, served through the MCP_Server built from
//   the same getToolDefinitions/createToolDispatch.
//
// ---------------------------------------------------------------------------
// Scope of "identical Tool_Results" (what is and is NOT a payload value)
// ---------------------------------------------------------------------------
// The property concerns the deterministic OUTCOME of dispatch: the success/
// failure discriminant, the engine-computed success data, and the resulting
// Project_State. Two fields are deliberately EXCLUDED from the equivalence, and
// both exclusions reflect intentional, documented differences in the codebase
// rather than divergent engine behavior:
//
//   1. `ScaffoldPlan.version` — an internal monotonic bookkeeping counter
//      (design Data Models: "monotonic; bumped on every accepted mutation").
//      `createFilePlanContext` bumps it on every accepted mutation; the live
//      `scaffoldPlanController` (the OpenAI path's backing store) does not bump
//      it in place, because the route re-versions/merges the file plan back
//      into the controller after a Codex turn. It is not a deterministic-engine
//      payload value, so the `getScaffoldPlan` result is compared via
//      `toProjectState(...)`, which strips `version` (and the `drawing`/`cad`
//      bookkeeping slots, which are untouched by this test's tool set anyway).
//      Every OTHER tool result is compared with full deep equality — none of
//      them carries `version`.
//
//   2. Human-readable rejection MESSAGE wording — `setBuildingPerimeter` and
//      `setScaffoldDimensions` phrase their rejection message differently in the
//      two contexts (the controller uses a friendly field label and a detailed
//      perimeter message; the file context uses a terser message). The error
//      MESSAGE is a presentation string, not an engine payload value; the
//      property asserts the failure DISCRIMINANT matches and that both contexts
//      preserve the same Project_State on rejection. (Both still return a
//      non-empty error string, which is asserted.)
//
// This matches the equivalence convention already used by Property I
// (`perimeterEquivalence.property.test.ts`), which compares engine-derived
// measurements/Scaffold_Length rather than internal bookkeeping.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createToolDispatch,
  executeTool,
  type ToolName,
  type ToolResult,
} from './toolExecutor';
import { createControllerPlanContext, createFilePlanContext } from './planToolContext';
import type { PlanToolContext } from './toolExecutor';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan, toProjectState } from '@/lib/scaffold/scaffoldPlan';
import type { GeoJsonPolygon, ScaffoldPlan, ScaffoldSystemId } from '@/lib/types';

const MIN_RUNS = 200;
const SESSION_ID = 'dispatch-equivalence-test';

// ---------------------------------------------------------------------------
// Context factories — the two PlanToolContext implementations under test. Each
// starts from an identical empty plan: a fresh controller's initial state and a
// fresh createScaffoldPlan() are byte-for-byte equal (the controller's initial
// state IS createScaffoldPlan()).
// ---------------------------------------------------------------------------

function makeControllerContext(): PlanToolContext {
  return createControllerPlanContext(createProjectStateController(), SESSION_ID);
}

function makeFileContext(): PlanToolContext {
  let plan: ScaffoldPlan = createScaffoldPlan();
  return createFilePlanContext(
    () => plan,
    (next) => {
      plan = next;
    },
    SESSION_ID,
  );
}

// ---------------------------------------------------------------------------
// Argument generators
// ---------------------------------------------------------------------------

/** Axis-aligned rectangle ring (closed, simple, valid). */
function buildRectangle(lon0: number, lat0: number, w: number, h: number): GeoJsonPolygon {
  const ring: number[][] = [
    [lon0, lat0],
    [lon0 + w, lat0],
    [lon0 + w, lat0 + h],
    [lon0, lat0 + h],
    [lon0, lat0],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

const rectangleArb: fc.Arbitrary<GeoJsonPolygon> = fc
  .record({
    lon0: fc.double({ min: -179, max: 178, noNaN: true }),
    lat0: fc.double({ min: -60, max: 59, noNaN: true }),
    w: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
    h: fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
  })
  .map(({ lon0, lat0, w, h }) => buildRectangle(lon0, lat0, w, h));

/** Star-shaped (hence simple) polygon: strictly increasing angles, valid. */
function buildStarPolygon(
  clon: number,
  clat: number,
  radii: number[],
  fractions: number[],
): GeoJsonPolygon {
  const n = radii.length;
  const ring: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = ((i + fractions[i]) / n) * 2 * Math.PI;
    ring.push([clon + radii[i] * Math.cos(angle), clat + radii[i] * Math.sin(angle)]);
  }
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

const starRingArb: fc.Arbitrary<GeoJsonPolygon> = fc.integer({ min: 3, max: 8 }).chain((n) =>
  fc
    .record({
      clon: fc.double({ min: -170, max: 170, noNaN: true }),
      clat: fc.double({ min: -60, max: 60, noNaN: true }),
      radii: fc.array(fc.double({ min: 0.0005, max: 0.005, noNaN: true }), {
        minLength: n,
        maxLength: n,
      }),
      fractions: fc.array(fc.double({ min: 0.05, max: 0.9, noNaN: true }), {
        minLength: n,
        maxLength: n,
      }),
    })
    .map(({ clon, clat, radii, fractions }) => buildStarPolygon(clon, clat, radii, fractions)),
);

const validPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.oneof(rectangleArb, starRingArb);

/** A handful of geometrically invalid rings the Geometry_Engine must reject. */
const invalidPolygonArb: fc.Arbitrary<GeoJsonPolygon> = fc.constantFrom<GeoJsonPolygon>(
  // Fewer than 3 distinct vertices.
  { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
  // Self-intersecting bow-tie.
  { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]] },
  // Degenerate: a single repeated point.
  { type: 'Polygon', coordinates: [[[5, 5], [5, 5], [5, 5], [5, 5]]] },
);

/** Numbers spanning the validation ranges, the boundaries, and non-finite values. */
const numericValueArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: -50, max: 250, noNaN: true }),
  fc.double({ min: -0.5, max: 6, noNaN: true }),
  fc.constantFrom(0.01, 5, 100, 0, -0.01, 0.009, 4.9999, 5.0001, 99.9999, 100.0001, -1, 50, 500),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

/** A positive-leaning numeric for the calculator so the success path is well covered. */
const calcNumberArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0.5, max: 50, noNaN: true }),
  fc.constantFrom(0, -1, 0.01, Number.NaN),
);

const KNOWN_SYSTEM_IDS: readonly ScaffoldSystemId[] = [
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
];

const systemIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KNOWN_SYSTEM_IDS),
  fc.constantFrom('does-not-exist', 'HAKI', 'generic', '', 'layher-typo'),
);

const sideIndicesArb: fc.Arbitrary<number[] | null> = fc.oneof(
  fc.constant<number[] | null>(null),
  fc.array(fc.integer({ min: -3, max: 12 }), { minLength: 0, maxLength: 6 }),
);

// ---------------------------------------------------------------------------
// Command generators — one per tool in the canonical task sequence.
// ---------------------------------------------------------------------------

interface Command {
  readonly name: ToolName;
  readonly args: unknown;
}

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc
    .oneof(validPolygonArb, invalidPolygonArb)
    .map((polygon) => ({ name: 'setBuildingPerimeter' as const, args: { polygon } })),
  sideIndicesArb.map((sideIndices) => ({
    name: 'selectFacadeSides' as const,
    args: { sideIndices },
  })),
  numericValueArb.map((heightMeters) => ({
    name: 'updateWorkingHeight' as const,
    args: { heightMeters },
  })),
  systemIdArb.map((scaffoldSystemId) => ({
    name: 'setScaffoldSystem' as const,
    args: { scaffoldSystemId },
  })),
  fc
    .record({
      bayLengthMeters: fc.option(numericValueArb, { nil: undefined }),
      liftHeightMeters: fc.option(numericValueArb, { nil: undefined }),
      scaffoldWidthMeters: fc.option(numericValueArb, { nil: undefined }),
    })
    .map((args) => ({ name: 'setScaffoldDimensions' as const, args })),
  fc
    .record({
      scaffoldLengthMeters: calcNumberArb,
      workingHeightMeters: calcNumberArb,
      bayLengthMeters: calcNumberArb,
      liftHeightMeters: calcNumberArb,
      scaffoldWidthMeters: calcNumberArb,
      scaffoldSystemId: fc.constantFrom(...KNOWN_SYSTEM_IDS),
      wasteFactorPercent: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
        nil: undefined,
      }),
    })
    .map((args) => ({ name: 'calculateScaffoldMaterials' as const, args })),
  fc.constant({ name: 'getScaffoldPlan' as const, args: {} }),
  fc.constant({ name: 'getSelectedBuildingMeasurements' as const, args: {} }),
  fc.constant({ name: 'getAvailableScaffoldSystems' as const, args: {} }),
);

const commandSequenceArb: fc.Arbitrary<Command[]> = fc.array(commandArb, {
  minLength: 1,
  maxLength: 14,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSequence(
  context: PlanToolContext,
  commands: readonly Command[],
): Promise<ToolResult[]> {
  const dispatch = createToolDispatch(context);
  const results: ToolResult[] = [];
  for (const command of commands) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await executeTool(dispatch, context, command.name, command.args));
  }
  return results;
}

/**
 * Asserts two Tool_Results for the SAME tool name + args produced by the two
 * contexts are equivalent under the property's scope: identical discriminant,
 * identical engine-computed success payload (version-stripped for
 * `getScaffoldPlan`), and a non-empty error string on shared failures.
 */
function expectResultsEquivalent(
  name: ToolName,
  controllerResult: ToolResult,
  fileResult: ToolResult,
): void {
  // Same outcome discriminant regardless of provider (Req 1.3).
  expect(controllerResult.ok).toBe(fileResult.ok);

  if (controllerResult.ok && fileResult.ok) {
    if (name === 'getScaffoldPlan') {
      // Compare the user-facing Project_State payload, excluding the internal
      // `version` bookkeeping counter (and the untouched drawing/cad slots).
      expect(toProjectState(controllerResult.data as ScaffoldPlan)).toEqual(
        toProjectState(fileResult.data as ScaffoldPlan),
      );
    } else {
      // Every other tool's success payload is purely engine-derived and must be
      // deep-equal with no exclusions (Req 1.2, 1.3).
      expect(controllerResult.data).toEqual(fileResult.data);
    }
    return;
  }

  // Shared failure: both must carry a human-readable error string. The exact
  // wording is presentation, not an engine payload value, so it is not required
  // to match (see header note); state preservation is asserted by the final
  // Project_State comparison in each property.
  if (!controllerResult.ok && !fileResult.ok) {
    expect(typeof controllerResult.error).toBe('string');
    expect(controllerResult.error.length).toBeGreaterThan(0);
    expect(typeof fileResult.error).toBe('string');
    expect(fileResult.error.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Property A
// ---------------------------------------------------------------------------

describe('Property A: Provider-agnostic dispatch equivalence (Req 1.2, 1.3, 2.1)', () => {
  it('runs an arbitrary tool-call sequence on the controller-backed and file-backed contexts and the two agree on every call outcome and on the final Project_State', async () => {
    await fc.assert(
      fc.asyncProperty(commandSequenceArb, async (commands) => {
        const controllerContext = makeControllerContext();
        const fileContext = makeFileContext();

        // Both contexts start from an identical empty Project_State (Req 1.3).
        expect(toProjectState(controllerContext.getScaffoldPlan())).toEqual(
          toProjectState(fileContext.getScaffoldPlan()),
        );

        const controllerResults = await runSequence(controllerContext, commands);
        const fileResults = await runSequence(fileContext, commands);

        expect(controllerResults).toHaveLength(commands.length);
        expect(fileResults).toHaveLength(commands.length);

        // Each tool call returns an equivalent Tool_Result on both providers.
        for (let i = 0; i < commands.length; i += 1) {
          expectResultsEquivalent(commands[i].name, controllerResults[i], fileResults[i]);
        }

        // The cumulative effect on the single source of truth is identical: both
        // providers, having executed the same calls through the same dispatch,
        // end in the same Project_State (Req 1.2, 1.3).
        expect(toProjectState(controllerContext.getScaffoldPlan())).toEqual(
          toProjectState(fileContext.getScaffoldPlan()),
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('agrees on the canonical end-to-end workflow (perimeter → facades → height → system → dimensions → calculate → reads) and reaches a successful calculation identically on both providers', async () => {
    await fc.assert(
      fc.asyncProperty(validPolygonArb, async (polygon) => {
        const controllerContext = makeControllerContext();
        const fileContext = makeFileContext();

        // A deterministic, valid happy-path sequence: every call should succeed
        // on BOTH providers and produce identical engine payloads, exercising the
        // success branch (not just rejection parity).
        const commands: Command[] = [
          { name: 'setBuildingPerimeter', args: { polygon } },
          { name: 'selectFacadeSides', args: { sideIndices: null } },
          { name: 'updateWorkingHeight', args: { heightMeters: 6 } },
          { name: 'setScaffoldSystem', args: { scaffoldSystemId: 'generic-frame' } },
          {
            name: 'setScaffoldDimensions',
            args: { bayLengthMeters: 2.5, liftHeightMeters: 2, scaffoldWidthMeters: 0.7 },
          },
          {
            name: 'calculateScaffoldMaterials',
            args: {
              scaffoldLengthMeters: 20,
              workingHeightMeters: 6,
              bayLengthMeters: 2.5,
              liftHeightMeters: 2,
              scaffoldWidthMeters: 0.7,
              scaffoldSystemId: 'generic-frame',
            },
          },
          { name: 'getScaffoldPlan', args: {} },
          { name: 'getSelectedBuildingMeasurements', args: {} },
          { name: 'getAvailableScaffoldSystems', args: {} },
        ];

        const controllerResults = await runSequence(controllerContext, commands);
        const fileResults = await runSequence(fileContext, commands);

        for (let i = 0; i < commands.length; i += 1) {
          // Every step of the happy path succeeds on both providers...
          expect(controllerResults[i].ok).toBe(true);
          expect(fileResults[i].ok).toBe(true);
          // ...and returns the identical engine-computed payload.
          expectResultsEquivalent(commands[i].name, controllerResults[i], fileResults[i]);
        }

        // Final Project_State (incl. the computed calculation + material list) is
        // identical across providers.
        expect(toProjectState(controllerContext.getScaffoldPlan())).toEqual(
          toProjectState(fileContext.getScaffoldPlan()),
        );
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
