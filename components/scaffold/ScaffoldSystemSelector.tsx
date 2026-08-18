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
        <div className="flex items-center justify-between mb-1">
          <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
            Scaffold System Library
          </legend>
          <span className="text-[10px] font-mono text-slate-400">5 SYSTEMS</span>
        </div>
        <div role="radiogroup" aria-label="Scaffold system" className="grid grid-cols-1 gap-2">
          {systems.map((system) => {
            const inputId = `${groupId}-system-${system.id}`;
            const isSelected = system.id === selectedSystemId;
            return (
              <label
                key={system.id}
                htmlFor={inputId}
                data-testid={`scaffold-system-option-${system.id}`}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between rounded-xl border p-3 text-xs transition-all shadow-xs",
                  isSelected
                    ? "border-brand-500 bg-brand-50/70 text-brand-950 font-medium ring-1 ring-brand-500/20"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/60"
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    id={inputId}
                    type="radio"
                    name={`${groupId}-scaffold-system`}
                    value={system.id}
                    checked={isSelected}
                    onChange={() => onSelectSystem(system.id)}
                    className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900">{system.displayName}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      Std: {system.defaultBayLengthMeters}m bay × {system.defaultLiftHeightMeters}m lift
                    </span>
                  </div>
                </div>
                {system.isPlaceholder ? (
                  <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-800">
                    Placeholder
                  </span>
                ) : system.isCustom ? (
                  <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-mono font-semibold text-brand-700">
                    Custom
                  </span>
                ) : (
                  <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-600">
                    Standard
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Non-certified placeholder notice (Req 7.4). */}
      {selectedSystem?.isPlaceholder ? (
        <div
          role="note"
          data-testid="placeholder-notice"
          className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900 shadow-xs"
        >
          <div className="flex items-start gap-2">
            <span className="text-sm">⚠️</span>
            <p className="font-medium leading-relaxed">
              The dimensions for {selectedSystem.displayName} are non-certified placeholder values. Confirm them against the manufacturer specification before relying on the estimate.
            </p>
          </div>
        </div>
      ) : null}

      {/* Dimension editor (Req 7.3). */}
      {selectedSystem ? (
        <fieldset className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
          <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono px-1">
            System Module Dimensions
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {DIMENSION_FIELDS.map(({ field, label }) => (
              <DimensionInput
                key={field}
                field={field}
                label={label}
                value={dimensionValues[field]}
                required={isCustom}
                externallyMissing={missingDimensions?.includes(field) === true}
                onCommit={onChangeDimension}
              />
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-xs text-slate-500 font-mono">
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

    setLocalError(result.reason === "missing" && !required ? null : result.message);
  };

  const isMissing =
    (required && draft.trim() === "" && value === null) || externallyMissing;
  const message: ReactNode =
    localError ?? (isMissing ? `${label} is required.` : null);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-[11px] font-bold uppercase tracking-wider text-slate-600 font-mono">
        {label}
      </label>
      <div className="relative flex items-center">
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
            "min-h-11 w-full rounded-xl border px-3 py-2 pr-8 text-xs font-mono font-medium shadow-xs focus:outline-none focus:ring-2",
            message != null
              ? "border-red-400 bg-red-50 text-red-900 focus:ring-red-400/20"
              : "border-slate-300 bg-white text-slate-900 focus:border-brand-500 focus:ring-brand-500/20"
          )}
        />
        <span className="pointer-events-none absolute right-2.5 text-xs font-mono font-semibold text-slate-400">
          m
        </span>
      </div>
      {message != null ? (
        <p
          id={errorId}
          role="alert"
          data-testid={`dimension-error-${field}`}
          className="text-[11px] font-medium text-red-600"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

export default ScaffoldSystemSelector;
