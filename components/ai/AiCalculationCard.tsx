"use client";

import type { AiToolResult } from "@/app/api/ai/chat/route";
import { formatMeasurement } from "@/lib/format/measurement";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Human-readable labels for the six deterministic tools (Req 13.2). Falls back
 * to the raw tool name for any unrecognized value so an unexpected tool is
 * still rendered rather than hidden.
 */
const TOOL_LABELS: Record<string, string> = {
  calculateScaffoldMaterials: "Scaffold calculation",
  getSelectedBuildingMeasurements: "Building measurements",
  getAvailableScaffoldSystems: "Available scaffold systems",
  updateWorkingHeight: "Working height update",
  generateMaterialList: "Material list",
  generateReportSummary: "Report summary",
  getScaffoldPlan: "Scaffold plan",
  setBuildingPerimeter: "Building perimeter",
  setBuildingPerimeterFromLocation: "Selected house perimeter",
  selectFacadeSides: "Facade selection",
  setScaffoldSystem: "Scaffold system",
  setScaffoldDimensions: "Scaffold dimensions",
  generateScaffoldDrawing: "Scaffold drawing",
  clearScaffoldDrawing: "Clear drawing",
  generateCadModel: "CAD model",
  exportCadFormat: "CAD export",
  retrieveBuildingFootprints: "Building footprints",
};

export interface AiCalculationCardProps {
  /**
   * A single tool invocation and its deterministic result, as returned by the
   * chat route and normalized by the chat client (Req 13.1). The `data` payload
   * is untrusted/loosely-typed here, so every field is read defensively.
   */
  result: AiToolResult;
  /**
   * Decimal places used to format the Scaffold_Length, matching the rest of the
   * display layer (Req 6.5). Defaults to 2.
   */
  decimalPlaces?: number;
  /** Extra classes for the outer container. */
  className?: string;
}

/** A single rendered quantity row extracted from a tool result. */
interface Quantity {
  key: string;
  label: string;
  value: string;
}

/** A single material line extracted from a tool result's material list. */
interface MaterialLine {
  id: string;
  itemName: string;
  quantity: string;
  unit: string;
  notes?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads a finite number field, or `undefined` when absent/non-numeric. */
function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads a non-empty string field, or `undefined` otherwise. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

/**
 * Extracts the engine-computed scalar quantities present anywhere in a tool
 * result's `data` (Req 13.1, 13.6). Values are surfaced verbatim — only the
 * Scaffold_Length is formatted to the configured decimal places, matching the
 * material-list display. Nothing is invented: a field that is absent simply
 * produces no row.
 */
function extractQuantities(data: unknown, decimalPlaces: number): Quantity[] {
  const record = asRecord(data);
  const quantities: Quantity[] = [];
  const measurements = asRecord(record.measurements);
  const selectedCandidate = asRecord(record.selectedCandidate);

  const scaffoldLength =
    readNumber(record, "totalScaffoldLengthMeters") ??
    readNumber(record, "scaffoldLengthMeters");
  if (scaffoldLength !== undefined) {
    quantities.push({
      key: "scaffoldLength",
      label: "Scaffold length",
      value: `${formatMeasurement(scaffoldLength, decimalPlaces)} m`,
    });
  }

  const perimeter =
    readNumber(record, "perimeterMeters") ??
    readNumber(measurements, "perimeterMeters") ??
    readNumber(selectedCandidate, "perimeterMeters");
  if (perimeter !== undefined) {
    quantities.push({
      key: "perimeter",
      label: "Perimeter",
      value: `${formatMeasurement(perimeter, decimalPlaces)} m`,
    });
  }

  const area =
    readNumber(record, "areaSquareMeters") ??
    readNumber(measurements, "areaSquareMeters") ??
    readNumber(selectedCandidate, "areaSquareMeters");
  if (area !== undefined) {
    quantities.push({
      key: "area",
      label: "Area",
      value: `${formatMeasurement(area, decimalPlaces)} m2`,
    });
  }

  const candidateCount =
    readNumber(record, "candidateCount") ?? readArray(record, "candidates")?.length;
  if (candidateCount !== undefined) {
    quantities.push({
      key: "candidateCount",
      label: "Footprints found",
      value: String(candidateCount),
    });
  }

  const selectedIndex = readNumber(record, "selectedIndex");
  if (selectedIndex !== undefined) {
    quantities.push({
      key: "selectedIndex",
      label: "Selected footprint",
      value: `#${selectedIndex + 1}`,
    });
  }

  const bays = readNumber(record, "numberOfBays");
  if (bays !== undefined) {
    quantities.push({ key: "bays", label: "Bays", value: String(bays) });
  }

  const levels = readNumber(record, "numberOfLevels");
  if (levels !== undefined) {
    quantities.push({ key: "levels", label: "Levels", value: String(levels) });
  }

  const workingHeight = readNumber(record, "workingHeightMeters");
  if (workingHeight !== undefined) {
    quantities.push({
      key: "workingHeight",
      label: "Working height",
      value: `${formatMeasurement(workingHeight, decimalPlaces)} m`,
    });
  }

  const featureCount = readNumber(record, "featureCount");
  if (featureCount !== undefined) {
    quantities.push({
      key: "featureCount",
      label: "Drawing features",
      value: String(featureCount),
    });
  }

  const downloadUrl = readString(record, "downloadUrl");
  if (downloadUrl) {
    quantities.push({ key: "download", label: "Export", value: downloadUrl });
  }

  return quantities;
}

/**
 * Extracts the material list lines from a tool result's `data`, when present
 * (Req 13.1). Quantities and units are surfaced exactly as the engine produced
 * them, with no rounding or transformation (Req 13.6).
 */
function extractMaterialList(data: unknown): MaterialLine[] {
  const record = asRecord(data);
  const list = record.materialList;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((entry, index) => {
    const item = asRecord(entry);
    const id = readString(item, "id") ?? `item-${index}`;
    const quantity = readNumber(item, "quantity");
    return {
      id,
      itemName: readString(item, "itemName") ?? "Item",
      quantity: quantity !== undefined ? String(quantity) : "—",
      unit: readString(item, "unit") ?? "",
      notes: readString(item, "notes"),
    };
  });
}

/** Extracts any warnings array from a tool result's `data`. */
function extractWarnings(data: unknown): string[] {
  const record = asRecord(data);
  const warnings = record.warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.filter((entry): entry is string => typeof entry === "string");
}

/**
 * `AiCalculationCard` — renders a single deterministic tool-call result inside
 * the chat (Req 13.1). It shows the tool that ran, whether it succeeded, and
 * the engine-computed quantities it returned: the Scaffold_Length, the number
 * of bays and levels, the working height, the estimated material list, and any
 * warnings. Quantities are presented exactly as the engine returned them — no
 * rounding, scaling, or other transformation (Req 13.6) — so a figure shown in
 * chat always equals the calculator's figure for the same inputs.
 *
 * When the tool failed, the specific error is shown so the assistant can ask
 * the user for the missing or invalid value rather than fabricating one
 * (Req 13.5). The component is purely presentational and reads its untrusted
 * `data` payload defensively.
 */
export function AiCalculationCard({
  result,
  decimalPlaces = 2,
  className,
}: AiCalculationCardProps) {
  const label = TOOL_LABELS[result.tool] ?? result.tool;
  const quantities = result.ok ? extractQuantities(result.data, decimalPlaces) : [];
  const materialList = result.ok ? extractMaterialList(result.data) : [];
  const warnings = result.ok ? extractWarnings(result.data) : [];

  return (
    <article
      data-testid={`ai-calculation-card-${result.tool}`}
      data-tool={result.tool}
      data-ok={result.ok}
      className={cn(
        "rounded-lg border bg-white p-3 text-sm",
        result.ok ? "border-gray-200" : "border-red-300 bg-red-50",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-semibold text-gray-800">{label}</span>
        <span
          data-testid="ai-calculation-status"
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            result.ok
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800",
          )}
        >
          {result.ok ? "Computed by calculator" : "Needs input"}
        </span>
      </header>

      {/* Failure: surface the specific reason so the assistant can request the
          missing/invalid value rather than fabricate one (Req 13.5). */}
      {!result.ok ? (
        <p
          role="alert"
          data-testid="ai-calculation-error"
          className="mt-2 text-red-700"
        >
          {result.error ?? "The tool could not complete."}
        </p>
      ) : null}

      {/* Engine-computed scalar quantities (Req 13.1, 13.6). */}
      {quantities.length > 0 ? (
        <dl
          data-testid="ai-calculation-quantities"
          className="mt-2 grid grid-cols-2 gap-2"
        >
          {quantities.map((quantity) => (
            <div key={quantity.key} className="flex flex-col">
              <dt className="text-xs text-gray-500">{quantity.label}</dt>
              <dd
                data-testid={`ai-quantity-${quantity.key}`}
                className="font-semibold text-gray-800"
              >
                {quantity.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Estimated material list, quantities shown verbatim (Req 13.6). */}
      {materialList.length > 0 ? (
        <ul
          data-testid="ai-calculation-material-list"
          className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-2"
        >
          {materialList.map((line) => (
            <li
              key={line.id}
              data-testid={`ai-material-${line.id}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-gray-800">
                {line.itemName}
                {line.notes ? (
                  <span className="ml-1 text-xs text-gray-500">({line.notes})</span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-gray-700">
                {line.quantity} {line.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Engine warnings (Req 10.5), if any. */}
      {warnings.length > 0 ? (
        <ul
          data-testid="ai-calculation-warnings"
          className="mt-3 flex flex-col gap-1 border-t border-amber-200 pt-2 text-xs text-amber-800"
        >
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default AiCalculationCard;
