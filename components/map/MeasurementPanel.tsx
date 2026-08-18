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
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
          Geometric Measurements
        </h2>
        {hasValidMeasurements ? (
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-700 border border-emerald-500/20">
            PERIMETER LOCKED
          </span>
        ) : null}
      </div>

      {/* Invalid-polygon error indication (Req 6.10). */}
      {!hasValidMeasurements ? (
        <div
          role="alert"
          data-testid="measurement-invalid"
          className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-900"
        >
          <div className="flex items-start gap-2">
            <span className="text-base leading-none">⚠️</span>
            <p className="font-medium leading-relaxed">
              No valid perimeter yet. Draw or select a building outline with at least 3 vertices and no crossing sides to see measurements.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Live perimeter / area / scaffold length readouts (Req 6.4, 6.5). */}
          <dl
            data-testid="measurement-readout"
            className="grid grid-cols-2 gap-2.5"
          >
            <Readout
              label="Perimeter"
              value={`${formatMeasurement(measurements.perimeterMeters, decimalPlaces)} m`}
              testId="readout-perimeter"
              icon="📏"
            />
            <Readout
              label="Footprint Area"
              value={`${formatMeasurement(measurements.areaSquareMeters, decimalPlaces)} m²`}
              testId="readout-area"
              icon="📐"
            />
            <Readout
              label="Scaffold Length"
              value={
                scaffoldLengthMeters === null
                  ? "—"
                  : `${formatMeasurement(scaffoldLengthMeters, decimalPlaces)} m`
              }
              testId="readout-scaffold-length"
              icon="🏗️"
              highlight
            />
            <Readout
              label="Facade Sides"
              value={String(sideLengths.length)}
              testId="readout-side-count"
              icon="🔢"
            />
          </dl>

          {/* Per-side lengths in ring order (Req 6.3, 6.4). */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              Individual Facade Sides
            </span>
            <ul
              data-testid="side-lengths"
              className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1"
            >
              {sideLengths.map((length, index) => (
                <li
                  key={index}
                  data-testid={`side-length-${index}`}
                  className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-800 border border-slate-200/80 shadow-xs"
                >
                  <span className="font-medium text-slate-600">Side {index + 1}</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {formatMeasurement(length, decimalPlaces)} m
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Decimal-places control, 0–3 (Req 6.5). */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={decimalsId}
          className="text-xs font-bold uppercase tracking-wider text-slate-600 font-mono"
        >
          Decimal Precision
        </label>
        <select
          id={decimalsId}
          value={decimalPlaces}
          onChange={(event) => handleDecimalPlacesChange(event.target.value)}
          data-testid="decimal-places-control"
          className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          {DECIMAL_PLACE_OPTIONS.map((places) => (
            <option key={places} value={places}>
              {places} decimal {places === 1 ? "place" : "places"} ({places === 0 ? "1 m" : (1 / Math.pow(10, places)).toFixed(places) + " m"})
            </option>
          ))}
        </select>
      </div>

      {/* Waste-factor control, 0–100 with validation message (Req 6.6, 6.11). */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={wasteId} className="text-xs font-bold uppercase tracking-wider text-slate-600 font-mono">
          Material Waste Factor
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
              "min-h-[44px] w-full rounded-xl border px-3 py-2 text-sm font-mono font-medium text-slate-900 shadow-sm focus:outline-none focus:ring-2",
              wasteError
                ? "border-red-400 bg-red-50/50 focus:ring-red-400/20"
                : "border-slate-300 bg-white focus:border-brand-500 focus:ring-brand-500/20",
            )}
          />
          <div className="flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-slate-100 px-3 text-sm font-mono font-semibold text-slate-600">
            %
          </div>
        </div>
        {wasteError ? (
          <p
            id={`${wasteId}-error`}
            role="alert"
            data-testid="waste-factor-error"
            className="rounded-lg bg-red-50 p-2 text-xs font-medium text-red-600 border border-red-200"
          >
            {wasteError}
          </p>
        ) : (
          <p id={`${wasteId}-hint`} className="text-[11px] font-mono text-slate-400">
            Permitted range: {WASTE_FACTOR_MIN} to {WASTE_FACTOR_MAX} %
          </p>
        )}
      </div>

      {/* Facade-subset selection (Req 6.7, 6.8, 6.9). */}
      <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3" data-testid="facade-selection">
        <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono px-1">
          Target Facade Scope
        </legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <label className={cn(
            "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
            wholePerimeterSelected
              ? "border-brand-500 bg-brand-50/60 text-brand-900 font-semibold"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          )}>
            <input
              type="radio"
              name={`${wasteId}-facade-mode`}
              checked={wholePerimeterSelected}
              onChange={selectWholePerimeter}
              data-testid="facade-whole-perimeter"
              className="h-4 w-4 text-brand-600 focus:ring-brand-500"
            />
            <span>Whole perimeter</span>
          </label>
          <label className={cn(
            "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
            !wholePerimeterSelected
              ? "border-brand-500 bg-brand-50/60 text-brand-900 font-semibold"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            !hasValidMeasurements && "opacity-50 cursor-not-allowed"
          )}>
            <input
              type="radio"
              name={`${wasteId}-facade-mode`}
              checked={!wholePerimeterSelected}
              onChange={beginFacadeSubset}
              disabled={!hasValidMeasurements}
              data-testid="facade-subset-mode"
              className="h-4 w-4 text-brand-600 focus:ring-brand-500"
            />
            <span>Selected sides only</span>
          </label>
        </div>

        {/* Per-side checkboxes, shown when targeting a subset (Req 6.7). */}
        {!wholePerimeterSelected && hasValidMeasurements ? (
          <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-slate-200">
            <span className="text-[11px] font-bold text-slate-500">Select active facade sides:</span>
            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
              {sideLengths.map((length, index) => {
                const checked =
                  selectedFacadeSideIndices?.includes(index) === true;
                return (
                  <label
                    key={index}
                    className={cn(
                      "flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                      checked
                        ? "border-brand-300 bg-brand-50 text-brand-900 font-medium"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSide(index)}
                        data-testid={`facade-side-${index}`}
                        className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span>Side {index + 1}</span>
                    </span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatMeasurement(length, decimalPlaces)} m
                    </span>
                  </label>
                );
              })}
            </div>
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
  icon?: string;
  highlight?: boolean;
}

/** A single labeled measurement readout in the summary grid. */
function Readout({ label, value, testId, icon, highlight }: ReadoutProps) {
  return (
    <div className={cn(
      "flex flex-col rounded-xl border p-2.5 transition-all shadow-xs",
      highlight
        ? "border-brand-300 bg-brand-50/50 ring-1 ring-brand-400/20"
        : "border-slate-200 bg-white"
    )}>
      <div className="flex items-center justify-between">
        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">{label}</dt>
        {icon ? <span className="text-xs opacity-70">{icon}</span> : null}
      </div>
      <dd data-testid={testId} className={cn(
        "mt-1 text-sm font-mono font-bold tracking-tight",
        highlight ? "text-brand-700" : "text-slate-900"
      )}>
        {value}
      </dd>
    </div>
  );
}

export default MeasurementPanel;
