"use client";

import { useState } from "react";

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface ProductIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchDemo?: () => void;
}

export function ProductIntroModal({
  isOpen,
  onClose,
  onLaunchDemo,
}: ProductIntroModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "features" | "standards" | "workflow">("overview");

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl max-h-[90dvh] flex flex-col rounded-2xl border border-[#e7e3dc] bg-[#faf8f5] shadow-2xl text-[#1a1918] overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-[#e7e3dc] bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            {/* Scaffolding Logo Icon */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#da7756] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M4 2v20M20 2v20M4 6h16M4 12h16M4 18h16M4 6l16 12M4 18L20 6" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 id="intro-modal-title" className="text-base sm:text-lg font-serif font-bold tracking-tight text-[#1a1918]">
                  StillasCalculator™
                </h1>
                <span className="rounded-full bg-[#f4ddd3] px-2.5 py-0.5 text-[10px] font-mono font-semibold text-[#a3482a]">
                  v0.1.0 PRO
                </span>
              </div>
              <p className="text-xs text-[#66625d]">
                Precision Scaffolding Estimation, Automated BOM Takeoff & 3D CAD Suite
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close intro"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#78736d] hover:bg-[#f5f2eb] hover:text-[#1a1918] transition-colors"
          >
            <span className="text-xl font-bold leading-none">&times;</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#e7e3dc] bg-[#f5f2eb] px-4 pt-2 gap-1 sm:gap-2">
          {[
            { id: "overview", label: "🌟 Overview", desc: "What is it?" },
            { id: "features", label: "⚡ Capabilities", desc: "What does it do?" },
            { id: "workflow", label: "🛠️ How It Works", desc: "3-step workflow" },
            { id: "standards", label: "📐 Standards", desc: "NS 9700 / EN 12811" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex flex-col items-center sm:items-start px-3.5 py-2 border-b-2 text-xs font-medium transition-all",
                activeTab === tab.id
                  ? "border-[#da7756] text-[#da7756] bg-white font-semibold rounded-t-lg shadow-2xs"
                  : "border-transparent text-[#66625d] hover:text-[#1a1918] hover:bg-white/40 rounded-t-lg"
              )}
            >
              <span>{tab.label}</span>
              <span className="hidden sm:inline text-[10px] font-normal text-[#78736d]">{tab.desc}</span>
            </button>
          ))}
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Hero Banner */}
              <div className="relative overflow-hidden rounded-2xl border border-[#ecc4b4] bg-[#fdf8f5] p-5 sm:p-6 shadow-xs">
                <div className="relative z-10 space-y-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4ddd3] px-3 py-1 text-xs font-medium text-[#a3482a]">
                    🏗️ Professional Scaffolding Engineering & Takeoff Studio
                  </span>
                  <h2 className="text-xl sm:text-2xl font-serif font-bold tracking-tight text-[#1a1918]">
                    Automate Scaffolding Takeoffs, Material Lists & CAD Models in Seconds
                  </h2>
                  <p className="text-sm text-[#57534e] leading-relaxed max-w-2xl">
                    <strong>StillasCalculator</strong> is a web application designed for scaffold contractors, estimators, and construction engineers. It turns building footprints and map coordinates into complete, compliant material bills of materials (BOM), structural estimations, and 3D CAD models.
                  </p>
                </div>
              </div>

              {/* 3 Core Value Pillars */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
                  <div className="text-2xl">🗺️</div>
                  <h3 className="text-sm font-serif font-bold text-[#1a1918]">1. GIS Map Takeoff</h3>
                  <p className="text-xs text-[#66625d] leading-relaxed">
                    Search any Norwegian address or draw custom polygons to automatically retrieve building footprints with centimetre precision.
                  </p>
                </div>

                <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
                  <div className="text-2xl">⚡</div>
                  <h3 className="text-sm font-serif font-bold text-[#1a1918]">2. Deterministic BOM</h3>
                  <p className="text-xs text-[#66625d] leading-relaxed">
                    Generates exact parts counts for base jacks, ledgers, standards, planks, guardrails, toeboards, and wall anchors.
                  </p>
                </div>

                <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
                  <div className="text-2xl">🏗️</div>
                  <h3 className="text-sm font-serif font-bold text-[#1a1918]">3. 3D CAD & Reports</h3>
                  <p className="text-xs text-[#66625d] leading-relaxed">
                    Instant parametric OpenSCAD 3D models with direct export to PDF Estimation Reports, CSV takeoffs, and .DXF geometry.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "features" && (
            <div className="space-y-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#78736d]">
                What Can You Do With StillasCalculator?
              </h2>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">📍</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">Automated Footprint Detection</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Integrates with OpenStreetMap / Kartverket to extract building perimeters automatically from address searches.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">📐</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">Multi-System Scaffolding Library</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Pre-configured with Generic Modular Frames, Tube & Coupler, Layher Allround, and Haki Universal systems.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">🏢</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">Selective Facade Scaffolding</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Scaffold the entire building perimeter or toggle specific sides (e.g. North and East facades only).
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">📊</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">Instant BOM Takeoff Table</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Calculates exact itemized quantities with interactive steppers to manually adjust procurement numbers.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">📄</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">1-Click PDF & CSV Exports</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Generate executive customer proposals, printable procurement sheets, and spreadsheets.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <span className="text-xl">🤖</span>
                  <div>
                    <h3 className="text-xs font-serif font-bold text-[#1a1918]">AI Scaffolding Copilot</h3>
                    <p className="text-xs text-[#66625d] mt-1">
                      Ask the AI assistant to adjust working height, add double guardrails, or check safety rules in plain English or Norwegian.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "workflow" && (
            <div className="space-y-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#78736d]">
                Simple 3-Step Takeoff Workflow
              </h2>

              <div className="space-y-3">
                <div className="flex items-start gap-4 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#da7756] font-serif font-bold text-white shrink-0">
                    1
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-serif font-bold text-[#1a1918]">Select or Draw Building Perimeter</h3>
                    <p className="text-xs text-[#66625d] leading-relaxed">
                      Search any street address (e.g. <em>Storgata 1, Oslo</em>) or click the <strong>Draw</strong> tool to click vertices directly on the satellite map. The system automatically derives the exact perimeter meters.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#da7756] font-serif font-bold text-white shrink-0">
                    2
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-serif font-bold text-[#1a1918]">Configure Height & Scaffold System</h3>
                    <p className="text-xs text-[#66625d] leading-relaxed">
                      Choose your scaffolding brand (Modular Frame, Layher, Haki) and pick a storey height preset (3m, 6m, 9m, 12m). Click <strong>Calculate Materials</strong>.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 rounded-xl border border-[#e7e3dc] bg-white p-4 shadow-xs">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#da7756] font-serif font-bold text-white shrink-0">
                    3
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-serif font-bold text-[#1a1918]">Review BOM, 3D CAD & Export</h3>
                    <p className="text-xs text-[#66625d] leading-relaxed">
                      Review the itemized BOM list, inspect the parametric 3D CAD preview, and export a client-ready PDF quotation or CSV material list.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "standards" && (
            <div className="space-y-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#78736d]">
                Norwegian & European Scaffolding Standards
              </h2>

              <div className="rounded-xl border border-[#ecc4b4] bg-[#fdf8f5] p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚖️</span>
                  <h3 className="text-sm font-serif font-bold text-[#1a1918]">
                    NS 9700 & EN 12811 Engineering Verification
                  </h3>
                </div>
                <p className="text-xs text-[#57534e] leading-relaxed">
                  StillasCalculator implements standard calculation rules aligned with <strong>Norwegian Standard NS 9700</strong> (Scaffolding design and safety) and <strong>European Standard EN 12811</strong> (Temporary works equipment - Scaffolds).
                </p>
                <ul className="text-xs text-[#78736d] list-disc list-inside space-y-1">
                  <li>Automatic calculation of standard levels and bays based on wall height.</li>
                  <li>Inclusion of double guardrails and toeboards for all active working levels.</li>
                  <li>Wall tie and anchoring estimates based on facade surface area.</li>
                  <li>Planning estimate disclaimer reminding contractors of professional on-site engineering verification.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-[#e7e3dc] bg-white px-5 py-4 gap-3">
          <div className="text-xs text-[#66625d]">
            Ready to calculate scaffolding for your next project?
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {onLaunchDemo && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLaunchDemo();
                }}
                className="flex-1 sm:flex-none rounded-xl border border-[#dfdad1] bg-[#faf8f5] px-4 py-2 text-xs font-medium text-[#2d2a26] hover:bg-[#f5f2eb] transition-all"
              >
                📍 Try Demo Location
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all active:scale-[0.98]"
            >
              <span>🚀 Launch Studio Calculator</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductIntroModal;
