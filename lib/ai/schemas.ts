// AI Assistant JSON Schemas (Req 13.2, 13.3).
//
// This module is the single source of the JSON Schema definitions that the AI
// Assistant uses at its trust boundary:
//
//   1. Tool *parameter* schemas — the argument shape each of the six tools
//      accepts. These are attached to the function/tool definitions in
//      `lib/ai/tools.ts` so the model can only ever call a tool with
//      structurally valid arguments (Req 13.2).
//
//   2. Structured Output schemas — the response schemas the model must conform
//      to when it returns a Material_List or a report summary (Req 13.3). The
//      server route (task 9.2) hands these to the OpenAI Responses API as a
//      `json_schema` response format and rejects any output that does not
//      validate against them (Req 13.4).
//
// All schemas are authored in OpenAI Structured Outputs ("strict") style:
// every object lists `additionalProperties: false` and names every property in
// `required`. Optional domain fields (e.g. `wasteFactorPercent`, an item
// `notes`) are expressed as nullable types rather than omitted, because strict
// mode requires every property to be required. This module performs NO
// arithmetic — it only describes shapes; all quantities still originate from
// the deterministic engine (Req 13.1, 13.6).

import { getAllScaffoldSystems } from '@/lib/scaffold/scaffoldSystems';

/**
 * A minimal recursive JSON Schema type, sufficient for the OpenAI Structured
 * Outputs subset used here (object/array/scalar shapes, enums, nullability).
 * Kept local so this module does not depend on the OpenAI SDK's evolving types.
 */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

/**
 * The exactly-five selectable scaffold system ids (Req 7.1), derived from the
 * Scaffold_Library so the schema enum can never drift from the actual library.
 */
export const SCAFFOLD_SYSTEM_IDS: readonly string[] = getAllScaffoldSystems().map(
  (system) => system.id
);

// ---------------------------------------------------------------------------
// Tool parameter schemas (Req 13.2)
// ---------------------------------------------------------------------------

/**
 * Parameters for `calculateScaffoldMaterials`: the full deterministic
 * calculation input (Req 8, 9). The model supplies the geometry and working
 * parameters it has gathered; the engine performs every computation.
 * `wasteFactorPercent` is nullable (defaults to 0 in the engine, Req 9.1).
 */
export const CALCULATE_SCAFFOLD_MATERIALS_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    scaffoldLengthMeters: {
      type: 'number',
      description: 'Total scaffold run length in meters (from the Geometry Engine).',
    },
    workingHeightMeters: {
      type: 'number',
      description: 'Vertical working height in meters (0.01 to 100).',
    },
    bayLengthMeters: {
      type: 'number',
      description: 'Horizontal length of a single scaffold bay in meters (> 0).',
    },
    liftHeightMeters: {
      type: 'number',
      description: 'Vertical height of a single scaffold lift in meters (> 0).',
    },
    scaffoldWidthMeters: {
      type: 'number',
      description: 'Depth/width of the scaffold in meters.',
    },
    scaffoldSystemId: {
      type: 'string',
      enum: SCAFFOLD_SYSTEM_IDS,
      description: 'Identifier of the selected scaffold system.',
    },
    wasteFactorPercent: {
      type: ['number', 'null'],
      description: 'Optional waste factor as a percentage from 0 to 100 (defaults to 0).',
    },
  },
  required: [
    'scaffoldLengthMeters',
    'workingHeightMeters',
    'bayLengthMeters',
    'liftHeightMeters',
    'scaffoldWidthMeters',
    'scaffoldSystemId',
    'wasteFactorPercent',
  ],
  additionalProperties: false,
};

/**
 * Parameters for `getSelectedBuildingMeasurements`: an optional project
 * identifier. StillasCalculator maintains a single Project_State, so this is
 * informational; the tool reads the current measurements regardless.
 */
export const GET_SELECTED_BUILDING_MEASUREMENTS_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: ['string', 'null'],
      description: 'Optional project identifier (the app uses a single Project_State).',
    },
  },
  required: ['projectId'],
  additionalProperties: false,
};

/**
 * Parameters for `getAvailableScaffoldSystems`: none. Strict mode still
 * requires an object schema with no properties.
 */
export const GET_AVAILABLE_SCAFFOLD_SYSTEMS_PARAMS: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

/**
 * Parameters for `updateWorkingHeight`: the new Working_Height in meters. The
 * value is validated by the state controller (0.01 to 100, Req 8.1, 12.5); an
 * out-of-range value is rejected and the existing Project_State is preserved.
 */
export const UPDATE_WORKING_HEIGHT_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    heightMeters: {
      type: 'number',
      description: 'New working height in meters (valid range 0.01 to 100).',
    },
  },
  required: ['heightMeters'],
  additionalProperties: false,
};

/**
 * Parameters for `generateMaterialList`: the computed bays and levels plus the
 * selected scaffold system. These are engine-computed values (e.g. from a
 * prior `calculateScaffoldMaterials` call), never figures invented by the
 * model — `buildMaterialList` derives every quantity from them (Req 10.4, 13.1).
 */
export const GENERATE_MATERIAL_LIST_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    numberOfBays: {
      type: 'integer',
      description: 'Number of scaffold bays B (a positive integer from the calculator).',
    },
    numberOfLevels: {
      type: 'integer',
      description: 'Number of scaffold levels L (a positive integer from the calculator).',
    },
    scaffoldSystemId: {
      type: 'string',
      enum: SCAFFOLD_SYSTEM_IDS,
      description: 'Identifier of the selected scaffold system.',
    },
  },
  required: ['numberOfBays', 'numberOfLevels', 'scaffoldSystemId'],
  additionalProperties: false,
};

/**
 * Parameters for `generateReportSummary`: an optional project identifier (the
 * app uses a single Project_State, mirroring `getSelectedBuildingMeasurements`).
 */
export const GENERATE_REPORT_SUMMARY_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: ['string', 'null'],
      description: 'Optional project identifier (the app uses a single ScaffoldPlan).',
    },
  },
  required: ['projectId'],
  additionalProperties: false,
};

export const GET_SCAFFOLD_PLAN_PARAMS: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

export const SET_BUILDING_PERIMETER_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    polygon: {
      type: 'object',
      description: 'GeoJSON Polygon with closed ring coordinates [lon, lat].',
      properties: {
        type: { type: 'string', enum: ['Polygon'] },
        coordinates: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'number' },
            },
          },
        },
      },
      required: ['type', 'coordinates'],
      additionalProperties: false,
    },
  },
  required: ['polygon'],
  additionalProperties: false,
};

export const SELECT_FACADE_SIDES_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    sideIndices: {
      type: ['array', 'null'],
      description: 'Facade side indices, or null for whole perimeter.',
      items: { type: 'integer' },
    },
  },
  required: ['sideIndices'],
  additionalProperties: false,
};

export const SET_SCAFFOLD_SYSTEM_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    scaffoldSystemId: {
      type: 'string',
      enum: SCAFFOLD_SYSTEM_IDS,
      description: 'Scaffold system to select.',
    },
  },
  required: ['scaffoldSystemId'],
  additionalProperties: false,
};

export const SET_SCAFFOLD_DIMENSIONS_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    bayLengthMeters: { type: ['number', 'null'], description: 'Bay length in meters.' },
    liftHeightMeters: { type: ['number', 'null'], description: 'Lift height in meters.' },
    scaffoldWidthMeters: { type: ['number', 'null'], description: 'Scaffold width in meters.' },
  },
  required: ['bayLengthMeters', 'liftHeightMeters', 'scaffoldWidthMeters'],
  additionalProperties: false,
};

export const GENERATE_SCAFFOLD_DRAWING_PARAMS: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

export const CLEAR_SCAFFOLD_DRAWING_PARAMS: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

export const GENERATE_CAD_MODEL_PARAMS: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

export const EXPORT_CAD_FORMAT_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    format: {
      type: 'string',
      enum: ['scad', 'stl', 'dxf'],
      description: 'CAD export format.',
    },
  },
  required: ['format'],
  additionalProperties: false,
};

/**
 * Parameters for `retrieveBuildingFootprints` (Req 5.1). The model supplies
 * exactly one of an address or a coordinate. Because strict mode requires every
 * property to be listed in `required`, the unused inputs are passed as null
 * rather than omitted: an address request sends `{ address, lat: null, lon:
 * null }`, a coordinate request sends `{ address: null, lat, lon }`. The tool
 * resolves an address to a coordinate via the Geocoding_Service and queries the
 * Overpass_Service for footprints server-side.
 */
export const RETRIEVE_BUILDING_FOOTPRINTS_PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    address: {
      type: ['string', 'null'],
      description:
        'Free-text address to geocode (e.g. "Storgata 1, Oslo"). Null if a coordinate is supplied.',
    },
    lat: {
      type: ['number', 'null'],
      description: 'Latitude (-90..90). Null if an address is supplied.',
    },
    lon: {
      type: ['number', 'null'],
      description: 'Longitude (-180..180). Null if an address is supplied.',
    },
  },
  required: ['address', 'lat', 'lon'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Structured Output schemas (Req 13.3)
// ---------------------------------------------------------------------------

/**
 * Schema for a single estimated Material_List line item (Req 10.2): a non-empty
 * name and unit, a non-negative integer quantity, and an optional note rendered
 * only when meaningful (expressed as a nullable string for strict mode).
 */
export const MATERIAL_ITEM_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable identifier of the line item.' },
    itemName: { type: 'string', description: 'Non-empty component name.' },
    quantity: { type: 'integer', minimum: 0, description: 'Non-negative whole quantity.' },
    unit: { type: 'string', description: 'Non-empty unit label (e.g. "pcs").' },
    notes: {
      type: ['string', 'null'],
      description: 'Optional note, e.g. the manual-verification note on wall ties/anchors.',
    },
  },
  required: ['id', 'itemName', 'quantity', 'unit', 'notes'],
  additionalProperties: false,
};

/**
 * Structured Output schema for a Material_List result (Req 13.3). It mirrors the
 * deterministic `ScaffoldCalculationOutput` so the assistant presents the
 * engine's values verbatim (Req 13.6): the total scaffold length, the number of
 * bays and levels, the full Material_List, and any warnings.
 */
export const MATERIAL_LIST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    totalScaffoldLengthMeters: {
      type: 'number',
      description: 'Total (waste-adjusted) scaffold length in meters.',
    },
    numberOfBays: { type: 'integer', description: 'Computed number of bays.' },
    numberOfLevels: { type: 'integer', description: 'Computed number of levels.' },
    materialList: {
      type: 'array',
      description: 'Every estimated Material_List line item, in display order.',
      items: MATERIAL_ITEM_SCHEMA,
    },
    warnings: {
      type: 'array',
      description: 'Warnings emitted by the deterministic engine.',
      items: { type: 'string' },
    },
  },
  required: [
    'totalScaffoldLengthMeters',
    'numberOfBays',
    'numberOfLevels',
    'materialList',
    'warnings',
  ],
  additionalProperties: false,
};

/**
 * Structured Output schema for a report summary (Req 13.3). It captures the
 * planning-estimate snapshot the assistant can present or hand to the export
 * module: address, perimeter/area, scaffold length, selected system, bays,
 * levels, the Material_List, warnings, and the mandatory Verification_Disclaimer
 * (Req 15.4, 15.5). Fields that may be absent in the current Project_State are
 * nullable rather than omitted (strict mode).
 */
export const REPORT_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    address: { type: ['string', 'null'], description: 'Selected address label, when present.' },
    perimeterMeters: {
      type: ['number', 'null'],
      description: 'Computed perimeter in meters, when measured.',
    },
    areaSquareMeters: {
      type: ['number', 'null'],
      description: 'Computed enclosed area in square meters, when measured.',
    },
    scaffoldLengthMeters: {
      type: ['number', 'null'],
      description: 'Computed scaffold run length in meters, when available.',
    },
    scaffoldSystem: {
      type: ['string', 'null'],
      description: 'Display name of the selected scaffold system, when selected.',
    },
    numberOfBays: { type: ['integer', 'null'], description: 'Number of bays, when calculated.' },
    numberOfLevels: { type: ['integer', 'null'], description: 'Number of levels, when calculated.' },
    materialList: {
      type: 'array',
      description: 'Current Material_List line items (may be empty before a calculation).',
      items: MATERIAL_ITEM_SCHEMA,
    },
    warnings: {
      type: 'array',
      description: 'Warnings carried from the deterministic calculation.',
      items: { type: 'string' },
    },
    disclaimer: {
      type: 'string',
      description: 'The Verification_Disclaimer (estimated planning output, manual tie/anchor verification).',
    },
  },
  required: [
    'address',
    'perimeterMeters',
    'areaSquareMeters',
    'scaffoldLengthMeters',
    'scaffoldSystem',
    'numberOfBays',
    'numberOfLevels',
    'materialList',
    'warnings',
    'disclaimer',
  ],
  additionalProperties: false,
};

/**
 * A named Structured Output schema, ready to be passed to the OpenAI Responses
 * API as a `json_schema` text format (`{ type: 'json_schema', name, schema,
 * strict }`). The route (task 9.2) selects the appropriate one and rejects any
 * response that does not validate against it (Req 13.4).
 */
export interface NamedStructuredSchema {
  name: string;
  schema: JsonSchema;
  strict: true;
}

/** Structured Output descriptor for a Material_List result (Req 13.3). */
export const MATERIAL_LIST_STRUCTURED_OUTPUT: NamedStructuredSchema = {
  name: 'material_list',
  schema: MATERIAL_LIST_SCHEMA,
  strict: true,
};

/** Structured Output descriptor for a report summary (Req 13.3). */
export const REPORT_SUMMARY_STRUCTURED_OUTPUT: NamedStructuredSchema = {
  name: 'report_summary',
  schema: REPORT_SUMMARY_SCHEMA,
  strict: true,
};
