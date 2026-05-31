"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DimensionField, UpdateResult } from "@/lib/types";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other layout/scaffold components.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Field configuration (design "Field Validation Rules", Req 8.1, 8.2)
// ---------------------------------------------------------------------------

/**
 * The Working_Height range in meters (Req 8.1). Working height is entered
 * separately from the scaffold dimensions and has its own wider range.
 */
const WORKING_HEIGHT_MIN = 0.01;
const WORKING_HEIGHT_MAX = 100;

/**
 * The shared range for the Bay_Length, Lift_Height, and Scaffold_Width inputs
 * in meters (Req 8.2). All three calculator dimension inputs use 0.01–5 m.
 */
const DIMENSION_MIN = 0.01;
const DIMENSION_MAX = 5;

/**
 * Identifies a single editable numeric field rendered by the form. The working
 * height is special-cased because it commits through a different controller
 * updater and uses a different range; the three `DimensionField`s share the
 * dimension range and commit through `onDimensionCommit`.
 */
type FormField = "workingHeightMeters" | DimensionField;

interface FieldConfig {
  field: FormField;
  label: string;
  min: number;
  max: number;
  /**
   * Whether the field is one of the four values a calculation requires
   * (Scaffold_Length, Working_Height, Bay_Length, Lift_Height — Req 8.4).
   * Scaffold_Width is editable (Req 8.2) but not required to run a calculation.
   */
  requiredForCalculation: boolean;
}

/** The four editable inputs, in display order. */
const FIELD_CONFIGS: readonly FieldConfig[] = [
  {
    field: "workingHeightMeters",
    label: "Working height",
    min: WORKING_HEIGHT_MIN,
    max: WORKING_HEIGHT_MAX,
    requiredForCalculation: true,
  },
  {
    field: "bayLengthMeters",
    label: "Bay length",
    min: DIMENSION_MIN,
    max: DIMENSION_MAX,
    requiredForCalculation: true,
  },
  {
    field: "liftHeightMeters",
    label: "Lift height",
    min: DIMENSION_MIN,
    max: DIMENSION_MAX,
    requiredForCalculation: true,
  },
  {
    field: "scaffoldWidthMeters",
    label: "Scaffold width",
    min: DIMENSION_MIN,
    max: DIMENSION_MAX,
    requiredForCalculation: false,
  },
];

/** Human-readable label for the derived Scaffold_Length (Req 8.4 / 9.x). */
const SCAFFOLD_LENGTH_LABEL = "Scaffold length";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The current committed values the form displays. These come from
 * `Project_State` (via the calculator selector) when wired in a later task;
 * `null` means the value is unset. `scaffoldLengthMeters` is derived from the
 * geometry (not editable here) and is shown read-only and included in the
 * required-value check that gates calculation (Req 8.4).
 */
export interface ScaffoldCalculatorFormValues {
  workingHeightMeters: number | null;
  bayLengthMeters: number | null;
  liftHeightMeters: number | null;
  scaffoldWidthMeters: number | null;
  scaffoldLengthMeters: number | null;
}

export interface ScaffoldCalculatorFormProps {
  /** Current committed field values to display (typically from Project_State). */
  values: ScaffoldCalculatorFormValues;
  /**
   * Commits a validated Working_Height. Wire to
   * `projectStateController.setWorkingHeight` (0.01–100, Req 8.1). The returned
   * {@link UpdateResult} lets the form surface a controller-side rejection.
   */
  onWorkingHeightCommit?: (meters: number) => UpdateResult;
  /**
   * Commits a validated scaffold dimension. Wire to
   * `projectStateController.setDimension(field, value, 'calculator')`
   * (0.01–5, Req 8.2).
   */
  onDimensionCommit?: (field: DimensionField, value: number) => UpdateResult;
  /**
   * Requests a calculation. Only invoked once every required value
   * (Scaffold_Length, Working_Height, Bay_Length, Lift_Height) is present;
   * otherwise the form shows a missing-value message and blocks the call
   * (Req 8.4).
   */
  onCalculate?: () => void;
  /** Disables every control (e.g. while a calculation is in flight). */
  disabled?: boolean;
  /** Extra classes for the form container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Parsing & validation helpers
// ---------------------------------------------------------------------------

interface ParsedInput {
  /** The raw input was blank/whitespace, i.e. the field is unset (Req 8.4). */
  empty: boolean;
  /** A finite parsed number, or `null` when blank or non-numeric. */
  value: number | null;
}

/** Parses a raw text input into either an empty marker, a number, or non-numeric. */
function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { empty: true, value: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { empty: false, value: null };
  }
  return { empty: false, value: parsed };
}

/** Formats a committed value for display in an input, or "" when unset. */
function toInputString(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Builds the range-validation message for a field, identifying the field and
 * its permitted range (Req 8.3).
 */
function rangeMessage(config: FieldConfig): string {
  return `${config.label} must be a number between ${config.min} and ${config.max} meters.`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `ScaffoldCalculatorForm` — the Working_Height and Bay_Length / Lift_Height /
 * Scaffold_Width inputs (Req 8.1, 8.2).
 *
 * Behaviour:
 * - Each field is range-validated as the user types; a non-numeric or
 *   out-of-range value shows a message identifying the field and its permitted
 *   range and is not committed (Req 8.3).
 * - Valid values are committed through the supplied callbacks so the component
 *   can be wired to `Project_State` later; a controller-side rejection is
 *   surfaced alongside the field.
 * - Requesting a calculation while Scaffold_Length, Working_Height, Bay_Length,
 *   or Lift_Height is unset shows a message naming each missing value and blocks
 *   the calculation (Req 8.4).
 *
 * The component is presentational and controlled: it holds only local draft
 * text and per-field error messages, deriving committed values from props.
 */
export function ScaffoldCalculatorForm({
  values,
  onWorkingHeightCommit,
  onDimensionCommit,
  onCalculate,
  disabled = false,
  className,
}: ScaffoldCalculatorFormProps) {
  // Local draft text per field, initialized from the committed prop values.
  const [drafts, setDrafts] = useState<Record<FormField, string>>(() => ({
    workingHeightMeters: toInputString(values.workingHeightMeters),
    bayLengthMeters: toInputString(values.bayLengthMeters),
    liftHeightMeters: toInputString(values.liftHeightMeters),
    scaffoldWidthMeters: toInputString(values.scaffoldWidthMeters),
  }));

  // Per-field validation/rejection messages (Req 8.3).
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FormField, string>>
  >({});

  // The missing-required-value message shown when a calculation is blocked
  // (Req 8.4). Cleared once the user supplies the missing values.
  const [missingMessage, setMissingMessage] = useState<string | null>(null);

  // Keep drafts in sync when committed values change externally (e.g. an AI
  // tool call updates Working_Height in Project_State). Each draft tracks its
  // own committed value so unrelated edits are preserved.
  useEffect(() => {
    setDrafts((prev) => syncDraft(prev, "workingHeightMeters", values.workingHeightMeters));
  }, [values.workingHeightMeters]);
  useEffect(() => {
    setDrafts((prev) => syncDraft(prev, "bayLengthMeters", values.bayLengthMeters));
  }, [values.bayLengthMeters]);
  useEffect(() => {
    setDrafts((prev) => syncDraft(prev, "liftHeightMeters", values.liftHeightMeters));
  }, [values.liftHeightMeters]);
  useEffect(() => {
    setDrafts((prev) => syncDraft(prev, "scaffoldWidthMeters", values.scaffoldWidthMeters));
  }, [values.scaffoldWidthMeters]);

  /** Commits a validated value for `config` through the appropriate callback. */
  function commit(config: FieldConfig, value: number): void {
    let result: UpdateResult | undefined;
    if (config.field === "workingHeightMeters") {
      result = onWorkingHeightCommit?.(value);
    } else {
      result = onDimensionCommit?.(config.field, value);
    }
    // Surface a controller-side rejection (e.g. a stricter range) if one is
    // returned; otherwise the value was accepted.
    if (result && result.ok === false) {
      setFieldErrors((prev) => ({
        ...prev,
        [config.field]: result?.error?.message ?? rangeMessage(config),
      }));
    }
  }

  /** Handles a change to one field: validate, show messages, and commit if valid. */
  function handleChange(config: FieldConfig, raw: string): void {
    setDrafts((prev) => ({ ...prev, [config.field]: raw }));

    const { empty, value } = parseInput(raw);
    const valid =
      value !== null && value >= config.min && value <= config.max;

    setFieldErrors((prev) => {
      const next = { ...prev };
      if (empty || valid) {
        // Blank is allowed while editing; the required-value check (Req 8.4)
        // catches a still-empty required field at calculation time.
        delete next[config.field];
      } else {
        next[config.field] = rangeMessage(config); // Req 8.3
      }
      return next;
    });

    if (valid) {
      commit(config, value as number);
    }
  }

  /**
   * Gathers the names of every required value that is currently unset
   * (Req 8.4). A field counts as present when it has a committed value or a
   * valid, non-blank draft.
   */
  function collectMissingRequired(): string[] {
    const missing: string[] = [];

    // Scaffold_Length is derived from the geometry and not editable here.
    if (values.scaffoldLengthMeters === null || values.scaffoldLengthMeters === undefined) {
      missing.push(SCAFFOLD_LENGTH_LABEL);
    }

    for (const config of FIELD_CONFIGS) {
      if (!config.requiredForCalculation) {
        continue;
      }
      const committed = values[config.field];
      const draft = parseInput(drafts[config.field]);
      const hasValidDraft =
        draft.value !== null &&
        draft.value >= config.min &&
        draft.value <= config.max;
      const present =
        (committed !== null && committed !== undefined) || hasValidDraft;
      if (!present) {
        missing.push(config.label);
      }
    }

    return missing;
  }

  /** Handles the calculate request, enforcing the required-value gate (Req 8.4). */
  function handleCalculate(): void {
    const missing = collectMissingRequired();
    if (missing.length > 0) {
      setMissingMessage(
        `Cannot calculate — missing required value${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
      );
      return; // Block the calculation (Req 8.4).
    }
    setMissingMessage(null);
    onCalculate?.();
  }

  return (
    <form
      data-testid="scaffold-calculator-form"
      aria-label="Scaffold calculator inputs"
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        handleCalculate();
      }}
    >
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="text-sm font-semibold text-gray-700">
          Working parameters
        </legend>

        {/* Derived Scaffold_Length (read-only); included in the required check. */}
        <ScaffoldLengthReadout meters={values.scaffoldLengthMeters} />

        {FIELD_CONFIGS.map((config) => {
          const error = fieldErrors[config.field];
          const errorId = `${config.field}-error`;
          const hintId = `${config.field}-hint`;
          return (
            <div key={config.field} className="flex flex-col gap-1">
              <label
                htmlFor={config.field}
                className="text-sm font-medium text-gray-700"
              >
                {config.label}
                {!config.requiredForCalculation && (
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    (optional)
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={config.field}
                  name={config.field}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={config.min}
                  max={config.max}
                  value={drafts[config.field]}
                  onChange={(event) => handleChange(config, event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : hintId}
                  data-testid={`input-${config.field}`}
                  className={cn(
                    "min-h-[44px] w-full rounded-lg border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2",
                    error
                      ? "border-red-400 focus:ring-red-400"
                      : "border-gray-300 focus:ring-blue-400",
                  )}
                />
                <span className="text-sm text-gray-500" aria-hidden="true">
                  m
                </span>
              </div>
              {error ? (
                <p
                  id={errorId}
                  role="alert"
                  data-testid={`error-${config.field}`}
                  className="text-sm text-red-600"
                >
                  {error}
                </p>
              ) : (
                <p id={hintId} className="text-xs text-gray-400">
                  Permitted range: {config.min} to {config.max} m
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {/* Missing-required-value message that blocks calculation (Req 8.4). */}
      {missingMessage && (
        <p
          role="alert"
          data-testid="missing-required-message"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {missingMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        data-testid="calculate-button"
        className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-base font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        Calculate materials
      </button>
    </form>
  );
}

/**
 * Updates a single draft entry to match a newly committed value, leaving the
 * other drafts untouched. Used by the per-field sync effects so an external
 * change to one value does not clobber in-progress edits to another.
 */
function syncDraft(
  prev: Record<FormField, string>,
  field: FormField,
  committed: number | null,
): Record<FormField, string> {
  const next = toInputString(committed);
  if (prev[field] === next) {
    return prev;
  }
  return { ...prev, [field]: next };
}

/** Read-only display of the geometry-derived Scaffold_Length used in calculation. */
function ScaffoldLengthReadout({ meters }: { meters: number | null }): ReactNode {
  const isSet = meters !== null && meters !== undefined;
  return (
    <div
      className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
      data-testid="scaffold-length-readout"
    >
      <span className="text-sm font-medium text-gray-700">
        {SCAFFOLD_LENGTH_LABEL}
      </span>
      <span className="text-sm text-gray-900">
        {isSet ? `${meters} m` : "Not set — draw a perimeter first"}
      </span>
    </div>
  );
}

export default ScaffoldCalculatorForm;
