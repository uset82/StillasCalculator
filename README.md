# StillasCalculator™

> **Precision Scaffolding Takeoffs, Automated BOM & 3D CAD Suite**  
> Engineered for Scaffolding Contractors, Estimators & Construction Managers in Norway & Europe. Aligned with **Norwegian Standard NS 9700** and **European Standard EN 12811**.

---

### 🌐 Live Production Application
👉 **[https://stillascalculator.netlify.app/](https://stillascalculator.netlify.app/)**

---

## 🌟 Overview

**StillasCalculator™** transforms building footprints and satellite maps into complete, compliant material takeoffs (BOM), structural scaffolding layouts, and parametric 3D CAD models in seconds.

Whether estimating residential facades or complex commercial developments, StillasCalculator provides a deterministic, rigorous engineering workflow with zero guesswork.

---

## ⚡ Core Capabilities

- **🗺️ GIS Map & Footprint Takeoff**: Search any Norwegian street address or draw custom facade polygons directly on high-precision satellite/vector maps using MapLibre GL. Integrates OpenStreetMap and Kartverket data for automatic building footprint extraction.
- **📐 Multi-System Scaffolding Engine**: Pre-configured with major European & Nordic systems:
  - *Generic Modular Frame* (3.00m bay)
  - *Layher Allround* (3.07m bay)
  - *Haki Universal* (3.05m bay)
  - *Tube & Coupler* (2.50m bay)
  - *Custom Dimension Parameters*
- **📊 Deterministic Bill of Materials (BOM)**: Real-time calculation of vertical standards, horizontal ledgers, aluminium/steel decks, double guardrails, toeboards, adjustable base jacks, and wind-load wall anchors.
- **🏗️ Parametric 3D OpenSCAD & DXF**: Generates programmatic 3D CAD models with direct downloads of `.SCAD` source code and `.DXF` layers for engineering handoff.
- **📄 1-Click Client Quotations & CSV**: Export client-ready PDF estimation proposals with safety disclaimers and formatted CSV procurement spreadsheets.
- **🤖 Conversational AI Engineering Copilot**: Built-in scaffolding assistant capable of modifying working heights, toggling facade sides, and validating safety rules in plain English and Norwegian.
- **🇳🇴 Standards & Safety Compliance**: Compliant with **NS 9700-1** and the Norwegian **Forskrift om utførelse av arbeid** (Work Equipment Regulations).

---

## 🎨 Design System

StillasCalculator features the **Claude Warm Editorial Design System**:
- **Warm Terracotta & Clay Accents** (`#da7756`, `#c25e3d`)
- **Warm Paper, Cream & Sand Backgrounds** (`#faf8f5`, `#f5f2eb`)
- **Refined Serif Headings** (*Newsreader*) paired with high-legibility sans (*Plus Jakarta Sans*) and tabular monospace (*JetBrains Mono*)

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18.18+ or 20+
- npm 9+

### 1. Clone the repository
```bash
git clone https://github.com/uset82/StillasCalculator.git
cd StillasCalculator
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start development server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🧪 Testing & Verification

StillasCalculator includes an exhaustive test suite combining unit, responsive, integration, and property-based tests (using `fast-check`):

```bash
# Run all test suites
npm test

# Run component test suites
npx vitest run components/

# Run production build
npm run build
```

---

## 🏛️ Tech Stack & Architecture

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Next.js 15](https://nextjs.org/) (App Router, Server & Client Components) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) (Strict Mode) |
| **Styling** | [Tailwind CSS v3](https://tailwindcss.com/) (Claude Warm Editorial Design System) |
| **Map & GIS Engine** | [MapLibre GL JS](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) + [Turf.js](https://turfjs.org/) |
| **CAD & 3D Engine** | Parametric [OpenSCAD](https://openscad.org/) Code Generator + DXF Exporter |
| **Testing** | [Vitest](https://vitest.dev/), [@testing-library/react](https://testing-library.com/), [fast-check](https://fast-check.dev/) |
| **Deployment** | [Netlify](https://stillascalculator.netlify.app/) CI/CD Pipeline |

---

## 📄 License & Safety Disclaimer

*Disclaimer: StillasCalculator provides estimated planning reports intended for procurement, budgeting, and preliminary layout. All quantities and structural layouts require on-site verification by a certified scaffolding inspector (stillasbygger / sakkyndig person) before erection.*
