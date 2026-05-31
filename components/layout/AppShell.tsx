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
 *
 * Layout strategy:
 * - Below 768px the shell is a single-column, mobile-optimized arrangement
 *   (Req 1.2): the map fills the primary area and the secondary panels live in
 *   an openable/dismissable {@link MobileBottomSheet}. A fixed bottom launcher
 *   bar exposes access points to the map, scaffold inputs, material list, AI
 *   assistant, and export (Req 1.5), each with a >=44x44 CSS px touch target
 *   (Req 16.4).
 * - At 768px and above the shell is a multi-pane arrangement (Req 1.3): the map
 *   pane and the side pane (which stacks every secondary panel) are visible
 *   simultaneously, with no navigation required to reach a panel.
 *
 * The same React tree is restyled with Tailwind responsive classes across the
 * breakpoint rather than mounted/unmounted per arrangement. Because none of the
 * slotted content unmounts when the viewport crosses 768px, entered inputs and
 * the selected map location are preserved automatically (Req 1.4).
 *
 * The root container clamps width to the viewport and clips horizontal overflow
 * so the layout renders without horizontal scrolling across 320-1920px
 * (Req 1.1, Req 16.3). Slots are passed in by the caller; wiring of concrete
 * components to `Project_State` happens in a later task.
 */
export function AppShell({
  title = "StillasCalculator",
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
      className="flex h-[100dvh] max-w-[100vw] flex-col overflow-x-hidden bg-gray-50 text-gray-900"
    >
      {/* Top bar. Kept compact so the map gets maximum space on small screens. */}
      <header className="flex h-12 flex-none items-center justify-between border-b border-gray-200 bg-white px-4">
        <span className="text-base font-semibold">{title}</span>
      </header>

      {/* Main region: single column on mobile, two panes on desktop. */}
      <div className="relative flex min-h-0 flex-1 flex-row">
        {/* Primary pane: the map. Always visible (Req 1.5). */}
        <main
          data-region="map"
          aria-label="Map"
          className="relative min-h-0 min-w-0 flex-1"
        >
          {map}
        </main>

        {/* Secondary panels.
            - Mobile: hosted inside the bottom sheet; only the active panel is
              shown, and the sheet can be opened/dismissed (Req 1.2).
            - Desktop: the sheet renders as a static side pane and every panel
              is shown at once (Req 1.3). */}
        <MobileBottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={PANEL_TITLES[activePanel]}
        >
          <div className="flex flex-col gap-4">
            {LAUNCHER_ITEMS.map(({ id, label }) => (
              <section
                key={id}
                data-region={id}
                aria-label={label}
                // Mobile: only the active panel is visible. Desktop: all panels
                // are visible simultaneously (multi-pane, Req 1.3).
                className={cn(
                  activePanel === id ? "block" : "hidden",
                  "md:block"
                )}
              >
                {/* Per-panel heading shown only on desktop, where panels stack
                    and need labels; on mobile the sheet header names it. */}
                <h2 className="mb-2 hidden text-sm font-semibold text-gray-700 md:block">
                  {PANEL_TITLES[id]}
                </h2>
                {slots[id]}
              </section>
            ))}
          </div>
        </MobileBottomSheet>
      </div>

      {/* Mobile launcher bar: access points for every feature (Req 1.5).
          Hidden on desktop where panels are already visible. Each button is a
          >=44x44 CSS px touch target (Req 16.4). */}
      <nav
        data-testid="mobile-launcher"
        aria-label="Panels"
        className="z-50 flex h-16 flex-none items-stretch justify-around border-t border-gray-200 bg-white md:hidden"
      >
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          aria-label="Map"
          data-testid="launcher-map"
          aria-pressed={!sheetOpen}
          className={cn(
            "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs",
            !sheetOpen ? "text-blue-600" : "text-gray-600"
          )}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            🗺️
          </span>
          Map
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
              "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs",
              sheetOpen && activePanel === id ? "text-blue-600" : "text-gray-600"
            )}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
