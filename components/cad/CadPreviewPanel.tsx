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
        "flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-800">CAD model</h2>
        {cad.lastGeneratedAt ? (
          <span className="text-xs text-gray-500">
            Updated {new Date(cad.lastGeneratedAt).toLocaleString()}
          </span>
        ) : null}
      </header>

      {!hasModel ? (
        <p className="text-sm text-gray-500">
          No CAD model yet. Ask the assistant to generate one from your scaffold plan.
        </p>
      ) : (
        <>
          {Object.keys(cad.parameters).length > 0 ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(cad.parameters).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-gray-500">{key}</dt>
                  <dd className="font-medium text-gray-800">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <details className="rounded-md border border-gray-100 bg-gray-50 p-2">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              OpenSCAD source
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto text-xs text-gray-800">
              {cad.openScadSource}
            </pre>
          </details>
        </>
      )}

      {exports.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {exports.map((entry, index) => (
            <li key={`${entry.format}-${index}`}>
              <a
                href={entry.pathOrUrl}
                className="text-sm font-medium text-blue-600 hover:underline"
                download
              >
                Download .{entry.format}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-gray-400">
        Parametric OpenSCAD template (CADAM-inspired). Geometry is deterministic from
        ScaffoldPlan — not LLM-generated.
      </p>
    </section>
  );
}

export default CadPreviewPanel;
