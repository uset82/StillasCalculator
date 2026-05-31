// Project_State controller — the single source of truth (Req 17.1).
//
// StillasCalculator keeps exactly one `ProjectState` record in memory and
// routes every read and mutation through this controller. Centralizing state
// here is what lets the app guarantee that the map, calculator, material list,
// AI assistant, and export views all observe identical values (Req 17.1-17.4),
// that field validation is applied uniformly (Req 6.11, 7.6, 8.3, 11.6, 17.5),
// and that subscribers are notified whenever the state actually changes.
//
// This file (task 5.1) implements:
//   - the single in-memory `ProjectState` with sensible defaults;
//   - `getState` and `subscribe` (the latter returning an unsubscribe handle);
//   - per-consumer selectors (map, calculator, material list, AI, export) that
//     project the slice of state each view needs while staying deeply-equal to
//     `Project_State` (Req 17.2, 17.3); and
//   - the geometry updaters `setAddress`, `setPerimeter`, and
//     `setSelectedFacades`. `setPerimeter` validates the ring with the Geometry
//     Engine and, on valid input, stores the closed polygon and recomputes the
//     measurements and Scaffold_Length; on invalid input it rejects the change
//     and retains the last valid measurements (Req 5.5, 5.7, 5.8, 6.10).
//     `setSelectedFacades` recomputes the Scaffold_Length from the selected
//     facade subset (Req 6.7, 6.8).
//
// The scalar-field validation updaters (`setWasteFactor`, `setDecimalPlaces`,
// `setWorkingHeight`, `setDimension`, `setScaffoldSystem`, `setMaterialQuantity`)
// and the result updater (`applyCalculation`) are added in task 5.2; the class
// is structured so they slot in alongside the geometry updaters below.

import type {
  AddressSelection,
  ChatMessage,
  DimensionField,
  GeoJsonFeatureCollection,
  GeoJsonPolygon,
  MaterialItem,
  PolygonMeasurements,
  ProjectState,
  ScaffoldCalculationOutput,
  ScaffoldPlan,
  ScaffoldPlanCad,
  ScaffoldSystemId,
  UpdateResult,
} from '@/lib/types';
import {
  computeScaffoldLength,
  isValidPerimeter,
  measurePolygon,
} from '@/lib/geometry/turfMeasurements';
import { getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';
import {
  createEmptyCad,
  createEmptyDrawing,
  createScaffoldPlan,
  toProjectState,
} from '@/lib/scaffold/scaffoldPlan';

// ---------------------------------------------------------------------------
// Selector projections
// ---------------------------------------------------------------------------
//
// Each consumer reads only the slice of `Project_State` it needs. The selector
// return shapes are exported so the UI and AI layers can depend on a stable,
// minimal contract instead of the whole state object. Every value returned is
// the same value held in `Project_State`, so selector output is deeply-equal to
// the underlying state (Req 17.2, 17.3).

/** State needed by the map, address search, footprint, and polygon editor views. */
export interface MapSelection {
  address: AddressSelection | null;
  perimeterPolygon: GeoJsonPolygon | null;
  measurements: PolygonMeasurements | null;
  selectedFacadeSideIndices: number[] | null;
  scaffoldLengthMeters: number | null;
  drawingOverlay: GeoJsonFeatureCollection | null;
}

/** State needed by the scaffold configuration and calculator form. */
export interface CalculatorSelection {
  scaffoldLengthMeters: number | null;
  workingHeightMeters: number | null;
  bayLengthMeters: number | null;
  liftHeightMeters: number | null;
  scaffoldWidthMeters: number | null;
  scaffoldSystemId: ScaffoldSystemId | null;
  wasteFactorPercent: number;
  decimalPlaces: number;
}

/** State needed by the material-list view (results plus manual overrides). */
export interface MaterialListSelection {
  calculation: ScaffoldCalculationOutput | null;
  materialListAdjusted: MaterialItem[] | null;
  scaffoldLengthMeters: number | null;
  decimalPlaces: number;
}

/** State needed by the AI assistant: conversation plus the context its tools read. */
export interface AiSelection {
  aiMessages: ChatMessage[];
  aiSummary: string | null;
  measurements: PolygonMeasurements | null;
  scaffoldLengthMeters: number | null;
  scaffoldSystemId: ScaffoldSystemId | null;
  workingHeightMeters: number | null;
}

/** State needed by the PDF/CSV export serializers. */
export interface ExportSelection {
  address: AddressSelection | null;
  perimeterMeters: number | null;
  scaffoldSystemId: ScaffoldSystemId | null;
  calculation: ScaffoldCalculationOutput | null;
  materialListAdjusted: MaterialItem[] | null;
  aiSummary: string | null;
}

/**
 * Identifies which form is editing a scaffold dimension, because the permitted
 * range differs by context (design "Field Validation Rules"): the scaffold
 * **system editor** allows any value greater than 0 and at most 100 m (Req 7.3),
 * while the **calculator** form constrains the same fields to 0.01–5 m (Req 8.2).
 * The three editable fields are the same (`DimensionField`); only the range
 * changes, so callers pass the context that applies to their form.
 */
export type DimensionContext = 'calculator' | 'systemEditor';

/** A subscriber notified after every state change. */
export type StateListener = (state: ScaffoldPlan) => void;

// ---------------------------------------------------------------------------
// Field-validation helpers
// ---------------------------------------------------------------------------

/** True only for a real, finite number (rejects `NaN`, `Infinity`, non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True for a finite number within the inclusive `[min, max]` range. */
function isInInclusiveRange(value: unknown, min: number, max: number): boolean {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/** True for a finite integer within the inclusive `[min, max]` range. */
function isIntegerInInclusiveRange(
  value: unknown,
  min: number,
  max: number,
): boolean {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Builds a fresh `ProjectState` with the documented defaults (Req 6.5, 6.6,
 * 17.1): no address/perimeter yet, decimal places 2, waste factor 0, and empty
 * AI conversation. A factory (rather than a shared literal) ensures each
 * controller instance owns an independent state object with its own arrays.
 */
function createInitialProjectState(): ScaffoldPlan {
  return createScaffoldPlan();
}

/**
 * Validates a geocoded address selection before it enters `Project_State`:
 * a non-empty label and finite latitude/longitude within geographic bounds.
 */
function isValidAddress(address: AddressSelection): boolean {
  return (
    !!address &&
    typeof address.label === 'string' &&
    address.label.trim().length > 0 &&
    Number.isFinite(address.lat) &&
    Number.isFinite(address.lon) &&
    address.lat >= -90 &&
    address.lat <= 90 &&
    address.lon >= -180 &&
    address.lon <= 180
  );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Owns a single `ScaffoldPlan` and exposes the typed read/update API used by
 * every view (Req 17.1). Construct one instance per application; tests may
 * create isolated instances via {@link createProjectStateController}.
 */
export class ProjectStateController {
  private state: ScaffoldPlan = createInitialProjectState();

  private readonly listeners = new Set<StateListener>();

  // -------------------------------------------------------------------------
  // Reads & subscriptions
  // -------------------------------------------------------------------------

  /**
   * Returns the current `ScaffoldPlan`. Updates always replace the state with
   * a new object, so callers can detect changes by reference.
   */
  getState(): ScaffoldPlan {
    return this.state;
  }

  /** Returns the Project_State slice (backward compatible). */
  getProjectState(): ProjectState {
    return toProjectState(this.state);
  }

  getScaffoldPlan(): ScaffoldPlan {
    return this.state;
  }

  /** Replaces the entire plan (used after AI tool sync). */
  applyScaffoldPlan(plan: ScaffoldPlan): void {
    this.state = {
      ...plan,
      drawing: plan.drawing ?? createEmptyDrawing(),
      cad: plan.cad ?? createEmptyCad(),
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Registers a listener invoked after every state change. Returns an
   * unsubscribe function that removes the listener; calling it more than once
   * is safe.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Per-consumer selectors (Req 17.2, 17.3)
  // -------------------------------------------------------------------------

  /** Map / address / footprint / polygon-editor projection. */
  selectMap(): MapSelection {
    return {
      address: this.state.address,
      perimeterPolygon: this.state.perimeterPolygon,
      measurements: this.state.measurements,
      selectedFacadeSideIndices: this.state.selectedFacadeSideIndices,
      scaffoldLengthMeters: this.state.scaffoldLengthMeters,
      drawingOverlay: this.state.drawing.overlayGeoJson,
    };
  }

  /** Scaffold configuration / calculator-form projection. */
  selectCalculator(): CalculatorSelection {
    return {
      scaffoldLengthMeters: this.state.scaffoldLengthMeters,
      workingHeightMeters: this.state.workingHeightMeters,
      bayLengthMeters: this.state.bayLengthMeters,
      liftHeightMeters: this.state.liftHeightMeters,
      scaffoldWidthMeters: this.state.scaffoldWidthMeters,
      scaffoldSystemId: this.state.scaffoldSystemId,
      wasteFactorPercent: this.state.wasteFactorPercent,
      decimalPlaces: this.state.decimalPlaces,
    };
  }

  /** Material-list projection: computed results plus manual overrides. */
  selectMaterialList(): MaterialListSelection {
    return {
      calculation: this.state.calculation,
      materialListAdjusted: this.state.materialListAdjusted,
      scaffoldLengthMeters: this.state.scaffoldLengthMeters,
      decimalPlaces: this.state.decimalPlaces,
    };
  }

  /** AI-assistant projection: conversation plus the context its tools read. */
  selectAi(): AiSelection {
    return {
      aiMessages: this.state.aiMessages,
      aiSummary: this.state.aiSummary,
      measurements: this.state.measurements,
      scaffoldLengthMeters: this.state.scaffoldLengthMeters,
      scaffoldSystemId: this.state.scaffoldSystemId,
      workingHeightMeters: this.state.workingHeightMeters,
    };
  }

  /** Export projection consumed by the PDF/CSV serializers. */
  selectExport(): ExportSelection {
    const { measurements } = this.state;
    return {
      address: this.state.address,
      perimeterMeters:
        measurements && measurements.valid ? measurements.perimeterMeters : null,
      scaffoldSystemId: this.state.scaffoldSystemId,
      calculation: this.state.calculation,
      materialListAdjusted: this.state.materialListAdjusted,
      aiSummary: this.state.aiSummary,
    };
  }

  // -------------------------------------------------------------------------
  // Geometry updaters (task 5.1)
  // -------------------------------------------------------------------------

  /**
   * Stores the selected geocoded address (Req 3, 17.1). A malformed address
   * (empty label or out-of-range/non-finite coordinates) is rejected and the
   * previous address is retained (Req 17.5).
   */
  setAddress(address: AddressSelection): UpdateResult {
    if (!isValidAddress(address)) {
      return {
        ok: false,
        error: {
          field: 'address',
          message:
            'The address must have a non-empty label and valid latitude/longitude coordinates.',
          permittedRange: 'lat -90 to 90, lon -180 to 180',
        },
      };
    }

    this.setState({
      ...this.state,
      address: { label: address.label, lat: address.lat, lon: address.lon },
    });
    return { ok: true };
  }

  /**
   * Validates and stores the building perimeter (Req 5.5, 5.7, 5.8, 6.10).
   *
   * On a valid ring (closed, ≥3 distinct vertices, no self-intersection) the
   * controller stores the closed GeoJSON polygon, recomputes the measurements
   * via the Geometry Engine, and recomputes the Scaffold_Length from the
   * current facade selection. On an invalid ring the change is rejected: the
   * polygon, measurements, and Scaffold_Length are all left untouched so the
   * last valid measurements remain in `Project_State` (Req 6.10).
   */
  setPerimeter(polygon: GeoJsonPolygon): UpdateResult {
    if (!isValidPerimeter(polygon)) {
      return {
        ok: false,
        error: {
          field: 'perimeterPolygon',
          message:
            'The perimeter must be a closed ring of at least 3 distinct vertices with no self-intersecting sides.',
        },
      };
    }

    const measurements = measurePolygon(polygon);
    const scaffoldLengthMeters = computeScaffoldLengthFor(
      measurements,
      this.state.selectedFacadeSideIndices,
    );

    this.setState({
      ...this.state,
      perimeterPolygon: polygon,
      measurements,
      scaffoldLengthMeters,
    });
    return { ok: true };
  }

  /**
   * Clears the stored building perimeter, returning the geometry slice of
   * `Project_State` to its empty state (Req 5.3). The polygon, the derived
   * measurements, and the Scaffold_Length are all dropped so no perimeter
   * remains; the facade selection is preserved. Wired to the Polygon_Editor's
   * reset action so resetting the editor also clears the perimeter from the
   * single source of truth.
   */
  clearPerimeter(): void {
    if (
      this.state.perimeterPolygon === null &&
      this.state.measurements === null &&
      this.state.scaffoldLengthMeters === null
    ) {
      // Already empty: nothing to change, so notify no subscriber.
      return;
    }

    this.setState({
      ...this.state,
      perimeterPolygon: null,
      measurements: null,
      scaffoldLengthMeters: null,
    });
  }

  /**
   * Sets the target facade subset and recomputes the Scaffold_Length (Req 6.7,
   * 6.8, 6.9). Passing `null` clears the subset so the Scaffold_Length becomes
   * the full perimeter (Req 6.8); an empty array yields a Scaffold_Length of 0
   * (Req 6.9). The selection is copied so later external mutation cannot alter
   * stored state.
   */
  setSelectedFacades(sideIndices: number[] | null): UpdateResult {
    const nextSelection = sideIndices === null ? null : [...sideIndices];
    const scaffoldLengthMeters = computeScaffoldLengthFor(
      this.state.measurements,
      nextSelection,
    );

    this.setState({
      ...this.state,
      selectedFacadeSideIndices: nextSelection,
      scaffoldLengthMeters,
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Scalar-field validation updaters and result updaters — task 5.2.
  // -------------------------------------------------------------------------
  //
  // Each updater enforces the design's "Field Validation Rules" table. The
  // contract is uniform (Property 14 — field validation is total and atomic):
  // a value is accepted iff it is a finite number within range (and an integer
  // where required); on rejection the controller retains the last valid value,
  // leaves the rest of `Project_State` untouched, notifies no subscriber, and
  // returns `{ ok: false, error }` whose `ValidationError` identifies the field
  // and its permitted range (Req 6.11, 7.6, 8.3, 11.6, 17.5). The rule is
  // identical whether the value originates from a manual control or an AI tool
  // call (Req 12.5).

  /**
   * Sets the Waste_Factor percentage (Req 6.6, 6.11). Accepts a finite number
   * in the inclusive range 0–100; any non-numeric or out-of-range value is
   * rejected and the last valid Waste_Factor is retained (Req 6.11).
   */
  setWasteFactor(percent: number): UpdateResult {
    if (!isInInclusiveRange(percent, 0, 100)) {
      return {
        ok: false,
        error: {
          field: 'wasteFactorPercent',
          message:
            'The waste factor must be a number between 0 and 100 percent.',
          permittedRange: '0 to 100',
        },
      };
    }

    this.setState({ ...this.state, wasteFactorPercent: percent });
    return { ok: true };
  }

  /**
   * Sets the number of decimal places used to display measurements (Req 6.5).
   * Accepts an integer in the inclusive range 0–3; non-integer or out-of-range
   * values are rejected and the last valid setting is retained.
   */
  setDecimalPlaces(places: number): UpdateResult {
    if (!isIntegerInInclusiveRange(places, 0, 3)) {
      return {
        ok: false,
        error: {
          field: 'decimalPlaces',
          message: 'The number of decimal places must be a whole number from 0 to 3.',
          permittedRange: '0 to 3 (integer)',
        },
      };
    }

    this.setState({ ...this.state, decimalPlaces: places });
    return { ok: true };
  }

  /**
   * Sets the Working_Height in meters (Req 8.1, 8.3). Accepts a finite number
   * in the inclusive range 0.01–100; non-numeric or out-of-range values are
   * rejected and the last valid Working_Height is retained.
   */
  setWorkingHeight(meters: number): UpdateResult {
    if (!isInInclusiveRange(meters, 0.01, 100)) {
      return {
        ok: false,
        error: {
          field: 'workingHeightMeters',
          message:
            'The working height must be a number between 0.01 and 100 meters.',
          permittedRange: '0.01 to 100',
        },
      };
    }

    this.setState({ ...this.state, workingHeightMeters: meters });
    return { ok: true };
  }

  /**
   * Sets one editable scaffold dimension — Bay_Length, Lift_Height, or
   * Scaffold_Width — to a validated value (Req 7.3, 7.6, 8.2, 8.3).
   *
   * The permitted range depends on `context` (design "Field Validation Rules"):
   * the calculator form constrains the value to 0.01–5 m (Req 8.2), while the
   * scaffold system editor allows greater than 0 and at most 100 m (Req 7.3).
   * The context defaults to `'calculator'`. On any non-numeric or out-of-range
   * value the change is rejected, the previous valid value for that field is
   * retained, and a field-identifying `ValidationError` is returned (Req 7.6,
   * 8.3, 17.5).
   */
  setDimension(
    field: DimensionField,
    value: number,
    context: DimensionContext = 'calculator',
  ): UpdateResult {
    const accepted =
      context === 'systemEditor'
        ? isFiniteNumber(value) && value > 0 && value <= 100
        : isInInclusiveRange(value, 0.01, 5);

    if (!accepted) {
      const permittedRange =
        context === 'systemEditor' ? 'greater than 0 and at most 100' : '0.01 to 5';
      return {
        ok: false,
        error: {
          field,
          message: `The ${dimensionLabel(field)} must be a number ${permittedRange} meters.`,
          permittedRange,
        },
      };
    }

    this.setState({ ...this.state, [field]: value });
    return { ok: true };
  }

  /**
   * Selects a scaffold system and loads its default Bay_Length, Scaffold_Width,
   * and Lift_Height into `Project_State` (Req 7.2). An unknown system id is
   * rejected and the previous selection and dimensions are retained.
   */
  setScaffoldSystem(systemId: ScaffoldSystemId): UpdateResult {
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

    this.setState({
      ...this.state,
      scaffoldSystemId: system.id,
      bayLengthMeters: system.defaultBayLengthMeters,
      scaffoldWidthMeters: system.defaultScaffoldWidthMeters,
      liftHeightMeters: system.defaultLiftHeightMeters,
    });
    return { ok: true };
  }

  /**
   * Manually adjusts the quantity of one Material_List item (Req 11.3, 11.4,
   * 11.6). Accepts an integer in the inclusive range 0–999999 for an item that
   * exists in the current adjusted Material_List; the adjusted value is retained
   * for display and export (Req 11.4). A non-integer, negative, or out-of-range
   * quantity — or an unknown item id — is rejected and the prior quantity is
   * retained (Req 11.6).
   */
  setMaterialQuantity(itemId: string, qty: number): UpdateResult {
    const items = this.state.materialListAdjusted;
    const index = items ? items.findIndex((item) => item.id === itemId) : -1;
    if (!items || index === -1) {
      return {
        ok: false,
        error: {
          field: 'materialQuantity',
          message: `No material list item with id "${itemId}" exists to adjust.`,
        },
      };
    }

    if (!isIntegerInInclusiveRange(qty, 0, 999999)) {
      return {
        ok: false,
        error: {
          field: `materialQuantity:${itemId}`,
          message:
            'The quantity must be a whole number between 0 and 999999.',
          permittedRange: '0 to 999999 (integer)',
        },
      };
    }

    const nextItems = items.map((item, i) =>
      i === index ? { ...item, quantity: qty } : item,
    );
    this.setState({ ...this.state, materialListAdjusted: nextItems });
    return { ok: true };
  }

  /**
   * Applies a completed calculation result, replacing any prior manual quantity
   * adjustments with the newly computed Material_List (Req 11.7). The computed
   * material list becomes the new adjusted list, so every stored/displayed
   * quantity equals the freshly computed value rather than a previous manual
   * one (Property 17). The item array is copied so later calculation results
   * cannot mutate the snapshot stored here.
   */
  applyCalculation(result: ScaffoldCalculationOutput): void {
    this.setState({
      ...this.state,
      calculation: result,
      materialListAdjusted: result.materialList.map((item) => ({ ...item })),
    });
  }

  /**
   * Sets the AI conversation to `messages`, kept in chronological order
   * (Req 12.1). The array is copied so later external mutation cannot alter the
   * stored conversation. Wired to the AI chat flow so user and assistant
   * messages live in the single `Project_State` and every consumer (Req 17.2)
   * observes the same transcript.
   */
  setAiMessages(messages: ChatMessage[]): void {
    this.setState({ ...this.state, aiMessages: messages.map((m) => ({ ...m })) });
  }

  /**
   * Stores the AI-generated report summary so the Report_Module can include it
   * in the exported PDF when present (Req 14.6). Passing `null` clears it.
   */
  setAiSummary(summary: string | null): void {
    this.setState({ ...this.state, aiSummary: summary });
  }

  setDrawingOverlay(overlayGeoJson: GeoJsonFeatureCollection | null): void {
    this.setState({
      ...this.state,
      drawing: {
        overlayGeoJson,
        lastGeneratedAt: overlayGeoJson ? Date.now() : null,
      },
    });
  }

  clearDrawingOverlay(): void {
    this.setDrawingOverlay(null);
  }

  setCadModel(openScadSource: string, parameters: Record<string, number>): void {
    this.setState({
      ...this.state,
      cad: {
        ...this.state.cad,
        openScadSource,
        parameters: { ...parameters },
        lastGeneratedAt: Date.now(),
      },
    });
  }

  addCadExport(
    format: 'scad' | 'stl' | 'dxf',
    pathOrUrl: string,
  ): void {
    this.setState({
      ...this.state,
      cad: {
        ...this.state.cad,
        exports: [...this.state.cad.exports, { format, pathOrUrl }],
      },
    });
  }

  setCadExports(exports: ScaffoldPlanCad['exports']): void {
    this.setState({
      ...this.state,
      cad: {
        ...this.state.cad,
        exports: [...exports],
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Replaces the state with `next` and notifies every subscriber. Updaters call
   * this only after a change is accepted, so a rejected update notifies no one
   * and leaves the state untouched.
   */
  private setState(next: ScaffoldPlan): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/**
 * Derives the Scaffold_Length from the current measurements and facade
 * selection (Req 6.7, 6.8, 6.9). Returns `null` when there is no valid
 * measurement to aggregate, so the calculator can distinguish "no perimeter
 * yet" from a genuine zero-length run.
 */
function computeScaffoldLengthFor(
  measurements: PolygonMeasurements | null,
  selectedFacadeSideIndices: number[] | null,
): number | null {
  if (!measurements || measurements.valid !== true) {
    return null;
  }
  return computeScaffoldLength(measurements, selectedFacadeSideIndices);
}

/**
 * Returns a human-readable label for an editable scaffold dimension field, used
 * to build field-identifying validation messages (Req 7.6, 8.3).
 */
function dimensionLabel(field: DimensionField): string {
  switch (field) {
    case 'bayLengthMeters':
      return 'bay length';
    case 'liftHeightMeters':
      return 'lift height';
    case 'scaffoldWidthMeters':
      return 'scaffold width';
    default:
      return field;
  }
}

/**
 * Creates an isolated `ProjectStateController` with its own `Project_State`.
 * Useful in tests that must not share state between cases.
 */
export function createProjectStateController(): ProjectStateController {
  return new ProjectStateController();
}

/**
 * The application-wide singleton controller — the single `Project_State`
 * instance the whole UI, AI route, and export module share (Req 17.1).
 */
export const projectStateController: ProjectStateController =
  createProjectStateController();

/** Alias for the ScaffoldPlan-backed controller (single source of truth). */
export const scaffoldPlanController = projectStateController;

export type ScaffoldPlanController = ProjectStateController;
