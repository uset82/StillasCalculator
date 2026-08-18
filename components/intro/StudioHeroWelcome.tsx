"use client";

import { useState } from "react";

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface StudioHeroWelcomeProps {
  onSelectDemo: (city: { label: string; lat: number; lon: number }) => void;
  onOpenGuide: () => void;
  onStartDrawing?: () => void;
}

export function StudioHeroWelcome({
  onSelectDemo,
  onOpenGuide,
  onStartDrawing,
}: StudioHeroWelcomeProps) {
  const [minimized, setMinimized] = useState(false);

  if (minimized) {
    return (
      <div className="absolute bottom-6 left-6 z-20">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 rounded-xl border border-[#dfdad1] bg-white/95 px-4 py-2 text-xs font-serif font-bold text-[#1a1918] shadow-md backdrop-blur-md hover:bg-[#faf8f5] hover:text-[#da7756] transition-all"
        >
          <span>🏗️</span>
          <span>Open Quick Demos & Guide</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4 sm:p-6">
      <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-[#e7e3dc] bg-white/95 p-5 sm:p-6 text-[#1a1918] shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-all">
        {/* Header with Logo */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#da7756] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M4 2v20M20 2v20M4 6h16M4 12h16M4 18h16M4 6l16 12M4 18L20 6" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-serif font-bold tracking-tight text-[#1a1918]">
                  StillasCalculator™
                </h2>
                <span className="rounded-full bg-[#f4ddd3] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#a3482a]">
                  PRO STUDIO
                </span>
              </div>
              <p className="text-xs text-[#66625d]">
                Precision Scaffolding Estimation, Automated BOM & 3D CAD
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize welcome guide"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#78736d] hover:bg-[#f5f2eb] hover:text-[#1a1918] transition-colors"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        {/* Intro Pitch */}
        <p className="mt-3.5 text-xs sm:text-sm text-[#57534e] leading-relaxed">
          Welcome to the professional scaffolding takeoff suite for Norwegian & European projects. Calculate exact <strong>NS 9700 / EN 12811</strong> bill of materials (BOM), working heights, and 3D CAD geometry directly from building footprints.
        </p>

        {/* Quick Launchpad Buttons */}
        <div className="mt-4 space-y-2">
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#78736d]">
            Quick Start Demos
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onSelectDemo({ label: "Storgata 1, 0155 Oslo, Norway", lat: 59.9139, lon: 10.7522 })}
              className="flex items-center justify-between rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3 text-left transition-all hover:border-[#da7756] hover:bg-[#fdf8f5] group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">📍</span>
                <div>
                  <div className="text-xs font-serif font-bold text-[#1a1918] group-hover:text-[#da7756]">Oslo Sentrum Demo</div>
                  <div className="text-[10px] text-[#78736d]">Storgata 1 • Auto Footprint</div>
                </div>
              </div>
              <span className="text-xs text-[#78736d] group-hover:text-[#da7756]">→</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectDemo({ label: "Bryggen, 5003 Bergen, Norway", lat: 60.3976, lon: 5.3245 })}
              className="flex items-center justify-between rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3 text-left transition-all hover:border-[#da7756] hover:bg-[#fdf8f5] group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">📍</span>
                <div>
                  <div className="text-xs font-serif font-bold text-[#1a1918] group-hover:text-[#da7756]">Bergen Bryggen Demo</div>
                  <div className="text-[10px] text-[#78736d]">Historic Facade Takeoff</div>
                </div>
              </div>
              <span className="text-xs text-[#78736d] group-hover:text-[#da7756]">→</span>
            </button>
          </div>
        </div>

        {/* Action Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#eee9de] pt-3.5">
          <button
            type="button"
            onClick={onOpenGuide}
            className="flex items-center gap-1.5 text-xs font-medium text-[#da7756] hover:text-[#c25e3d] underline"
          >
            <span>📖</span>
            <span>View Full Capabilities & Standards Guide</span>
          </button>

          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="rounded-xl border border-[#dfdad1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2d2a26] hover:bg-[#f5f2eb] transition-colors"
          >
            Explore Map & Tools
          </button>
        </div>
      </div>
    </div>
  );
}

export default StudioHeroWelcome;
