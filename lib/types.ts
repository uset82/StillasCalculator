// Core domain types for StillasCalculator.
//
// This module is the single, shared definition of the data shapes that flow
// through the whole application: the Project_State (single source of truth,
// Req 17.1), the geometry/scaffold engine inputs and outputs, validation
// results, and the AI chat message shape. The deterministic engines, the state
// controller, the service adapters, the UI, and the export serializers all
// import from here so that the same shape is used end-to-end.
//
// It also exports the fixed Verification_Disclaimer constant (Req 15.4-15.6),
// placed here so both the material-list UI and the PDF/CSV export modules can
// import it from a single location.

// ---------------------------------------------------------------------------
// Identifiers and enumerations
// ---------------------------------------------------------------------------

/**
 * The exactly-five selectable scaffold systems (Req 7.1).
 * `custom` is the user-editable "Custom Dimensions" system (Req 7.5).
 */
export type ScaffoldSystemId =
  | 'generic-frame'
  | 'haki'
  | 'layher'
  | 'instant-alufase'
  | 'custom';

/**
 * The editable scaffold dimension fields that the state controller's
 * `setDimension` updater accepts (Req 7.3, 8.2).
 */
export type DimensionField =
  | 'bayLengthMeters'
  | 'liftHeightMeters'
  | 'scaffoldWidthMeters';

/**
 * Roles for AI Assistant chat messages (Req 12.1).
 */
export type ChatRole = 'user' | 'assistant' | 'system';

// ---------------------------------------------------------------------------
// Geometry types
// ---------------------------------------------------------------------------

/**
 * A GeoJSON Polygon restricted to a single closed linear ring expressed as
 * [longitude, latitude] coordinate pairs (Req 5, 6).
 */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [ [ [lon,lat], ... , [lon,lat] ] ] closed ring
}

/**
 * Output of the Geometry Engine for a perimeter polygon (Req 6.1-6.3, 6.10).
 */
export interface PolygonMeasurements {
  perimeterMeters: number; // Req 6.1
  areaSquareMeters: number; // Req 6.2
  sideLengthsMeters: number[]; // one entry per polygon side, in ring order (Req 6.3)
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/**
 * A geocoded address selection that recenters the map and seeds the workflow
 * (Req 3, 14.5, 17.1).
 */
export interface AddressSelection {
  label: string;
  lat: number;
  lon: number;
}

/**
 * A single normalized geocoding suggestion returned by the
 * `/api/geocoding/photon` server route and consumed by the client geocoding
 * adapter (Req 3.3). Both the Photon and Nominatim providers are normalized to
 * this shape before leaving the trust boundary.
 */
export interface GeocodingResult {
  label: string;
  lat: number;
  lon: number;
}

/**
 * Response body of the `/api/geocoding/photon` server route.
 *
 * - `results` holds up to the first 5 normalized suggestions (Req 3.3).
 * - `noMatch` is `true` when both Photon and Nominatim failed to return any
 *   usable result, signalling the client to show the "no matching address"
 *   message while preserving the current map view/marker (Req 3.7).
 * - `rateLimited` is `true` when the per-session limit of at most 1 request
 *   per 300 ms was exceeded (Req 3.8).
 */
export interface GeocodingResponse {
  results: GeocodingResult[];
  noMatch?: boolean;
  rateLimited?: boolean;
}

// ---------------------------------------------------------------------------
// Scaffold library
// ---------------------------------------------------------------------------

/**
 * A selectable scaffold system definition from the Scaffold_Library (Req 7).
 */
export interface ScaffoldSystem {
  id: ScaffoldSystemId;
  displayName: string;
  defaultBayLengthMeters: number;
  defaultScaffoldWidthMeters: number;
  defaultLiftHeightMeters: number;
  isPlaceholder: boolean; // shows the non-certified notice (Req 7.4)
  isCustom: boolean; // user-editable dimensions (Req 7.5)
}

// ---------------------------------------------------------------------------
// Scaffold calculation engine
// ---------------------------------------------------------------------------

/**
 * Input to the deterministic scaffold calculator (Req 8, 9).
 */
export interface ScaffoldCalculationInput {
  scaffoldLengthMeters: number; // from Geometry_Engine (Req 6.7-6.9)
  workingHeightMeters: number; // 0.01..100 (Req 8.1)
  bayLengthMeters: number; // > 0 (Req 9.x)
  liftHeightMeters: number; // > 0 (Req 9.x)
  scaffoldWidthMeters: number;
  scaffoldSystemId: ScaffoldSystemId;
  wasteFactorPercent?: number; // 0..100, default 0 (Req 9.1)
}

/**
 * A single estimated material line item (Req 10).
 */
export interface MaterialItem {
  id: string;
  itemName: string; // non-empty (Req 10.2)
  quantity: number; // non-negative integer (Req 10.2)
  unit: string; // non-empty (Req 10.2)
  notes?: string; // present only when meaningful (Req 11.1)
}

/**
 * Output of a successful scaffold calculation (Req 9.6, 10).
 */
export interface ScaffoldCalculationOutput {
  totalScaffoldLengthMeters: number; // Req 9.6
  numberOfBays: number; // positive integer (Req 9.2)
  numberOfLevels: number; // positive integer (Req 9.4)
  materialList: MaterialItem[]; // Req 10
  warnings: string[]; // Req 10.5
}

/**
 * Error returned when a calculation is rejected: it identifies every offending
 * value (non-positive or out-of-range) and every missing required value
 * (Req 8.4, 9.3, 9.7). Property 9 and Property 16 rely on these fields to
 * confirm the offending/missing values are identified.
 */
export interface InvalidInputError {
  kind: 'invalid-input';
  message: string;
  /** Fields whose supplied value is invalid (e.g. <= 0). */
  invalidFields: string[];
  /** Required fields that were missing or unset (Req 8.4). */
  missingFields: string[];
}

/**
 * Discriminated result of `calculateScaffoldMaterials` (Req 9.3, 9.7).
 */
export type CalculationResult =
  | { ok: true; output: ScaffoldCalculationOutput }
  | { ok: false; error: InvalidInputError };

// ---------------------------------------------------------------------------
// Validation / state update results
// ---------------------------------------------------------------------------

/**
 * Describes a rejected field update: identifies the field and its permitted
 * range so the UI can surface an actionable message while the controller
 * retains the last valid value (Req 6.11, 7.6, 8.3, 11.6, 17.5).
 */
export interface ValidationError {
  field: string;
  message: string;
  /** Human-readable permitted range, e.g. "0 to 100" or "0.01 to 5". */
  permittedRange?: string;
}

/**
 * Result of a state-controller update. `ok: false` carries the
 * `ValidationError` while the prior value is retained (Req 17.5).
 */
export interface UpdateResult {
  ok: boolean;
  error?: ValidationError;
}

// ---------------------------------------------------------------------------
// AI Assistant
// ---------------------------------------------------------------------------

/**
 * A single chat message in the AI Assistant conversation. Stored in
 * chronological order; user messages are bounded to 2000 characters (Req 12.1).
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number; // epoch milliseconds, used to preserve chronological order
}

// ---------------------------------------------------------------------------
// ScaffoldPlan drawing & CAD artifacts
// ---------------------------------------------------------------------------

/** GeoJSON FeatureCollection for 2D scaffold overlay on the map. */
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties?: Record<string, unknown>;
}

/** A single CAD export record stored on the ScaffoldPlan. */
export interface CadExportRecord {
  format: 'scad' | 'stl' | 'dxf';
  pathOrUrl: string;
}

/** 2D drawing layer derived deterministically from geometry + calculation. */
export interface ScaffoldPlanDrawing {
  overlayGeoJson: GeoJsonFeatureCollection | null;
  lastGeneratedAt: number | null;
}

/** CAD model metadata and export paths (OpenSCAD source is deterministic). */
export interface ScaffoldPlanCad {
  openScadSource: string | null;
  parameters: Record<string, number>;
  exports: CadExportRecord[];
  lastGeneratedAt: number | null;
}

// ---------------------------------------------------------------------------
// Project_State (single source of truth, Req 17.1)
// ---------------------------------------------------------------------------

/**
 * The single Project_State record shared by every view (Req 17.1). It holds
 * the selected address, perimeter polygon, measurements, scaffold selection
 * and inputs, calculation results, manual material overrides, and AI state.
 */
export interface ProjectState {
  // Address (Req 3, 14.5, 17.1)
  address: AddressSelection | null;

  // Geometry (Req 5, 6, 17.1)
  perimeterPolygon: GeoJsonPolygon | null;
  measurements: PolygonMeasurements | null;
  selectedFacadeSideIndices: number[] | null; // null = whole perimeter (Req 6.8)
  scaffoldLengthMeters: number | null;

  // Display & adjustment settings (Req 6.5, 6.6)
  decimalPlaces: number; // 0..3, default 2
  wasteFactorPercent: number; // 0..100, default 0

  // Scaffold configuration (Req 7, 8)
  scaffoldSystemId: ScaffoldSystemId | null;
  bayLengthMeters: number | null;
  liftHeightMeters: number | null;
  scaffoldWidthMeters: number | null;
  workingHeightMeters: number | null;

  // Results (Req 9, 10, 11)
  calculation: ScaffoldCalculationOutput | null;
  materialListAdjusted: MaterialItem[] | null; // manual overrides (Req 11.4)

  // AI (Req 12, 14.6)
  aiMessages: ChatMessage[];
  aiSummary: string | null;
}

/**
 * The central ScaffoldPlan JSON model: Project_State plus drawing/CAD artifacts
 * and a monotonic version for sync between the AI tool layer and the UI.
 */
export interface ScaffoldPlan extends ProjectState {
  version: number;
  drawing: ScaffoldPlanDrawing;
  cad: ScaffoldPlanCad;
}

// ---------------------------------------------------------------------------
// Verification disclaimer (constant, Req 15.4-15.6)
// ---------------------------------------------------------------------------

/**
 * The fixed Verification_Disclaimer shown inline on the material-list view
 * (Req 15.1) and embedded in every PDF and CSV export (Req 15.2, 15.3).
 *
 * It states that the output is an estimated planning report requiring
 * professional verification before use (Req 15.4) and that wall ties and
 * anchors must be verified manually (Req 15.5). It uses planning-estimate
 * terminology and deliberately avoids describing a scaffold as certified,
 * approved, or safe for use (Req 15.6).
 */
export const VERIFICATION_DISCLAIMER: string =
  'This material list is an estimated planning report intended for procurement ' +
  'and planning purposes only. All quantities are planning estimates and ' +
  'require professional verification by a qualified scaffolding expert before ' +
  'use. Wall ties and anchors must be verified manually. This planning ' +
  'estimate does not constitute an engineering sign-off and must not be ' +
  'relied upon as a final structural specification.';
