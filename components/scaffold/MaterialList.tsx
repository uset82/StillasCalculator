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
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
          <span className="text-2xl mb-2 inline-block">📋</span>
          <p className="text-xs font-mono font-medium text-slate-600" data-testid="material-list-empty">
            No material list yet. Complete a calculation to see the planning estimate.
          </p>
        </div>
        <Disclaimer />
      </section>
    );
  }

  /**
   * Validates and commits a quantity edit for `item`.
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

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section
      data-testid="material-list"
      aria-label="Estimated material list"
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
          Estimated Material Takeoff (BOM)
        </h2>
        <span className="rounded bg-brand-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-brand-700 border border-brand-500/20">
          {totalQuantity} TOTAL PARTS
        </span>
      </div>

      <CalculationSummary
        calculation={calculation}
        scaffoldLengthMeters={scaffoldLengthMeters}
        decimalPlaces={decimalPlaces}
      />

      {/* Desktop / tablet table (>=768px). */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full border-collapse text-xs" data-testid="material-list-table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <th scope="col" className="py-2.5 pl-3.5 pr-3">
                Component / Item
              </th>
              <th scope="col" className="py-2.5 px-3">
                Quantity
              </th>
              <th scope="col" className="py-2.5 pl-2 pr-3.5">
                Unit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr
                key={item.id}
                className="align-middle transition-colors hover:bg-slate-50/70"
                data-testid={`material-row-${item.id}`}
              >
                <td className="py-2.5 pl-3.5 pr-3">
                  <span className="font-semibold text-slate-900">{item.itemName}</span>
                  {item.notes ? (
                    <p
                      className="mt-0.5 text-[11px] font-mono text-slate-500"
                      data-testid={`material-notes-${item.id}`}
                    >
                      {item.notes}
                    </p>
                  ) : null}
                </td>
                <td className="py-2.5 px-3">
                  <QuantityField
                    item={item}
                    value={inputValueFor(item)}
                    error={errors[item.id]}
                    onChange={handleQuantityChange}
                  />
                </td>
                <td className="py-2.5 pl-2 pr-3.5 font-mono text-[11px] font-medium text-slate-500">{item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (<768px). */}
      <ul className="flex flex-col gap-2.5 md:hidden" data-testid="material-list-cards">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs"
            data-testid={`material-card-${item.id}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-xs text-slate-900">{item.itemName}</span>
              <span className="font-mono text-[11px] font-medium text-slate-500">{item.unit}</span>
            </div>
            {item.notes ? (
              <p
                className="mt-1 text-[11px] font-mono text-slate-500"
                data-testid={`material-notes-card-${item.id}`}
              >
                {item.notes}
              </p>
            ) : null}
            <div className="mt-2.5 pt-2 border-t border-slate-100">
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
  showLabel?: boolean;
}

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
          "text-[11px] font-mono text-slate-500",
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
          "h-10 w-24 rounded-lg border px-2.5 text-xs font-mono font-bold text-slate-900 shadow-xs",
          "focus:outline-none focus:ring-2",
          error !== undefined
            ? "border-red-400 bg-red-50 text-red-900 focus:ring-red-400/20"
            : "border-slate-300 bg-white focus:border-brand-500 focus:ring-brand-500/20",
        )}
      />
      {error !== undefined ? (
        <p
          id={errorId}
          role="alert"
          className="text-[11px] font-medium text-red-600"
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

function CalculationSummary({
  calculation,
  scaffoldLengthMeters,
  decimalPlaces,
}: CalculationSummaryProps) {
  const length = scaffoldLengthMeters ?? calculation?.totalScaffoldLengthMeters ?? null;
  return (
    <dl
      className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-center shadow-xs"
      data-testid="material-list-summary"
    >
      <div className="flex flex-col rounded-lg bg-white p-2 border border-slate-200/60 shadow-xs">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">Length</dt>
        <dd className="mt-0.5 text-xs font-mono font-bold text-slate-900" data-testid="summary-length">
          {length === null ? "—" : `${formatMeasurement(length, decimalPlaces)} m`}
        </dd>
      </div>
      <div className="flex flex-col rounded-lg bg-white p-2 border border-slate-200/60 shadow-xs">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">Bays</dt>
        <dd className="mt-0.5 text-xs font-mono font-bold text-slate-900" data-testid="summary-bays">
          {calculation ? calculation.numberOfBays : "—"}
        </dd>
      </div>
      <div className="flex flex-col rounded-lg bg-white p-2 border border-slate-200/60 shadow-xs">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">Levels</dt>
        <dd className="mt-0.5 text-xs font-mono font-bold text-slate-900" data-testid="summary-levels">
          {calculation ? calculation.numberOfLevels : "—"}
        </dd>
      </div>
    </dl>
  );
}

function Disclaimer() {
  return (
    <div
      role="note"
      data-testid="material-list-disclaimer"
      className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900 shadow-xs"
    >
      <div className="flex items-start gap-2">
        <span className="text-sm">⚠️</span>
        <p className="font-medium leading-relaxed">
          {VERIFICATION_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}

export default MaterialList;
