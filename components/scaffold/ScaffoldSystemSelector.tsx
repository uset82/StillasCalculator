"use client";

import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type {
  DimensionField,
  ScaffoldSystem,
  ScaffoldSystemId,
} from "@/lib/types";
import { getAllScaffoldSystems } from "@/lib/scaffold/scaffoldSystems";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components in this project.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Validation (Req 7.3): system-editor dimensions are "greater than 0 and at
// most 100 meters" per the design's Field Validation Rules table. This mirrors
// the `setDimension(field, value, 'systemEditor')` range in the state
// controller; the component validates locally so it can surface an inline
// message the instant a value is invalid, while still deferring the actual
// state mutation to the controller via `onChangeDimension`.
// ---------------------------------------------------------------------------

/** Exclusive lower bound for an editable system dimension (Req 7.3). */
const DIMENSION_MIN_EXCLUSIVE = 0;

/** Inclusive upper bound for an editable system dimension (Req 7.3). */
const DIMENSION_MAX = 100;

/** Human-readable permitted range used in validation messages (Req 7.3). */
const DIMENSION_RANGE_TEXT = "greater than 0 and at most 100 meters";

/** The three editable dimensions in display order (Req 7.3). */
const DIMENSION_FIELDS: ReadonlyArray<{ field: DimensionField; label: string }> =
  [
    { field: "bayLengthMeters", label: "Bay length" },
    { field: "liftHeightMeters", label: "Lift height" },
    { field: "scaffoldWidthMeters", label: "Scaffold width" },
  ];

type DimensionValidation =
  | { ok: true; value: number }
  | { ok: false; reason: "missing" | "invalid"; message: string };

/**
 * Validates a raw dimension input string against the system-editor range
 * (Req 7.3). An empty string is reported as `missing` (used to drive the
 * Custom Dimensions required-value messaging, Req 7.5); a non-numeric or
 * out-of-range value is reported as `invalid`.
 */
function validateDimension(raw: string, label: string): DimensionValidation {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      reason: "missing",
      message: `${label} is required.`,
    };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      reason: "invalid",
      message: `${label} must be a number ${DIMENSION_RANGE_TEXT}.`,
    };
  }

  if (value <= DIMENSION_MIN_EXCLUSIVE || value > DIMENSION_MAX) {
    return {
      ok: false,
      reason: "invalid",
      message: `${label} must be ${DIMENSION_RANGE_TEXT}.`,
    };
  }

  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ScaffoldSystemSelectorProps {
  /**
   * The selectable scaffold systems. Defaults to the full Scaffold_Library of
   * exactly five systems (Req 7.1); injectable for testing.
   */
  systems?: readonly ScaffoldSystem[];
  /** The currently selected system, or `null` when none is chosen yet. */
  selectedSystemId: ScaffoldSystemId | null;
  /** Current Bay_Length in meters (from Project_State), or `null` if unset. */
  bayLengthMeters: number | null;
  /** Current Lift_Height in meters (from Project_State), or `null` if unset. */
  liftHeightMeters: number | null;
  /** Current Scaffold_Width in meters (from Project_State), or `null` if unset. */
  scaffoldWidthMeters: number | null;
  /**
   * Invoked when the user selects a system. Wire this to
   * `projectStateController.setScaffoldSystem`, which loads the system's
   * default dimensions (Req 7.2).
   */
  onSelectSystem: (systemId: ScaffoldSystemId) => void;
  /**
   * Invoked with a validated dimension value (already passing the >0 and ≤100
   * check, Req 7.3). Wire this to
   * `projectStateController.setDimension(field, value, 'systemEditor')`.
   */
  onChangeDimension: (field: DimensionField, value: number) => void;
  /**
   * Dimensions the parent has determined are missing — typically supplied when
   * a calculation is requested with Custom Dimensions and a value is absent
   * (Req 7.5). When provided, these always surface a required-value message in
   * addition to any locally detected empty field.
   */
  missingDimensions?: readonly DimensionField[];
  /** Extra classes for the root container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Scaffold system selector and dimension editor (Req 7).
 *
 * Responsibilities:
 * - Lists exactly the five Scaffold_Library systems for selection (Req 7.1).
 * - Shows a non-certified placeholder notice when a placeholder system is
 *   selected (Req 7.4).
 * - Lets the user edit Bay_Length, Lift_Height, and Scaffold_Width, validating
 *   each against "greater than 0 and at most 100 meters" and surfacing an
 *   inline message on an invalid value (Req 7.3).
 * - For Custom Dimensions, surfaces required-value messaging for any missing
 *   dimension, both locally (an emptied field) and from the `missingDimensions`
 *   prop the parent provides at calculation time (Req 7.5).
 *
 * This is a controlled presentation component: it holds local draft text and
 * validation state for the inputs, but defers every committed change to the
 * `onSelectSystem` / `onChangeDimension` callbacks so it can be wired to the
 * single `Project_State` controller later.
 */
export function ScaffoldSystemSelector({
  systems = getAllScaffoldSystems(),
  selectedSystemId,
  bayLengthMeters,
  liftHeightMeters,
  scaffoldWidthMeters,
  onSelectSystem,
  onChangeDimension,
  missingDimensions,
  className,
}: ScaffoldSystemSelectorProps) {
  const groupId = useId();
  const selectedSystem =
    systems.find((system) => system.id === selectedSystemId) ?? null;
  const isCustom = selectedSystem?.isCustom === true;

  const dimensionValues: Record<DimensionField, number | null> = {
    bayLengthMeters,
    liftHeightMeters,
    scaffoldWidthMeters,
  };

  return (
    <div
      data-testid="scaffold-system-selector"
      className={cn("flex flex-col gap-4", className)}
    >
      {/* System list (Req 7.1). Radio group so exactly one system is selected. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-gray-700">
          Scaffold system
        </legend>
        <div role="radiogroup" aria-label="Scaffold system" className="flex flex-col gap-1">
          {systems.map((system) => {
            const inputId = `${groupId}-system-${system.id}`;
            const isSelected = system.id === selectedSystemId;
            return (
              <label
                key={system.id}
                htmlFor={inputId}
                data-testid={`scaffold-system-option-${system.id}`}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                  isSelected
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-gray-200 bg-white text-gray-800 hover:border-gray-300"
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`${groupId}-scaffold-system`}
                  value={system.id}
                  checked={isSelected}
                  onChange={() => onSelectSystem(system.id)}
                  className="h-4 w-4"
                />
                <span className="flex-1">{system.displayName}</span>
                {system.isPlaceholder ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Placeholder
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Non-certified placeholder notice (Req 7.4). */}
      {selectedSystem?.isPlaceholder ? (
        <p
          role="note"
          data-testid="placeholder-notice"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          The dimensions for {selectedSystem.displayName} are non-certified
          placeholder values. Confirm them against the manufacturer
          specification before relying on the estimate.
        </p>
      ) : null}

      {/* Dimension editor (Req 7.3). Shown once a system is selected so the
          fields have a meaningful context (and defaults loaded by Req 7.2). */}
      {selectedSystem ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-gray-700">
            Dimensions (meters)
          </legend>
          {DIMENSION_FIELDS.map(({ field, label }) => (
            <DimensionInput
              key={field}
              field={field}
              label={label}
              value={dimensionValues[field]}
              // Custom Dimensions require every value; surface a message when a
              // field is empty or the parent flagged it missing (Req 7.5).
              required={isCustom}
              externallyMissing={missingDimensions?.includes(field) === true}
              onCommit={onChangeDimension}
            />
          ))}
        </fieldset>
      ) : (
        <p className="text-xs text-gray-500">
          Select a scaffold system to edit its dimensions.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dimension input
// ---------------------------------------------------------------------------

interface DimensionInputProps {
  field: DimensionField;
  label: string;
  value: number | null;
  /** Whether an empty value should be flagged as missing (Custom Dimensions, Req 7.5). */
  required: boolean;
  /** Parent-reported missing flag, typically set at calculation time (Req 7.5). */
  externallyMissing: boolean;
  /** Commits a validated value upstream (Req 7.3). */
  onCommit: (field: DimensionField, value: number) => void;
}

/**
 * A single editable scaffold dimension with inline validation (Req 7.3).
 *
 * The input keeps its own draft text so the user can type freely; on every
 * change it validates against the system-editor range and either commits the
 * value via {@link DimensionInputProps.onCommit} or shows a message without
 * committing. The draft re-syncs to the incoming `value` whenever the prop
 * changes (e.g. after selecting a system loads its defaults, Req 7.2).
 */
function DimensionInput({
  field,
  label,
  value,
  required,
  externallyMissing,
  onCommit,
}: DimensionInputProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  const [localError, setLocalError] = useState<string | null>(null);

  // Re-sync the draft to the authoritative value (e.g. defaults loaded on
  // system selection, or an accepted update from the controller). Clearing the
  // local error here avoids showing a stale message after a valid external
  // change.
  useEffect(() => {
    setDraft(value === null ? "" : String(value));
    setLocalError(null);
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    setDraft(raw);

    const result = validateDimension(raw, label);
    if (result.ok) {
      setLocalError(null);
      onCommit(field, result.value);
      return;
    }

    // Empty input: only surface a message when the field is required (Custom
    // Dimensions). Otherwise leave it blank without an error (Req 7.5).
    setLocalError(result.reason === "missing" && !required ? null : result.message);
  };

  // A required field that is empty (no draft, no stored value) is missing — as
  // is any field the parent explicitly flagged. This drives the Custom
  // Dimensions required-value messaging (Req 7.5).
  const isMissing =
    (required && draft.trim() === "" && value === null) || externallyMissing;
  const message: ReactNode =
    localError ?? (isMissing ? `${label} is required.` : null);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm text-gray-700">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        min={DIMENSION_MIN_EXCLUSIVE}
        max={DIMENSION_MAX}
        step="0.01"
        value={draft}
        onChange={handleChange}
        aria-invalid={message != null}
        aria-describedby={message != null ? errorId : undefined}
        data-testid={`dimension-input-${field}`}
        className={cn(
          "min-h-11 rounded-lg border px-3 py-2 text-sm",
          message != null
            ? "border-red-400 bg-red-50 text-red-900"
            : "border-gray-300 bg-white text-gray-900"
        )}
      />
      {message != null ? (
        <p
          id={errorId}
          role="alert"
          data-testid={`dimension-error-${field}`}
          className="text-xs text-red-600"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

export default ScaffoldSystemSelector;
