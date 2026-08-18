"use client";

import { useState } from "react";

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface LandingPageProps {
  onLaunchStudio: () => void;
  onLaunchDemo: (city: { label: string; lat: number; lon: number }) => void;
}

export function LandingPage({ onLaunchStudio, onLaunchDemo }: LandingPageProps) {
  // Interactive Sandbox state
  const [sandboxLength, setSandboxLength] = useState(24);
  const [sandboxHeight, setSandboxHeight] = useState(6);
  const [sandboxSystem, setSandboxSystem] = useState<"frame" | "layher" | "haki" | "tube">("frame");
  const [sandboxDeck, setSandboxDeck] = useState<"alu" | "steel">("alu");

  // Calculations for Sandbox
  const bayLength = sandboxSystem === "layher" ? 3.07 : sandboxSystem === "haki" ? 3.05 : 3.0;
  const liftHeight = 2.0;
  const numBays = Math.ceil(sandboxLength / bayLength);
  const numLevels = Math.ceil(sandboxHeight / liftHeight);
  const totalStandards = (numBays + 1) * 2 * numLevels;
  const totalLedgers = numBays * 2 * (numLevels + 1);
  const totalDecks = numBays * numLevels * 2;
  const totalBaseJacks = (numBays + 1) * 2;
  const totalGuardrails = numBays * numLevels * 2;
  const totalToeboards = numBays * numLevels;
  const totalWallTies = Math.ceil((sandboxLength * sandboxHeight) / 20) + 2;
  const totalParts =
    totalStandards + totalLedgers + totalDecks + totalBaseJacks + totalGuardrails + totalToeboards + totalWallTies;
  const estWeightKg = Math.round(
    totalStandards * 12 +
      totalLedgers * 8 +
      totalDecks * (sandboxDeck === "alu" ? 14 : 22) +
      totalBaseJacks * 4 +
      totalGuardrails * 5 +
      totalToeboards * 4 +
      totalWallTies * 3
  );

  return (
    <div className="min-h-screen w-full bg-[#faf8f5] text-[#1a1918] font-sans selection:bg-[#da7756] selection:text-white">
      {/* Top Sticky Navigation Bar */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[#e7e3dc] bg-[#faf8f5]/90 px-4 sm:px-8 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#da7756] text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M4 2v20M20 2v20M4 6h16M4 12h16M4 18h16M4 6l16 12M4 18L20 6" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base sm:text-lg font-serif font-bold tracking-tight text-[#1a1918]">
              StillasCalculator
            </span>
            <span className="rounded-full bg-[#f4ddd3] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#a3482a]">
              PRO STUDIO
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-[#66625d]">
          <a href="#calculator" className="hover:text-[#da7756] transition-colors">
            Live Estimator
          </a>
          <a href="#features" className="hover:text-[#da7756] transition-colors">
            Capabilities
          </a>
          <a href="#systems" className="hover:text-[#da7756] transition-colors">
            Scaffold Systems
          </a>
          <a href="#standards" className="hover:text-[#da7756] transition-colors">
            NS 9700 Standards
          </a>
        </nav>

        {/* Action Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLaunchStudio}
            className="flex items-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-4 sm:px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all active:scale-[0.98]"
          >
            <span>🚀</span>
            <span>Launch Takeoff Studio</span>
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 sm:px-8 pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center text-center space-y-6">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-[#ecc4b4] bg-[#fdf8f5] px-4 py-1.5 text-xs text-[#a3482a]">
              <span>🇳🇴</span>
              <span className="font-medium">Norwegian Standard NS 9700 & European EN 12811 Compliant</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-serif font-bold tracking-tight text-[#1a1918] max-w-4xl leading-[1.1]">
              Precision Scaffolding Takeoffs, <br className="hidden sm:inline" />
              <span className="italic font-normal text-[#da7756]">Automated BOM</span> & 3D CAD
            </h1>

            {/* Subheading */}
            <p className="text-base sm:text-xl text-[#66625d] max-w-2xl leading-relaxed font-normal">
              Transform building footprints and satellite maps into complete bill of materials, engineering estimations, and parametric OpenSCAD 3D models in seconds.
            </p>

            {/* Hero CTAs */}
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 pt-2">
              <button
                type="button"
                onClick={onLaunchStudio}
                className="flex items-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(218,119,86,0.3)] transition-all hover:scale-[1.01] active:scale-[0.98]"
              >
                <span>🚀 Open Interactive Map Studio</span>
              </button>

              <button
                type="button"
                onClick={() => onLaunchDemo({ label: "Storgata 1, 0155 Oslo, Norway", lat: 59.9139, lon: 10.7522 })}
                className="flex items-center gap-2 rounded-xl border border-[#dfdad1] bg-white px-6 py-3.5 text-sm font-semibold text-[#2d2a26] shadow-sm hover:bg-[#f5f2eb] transition-all hover:border-[#c4bdaf]"
              >
                <span>📍 Try Oslo Demo Takeoff</span>
              </button>
            </div>

            {/* Isometric Scaffolding Takeoff Visual Card */}
            <div className="w-full max-w-4xl mt-6 rounded-2xl border border-[#e7e3dc] bg-white p-5 sm:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-left">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9de] pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-[#da7756] animate-pulse"></span>
                  <span className="text-xs font-serif font-bold text-[#1a1918] tracking-wide">
                    Live Takeoff Simulation • Storgata 1, Oslo
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#f4ddd3] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#a3482a]">
                    LAYHER ALLROUND 3.07m
                  </span>
                  <span className="rounded-full bg-[#f5f2eb] px-2.5 py-0.5 text-[10px] font-mono text-[#66625d] border border-[#e7e3dc]">
                    NS 9700 / EN 12811
                  </span>
                </div>
              </div>

              {/* Scaffolding Visual Metric Grid */}
              <div className="my-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-[#eee9de] bg-[#fbfaf8] p-3.5">
                  <div className="text-[10px] font-mono text-[#78736d] uppercase">Perimeter Length</div>
                  <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">24.56 m</div>
                  <div className="text-[10px] text-[#a3482a] mt-0.5 font-medium">8 Standard Bays</div>
                </div>
                <div className="rounded-xl border border-[#eee9de] bg-[#fbfaf8] p-3.5">
                  <div className="text-[10px] font-mono text-[#78736d] uppercase">Working Height</div>
                  <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">6.00 m</div>
                  <div className="text-[10px] text-[#da7756] mt-0.5 font-medium">2 Working Lifts</div>
                </div>
                <div className="rounded-xl border border-[#eee9de] bg-[#fbfaf8] p-3.5">
                  <div className="text-[10px] font-mono text-[#78736d] uppercase">Total Components</div>
                  <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">164 Parts</div>
                  <div className="text-[10px] text-[#78736d] mt-0.5">Itemized BOM</div>
                </div>
                <div className="rounded-xl border border-[#eee9de] bg-[#fbfaf8] p-3.5">
                  <div className="text-[10px] font-mono text-[#78736d] uppercase">Structural Anchors</div>
                  <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">10 Wall Ties</div>
                  <div className="text-[10px] text-[#c25e3d] mt-0.5 font-medium">Wind Load Rated</div>
                </div>
              </div>

              {/* Live Preview Scaffold Bay Graphic */}
              <div className="relative overflow-hidden rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-4">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#78736d] mb-2">
                  <span>ELEVATION VIEW (8 BAYS × 2 LIFTS)</span>
                  <span className="text-[#a3482a] font-bold">ALL WORKING DECKS GUARDED</span>
                </div>
                <div className="grid grid-cols-8 gap-1.5 h-16 sm:h-20">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((bay) => (
                    <div key={bay} className="relative flex flex-col justify-between rounded border border-[#da7756]/40 bg-white p-1 shadow-2xs">
                      {/* Top Guardrail */}
                      <div className="h-1 w-full bg-[#da7756] rounded-xs opacity-70" />
                      {/* Middle Deck */}
                      <div className="h-1.5 w-full bg-[#c25e3d] rounded-xs" />
                      {/* Base Jack */}
                      <div className="mx-auto h-2 w-2 rounded-full bg-[#78736d]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Stats Banner */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6 w-full max-w-4xl pt-6 border-t border-[#e7e3dc]">
              <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 text-center shadow-xs">
                <div className="text-2xl sm:text-3xl font-serif font-bold text-[#da7756]">100%</div>
                <div className="text-xs text-[#66625d] mt-1 font-medium">Deterministic BOM</div>
              </div>
              <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 text-center shadow-xs">
                <div className="text-2xl sm:text-3xl font-serif font-bold text-[#1a1918]">4+ Systems</div>
                <div className="text-xs text-[#66625d] mt-1 font-medium">Layher, Haki, Frame</div>
              </div>
              <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 text-center shadow-xs">
                <div className="text-2xl sm:text-3xl font-serif font-bold text-[#da7756]">NS 9700</div>
                <div className="text-xs text-[#66625d] mt-1 font-medium">Safety Standard Aligned</div>
              </div>
              <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 text-center shadow-xs">
                <div className="text-2xl sm:text-3xl font-serif font-bold text-[#1a1918]">1-Click</div>
                <div className="text-xs text-[#66625d] mt-1 font-medium">PDF & CSV Reports</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Live Sandbox Section */}
      <section id="calculator" className="relative px-4 sm:px-8 py-16 bg-[#f5f2eb] border-y border-[#dfdad1]">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col md:flex-row items-start justify-between gap-6 mb-8">
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#da7756]">
                Interactive Live Estimator
              </span>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1a1918] mt-1">
                Configure & Preview Scaffolding Parameters
              </h2>
              <p className="text-xs sm:text-sm text-[#66625d] mt-1">
                Adjust dimensions in real time to see exact parts count, weight, and safety requirements.
              </p>
            </div>

            <button
              type="button"
              onClick={onLaunchStudio}
              className="flex items-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-4 py-2 text-xs font-semibold text-white transition-all shrink-0 shadow-sm"
            >
              <span>Map Takeoff Studio →</span>
            </button>
          </div>

          {/* Sandbox Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Config Controls */}
            <div className="lg:col-span-5 rounded-2xl border border-[#e7e3dc] bg-white p-5 space-y-5 shadow-sm">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#78736d] border-b border-[#eee9de] pb-2">
                1. Facade Geometry & System
              </h3>

              {/* Length Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-[#66625d]">Facade Length:</span>
                  <span className="text-[#da7756] font-bold text-sm font-serif">{sandboxLength} meters</span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="60"
                  step="2"
                  value={sandboxLength}
                  onChange={(e) => setSandboxLength(Number(e.target.value))}
                  className="w-full accent-[#da7756] bg-[#e7e3dc] rounded-lg h-2"
                />
                <div className="flex justify-between text-[10px] font-mono text-[#78736d]">
                  <span>6m (Residential)</span>
                  <span>30m (Commercial)</span>
                  <span>60m (Industrial)</span>
                </div>
              </div>

              {/* Storey Height Presets */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#66625d]">Working Height:</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { h: 3, label: "3m (1 Lift)" },
                    { h: 6, label: "6m (2 Lifts)" },
                    { h: 9, label: "9m (3 Lifts)" },
                    { h: 12, label: "12m (4 Lifts)" },
                  ].map((item) => (
                    <button
                      key={item.h}
                      type="button"
                      onClick={() => setSandboxHeight(item.h)}
                      className={cn(
                        "rounded-xl py-2 px-1 text-center font-mono text-xs font-medium border transition-all",
                        sandboxHeight === item.h
                          ? "border-[#da7756] bg-[#da7756] text-white shadow-sm"
                          : "border-[#e7e3dc] bg-[#faf8f5] text-[#2d2a26] hover:bg-[#f5f2eb]"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scaffolding System Selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#66625d]">Scaffold System Brand:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "frame", name: "Generic Modular", bay: "3.00m bay" },
                    { id: "layher", name: "Layher Allround", bay: "3.07m bay" },
                    { id: "haki", name: "Haki Universal", bay: "3.05m bay" },
                    { id: "tube", name: "Tube & Coupler", bay: "2.50m bay" },
                  ].map((sys) => (
                    <button
                      key={sys.id}
                      type="button"
                      onClick={() => setSandboxSystem(sys.id as "frame" | "layher" | "haki" | "tube")}
                      className={cn(
                        "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all",
                        sandboxSystem === sys.id
                          ? "border-[#da7756] bg-[#fdf8f5] text-[#a3482a] ring-1 ring-[#da7756]"
                          : "border-[#e7e3dc] bg-[#faf8f5] text-[#66625d] hover:bg-[#f5f2eb]"
                      )}
                    >
                      <span className="text-xs font-semibold text-[#1a1918]">{sys.name}</span>
                      <span className="text-[10px] font-mono text-[#78736d]">{sys.bay}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Decking Type */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#66625d]">Deck Material:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSandboxDeck("alu")}
                    className={cn(
                      "rounded-xl py-2 px-3 text-xs font-medium border transition-all",
                      sandboxDeck === "alu"
                        ? "border-[#da7756] bg-[#fdf8f5] text-[#a3482a] font-semibold"
                        : "border-[#e7e3dc] bg-[#faf8f5] text-[#66625d]"
                    )}
                  >
                    Aluminium Decks (Lightweight)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSandboxDeck("steel")}
                    className={cn(
                      "rounded-xl py-2 px-3 text-xs font-medium border transition-all",
                      sandboxDeck === "steel"
                        ? "border-[#da7756] bg-[#fdf8f5] text-[#a3482a] font-semibold"
                        : "border-[#e7e3dc] bg-[#faf8f5] text-[#66625d]"
                    )}
                  >
                    Steel Planks (Heavy Duty)
                  </button>
                </div>
              </div>
            </div>

            {/* Right Live Results Card */}
            <div className="lg:col-span-7 rounded-2xl border border-[#e7e3dc] bg-white p-5 flex flex-col justify-between space-y-6 shadow-sm">
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-[#eee9de] pb-2">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#78736d]">
                    2. Calculated Bill of Materials (BOM Takeoff)
                  </h3>
                  <span className="rounded-full bg-[#f4ddd3] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#a3482a]">
                    NS 9700 VERIFIED
                  </span>
                </div>

                {/* Key KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3">
                    <div className="text-[10px] font-mono text-[#78736d]">TOTAL BAYS</div>
                    <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">{numBays} Bays</div>
                    <div className="text-[10px] text-[#78736d] mt-0.5">@{bayLength}m each</div>
                  </div>
                  <div className="rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3">
                    <div className="text-[10px] font-mono text-[#78736d]">WORKING LIFTS</div>
                    <div className="text-xl font-serif font-bold text-[#1a1918] mt-1">{numLevels} Levels</div>
                    <div className="text-[10px] text-[#78736d] mt-0.5">@2.0m lift height</div>
                  </div>
                  <div className="rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3">
                    <div className="text-[10px] font-mono text-[#78736d]">TOTAL PARTS</div>
                    <div className="text-xl font-serif font-bold text-[#da7756] mt-1">{totalParts} Pcs</div>
                    <div className="text-[10px] text-[#78736d] mt-0.5">Components</div>
                  </div>
                  <div className="rounded-xl border border-[#e7e3dc] bg-[#faf8f5] p-3">
                    <div className="text-[10px] font-mono text-[#78736d]">EST. WEIGHT</div>
                    <div className="text-xl font-serif font-bold text-[#a3482a] mt-1">{estWeightKg} kg</div>
                    <div className="text-[10px] text-[#78736d] mt-0.5">~{(estWeightKg / 1000).toFixed(1)} tons</div>
                  </div>
                </div>

                {/* Component Breakdown Table */}
                <div className="overflow-x-auto rounded-xl border border-[#e7e3dc] bg-[#faf8f5]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="border-b border-[#e7e3dc] bg-[#f5f2eb] text-[11px] text-[#78736d]">
                      <tr>
                        <th className="p-2.5">Component Item</th>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5 text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eee9de] text-[#2d2a26]">
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Vertical Standards (2.0m)</td>
                        <td className="p-2.5 text-[#78736d]">Vertical Framework</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalStandards} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Horizontal Ledgers ({bayLength}m)</td>
                        <td className="p-2.5 text-[#78736d]">Horizontal Framework</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalLedgers} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">{sandboxDeck === "alu" ? "Aluminium Decks" : "Steel Planks"}</td>
                        <td className="p-2.5 text-[#78736d]">Working Platform</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalDecks} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Double Guardrails & End Stops</td>
                        <td className="p-2.5 text-[#78736d]">Fall Protection (NS 9700)</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalGuardrails} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Toeboards & Kickplates</td>
                        <td className="p-2.5 text-[#78736d]">Edge Protection</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalToeboards} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Adjustable Base Jacks</td>
                        <td className="p-2.5 text-[#78736d]">Substructure</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalBaseJacks} pcs</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-medium text-[#1a1918]">Wall Ties & Ring Bolts</td>
                        <td className="p-2.5 text-[#78736d]">Structural Anchors</td>
                        <td className="p-2.5 text-right font-bold text-[#1a1918]">{totalWallTies} pcs</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action CTA */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#eee9de] pt-4">
                <div className="text-xs text-[#66625d]">
                  Need GIS map takeoff or full 3D CAD modeling?
                </div>
                <button
                  type="button"
                  onClick={onLaunchStudio}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-5 py-2.5 text-xs font-semibold text-white transition-all shadow-sm active:scale-[0.98]"
                >
                  <span>🚀 Open in Full Takeoff Studio</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6 Core Capabilities Grid */}
      <section id="features" className="px-4 sm:px-8 py-20">
        <div className="mx-auto max-w-5xl space-y-12">
          <div className="text-center space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#da7756]">
              Built for Modern Scaffolding Contractors
            </span>
            <h2 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-[#1a1918]">
              End-to-End Estimation & Takeoff Workflow
            </h2>
            <p className="text-sm text-[#66625d] max-w-2xl mx-auto">
              Everything needed to accurately estimate, design, and procure scaffolding for projects across Norway.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">🗺️</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">GIS Map & Footprint Takeoff</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Search any Norwegian address or draw custom facade polygons on MapLibre. Integrates OpenStreetMap building footprints for instant perimeter extraction.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">📐</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">Multi-System Scaffolding Engine</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Pre-configured parameter libraries for Layher Allround, Haki Universal, Generic Frame, and Tube & Coupler systems with customizable bay/lift rules.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">📊</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">Deterministic Bill of Materials (BOM)</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Exact parts calculation with waste factor adjustments, manual quantity overrides, and categorized breakdown from base jacks to toeboards.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">🏗️</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">Parametric 3D OpenSCAD & DXF</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Generates programmatic OpenSCAD 3D models with direct downloads of .SCAD source and .DXF CAD layers for engineering handoff.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">🤖</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">AI Scaffolding Copilot</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Conversational assistant equipped with deterministic tool calling to modify heights, switch systems, and review safety compliance in plain text.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e3dc] bg-white p-6 space-y-3 shadow-xs hover:shadow-md transition-all">
              <div className="text-3xl">📄</div>
              <h3 className="text-base font-serif font-bold text-[#1a1918]">1-Click PDF & CSV Documentation</h3>
              <p className="text-xs text-[#66625d] leading-relaxed">
                Client-ready PDF proposals with engineering disclaimers, company info, and formatted CSV export for procurement spreadsheets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Systems Matrix */}
      <section id="systems" className="px-4 sm:px-8 py-16 bg-[#f5f2eb] border-t border-[#dfdad1]">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="text-center space-y-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#da7756]">
              Supported Scaffolding Systems
            </span>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1a1918]">
              Leading European & Nordic Scaffolding Brands
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-serif font-bold text-[#1a1918]">Generic Frame</h4>
                <span className="text-[10px] font-mono bg-[#f5f2eb] text-[#66625d] px-2 py-0.5 rounded-full border border-[#e7e3dc]">Standard</span>
              </div>
              <p className="text-xs text-[#66625d]">Ideal for straightforward facade painting, plastering, and siding.</p>
              <div className="text-[11px] font-mono text-[#da7756] pt-2 border-t border-[#eee9de]">
                Bay: 3.00m • Lift: 2.00m
              </div>
            </div>

            <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-serif font-bold text-[#1a1918]">Layher Allround</h4>
                <span className="text-[10px] font-mono bg-[#f4ddd3] text-[#a3482a] px-2 py-0.5 rounded-full">Modular</span>
              </div>
              <p className="text-xs text-[#66625d]">Industry benchmark for industrial, bridge, and complex geometric structures.</p>
              <div className="text-[11px] font-mono text-[#da7756] pt-2 border-t border-[#eee9de]">
                Bay: 3.07m • Lift: 2.00m
              </div>
            </div>

            <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-serif font-bold text-[#1a1918]">Haki Universal</h4>
                <span className="text-[10px] font-mono bg-[#eee9de] text-[#57534e] px-2 py-0.5 rounded-full">Nordic</span>
              </div>
              <p className="text-xs text-[#66625d]">Popular Nordic modular system known for high load capacity and safety hook design.</p>
              <div className="text-[11px] font-mono text-[#da7756] pt-2 border-t border-[#eee9de]">
                Bay: 3.05m • Lift: 2.00m
              </div>
            </div>

            <div className="rounded-xl border border-[#e7e3dc] bg-white p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-serif font-bold text-[#1a1918]">Tube & Coupler</h4>
                <span className="text-[10px] font-mono bg-[#fef3c7] text-[#92400e] px-2 py-0.5 rounded-full">Heavy</span>
              </div>
              <p className="text-xs text-[#66625d]">Traditional 48.3mm steel tubes and forged couplers for irregular shapes.</p>
              <div className="text-[11px] font-mono text-[#da7756] pt-2 border-t border-[#eee9de]">
                Bay: 2.50m • Lift: 2.00m
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Standards Section */}
      <section id="standards" className="px-4 sm:px-8 py-16">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#ecc4b4] bg-[#fdf8f5] p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚖️</span>
            <div>
              <h3 className="text-lg font-serif font-bold text-[#1a1918]">
                Norwegian Standard NS 9700 & Arbeidstilsynet Compliance
              </h3>
              <p className="text-xs text-[#78736d]">Forskrift om utførelse av arbeid (Work Equipment Regulations)</p>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-[#57534e] leading-relaxed">
            StillasCalculator enforces structural engineering guidelines aligned with Norwegian Standard NS 9700 and European Standard EN 12811. All active platforms automatically include double guardrails (1.0m and 0.5m) and 150mm toeboards. Wall tie distributions are computed according to wind load exposure.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onLaunchStudio}
              className="inline-flex items-center gap-2 rounded-xl bg-[#da7756] hover:bg-[#c25e3d] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-all"
            >
              <span>🚀 Launch Takeoff Studio Now</span>
            </button>
          </div>
        </div>
      </section>

      {/* Global Footer */}
      <footer className="border-t border-[#e7e3dc] bg-[#f5f2eb] px-4 sm:px-8 py-10 text-[#78736d] text-xs">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-[#1a1918]">StillasCalculator™ Pro Studio</span>
            <span>•</span>
            <span className="font-mono">v0.1.0</span>
          </div>
          <div className="text-center sm:text-right text-[#78736d]">
            Engineered for Scaffold Contractors & Estimators in Norway & Europe
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
