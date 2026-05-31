"use client";

import { useState } from "react";

import type { ProjectState } from "@/lib/types";
import { serializeReportPdf } from "@/lib/export/pdfExport";
import { serializeMaterialListCsv } from "@/lib/export/csvExport";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components in this project.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Default download file names for the generated report artifacts. */
const PDF_FILENAME = "scaffold-material-estimate.pdf";
const CSV_FILENAME = "scaffold-material-estimate.csv";

/**
 * Generic export-failure message surfaced when a serializer reports an
 * unexpected failure or throws (Req 14.7). The serializers' own `reason`
 * strings (including the shared "complete a calculation first" message,
 * Req 14.4) are preferred over this fallback when present.
 */
const EXPORT_FAILED_FALLBACK =
  "The export could not be completed. Please try again.";

/** Visual classification of the inline status message. */
type ExportStatus = { kind: "error"; text: string } | null;

/** Which export is currently being generated, if any (drives button disabling). */
type Pending = "pdf" | "csv" | null;

export interface ExportButtonsProps {
  /**
   * A snapshot of the current `Project_State` to serialize. Provide this when
   * the parent already holds the live state; otherwise provide {@link getState}
   * so the latest snapshot is read at click time. When both are supplied,
   * {@link getState} takes precedence so the most current state is exported.
   * Optional so the component can be rendered before it is wired to
   * `Project_State`.
   */
  state?: ProjectState;
  /**
   * Returns the current `Project_State` snapshot, evaluated each time an export
   * is triggered. Wired to `projectStateController.getState` so exports always
   * reflect the latest stored quantities (Req 14.1, 14.2). Takes precedence
   * over {@link state} when both are provided.
   */
  getState?: () => ProjectState;
  /** Extra classes for the outer container. */
  className?: string;
}

/**
 * Triggers PDF and CSV export of the current `Project_State` (Req 14).
 *
 * Both buttons serialize from a snapshot of the single source of truth using
 * the pure serializers in `lib/export`, then trigger a browser download of the
 * result on success (Req 14.1, 14.2). When no `Material_List` exists the
 * serializers refuse and return the shared "complete a calculation first"
 * message, which is surfaced inline without producing a file (Req 14.4). Any
 * other serializer failure surfaces an export-failure message while leaving the
 * `Project_State` untouched (Req 14.7).
 *
 * The component owns no business state of its own: it reads a `Project_State`
 * snapshot (via {@link ExportButtonsProps.getState} or
 * {@link ExportButtonsProps.state}) and never mutates it, so it composes
 * cleanly once wired to the state controller.
 */
export function ExportButtons({
  state,
  getState,
  className,
}: ExportButtonsProps) {
  const [status, setStatus] = useState<ExportStatus>(null);
  const [pending, setPending] = useState<Pending>(null);

  /**
   * Resolves the current `Project_State` snapshot, preferring the live
   * {@link getState} callback over a passed-in {@link state}. Returns `null`
   * when neither is wired up yet.
   */
  const resolveState = (): ProjectState | null => {
    if (getState) {
      return getState();
    }
    return state ?? null;
  };

  /** Handles the PDF export click (Req 14.1, 14.4, 14.7). */
  const handleExportPdf = async (): Promise<void> => {
    const snapshot = resolveState();
    if (snapshot === null) {
      setStatus({ kind: "error", text: EXPORT_FAILED_FALLBACK });
      return;
    }

    setPending("pdf");
    setStatus(null);
    try {
      const result = await serializeReportPdf(snapshot);
      if (!result.ok) {
        // Covers both the "complete a calculation first" refusal (Req 14.4)
        // and any rendering failure (Req 14.7); the serializer never throws.
        setStatus({ kind: "error", text: result.reason });
        return;
      }
      triggerDownload(
        // Copy into a fresh ArrayBuffer-backed view so the Blob part is a
        // plain BlobPart regardless of the source buffer type.
        new Blob([result.pdf.slice()], { type: "application/pdf" }),
        PDF_FILENAME,
      );
    } catch {
      setStatus({ kind: "error", text: EXPORT_FAILED_FALLBACK });
    } finally {
      setPending(null);
    }
  };

  /** Handles the CSV export click (Req 14.2, 14.4, 14.7). */
  const handleExportCsv = (): void => {
    const snapshot = resolveState();
    if (snapshot === null) {
      setStatus({ kind: "error", text: EXPORT_FAILED_FALLBACK });
      return;
    }

    setPending("csv");
    setStatus(null);
    try {
      const result = serializeMaterialListCsv(snapshot);
      if (!result.ok) {
        // Covers both the "complete a calculation first" refusal (Req 14.4)
        // and any failure (Req 14.7); the serializer never throws.
        setStatus({ kind: "error", text: result.reason });
        return;
      }
      triggerDownload(
        new Blob([result.csv], { type: "text/csv;charset=utf-8;" }),
        CSV_FILENAME,
      );
    } catch {
      setStatus({ kind: "error", text: EXPORT_FAILED_FALLBACK });
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;

  return (
    <section
      data-testid="export-buttons"
      aria-label="Export report"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={busy}
          data-testid="export-pdf-button"
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium",
            "bg-blue-600 text-white hover:bg-blue-700",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending === "pdf" ? "Generating PDF…" : "Export PDF"}
        </button>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={busy}
          data-testid="export-csv-button"
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium",
            "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending === "csv" ? "Generating CSV…" : "Export CSV"}
        </button>
      </div>

      {status !== null ? (
        <p
          role="alert"
          data-testid="export-message"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700"
        >
          {status.text}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Triggers a browser download of `blob` under `filename` using a transient
 * object URL and a synthetic anchor click. The object URL is revoked
 * afterwards so the blob can be garbage-collected.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default ExportButtons;
