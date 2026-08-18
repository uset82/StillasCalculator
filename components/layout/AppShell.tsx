"use client";

import { useState, type ReactNode } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";

/** Local class-name joiner (see MobileBottomSheet for rationale). */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Identifiers for the secondary panels surfaced through the bottom sheet on
 * mobile and the side pane on desktop. Used to drive which panel is active in
 * the mobile bottom sheet (Req 1.2).
 */
export type SecondaryPanelId =
  | "scaffoldInputs"
  | "materialList"
  | "aiAssistant"
  | "export";

export interface AppShellProps {
  /** Optional brand/title shown in the top bar. Defaults to the app name. */
  title?: ReactNode;
  /** Callback to trigger the Product Intro modal. */
  onOpenIntro?: () => void;
  /** Callback to return to the full landing page overview. */
  onBackToLanding?: () => void;
  /**
   * Primary content slot: the interactive map. Rendered in the always-visible
   * primary pane on every viewport width (Req 1.5, Req 2).
   */
  map: ReactNode;
  /** Scaffold input controls (system selector + calculator form) (Req 1.5). */
  scaffoldInputs: ReactNode;
  /** Estimated material list + calculation summary (Req 1.5). */
  materialList: ReactNode;
  /** AI assistant chat panel (Req 1.5). */
  aiAssistant: ReactNode;
  /** Export actions (PDF/CSV) (Req 1.5). */
  exportActions: ReactNode;
}

interface LauncherItem {
  id: SecondaryPanelId;
  label: string;
  icon: string;
}

const LAUNCHER_ITEMS: readonly LauncherItem[] = [
  { id: "scaffoldInputs", label: "Inputs", icon: "📐" },
  { id: "materialList", label: "Materials", icon: "📋" },
  { id: "aiAssistant", label: "Assistant", icon: "💬" },
  { id: "export", label: "Export", icon: "⬇️" },
] as const;

const PANEL_TITLES: Record<SecondaryPanelId, string> = {
  scaffoldInputs: "Scaffold inputs",
  materialList: "Material list",
  aiAssistant: "AI assistant",
  export: "Export",
};

/**
 * Top-level responsive application shell (Req 1).
 */
export function AppShell({
  title = "StillasCalculator",
  onOpenIntro,
  onBackToLanding,
  map,
  scaffoldInputs,
  materialList,
  aiAssistant,
  exportActions,
}: AppShellProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<SecondaryPanelId>("scaffoldInputs");

  const openPanel = (panel: SecondaryPanelId) => {
    setActivePanel(panel);
    setSheetOpen(true);
  };

  const slots: Record<SecondaryPanelId, ReactNode> = {
    scaffoldInputs,
    materialList,
    aiAssistant,
    export: exportActions,
  };

  return (
    <div
      data-testid="app-shell"
      className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#faf8f5] text-[#1a1918] font-sans antialiased"
    >
      {/* Precision Studio Top Bar */}
      <header className="flex h-14 flex-none items-center justify-between border-b border-[#e7e3dc] bg-[#faf8f5]/95 px-3 md:px-5 shadow-xs z-30">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#da7756] font-bold text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4.5 w-4.5"
              aria-hidden="true"
            >
              <path d="M4 2v20M20 2v20M4 6h16M4 12h16M4 18h16M4 6l16 12M4 18L20 6" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm md:text-base font-serif font-bold tracking-tight text-[#1a1918]">{title}</span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-[#f4ddd3] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#a3482a]">
              PRO STUDIO
            </span>
          </div>
        </div>

        {/* Live System Status HUD & Navigation Buttons */}
        <div className="flex items-center gap-2">
          {onBackToLanding && (
            <button
              type="button"
              onClick={onBackToLanding}
              className="flex items-center gap-1.5 rounded-xl bg-white hover:bg-[#f5f2eb] text-[#2d2a26] border border-[#dfdad1] px-3 py-1.5 text-xs font-medium shadow-xs transition-colors"
            >
              <span>🌐</span>
              <span className="hidden sm:inline">Overview & Estimator</span>
            </button>
          )}

          {onOpenIntro && (
            <button
              type="button"
              onClick={onOpenIntro}
              className="flex items-center gap-1.5 rounded-xl bg-[#fdf8f5] hover:bg-[#f9eee8] text-[#a3482a] border border-[#ecc4b4] px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <span>ℹ️</span>
              <span className="hidden sm:inline">Guide</span>
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 border border-[#e7e3dc] text-xs text-[#66625d] shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#da7756] opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#da7756]"></span>
            </span>
            <span className="font-mono text-[11px] text-[#66625d]">CAD TAKEOFF</span>
          </div>
        </div>
      </header>

      {/* Main region: single column on mobile, two panes on desktop. */}
      <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden bg-[#faf8f5]">
        {/* Primary pane: the map. Always visible (Req 1.5). */}
        <main
          data-region="map"
          aria-label="Map"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-900"
        >
          {map}
        </main>

        {/* Secondary panels: mobile bottom sheet / desktop side pane */}
        <MobileBottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={PANEL_TITLES[activePanel]}
        >
          {/* Desktop Studio Workspace Tab Bar */}
          <div className="hidden md:flex mb-3 items-center justify-between rounded-xl bg-[#f5f2eb] p-1 border border-[#dfdad1] shadow-2xs">
            {LAUNCHER_ITEMS.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActivePanel(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 text-xs font-medium transition-all",
                  activePanel === id
                    ? "bg-white text-[#da7756] font-bold shadow-xs border border-[#e7e3dc]"
                    : "text-[#66625d] hover:text-[#1a1918] hover:bg-white/50"
                )}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            {LAUNCHER_ITEMS.map(({ id, label }) => (
              <section
                key={id}
                data-region={id}
                aria-label={label}
                className={cn(
                  activePanel === id ? "block" : "hidden",
                  "md:block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all"
                )}
              >
                {/* Per-panel heading shown on desktop */}
                <div className="mb-3 hidden items-center justify-between border-b border-slate-100 pb-2.5 md:flex">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200/50">
                      {LAUNCHER_ITEMS.find((item) => item.id === id)?.icon}
                    </span>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
                      {PANEL_TITLES[id]}
                    </h2>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                    SEC-{id.toUpperCase().slice(0, 4)}
                  </span>
                </div>
                <div className="text-slate-900">{slots[id]}</div>
              </section>
            ))}
          </div>
        </MobileBottomSheet>
      </div>

      {/* Mobile launcher bar: access points for every feature (Req 1.5). */}
      <nav
        data-testid="mobile-launcher"
        aria-label="Panels"
        className="z-50 flex h-16 flex-none items-stretch justify-around border-t border-slate-800 bg-slate-900 px-1 md:hidden shadow-lg"
      >
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          aria-label="Map"
          data-testid="launcher-map"
          aria-pressed={!sheetOpen}
          className={cn(
            "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs transition-colors",
            !sheetOpen
              ? "bg-brand-600/15 text-brand-400 font-semibold"
              : "text-slate-400 hover:text-slate-200 active:bg-slate-800"
          )}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            🗺️
          </span>
          <span className="text-[11px] tracking-tight">Map</span>
        </button>
        {LAUNCHER_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => openPanel(id)}
            aria-label={label}
            data-testid={`launcher-${id}`}
            aria-pressed={sheetOpen && activePanel === id}
            className={cn(
              "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs transition-colors",
              sheetOpen && activePanel === id
                ? "bg-brand-600/15 text-brand-400 font-semibold"
                : "text-slate-400 hover:text-slate-200 active:bg-slate-800"
            )}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {icon}
            </span>
            <span className="text-[11px] tracking-tight">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
