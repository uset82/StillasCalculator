"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  VERIFICATION_DISCLAIMER,
  type MaterialItem,
  type ScaffoldCalculationOutput,
  type UpdateResult,
} from "@/lib/types";
import { formatMeasurement } from "@/lib/format/measurement";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency; the presentation components only need a tiny helper.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Inclusive bounds for a manually adjusted material quantity (Req 11.3). */
const MIN_QUANTITY = 0;
const MAX_QUANTITY = 999999;

export interface MaterialListProps {
  /**
   * The most recent calculation result. Supplies the calculation summary —
   * Scaffold_Length, number of bays, and number of levels (Req 11.5) — and is
   * the fallback source of items when no manual overrides have been stored yet.
   */
  calculation: ScaffoldCalculationOutput | null;
  /**
   * The Material_List currently stored in `Project_State`, including any manual
   * quantity overrides (Req 11.4). This is the authoritative list to display
   * and export; it falls back to {@link calculation}'s list when null.
   */
  materialListAdjusted: MaterialItem[] | null;
  /**
   * The Scaffold_Length in meters shown in the calculation summary (Req 11.5).
   * Falls back to the calculation's total scaffold length when null.
   */
  scaffoldLengthMeters: number | null;
  /** Configured number of decimal places for the Scaffold_Length (Req 6.5). */
  decimalPlaces: number;
  /**
   * Invoked when the user commits a quantity edit for an item. Wired to
   * `projectStateController.setMaterialQuantity`, which validates the value
   * (integer 0..999999) and returns an {@link UpdateResult}. When the result is
   * `{ ok: false }` the returned `ValidationError` message is surfaced inline
   * (Req 11.6). Optional so the component can be rendered before it is wired to
   * `Project_State`.
   */
  onQuantityChange?: (itemId: string, qty: number) => UpdateResult;
  /** Extra classes for the outer container. */
  className?: string;
}

/**
 * Renders the estimated Material_List: a table at the >=768px breakpoint and a
 * stack of cards below it (Req 11.2). Each item shows its name, quantity, and
 * unit, with notes shown only for items that have them (Req 11.1). Quantities
 * are editable and constrained to an integer in 0..999999; an invalid entry is
 * rejected and a validation message identifying the item is shown while the
 * prior quantity is retained (Req 11.3, 11.6). A calculation summary shows the
 * Scaffold_Length, bays, and levels (Req 11.5), and the Verification_Disclaimer
 * is shown inline without navigation (Req 15.1).
 *
 * All copy uses planning-estimate terminology and never describes a scaffold as
 * certified, approved, or safe for use (Req 15.6).
 */
export function MaterialList({
  calculation,
  materialListAdjusted,
  scaffoldLengthMeters,
  decimalPlaces,
  onQuantityChange,
  className,
}: MaterialListProps) {
  const items = materialListAdjusted ?? calculation?.materialList ?? null;

  // Draft text for items currently being edited and per-item validation
  // messages. An item shows its draft text only while it has an active error
  // (an invalid entry the user has not yet corrected); otherwise the input
  // reflects the authoritative quantity from props, so a new calculation that
  // replaces manual edits is shown immediately (Req 11.7).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Clear any in-progress drafts/errors whenever a fresh calculation arrives so
  // newly computed quantities are not masked by stale edits (Req 11.7).
  const previousCalculationRef = useRef<ScaffoldCalculationOutput | null>(calculation);
  useEffect(() => {
    if (previousCalculationRef.current !== calculation) {
      previousCalculationRef.current = calculation;
      setDrafts({});
      setErrors({});
    }
  }, [calculation]);

  if (!items || items.length === 0) {
    return (
      <section
        data-testid="material-list"
        aria-label="Estimated material list"
        className={cn("flex flex-col gap-4", className)}
      >
        <p className="text-sm text-gray-600" data-testid="material-list-empty">
          No material list yet. Complete a calculation to see the planning
          estimate.
        </p>
        <Disclaimer />
      </section>
    );
  }

  /**
   * Validates and commits a quantity edit for `item`. Stores the draft, and on
   * an invalid entry (non-integer, negative, out of range, or rejected by the
   * controller) records a message identifying the item and retains the prior
   * quantity (Req 11.6). On a valid, accepted value the draft and error clear so
   * the input reflects the stored quantity.
   */
  const handleQuantityChange = (
    item: MaterialItem,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const raw = event.target.value;
    setDrafts((prev) => ({ ...prev, [item.id]: raw }));

    const parsed = Number(raw);
    const isValid =
      raw.trim() !== "" &&
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= MIN_QUANTITY &&
      parsed <= MAX_QUANTITY;

    if (!isValid) {
      setErrors((prev) => ({
        ...prev,
        [item.id]: `Quantity for "${item.itemName}" must be a whole number between ${MIN_QUANTITY} and ${MAX_QUANTITY}.`,
      }));
      return;
    }

    const result = onQuantityChange?.(item.id, parsed);
    if (result && !result.ok) {
      setErrors((prev) => ({
        ...prev,
        [item.id]:
          result.error?.message ??
          `The quantity for "${item.itemName}" was rejected.`,
      }));
      return;
    }

    // Accepted: drop the draft and any prior error so the input reflects the
    // authoritative stored quantity.
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setErrors((prev) => {
      if (prev[item.id] === undefined) {
        return prev;
      }
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const inputValueFor = (item: MaterialItem): string =>
    errors[item.id] !== undefined
      ? drafts[item.id] ?? String(item.quantity)
      : String(item.quantity);

  return (
    <section
      data-testid="material-list"
      aria-label="Estimated material list"
      className={cn("flex flex-col gap-4", className)}
    >
      <h2 className="text-base font-semibold text-gray-800">
        Estimated material list
      </h2>

      <CalculationSummary
        calculation={calculation}
        scaffoldLengthMeters={scaffoldLengthMeters}
        decimalPlaces={decimalPlaces}
      />

      {/* Desktop / tablet table (>=768px). Hidden below the breakpoint where
          the card layout is shown instead (Req 11.2). */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm" data-testid="material-list-table">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              <th scope="col" className="py-2 pr-3 font-medium">
                Item
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Quantity
              </th>
              <th scope="col" className="py-2 font-medium">
                Unit
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-gray-100 align-top"
                data-testid={`material-row-${item.id}`}
              >
                <td className="py-2 pr-3">
                  <span className="font-medium text-gray-800">{item.itemName}</span>
                  {/* Notes render only for items that have them (Req 11.1). */}
                  {item.notes ? (
                    <p
                      className="mt-1 text-xs text-gray-500"
                      data-testid={`material-notes-${item.id}`}
                    >
                      {item.notes}
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <QuantityField
                    item={item}
                    value={inputValueFor(item)}
                    error={errors[item.id]}
                    onChange={handleQuantityChange}
                  />
                </td>
                <td className="py-2 text-gray-700">{item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (<768px). Hidden at the desktop breakpoint (Req 11.2). */}
      <ul className="flex flex-col gap-3 md:hidden" data-testid="material-list-cards">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-lg border border-gray-200 p-3"
            data-testid={`material-card-${item.id}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-gray-800">{item.itemName}</span>
              <span className="text-sm text-gray-500">{item.unit}</span>
            </div>
            {item.notes ? (
              <p
                className="mt-1 text-xs text-gray-500"
                data-testid={`material-notes-card-${item.id}`}
              >
                {item.notes}
              </p>
            ) : null}
            <div className="mt-3">
              <QuantityField
                item={item}
                value={inputValueFor(item)}
                error={errors[item.id]}
                onChange={handleQuantityChange}
                showLabel
              />
            </div>
          </li>
        ))}
      </ul>

      <Disclaimer />
    </section>
  );
}

interface QuantityFieldProps {
  item: MaterialItem;
  value: string;
  error?: string;
  onChange: (item: MaterialItem, event: ChangeEvent<HTMLInputElement>) => void;
  /** Render a visible "Quantity" label (used in the card layout). */
  showLabel?: boolean;
}

/**
 * A single editable quantity input with an inline validation message. The input
 * is constrained to whole numbers in 0..999999; invalid entries surface a
 * message identifying the item while the controller retains the prior value
 * (Req 11.3, 11.6).
 */
function QuantityField({
  item,
  value,
  error,
  onChange,
  showLabel = false,
}: QuantityFieldProps) {
  const inputId = `material-qty-${item.id}`;
  const errorId = `material-qty-error-${item.id}`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className={cn(
          "text-xs font-medium text-gray-600",
          !showLabel && "sr-only",
        )}
      >
        Quantity of {item.itemName}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={MIN_QUANTITY}
        max={MAX_QUANTITY}
        step={1}
        value={value}
        onChange={(event) => onChange(item, event)}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        data-testid={`material-qty-input-${item.id}`}
        className={cn(
          "h-11 w-24 rounded-md border px-2 text-sm text-gray-900",
          "focus:outline-none focus:ring-2 focus:ring-blue-500",
          error !== undefined
            ? "border-red-500 focus:ring-red-500"
            : "border-gray-300",
        )}
      />
      {error !== undefined ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-red-600"
          data-testid={`material-qty-error-${item.id}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface CalculationSummaryProps {
  calculation: ScaffoldCalculationOutput | null;
  scaffoldLengthMeters: number | null;
  decimalPlaces: number;
}

/**
 * The calculation summary: Scaffold_Length in meters, the number of bays as a
 * whole number, and the number of levels as a whole number (Req 11.5).
 */
function CalculationSummary({
  calculation,
  scaffoldLengthMeters,
  decimalPlaces,
}: CalculationSummaryProps) {
  const length = scaffoldLengthMeters ?? calculation?.totalScaffoldLengthMeters ?? null;
  return (
    <dl
      className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-center"
      data-testid="material-list-summary"
    >
      <div className="flex flex-col">
        <dt className="text-xs text-gray-500">Scaffold length</dt>
        <dd className="text-sm font-semibold text-gray-800" data-testid="summary-length">
          {length === null ? "—" : `${formatMeasurement(length, decimalPlaces)} m`}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-gray-500">Bays</dt>
        <dd className="text-sm font-semibold text-gray-800" data-testid="summary-bays">
          {calculation ? calculation.numberOfBays : "—"}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-gray-500">Levels</dt>
        <dd className="text-sm font-semibold text-gray-800" data-testid="summary-levels">
          {calculation ? calculation.numberOfLevels : "—"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The inline Verification_Disclaimer, shown within the material-list content
 * without requiring navigation to a separate screen (Req 15.1). The text uses
 * planning-estimate terminology and never describes a scaffold as certified,
 * approved, or safe for use (Req 15.6).
 */
function Disclaimer() {
  return (
    <p
      role="note"
      data-testid="material-list-disclaimer"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"
    >
      {VERIFICATION_DISCLAIMER}
    </p>
  );
}

export default MaterialList;
