// Feature: ai-agent-building-drawing, Task 5.4 — facade-subset rejection.
//
// Unit tests for the shared `validateFacadeSelection` gate exposed through both
// Plan_Updater implementations' `setSelectedFacades`:
//   - `createControllerPlanContext` (OpenAI / in-process path), and
//   - `createFilePlanContext` (MCP / file-backed path).
//
// The gate accepts `null` (whole perimeter) and integer side indices in the
// range [0, sideCount), where sideCount is the side count of the currently
// stored, validly-measured perimeter (0 when no valid perimeter is stored). A
// non-integer, negative, or out-of-range index — or any index at all when no
// perimeter is stored — is rejected. On rejection the existing facade selection
// must be retained and no partial update applied.
//
// Requirements: 6.8

import { describe, it, expect } from 'vitest';
import {
  createControllerPlanContext,
  createFilePlanContext,
} from './planToolContext';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { PlanToolContext } from '@/lib/ai/toolExecutor';
import type { GeoJsonPolygon, ScaffoldPlan } from '@/lib/types';

// A valid, closed, axis-aligned rectangle ring: 4 distinct vertices => 4 sides,
// so the valid facade side indices are 0..3.
function buildRectangle(): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [10.0, 59.0],
        [10.001, 59.0],
        [10.001, 59.001],
        [10.0, 59.001],
        [10.0, 59.0],
      ],
    ],
  };
}

const SIDE_COUNT = 4;

/**
 * A harness around one Plan_Updater implementation: exposes the `context` under
 * test plus a `getSelection()` reader for the stored facade selection. The
 * `seedPerimeter` flag controls whether a valid 4-side perimeter is stored
 * before the test runs (so we can exercise both the "perimeter present" and
 * "no perimeter" branches of the gate).
 */
interface Harness {
  context: PlanToolContext;
  getSelection: () => number[] | null;
}

type HarnessFactory = (seedPerimeter: boolean) => Harness;

const controllerHarness: HarnessFactory = (seedPerimeter) => {
  const controller = createProjectStateController();
  if (seedPerimeter) {
    const stored = controller.setPerimeter(buildRectangle());
    expect(stored.ok).toBe(true);
  }
  const context = createControllerPlanContext(controller, 'test-session');
  return {
    context,
    getSelection: () => controller.getScaffoldPlan().selectedFacadeSideIndices,
  };
};

const fileHarness: HarnessFactory = (seedPerimeter) => {
  let plan: ScaffoldPlan = createScaffoldPlan();
  const context = createFilePlanContext(
    () => plan,
    (next) => {
      plan = next;
    },
    'test-session',
  );
  if (seedPerimeter) {
    const stored = context.setPerimeter(buildRectangle());
    expect(stored.ok).toBe(true);
  }
  return {
    context,
    getSelection: () => plan.selectedFacadeSideIndices,
  };
};

const implementations: Array<[string, HarnessFactory]> = [
  ['createControllerPlanContext', controllerHarness],
  ['createFilePlanContext', fileHarness],
];

describe.each(implementations)(
  'selectFacadeSides rejection (%s)',
  (_name, makeHarness) => {
    it('accepts null to select the whole perimeter', () => {
      const { context, getSelection } = makeHarness(true);

      // Seed a valid subset so we can confirm null actually replaces it.
      expect(context.setSelectedFacades([0, 1]).ok).toBe(true);
      expect(getSelection()).toEqual([0, 1]);

      const result = context.setSelectedFacades(null);

      expect(result.ok).toBe(true);
      expect(getSelection()).toBeNull();
    });

    it('accepts a valid in-range subset', () => {
      const { context, getSelection } = makeHarness(true);

      const result = context.setSelectedFacades([0, 2, 3]);

      expect(result.ok).toBe(true);
      expect(getSelection()).toEqual([0, 2, 3]);
    });

    it('rejects an out-of-range index and retains the existing selection', () => {
      const { context, getSelection } = makeHarness(true);

      // Establish a valid existing selection to defend.
      expect(context.setSelectedFacades([0, 1]).ok).toBe(true);
      expect(getSelection()).toEqual([0, 1]);

      // SIDE_COUNT is out of range: valid indices are 0..SIDE_COUNT-1.
      const result = context.setSelectedFacades([SIDE_COUNT]);

      expect(result.ok).toBe(false);
      expect(result.error?.field).toBe('selectedFacadeSideIndices');
      // The existing selection is retained on rejection (Req 6.8).
      expect(getSelection()).toEqual([0, 1]);
    });

    it('rejects a negative index and retains the existing selection', () => {
      const { context, getSelection } = makeHarness(true);

      expect(context.setSelectedFacades([2]).ok).toBe(true);
      expect(getSelection()).toEqual([2]);

      const result = context.setSelectedFacades([-1]);

      expect(result.ok).toBe(false);
      expect(result.error?.field).toBe('selectedFacadeSideIndices');
      expect(getSelection()).toEqual([2]);
    });

    it('rejects a non-integer index and retains the existing selection', () => {
      const { context, getSelection } = makeHarness(true);

      expect(context.setSelectedFacades([1, 3]).ok).toBe(true);
      expect(getSelection()).toEqual([1, 3]);

      const result = context.setSelectedFacades([1.5]);

      expect(result.ok).toBe(false);
      expect(result.error?.field).toBe('selectedFacadeSideIndices');
      expect(getSelection()).toEqual([1, 3]);
    });

    it('rejects any index when no perimeter is stored and leaves the selection untouched', () => {
      const { context, getSelection } = makeHarness(false);

      // No perimeter => sideCount is 0, so even index 0 is out of range.
      expect(getSelection()).toBeNull();

      const result = context.setSelectedFacades([0]);

      expect(result.ok).toBe(false);
      expect(result.error?.field).toBe('selectedFacadeSideIndices');
      // The error explains that no perimeter is stored.
      expect(result.error?.message).toContain('outside the stored');
      // No partial update: the selection is unchanged.
      expect(getSelection()).toBeNull();
    });
  },
);
