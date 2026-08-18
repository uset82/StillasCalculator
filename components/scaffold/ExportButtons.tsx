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
      className={cn("flex flex-col gap-3.5", className)}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
          Documentation & Takeoff Export
        </h2>
        <span className="text-[10px] font-mono text-slate-400">PDF & CSV</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={busy}
          data-testid="export-pdf-button"
          className={cn(
            "flex min-h-[48px] items-center justify-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all shadow-sm",
            "bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1",
            "disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
          )}
        >
          <span aria-hidden="true" className="text-base">📄</span>
          <span>{pending === "pdf" ? "Generating PDF…" : "Export PDF"}</span>
        </button>

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={busy}
          data-testid="export-csv-button"
          className={cn(
            "flex min-h-[48px] items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-800 transition-all shadow-xs hover:bg-slate-50 active:scale-[0.98]",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1",
            "disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none",
          )}
        >
          <span aria-hidden="true" className="text-base">📊</span>
          <span>{pending === "csv" ? "Generating CSV…" : "Export CSV"}</span>
        </button>
      </div>

      {status !== null ? (
        <div
          role="alert"
          data-testid="export-message"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700 shadow-xs"
        >
          {status.text}
        </div>
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
