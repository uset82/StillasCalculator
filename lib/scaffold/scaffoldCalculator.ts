// Scaffold_Calculator: the deterministic engine that turns a scaffold geometry
// and working parameters into an estimated bays/levels/Material_List result
// (Req 9, 10).
//
// `calculateScaffoldMaterials` is a PURE function: same input -> same output,
// no I/O, no clock, no randomness, and no mutation of any external state
// (Req 9.5). It never touches Project_State, so rejecting invalid input has no
// side effects (Req 9.3, 9.7). The material quantities are derived by the
// already-pure `buildMaterialList` rule table (Req 10.4).
//
// Computation (Req 9.1, 9.2, 9.4), matching the design's Core Formulas:
//
//   wasteFactor    = clamp(wasteFactorPercent ?? 0, 0, 100)
//   adjustedLength = scaffoldLengthMeters * (1 + wasteFactor / 100)
//   numberOfBays   = ceil(adjustedLength / bayLengthMeters)
//   numberOfLevels = ceil(workingHeightMeters / liftHeightMeters)
//   verticalLines  = numberOfBays + 1   (applied inside buildMaterialList)
//
// Validity precondition for a successful calculation (else InvalidInputError,
// Req 8.4, 9.3, 9.7): scaffoldLengthMeters, workingHeightMeters,
// bayLengthMeters, and liftHeightMeters must all be present and be finite
// numbers greater than 0. The returned error identifies every missing value
// and every offending (non-positive / non-finite) value.

import type {
  CalculationResult,
  InvalidInputError,
  ScaffoldCalculationInput,
} from '@/lib/types';
import { buildMaterialList } from '@/lib/scaffold/materialRules';

/** Clamp `value` into the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The four required calculation inputs, in the order their messages are
 * reported. Each must be present and a finite number greater than 0
 * (Req 8.4, 9.1, 9.3, 9.4, 9.7).
 */
const REQUIRED_FIELDS = [
  'scaffoldLengthMeters',
  'workingHeightMeters',
  'bayLengthMeters',
  'liftHeightMeters',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** A value is "missing"/unset when it is null, undefined, or NaN (Req 8.4). */
function isMissing(value: unknown): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

/** Human-readable label for a required field, used in the error message. */
function fieldLabel(field: RequiredField): string {
  switch (field) {
    case 'scaffoldLengthMeters':
      return 'Scaffold length';
    case 'workingHeightMeters':
      return 'Working height';
    case 'bayLengthMeters':
      return 'Bay length';
    case 'liftHeightMeters':
      return 'Lift height';
  }
}

/**
 * Computes the estimated bays, levels, total scaffold length, and Material_List
 * for the given input (Req 9, 10).
 *
 * Returns a discriminated `CalculationResult`:
 * - `{ ok: true, output }` for valid input, where `output` always contains the
 *   total scaffold length in meters (the waste-adjusted length), the number of
 *   bays, the number of levels, the Material_List, and a warnings array
 *   (Req 9.6).
 * - `{ ok: false, error }` when any required input is missing or non-positive,
 *   identifying every missing value and every offending value, producing no
 *   Material_List and mutating nothing (Req 8.4, 9.3, 9.7).
 *
 * The function is pure and deterministic: identical input always yields a
 * deeply-equal result, independent of session, device, or invocation count
 * (Req 9.5).
 */
export function calculateScaffoldMaterials(
  input: ScaffoldCalculationInput
): CalculationResult {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  // Validate the four required inputs without mutating anything. A field is
  // missing when unset/NaN (Req 8.4); a present field is invalid when it is
  // not a finite number greater than 0 (Req 9.1, 9.3, 9.4, 9.7).
  for (const field of REQUIRED_FIELDS) {
    const value = input[field] as number | null | undefined;
    if (isMissing(value)) {
      missingFields.push(field);
    } else if (!Number.isFinite(value) || (value as number) <= 0) {
      invalidFields.push(field);
    }
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(
        `missing required value${missingFields.length > 1 ? 's' : ''}: ` +
          missingFields
            .map((f) => fieldLabel(f as RequiredField))
            .join(', ')
      );
    }
    if (invalidFields.length > 0) {
      parts.push(
        `value${invalidFields.length > 1 ? 's' : ''} must be greater than 0: ` +
          invalidFields
            .map((f) => fieldLabel(f as RequiredField))
            .join(', ')
      );
    }

    const error: InvalidInputError = {
      kind: 'invalid-input',
      message: `Cannot calculate scaffold materials — ${parts.join('; ')}.`,
      invalidFields,
      missingFields,
    };
    return { ok: false, error };
  }

  // All four required inputs are present, finite, and > 0 (Req 9.1).
  const wasteRaw = input.wasteFactorPercent ?? 0;
  const wasteFactor = Number.isFinite(wasteRaw) ? clamp(wasteRaw, 0, 100) : 0;

  const adjustedLength =
    input.scaffoldLengthMeters * (1 + wasteFactor / 100); // Req 9.1
  const numberOfBays = Math.ceil(adjustedLength / input.bayLengthMeters); // Req 9.2
  const numberOfLevels = Math.ceil(
    input.workingHeightMeters / input.liftHeightMeters
  ); // Req 9.4

  // Derive every Material_List line item from the deterministic rule table,
  // which applies V = numberOfBays + 1 internally (Req 10.4).
  const { items, warnings } = buildMaterialList(
    numberOfBays,
    numberOfLevels,
    input.scaffoldSystemId
  );

  return {
    ok: true,
    output: {
      totalScaffoldLengthMeters: adjustedLength, // Req 9.6
      numberOfBays, // Req 9.2
      numberOfLevels, // Req 9.4
      materialList: items, // Req 10
      warnings, // Req 10.5
    },
  };
}
