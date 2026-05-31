"use client";

import { useEffect, useId, useState } from "react";
import type { PolygonMeasurements, UpdateResult } from "@/lib/types";
import { formatMeasurement } from "@/lib/format/measurement";
import { computeScaffoldLength } from "@/lib/geometry/turfMeasurements";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components in this project.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Control configuration (design "Field Validation Rules", Req 6.5, 6.6)
// ---------------------------------------------------------------------------

/** The selectable decimal-place settings, inclusive range 0–3 (Req 6.5). */
const DECIMAL_PLACE_OPTIONS: readonly number[] = [0, 1, 2, 3];

/** The Waste_Factor range as a percentage, inclusive (Req 6.6, 6.11). */
const WASTE_FACTOR_MIN = 0;
const WASTE_FACTOR_MAX = 100;

/** Validation message shown when an entered Waste_Factor is rejected (Req 6.11). */
const WASTE_FACTOR_MESSAGE = `The waste factor must be a number between ${WASTE_FACTOR_MIN} and ${WASTE_FACTOR_MAX} percent.`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MeasurementPanelProps {
  /**
   * The current geometry measurements from `Project_State` (via the map
   * selector). `null` or `{ valid: false }` means there is no valid perimeter,
   * which surfaces the invalid-polygon error indication (Req 6.10).
   */
  measurements: PolygonMeasurements | null;
  /** Current decimal-places setting used to format measurements, 0–3 (Req 6.5). */
  decimalPlaces: number;
  /** Current Waste_Factor percentage, 0–100 (Req 6.6). */
  wasteFactorPercent: number;
  /**
   * The selected facade subset as side indices, or `null` for the whole
   * perimeter (Req 6.7, 6.8). An empty array selects no sides, yielding a
   * Scaffold_Length of 0 (Req 6.9).
   */
  selectedFacadeSideIndices: number[] | null;
  /**
   * Commits a validated decimal-places setting. Wire to
   * `projectStateController.setDecimalPlaces` (0–3, Req 6.5). The returned
   * {@link UpdateResult} lets the panel surface a controller-side rejection.
   */
  onDecimalPlacesChange?: (places: number) => UpdateResult;
  /**
   * Commits a validated Waste_Factor. Wire to
   * `projectStateController.setWasteFactor` (0–100, Req 6.6, 6.11).
   */
  onWasteFactorChange?: (percent: number) => UpdateResult;
  /**
   * Commits the facade subset selection. Wire to
   * `projectStateController.setSelectedFacades`: `null` for the whole perimeter
   * (Req 6.8), an array of side indices for a subset (Req 6.7), or an empty
   * array for no sides (Req 6.9).
   */
  onSelectedFacadesChange?: (sideIndices: number[] | null) => UpdateResult;
  /** Extra classes for the root container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `MeasurementPanel` — live geometry readout and measurement controls (Req 6).
 *
 * Responsibilities:
 * - Shows the live perimeter, enclosed area, and per-side lengths formatted to
 *   the configured decimal places; because it renders directly from the
 *   `measurements` prop it reflects the current polygon as soon as the parent
 *   updates `Project_State`, well within the 500 ms budget (Req 6.4, 6.5).
 * - Provides the decimal-places control over the inclusive range 0–3 (Req 6.5).
 * - Provides the Waste_Factor control over the inclusive range 0–100, rejecting
 *   non-numeric or out-of-range input with a validation message while retaining
 *   the last valid value (Req 6.6, 6.11).
 * - Lets the user target the whole perimeter or a subset of facade sides,
 *   showing the resulting Scaffold_Length (Req 6.7, 6.8, 6.9).
 * - Surfaces an invalid-polygon error indication when no valid measurements
 *   exist (Req 6.10).
 *
 * This is a controlled presentation component: it holds only the local draft
 * text and error message for the Waste_Factor input, deriving everything else
 * from props so it can be wired to the single `Project_State` controller later.
 */
export function MeasurementPanel({
  measurements,
  decimalPlaces,
  wasteFactorPercent,
  selectedFacadeSideIndices,
  onDecimalPlacesChange,
  onWasteFactorChange,
  onSelectedFacadesChange,
  className,
}: MeasurementPanelProps) {
  const decimalsId = useId();
  const wasteId = useId();

  const hasValidMeasurements =
    measurements != null && measurements.valid === true;

  // Local draft text + message for the Waste_Factor input so an invalid entry
  // can show a message without losing the last valid value (Req 6.11).
  const [wasteDraft, setWasteDraft] = useState<string>(String(wasteFactorPercent));
  const [wasteError, setWasteError] = useState<string | null>(null);

  // Re-sync the draft when the committed Waste_Factor changes externally (e.g.
  // an AI tool call updates it in Project_State), clearing any stale message.
  useEffect(() => {
    setWasteDraft(String(wasteFactorPercent));
    setWasteError(null);
  }, [wasteFactorPercent]);

  /** Handles the decimal-places control; commits the chosen setting (Req 6.5). */
  function handleDecimalPlacesChange(raw: string): void {
    const places = Number(raw);
    onDecimalPlacesChange?.(places);
  }

  /** Validates and commits the Waste_Factor as the user types (Req 6.6, 6.11). */
  function handleWasteChange(raw: string): void {
    setWasteDraft(raw);

    const trimmed = raw.trim();
    if (trimmed === "") {
      // Blank while editing: do not commit, do not show an error yet.
      setWasteError(null);
      return;
    }

    const value = Number(trimmed);
    const valid =
      Number.isFinite(value) &&
      value >= WASTE_FACTOR_MIN &&
      value <= WASTE_FACTOR_MAX;

    if (!valid) {
      setWasteError(WASTE_FACTOR_MESSAGE); // Req 6.11
      return;
    }

    const result = onWasteFactorChange?.(value);
    if (result && result.ok === false) {
      // Surface a controller-side rejection while retaining the last valid value.
      setWasteError(result.error?.message ?? WASTE_FACTOR_MESSAGE);
      return;
    }
    setWasteError(null);
  }

  /** Selects the whole perimeter, clearing any facade subset (Req 6.8). */
  function selectWholePerimeter(): void {
    onSelectedFacadesChange?.(null);
  }

  /** Switches to facade-subset mode with no sides selected yet (Req 6.9). */
  function beginFacadeSubset(): void {
    onSelectedFacadesChange?.([]);
  }

  /** Toggles a single side in the facade subset (Req 6.7). */
  function toggleSide(index: number): void {
    const current = selectedFacadeSideIndices ?? [];
    const next = new Set(current);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    onSelectedFacadesChange?.([...next].sort((a, b) => a - b));
  }

  const wholePerimeterSelected = selectedFacadeSideIndices === null;
  const sideLengths = hasValidMeasurements ? measurements.sideLengthsMeters : [];
  const scaffoldLengthMeters = hasValidMeasurements
    ? computeScaffoldLength(measurements, selectedFacadeSideIndices)
    : null;

  return (
    <section
      data-testid="measurement-panel"
      aria-label="Polygon measurements"
      className={cn("flex flex-col gap-4", className)}
    >
      <h2 className="text-sm font-semibold text-gray-700">Measurements</h2>

      {/* Invalid-polygon error indication (Req 6.10). */}
      {!hasValidMeasurements ? (
        <p
          role="alert"
          data-testid="measurement-invalid"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          No valid perimeter yet. Draw or select a building outline with at
          least 3 vertices and no crossing sides to see measurements.
        </p>
      ) : (
        <>
          {/* Live perimeter / area / scaffold length readouts (Req 6.4, 6.5). */}
          <dl
            data-testid="measurement-readout"
            className="grid grid-cols-2 gap-2"
          >
            <Readout
              label="Perimeter"
              value={`${formatMeasurement(measurements.perimeterMeters, decimalPlaces)} m`}
              testId="readout-perimeter"
            />
            <Readout
              label="Area"
              value={`${formatMeasurement(measurements.areaSquareMeters, decimalPlaces)} m²`}
              testId="readout-area"
            />
            <Readout
              label="Scaffold length"
              value={
                scaffoldLengthMeters === null
                  ? "—"
                  : `${formatMeasurement(scaffoldLengthMeters, decimalPlaces)} m`
              }
              testId="readout-scaffold-length"
            />
            <Readout
              label="Sides"
              value={String(sideLengths.length)}
              testId="readout-side-count"
            />
          </dl>

          {/* Per-side lengths in ring order (Req 6.3, 6.4). */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">
              Side lengths
            </span>
            <ul
              data-testid="side-lengths"
              className="flex flex-col gap-1"
            >
              {sideLengths.map((length, index) => (
                <li
                  // Side index is stable for a given ring order.
                  key={index}
                  data-testid={`side-length-${index}`}
                  className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-800"
                >
                  <span>Side {index + 1}</span>
                  <span>{formatMeasurement(length, decimalPlaces)} m</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Decimal-places control, 0–3 (Req 6.5). */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={decimalsId}
          className="text-sm font-medium text-gray-700"
        >
          Decimal places
        </label>
        <select
          id={decimalsId}
          value={decimalPlaces}
          onChange={(event) => handleDecimalPlacesChange(event.target.value)}
          data-testid="decimal-places-control"
          className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {DECIMAL_PLACE_OPTIONS.map((places) => (
            <option key={places} value={places}>
              {places}
            </option>
          ))}
        </select>
      </div>

      {/* Waste-factor control, 0–100 with validation message (Req 6.6, 6.11). */}
      <div className="flex flex-col gap-1">
        <label htmlFor={wasteId} className="text-sm font-medium text-gray-700">
          Waste factor
        </label>
        <div className="flex items-center gap-2">
          <input
            id={wasteId}
            type="number"
            inputMode="decimal"
            step="any"
            min={WASTE_FACTOR_MIN}
            max={WASTE_FACTOR_MAX}
            value={wasteDraft}
            onChange={(event) => handleWasteChange(event.target.value)}
            aria-invalid={wasteError ? true : undefined}
            aria-describedby={wasteError ? `${wasteId}-error` : `${wasteId}-hint`}
            data-testid="waste-factor-control"
            className={cn(
              "min-h-[44px] w-full rounded-lg border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2",
              wasteError
                ? "border-red-400 focus:ring-red-400"
                : "border-gray-300 focus:ring-blue-400",
            )}
          />
          <span className="text-sm text-gray-500" aria-hidden="true">
            %
          </span>
        </div>
        {wasteError ? (
          <p
            id={`${wasteId}-error`}
            role="alert"
            data-testid="waste-factor-error"
            className="text-sm text-red-600"
          >
            {wasteError}
          </p>
        ) : (
          <p id={`${wasteId}-hint`} className="text-xs text-gray-400">
            Permitted range: {WASTE_FACTOR_MIN} to {WASTE_FACTOR_MAX} %
          </p>
        )}
      </div>

      {/* Facade-subset selection (Req 6.7, 6.8, 6.9). */}
      <fieldset className="flex flex-col gap-2" data-testid="facade-selection">
        <legend className="text-sm font-medium text-gray-700">
          Target facade(s)
        </legend>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`${wasteId}-facade-mode`}
            checked={wholePerimeterSelected}
            onChange={selectWholePerimeter}
            data-testid="facade-whole-perimeter"
            className="h-4 w-4"
          />
          <span>Whole perimeter</span>
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name={`${wasteId}-facade-mode`}
            checked={!wholePerimeterSelected}
            onChange={beginFacadeSubset}
            disabled={!hasValidMeasurements}
            data-testid="facade-subset-mode"
            className="h-4 w-4"
          />
          <span>Selected sides only</span>
        </label>

        {/* Per-side checkboxes, shown when targeting a subset (Req 6.7). */}
        {!wholePerimeterSelected && hasValidMeasurements ? (
          <div className="flex flex-col gap-1 pl-6">
            {sideLengths.map((length, index) => {
              const checked =
                selectedFacadeSideIndices?.includes(index) === true;
              return (
                <label
                  key={index}
                  className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-800"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSide(index)}
                      data-testid={`facade-side-${index}`}
                      className="h-4 w-4"
                    />
                    Side {index + 1}
                  </span>
                  <span className="text-gray-500">
                    {formatMeasurement(length, decimalPlaces)} m
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
      </fieldset>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

interface ReadoutProps {
  label: string;
  value: string;
  testId: string;
}

/** A single labeled measurement readout in the summary grid. */
function Readout({ label, value, testId }: ReadoutProps) {
  return (
    <div className="flex flex-col rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd data-testid={testId} className="text-sm text-gray-900">
        {value}
      </dd>
    </div>
  );
}

export default MeasurementPanel;
