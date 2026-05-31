// Feature: ai-agent-building-drawing, Property B: Unknown tool is inert.
//
// Property B (design.md "Components and Interfaces" → shared tool layer note,
// Task 6.3): for any tool name that is NOT a defined Application_Tool,
// `executeTool` SHALL
//   1. return a Tool_Result error (`{ ok: false, error }`) that NAMES the
//      unknown tool,
//   2. execute NO deterministic engine function (no Plan_Updater mutation), and
//   3. leave the Project_State byte-for-byte unchanged.
//
// **Validates: Requirements 1.4, 9.5**
//
// Req 1.4: IF an AI_Provider requests a tool name that is not a defined
//   Application_Tool, THEN the Tool_Dispatch SHALL return a Tool_Result error
//   that names the unknown tool, SHALL execute no deterministic engine
//   function, and SHALL leave the Project_State unchanged.
// Req 9.5: IF tool arguments from any AI_Provider fail JSON Schema validation or
//   cannot be parsed, THEN the AI_Agent SHALL reject the tool call without
//   executing the tool and leave the Project_State unchanged. An unknown tool
//   name is the strongest form of "cannot be dispatched" and must be equally
//   inert for arbitrary argument payloads.
//
// Strategy: build a non-trivial, known Project_State on BOTH Plan_Updater
// backends (controller-backed `createControllerPlanContext`, the OpenAI path,
// and file-backed `createFilePlanContext`, the MCP path). Each context is
// wrapped in a tracker that flags if ANY mutating updater is invoked. For every
// generated UNKNOWN tool name — random strings excluding the real ToolName set
// PLUS the Object.prototype member names that a bare `dispatch[name]` lookup
// would resolve through the prototype chain ('toString', 'constructor',
// 'valueOf', 'hasOwnProperty', '__proto__', ...) — and arbitrary argument
// payloads, call `executeTool(dispatch, context, name as ToolName, args)` and
// assert: the result is `{ ok: false }`, the error string contains the name, no
// mutating updater ran, and the plan is deep-equal to the pre-call snapshot.
//
// The prototype-collision names lock in the task 6.1 fix: `executeTool` resolves
// the executor as an OWN, callable property only, so an unknown name colliding
// with an inherited Object.prototype function can never be invoked.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createToolDispatch,
  executeTool,
  getToolDefinitions,
  type PlanToolContext,
  type ToolName,
} from './toolExecutor';
import { createControllerPlanContext, createFilePlanContext } from './planToolContext';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { GeoJsonPolygon, ScaffoldPlan } from '@/lib/types';

const MIN_RUNS = 300;

// The defined Application_Tool names — the single source both providers build
// from. Anything outside this set is an "unknown tool".
const TOOL_NAMES: ReadonlySet<string> = new Set(
  getToolDefinitions().map((definition) => definition.name),
);

// Object.prototype (and Function.prototype) member names. A naive
// `dispatch[name]` lookup would resolve these through the prototype chain; the
// hardened `executeTool` must treat them as unknown tools all the same.
const PROTOTYPE_MEMBER_NAMES: readonly string[] = [
  'toString',
  'toLocaleString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  // Function.prototype members (dispatch is a plain object, but these are
  // common prototype-pollution probes worth locking in regardless).
  'call',
  'apply',
  'bind',
];

// A known, non-trivial perimeter so the Project_State carries real
// engine-computed measurements and Scaffold_Length to protect.
const KNOWN_PERIMETER: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10.0, 59.9],
      [10.0015, 59.9],
      [10.0015, 59.9012],
      [10.0, 59.9012],
      [10.0, 59.9],
    ],
  ],
};

// ---------------------------------------------------------------------------
// Mutation-tracking wrapper: flags any mutating Plan_Updater call.
// ---------------------------------------------------------------------------

const MUTATING_METHODS = [
  'setWorkingHeight',
  'setPerimeter',
  'setSelectedFacades',
  'setScaffoldSystem',
  'setDimension',
  'applyCalculation',
  'setDrawingOverlay',
  'clearDrawingOverlay',
  'setCadModel',
  'addCadExport',
] as const satisfies readonly (keyof PlanToolContext)[];

interface TrackedContext {
  context: PlanToolContext;
  mutatingCalls: () => string[];
}

/**
 * Wraps a PlanToolContext so every mutating updater records its name before
 * delegating. Read-only members (getScaffoldPlan, getCadSessionId,
 * getCadExportDir) pass through untouched. If `executeTool` is inert for an
 * unknown tool, NONE of the mutating members are ever reached.
 */
function trackContext(base: PlanToolContext): TrackedContext {
  const calls: string[] = [];
  const wrapped = { ...base } as PlanToolContext;
  for (const method of MUTATING_METHODS) {
    const original = base[method] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') {
      continue;
    }
    (wrapped as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      calls.push(method);
      return original.apply(base, args);
    };
  }
  return { context: wrapped, mutatingCalls: () => calls };
}

// ---------------------------------------------------------------------------
// Known-state builders for both Plan_Updater backends.
// ---------------------------------------------------------------------------

function buildControllerContext(): TrackedContext {
  const controller = createProjectStateController();
  const perimeter = controller.setPerimeter(KNOWN_PERIMETER);
  expect(perimeter.ok).toBe(true);
  const height = controller.setWorkingHeight(12);
  expect(height.ok).toBe(true);
  return trackContext(createControllerPlanContext(controller, 'session-unknown-tool'));
}

function buildFileContext(): { tracked: TrackedContext; getPlan: () => ScaffoldPlan } {
  let plan: ScaffoldPlan = createScaffoldPlan();
  const baseContext = createFilePlanContext(
    () => plan,
    (next) => {
      plan = next;
    },
    'session-unknown-tool',
  );
  // Seed the same non-trivial state through the file-backed updater.
  expect(baseContext.setPerimeter(KNOWN_PERIMETER).ok).toBe(true);
  expect(baseContext.setWorkingHeight(12).ok).toBe(true);
  return { tracked: trackContext(baseContext), getPlan: () => plan };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Random non-empty strings that are not a defined Application_Tool name. */
const randomUnknownNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((name) => !TOOL_NAMES.has(name));

/** Unknown names: random strings plus the prototype-member collision names. */
const unknownNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: randomUnknownNameArb },
  { weight: 2, arbitrary: fc.constantFrom(...PROTOTYPE_MEMBER_NAMES) },
);

/** Arbitrary, untrusted argument payloads the dispatch must never act on. */
const argsArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.anything(),
  fc.record({ polygon: fc.constant(KNOWN_PERIMETER), heightMeters: fc.double() }),
);

// ---------------------------------------------------------------------------
// Property B
// ---------------------------------------------------------------------------

describe('Property B: Unknown tool is inert (Req 1.4, 9.5)', () => {
  it('controller-backed (OpenAI path): an unknown tool name errors naming the tool, runs no engine function, and leaves Project_State unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(unknownNameArb, argsArb, async (name, args) => {
        // Guard the generator's invariant: the name is genuinely unknown.
        expect(TOOL_NAMES.has(name)).toBe(false);

        const { context, mutatingCalls } = buildControllerContext();
        const dispatch = createToolDispatch(context);

        const before = structuredClone(context.getScaffoldPlan());

        const result = await executeTool(dispatch, context, name as ToolName, args);

        // 1. Tool_Result is a failure naming the unknown tool (Req 1.4).
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain(name);
        }

        // 2. No deterministic engine function / Plan_Updater ran (Req 1.4, 9.5).
        expect(mutatingCalls()).toEqual([]);

        // 3. Project_State is byte-for-byte unchanged (Req 1.4).
        const after = context.getScaffoldPlan();
        expect(after).toEqual(before);
        expect(after.version).toBe(before.version);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('file-backed (MCP path): an unknown tool name errors naming the tool, runs no engine function, and leaves Project_State unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(unknownNameArb, argsArb, async (name, args) => {
        expect(TOOL_NAMES.has(name)).toBe(false);

        const { tracked, getPlan } = buildFileContext();
        const { context, mutatingCalls } = tracked;
        const dispatch = createToolDispatch(context);

        const before = structuredClone(getPlan());

        const result = await executeTool(dispatch, context, name as ToolName, args);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain(name);
        }

        expect(mutatingCalls()).toEqual([]);

        const after = getPlan();
        expect(after).toEqual(before);
        expect(after.version).toBe(before.version);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
