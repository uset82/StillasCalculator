"use client";

import type { ScaffoldPlanCad } from "@/lib/types";

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface CadPreviewPanelProps {
  cad: ScaffoldPlanCad;
  className?: string;
}

export function CadPreviewPanel({ cad, className }: CadPreviewPanelProps) {
  const hasModel = Boolean(cad.openScadSource);
  const exports = cad.exports;

  return (
    <section
      data-testid="cad-preview-panel"
      aria-label="CAD preview"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 shadow-xs",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">📐</span>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
            Parametric 3D CAD Model
          </h2>
        </div>
        {cad.lastGeneratedAt ? (
          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            UPDATED {new Date(cad.lastGeneratedAt).toLocaleTimeString()}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-slate-400">OPENSCAD</span>
        )}
      </header>

      {!hasModel ? (
        <p className="text-xs text-slate-500 font-mono leading-relaxed">
          No CAD model generated yet. Request a 3D plan from the AI Copilot to generate parametric OpenSCAD geometry.
        </p>
      ) : (
        <>
          {Object.keys(cad.parameters).length > 0 ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(cad.parameters).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-white p-2 border border-slate-200/80 shadow-xs">
                  <dt className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">{key}</dt>
                  <dd className="mt-0.5 font-mono font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <details className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200">
            <summary className="cursor-pointer text-xs font-mono font-semibold text-brand-400 hover:text-brand-300">
              View OpenSCAD Source Code
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-300 border border-slate-800">
              {cad.openScadSource}
            </pre>
          </details>
        </>
      )}

      {exports.length > 0 ? (
        <ul className="flex flex-col gap-1.5 pt-1">
          {exports.map((entry, index) => (
            <li key={`${entry.format}-${index}`}>
              <a
                href={entry.pathOrUrl}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-mono font-bold text-brand-700 hover:bg-brand-100 border border-brand-200"
                download
              >
                <span>⬇</span>
                <span>Download .{entry.format.toUpperCase()}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] font-mono text-slate-400">
        Deterministic OpenSCAD template. Synchronized with ScaffoldPlan.
      </p>
    </section>
  );
}

export default CadPreviewPanel;
