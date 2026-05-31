
# StillasCalculator — Research + Project Plan for Codex

## 1. Objetivo del proyecto

**StillasCalculator** será una web app responsive para iPhone, Android y desktop que permita calcular materiales de stillas/andamios alrededor de una casa o fachada.

La app debe permitir:

```text
1. Buscar una dirección.
2. Mostrar la ubicación en un mapa open-source.
3. Obtener la huella del edificio desde OpenStreetMap/Overpass API.
4. Permitir seleccionar o dibujar manualmente el perímetro de la casa.
5. Calcular perímetro, área y lados.
6. Seleccionar sistema de stillas.
7. Ingresar altura de trabajo.
8. Calcular bays, niveles y lista estimada de piezas.
9. Conversar con un asistente IA integrado.
10. Exportar PDF y CSV.
```

---

# 2. Free API / Open-source replacement for Google Maps

Google Maps API puede volverse caro. Para este proyecto recomiendo esta arquitectura:

```text
MapLibre GL JS
+ OpenFreeMap
+ Photon
+ Nominatim fallback
+ Overpass API
+ Turf.js
```

## Recommended free stack

| Función                 | Herramienta         | Uso                                                                                                                                                                  |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapa visual             | **MapLibre GL JS**  | Renderizar mapas interactivos. El repo oficial existe como `maplibre/maplibre-gl-js`.                                                                                |
| Tiles/map style         | **OpenFreeMap**     | Mapas gratis basados en OpenStreetMap. Su README dice que permite usar mapas gratis, sin API keys, sin registro y sin límites de map views en la instancia pública.  |
| Búsqueda de direcciones | **Photon**          | Geocoder open-source basado en OpenStreetMap y OpenSearch.                                                                                                           |
| Fallback geocoder       | **Nominatim**       | Alternativa para geocoding con OpenStreetMap. El repo aparece como `lonvia/Nominatim`.                                                                               |
| Building footprints     | **Overpass API**    | Consultar edificios desde OpenStreetMap. Usar `overpass-turbo` para probar queries.                                                                                  |
| Medición geométrica     | **Turf.js**         | Calcular perímetro, área y longitudes usando GeoJSON.                                                                                                                |
| Dibujo/edición          | **MapLibre Geoman** | Crear y editar polígonos, medir, hacer drag, snap, split, scale, etc.                                                                                                |

Importante: **OpenFreeMap no ofrece búsqueda, geocoding, navegación, imágenes satelitales ni elevación**; solo mapa/tiles. Por eso necesitamos Photon, Overpass y Turf.js como módulos separados. 

---

# 3. Similar GitHub projects to use as models

## A. Main construction/takeoff inspiration

### 1. ProTakeoff Public

**Repo:** `ilirkl/protakeoff-public`

Este es el proyecto más útil como inspiración para StillasCalculator. Es un software open-source de estimación/takeoff para construcción. Usa React, TypeScript y Tailwind, y su README indica licencia MIT. 

Tiene funciones muy parecidas a lo que necesitamos para el lado de “takeoff + estimación”:

```text
- Digital takeoffs
- Area measurement
- Linear measurement
- Count tools
- Canvas tools
- Item assemblies
- Formulas
- Waste factors
- PDF proposals
- Excel export
```

El README menciona mediciones de área, líneas, conteos y herramientas de canvas.  También menciona assemblies, fórmulas y waste factors, que son exactamente conceptos necesarios para calcular piezas de stillas. 

**Uso recomendado:**
No lo copiaría completo porque es Tauri/Rust/desktop, pero sí lo usaría como referencia fuerte para:

```text
- estructura de estimación
- material list
- formulas
- waste factor
- PDF/Excel export
- UI de takeoff
```

---

## B. Advanced AI estimating inspiration

### 2. Bidwright

**Repo:** `braedonsaunders/bidwright`

Bidwright es una plataforma avanzada de construcción/estimación con IA. Su README describe un sistema con intake, knowledge, takeoff, pricing, scheduling, review y quote delivery sobre un agente IA. 

Lo más interesante para StillasCalculator:

```text
- AI agent orchestration
- OpenAI / Anthropic / Gemini / local models
- MCP server
- 2D takeoff
- 3D model takeoff
- assemblies
- pricing engine
- quote review
- audit trail
```

Bidwright separa el adapter del LLM en `packages/agent` y mantiene las acciones de estimación en servicios/API/MCP, lo cual es una buena arquitectura para que la IA no invente cálculos.  También tiene 2D/3D takeoff y assemblies reutilizables con parámetros. 

**Uso recomendado:**
Solo como inspiración avanzada. No lo usaría como base principal para el MVP porque es demasiado grande.

---

## C. Map/drawing/measurement repositories

### 3. MapLibre GL JS

**Repo:** `maplibre/maplibre-gl-js`

Debe ser la base del mapa. No necesitas forkearlo; se instala como dependencia.

```bash
npm install maplibre-gl
```

---

### 4. MapLibre Geoman

**Repo:** `geoman-io/maplibre-geoman`

Este es muy importante para la parte de dibujar y editar el perímetro de la casa. El README dice que permite crear y editar geometrías con funciones como draw, edit, drag, cut, rotate, split, scale, measure, snap y soporte para GeoJSON, polígonos y multipolígonos. 

También tiene ejemplo para Next.js, React y otros frameworks. 

**Uso recomendado:**
Instalar como dependencia o estudiar sus ejemplos de Next.js.

```bash
npm install @geoman-io/maplibre-geoman-free
```

---

### 5. maplibre-gl-multiple-color-draw

**Repo:** `kashishgadhiya/maplibre-gl-multiple-color-draw`

Aparece en la búsqueda como un repo público para dibujo con MapLibre. 

**Uso recomendado:**
Revisarlo como alternativa más ligera si MapLibre Geoman es demasiado pesado.

---

### 6. terra-draw

**Repo:** `JamesLMilner/terra-draw`

Aparece como resultado relevante para dibujo de polígonos con mapas. 

**Uso recomendado:**
Alternativa para dibujo geométrico si se quiere un motor independiente del proveedor de mapas.

---

## D. Geocoding / address search

### 7. Photon

**Repo:** `komoot/photon`

Photon es un geocoder open-source para OpenStreetMap. Soporta search-as-you-type, búsqueda multilingüe, location bias, typo tolerance, reverse geocoding y filtros por tags OSM. 

El demo público puede usarse con límites razonables, pero el README advierte que uso intensivo puede ser throttled o banned; para producción conviene self-host. 

**Uso recomendado:**
Usar demo para MVP. Más adelante, self-host si la app crece.

---

## E. Overpass / OpenStreetMap building footprints

### 8. overpass-turbo

**Repo:** `tyrasd/overpass-turbo`

Sirve para probar queries Overpass antes de ponerlas en tu app. 

Ejemplo de query para edificios alrededor de una coordenada:

```txt
[out:json][timeout:25];
(
  way["building"](around:40, 60.39299, 5.32415);
  relation["building"](around:40, 60.39299, 5.32415);
);
out body;
>;
out skel qt;
```

**Uso recomendado:**
No forkearlo. Usarlo para diseñar y probar queries.

---

# 4. Best fork/build strategy

No recomiendo forkear todo de un proyecto grande. Mejor:

```text
Build StillasCalculator as a new Next.js app.
Use existing GitHub repos as models and dependencies.
Fork only small modules if needed.
```

## Recommended approach

| Repo                        |        Fork? | Uso recomendado                                                     |
| --------------------------- | -----------: | ------------------------------------------------------------------- |
| `ilirkl/protakeoff-public`  |     Optional | Usarlo como modelo para takeoff, estimating, PDF/Excel, assemblies. |
| `maplibre/maplibre-gl-js`   |           No | Instalar como dependencia.                                          |
| `hyperknot/openfreemap`     |           No | Usar como servicio de mapas/tiles.                                  |
| `komoot/photon`             | No al inicio | Usar API demo para MVP; self-host después.                          |
| `geoman-io/maplibre-geoman` |           No | Instalar como dependencia para dibujo/edición.                      |
| `tyrasd/overpass-turbo`     |           No | Usar como herramienta para probar Overpass queries.                 |
| `braedonsaunders/bidwright` |           No | Inspiración avanzada para IA, MCP y estimating workflow.            |

---

# 5. Architecture

```text
User
  ↓
Next.js responsive web app
  ↓
MapLibre GL JS + OpenFreeMap
  ↓
Photon / Nominatim
  ↓
Overpass API building footprints
  ↓
Turf.js geometry engine
  ↓
Scaffold calculation engine
  ↓
OpenAI AI assistant
  ↓
PDF / CSV export
```

## Important architectural rule

```text
AI talks.
Calculator engine calculates.
Report module documents.
```

The AI Assistant must not invent quantities. It should call deterministic internal functions.

OpenAI function calling is specifically designed to connect models to external systems and application actions, using tools/functions defined by JSON schema. ([OpenAI Platform][1]) Structured Outputs can force responses to follow a JSON Schema, which is useful for material lists and report summaries. ([OpenAI Platform][2])

---

# 6. Project structure

```txt
stillascalculator/
  app/
    page.tsx
    calculator/
      page.tsx
    report/
      page.tsx
    api/
      ai/
        chat/
          route.ts
      geocoding/
        photon/
          route.ts
      overpass/
        buildings/
          route.ts

  components/
    layout/
      AppShell.tsx
      MobileBottomSheet.tsx

    map/
      MapView.tsx
      AddressSearch.tsx
      BuildingFootprintLayer.tsx
      PolygonEditor.tsx
      MeasurementPanel.tsx

    scaffold/
      ScaffoldSystemSelector.tsx
      ScaffoldCalculatorForm.tsx
      MaterialList.tsx
      ExportButtons.tsx

    ai/
      AiChatPanel.tsx
      AiMessageList.tsx
      AiInputBox.tsx
      AiCalculationCard.tsx

  lib/
    map/
      mapLibreConfig.ts
      openFreeMapStyle.ts

    geocoding/
      photon.ts
      nominatim.ts

    osm/
      overpass.ts
      osmToGeoJSON.ts

    geometry/
      turfMeasurements.ts

    scaffold/
      scaffoldSystems.ts
      scaffoldCalculator.ts
      materialRules.ts
      types.ts

    ai/
      openaiClient.ts
      tools.ts
      systemPrompt.ts
      schemas.ts

    export/
      pdfExport.ts
      csvExport.ts

  data/
    scaffold-systems.json

  docs/
    mainidea.md
    taskplan.md
    github-references.md
    calculation-rules.md
    ai-assistant-plan.md

  AGENTS.md
```

---

# 7. Scaffold calculation logic

## Inputs

```ts
type ScaffoldCalculationInput = {
  scaffoldLengthMeters: number;
  workingHeightMeters: number;
  bayLengthMeters: number;
  liftHeightMeters: number;
  scaffoldWidthMeters: number;
  scaffoldSystemId: string;
  wasteFactorPercent?: number;
};
```

## Basic formulas

```ts
const adjustedLength =
  scaffoldLengthMeters * (1 + (wasteFactorPercent ?? 0) / 100);

const numberOfBays = Math.ceil(adjustedLength / bayLengthMeters);

const numberOfLevels = Math.ceil(
  workingHeightMeters / liftHeightMeters
);
```

## Output

```ts
type ScaffoldCalculationOutput = {
  numberOfBays: number;
  numberOfLevels: number;
  totalScaffoldLengthMeters: number;
  materialList: {
    itemName: string;
    quantity: number;
    unit: string;
    notes?: string;
  }[];
  warnings: string[];
};
```

## Initial material categories

```text
- Frames / standards
- Base plates
- Adjustable base jacks
- Ledgers / horizontals
- Platforms / decks
- Guardrails
- Toe boards / fotlist
- Diagonal braces
- Ladders / access
- Wall ties / anchors: verify manually
```

---

# 8. AI Assistant module

The user should be able to ask:

```text
"Calculate the scaffolding for this house."
"I only need the front facade."
"Use HAKI."
"The working height is 6 meters."
"Explain how many pieces I need."
"Generate a report summary."
```

## AI functions/tools

```ts
calculateScaffoldMaterials(input)
getSelectedBuildingMeasurements(projectId)
getAvailableScaffoldSystems()
updateWorkingHeight(heightMeters)
updateSelectedFacades(facadeIds)
generateMaterialList(calculationInput)
generateReportSummary(projectId)
explainCalculation(calculationId)
```

## API routes

```txt
/app/api/ai/chat/route.ts
/app/api/ai/tools/calculate-scaffold/route.ts
/app/api/ai/tools/project-context/route.ts
```

## Security rule

```env
OPENAI_API_KEY=your_key_here
```

The OpenAI API key must stay server-side only. Never expose it in the frontend.

The OpenAI Responses API supports model responses, text/JSON outputs, built-in tools, and function calling to custom code or external systems. ([OpenAI Platform][3])

---

# 9. Future ChatGPT integration

For the normal MVP, the chat lives **inside your web app**.

Future version:

```text
StillasCalculator inside ChatGPT
→ Apps SDK
→ MCP server
→ OAuth
→ StillasCalculator tools
```

OpenAI’s Apps SDK requires a Model Context Protocol server that exposes your app’s capabilities/tools to ChatGPT, and optionally a web component rendered inside ChatGPT. ([OpenAI Developers][4])

For account connection, ChatGPT Apps SDK uses OAuth-style authorization. The official auth docs describe protected resource metadata, OAuth metadata, authorization-code + PKCE flow, and ChatGPT attaching the access token to MCP requests as `Authorization: Bearer <token>`. ([OpenAI Developers][5])

---

# 10. Codex setup

Create:

```txt
AGENTS.md
docs/mainidea.md
docs/taskplan.md
docs/github-references.md
docs/calculation-rules.md
docs/ai-assistant-plan.md
```

Codex reads `AGENTS.md` before doing work, and OpenAI’s Codex docs explain that repository-level `AGENTS.md` files keep Codex aware of project norms and setup rules. ([OpenAI Developers][6])

---

# 11. `docs/github-references.md`

```md
# GitHub References for StillasCalculator

## Main construction/takeoff reference

### ProTakeoff Public
Repository: ilirkl/protakeoff-public

Use as reference for:
- construction takeoff workflow
- area/linear/count measurement
- estimating interface
- formulas
- waste factors
- assemblies
- PDF proposals
- Excel export

Do not copy blindly. Study the structure and adapt the concepts into a Next.js web app.

## Advanced AI estimating reference

### Bidwright
Repository: braedonsaunders/bidwright

Use only as advanced architecture inspiration for:
- AI agent orchestration
- OpenAI integration
- MCP server
- estimate review
- assemblies
- pricing engine
- audit trail

Do not use as MVP base because it is too complex.

## Map engine

### MapLibre GL JS
Repository: maplibre/maplibre-gl-js

Use as the main map engine.
Install as dependency.

## Free map tiles

### OpenFreeMap
Repository: hyperknot/openfreemap

Use as free/open-source map tile provider.
Important: OpenFreeMap does not provide geocoding, routing, satellite imagery or elevation.

## Address search

### Photon
Repository: komoot/photon

Use for address search.
Use public demo only for MVP/testing.
For production, consider self-hosting.

### Nominatim
Repository: lonvia/Nominatim

Use as fallback geocoder only.

## Drawing and editing building polygons

### MapLibre Geoman
Repository: geoman-io/maplibre-geoman

Use for:
- drawing polygons
- editing building footprint
- measuring geometry
- GeoJSON support
- React/Next.js examples

### maplibre-gl-multiple-color-draw
Repository: kashishgadhiya/maplibre-gl-multiple-color-draw

Use as lightweight drawing alternative.

### terra-draw
Repository: JamesLMilner/terra-draw

Use as another geometry drawing reference.

## Overpass / OSM building data

### overpass-turbo
Repository: tyrasd/overpass-turbo

Use for testing Overpass API queries before implementing them in code.
```

---

# 12. `AGENTS.md`

```md
# AGENTS.md — StillasCalculator

## Project goal

Build StillasCalculator, a responsive web app for calculating scaffolding/stillas material needs around a house or selected facade.

The app must work on:
- iPhone
- Android
- desktop browser

## Core stack

Use:
- Next.js
- React
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- OpenFreeMap
- Photon geocoder
- Nominatim fallback
- Overpass API
- Turf.js
- OpenAI JavaScript SDK
- OpenAI Responses API
- Function calling / tool calling
- Structured Outputs
- PDF and CSV export

Do not use:
- Google Maps API
- paid map APIs
- frontend OpenAI API keys

## Main app workflow

1. User searches an address.
2. App shows open-source map.
3. App fetches nearby building footprints using Overpass API.
4. User selects the correct house polygon.
5. User can manually draw or edit the polygon.
6. App calculates perimeter, area and side lengths.
7. User selects scaffold system.
8. User enters working height, bay length, lift height and scaffold width.
9. App calculates number of bays, levels and estimated material list.
10. AI assistant helps complete missing data and runs calculations through internal functions.
11. App exports PDF and CSV.

## AI rules

The assistant must not invent calculations.

All calculations must be performed by deterministic internal functions in:
- lib/scaffold/scaffoldCalculator.ts
- lib/scaffold/materialRules.ts
- lib/geometry/turfMeasurements.ts

The assistant must use function calling to call:
- calculateScaffoldMaterials
- getSelectedBuildingMeasurements
- getAvailableScaffoldSystems
- updateWorkingHeight
- generateMaterialList
- generateReportSummary

Use Structured Outputs for material lists and report summaries.

## Development rules

- Follow docs/taskplan.md step by step.
- Mark each checkbox after completing a task.
- Do not jump between phases.
- Keep code modular.
- Separate map, geocoding, OSM/Overpass, geometry, scaffold calculation and AI logic.
- Create tests for calculation functions.
- Do not add advanced role management yet.
- Do not add full project/client/company management yet.

## Safety/legal rule

The app can generate planning estimates and material lists, but it must not claim that a scaffold is certified, approved or safe for use without professional verification.

Use wording like:
- Estimated material list
- Planning report
- Requires professional verification
- Anchors/wall ties must be verified manually
```

---

# 13. `docs/taskplan.md`

```md
# StillasCalculator Task Plan

## Phase 1 — Project setup

- [ ] Create Next.js project with TypeScript.
- [ ] Install Tailwind CSS.
- [ ] Install MapLibre GL JS.
- [ ] Install Turf.js.
- [ ] Install OpenAI JavaScript SDK.
- [ ] Install PDF/CSV export libraries.
- [ ] Create responsive layout.
- [ ] Create main calculator page.

## Phase 2 — Map system

- [ ] Create MapView component.
- [ ] Connect MapLibre GL JS.
- [ ] Connect OpenFreeMap style.
- [ ] Add zoom/navigation controls.
- [ ] Add mobile full-screen map mode.
- [ ] Add selected location marker.

## Phase 3 — Address search

- [ ] Create Photon geocoding service.
- [ ] Create address search input.
- [ ] Show address results dropdown.
- [ ] Move map to selected result.
- [ ] Add Nominatim fallback.
- [ ] Add rate-limit protection for public geocoders.

## Phase 4 — Building footprint lookup

- [ ] Create Overpass API service.
- [ ] Query buildings around selected coordinates.
- [ ] Convert OSM result to GeoJSON.
- [ ] Show nearby building polygons on map.
- [ ] Allow user to select one building.
- [ ] Highlight selected building.

## Phase 5 — Polygon drawing/editing

- [ ] Add MapLibre Geoman or equivalent polygon editor.
- [ ] Allow user to draw house perimeter manually.
- [ ] Allow user to edit polygon points.
- [ ] Allow user to delete/reset polygon.
- [ ] Store polygon as GeoJSON.
- [ ] Make drawing usable on iPhone and Android touch screens.

## Phase 6 — Geometry measurement

- [ ] Calculate polygon perimeter in meters.
- [ ] Calculate area in square meters.
- [ ] Calculate side lengths.
- [ ] Display measurements live.
- [ ] Add rounding settings.
- [ ] Add waste/adjustment factor.

## Phase 7 — Scaffold system library

- [ ] Create scaffold system data model.
- [ ] Add Generic Frame Scaffold.
- [ ] Add HAKI placeholder.
- [ ] Add Layher placeholder.
- [ ] Add Instant / Alufase placeholder.
- [ ] Add Custom Dimensions option.
- [ ] Allow user to edit bay length, width and lift height.

## Phase 8 — Scaffold calculator engine

- [ ] Create calculateScaffoldMaterials function.
- [ ] Calculate scaffold length.
- [ ] Calculate number of bays.
- [ ] Calculate number of levels.
- [ ] Estimate base plates.
- [ ] Estimate adjustable base jacks.
- [ ] Estimate frames/standards.
- [ ] Estimate ledgers/horizontals.
- [ ] Estimate platforms/decks.
- [ ] Estimate guardrails.
- [ ] Estimate toe boards/fotlist.
- [ ] Estimate diagonal braces.
- [ ] Add manual verification note for anchors/wall ties.

## Phase 9 — Material list UI

- [ ] Create MaterialList component.
- [ ] Show item name, quantity, unit and notes.
- [ ] Add mobile card view.
- [ ] Allow quantities to be manually adjusted.
- [ ] Show calculation summary.

## Phase 10 — AI Assistant

- [ ] Create OpenAI server client.
- [ ] Add OPENAI_API_KEY to server environment only.
- [ ] Create /app/api/ai/chat/route.ts.
- [ ] Create AiChatPanel component.
- [ ] Create AiInputBox component.
- [ ] Create AiMessageList component.
- [ ] Create AI system prompt.
- [ ] Add tool/function calling for calculateScaffoldMaterials.
- [ ] Add tool/function calling for getSelectedBuildingMeasurements.
- [ ] Add tool/function calling for getAvailableScaffoldSystems.
- [ ] Add Structured Outputs for material list.
- [ ] Add Structured Outputs for report summary.
- [ ] Prevent assistant from inventing quantities without calling internal functions.

## Phase 11 — Export

- [ ] Create PDF report.
- [ ] Create CSV export.
- [ ] Include address.
- [ ] Include perimeter.
- [ ] Include selected scaffold system.
- [ ] Include material list.
- [ ] Include AI-generated summary.
- [ ] Include professional verification note.

## Phase 12 — Responsive/PWA

- [ ] Optimize for iPhone Safari.
- [ ] Optimize for Android Chrome.
- [ ] Add installable PWA manifest.
- [ ] Add app icon.
- [ ] Test mobile drawing.
- [ ] Test mobile export.

## Phase 13 — Testing

- [ ] Test rectangular house.
- [ ] Test L-shaped house.
- [ ] Test missing building footprint.
- [ ] Test manual drawing fallback.
- [ ] Test different bay lengths.
- [ ] Test different working heights.
- [ ] Test AI assistant tool calls.
- [ ] Test PDF/CSV export.
```

---

# 14. Final Codex-ready prompt

```md
Create a responsive web app called StillasCalculator.

The app must calculate scaffolding/stillas material needs around a house or selected facade.

Do not use Google Maps API or paid map APIs.

Use:
- Next.js
- React
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- OpenFreeMap
- Photon geocoder
- Nominatim fallback
- Overpass API for OpenStreetMap building footprints
- Turf.js for geometry calculations
- OpenAI JavaScript SDK
- OpenAI Responses API
- Function calling / tool calling
- Structured Outputs
- PDF and CSV export

Add an AI Assistant inside the app.

The user must be able to chat with the app and ask things like:
- "Calculate the scaffolding for this house."
- "I only need the front facade."
- "Use HAKI."
- "The working height is 6 meters."
- "Explain how many pieces I need."
- "Generate a report summary."

Important AI rules:
- The assistant must not invent calculations.
- All calculations must be performed by deterministic internal functions.
- The assistant must use function calling to call:
  - calculateScaffoldMaterials
  - getSelectedBuildingMeasurements
  - getAvailableScaffoldSystems
  - updateWorkingHeight
  - generateMaterialList
  - generateReportSummary
- Use structured JSON outputs for material lists.
- The OpenAI API key must stay server-side only.
- Do not expose API keys in the frontend.

Core MVP:
1. User searches an address.
2. App shows open-source map.
3. App fetches nearby building footprints using Overpass API.
4. User selects the correct house polygon.
5. User can manually draw or edit the house polygon.
6. App calculates perimeter, area and side lengths.
7. User selects scaffold system:
   - Generic frame scaffold
   - HAKI placeholder
   - Layher placeholder
   - Instant / Alufase placeholder
   - Custom dimensions
8. User enters working height, bay length, lift height and scaffold width.
9. App calculates:
   - scaffold length
   - number of bays
   - number of levels
   - estimated material list
10. AI assistant can help the user complete missing information and run calculations.
11. App exports PDF and CSV.
12. App must be responsive for iPhone, Android and desktop.

Use these repositories as models/references:
- ilirkl/protakeoff-public for construction takeoff, estimating, PDF/export and material quantity workflow.
- maplibre/maplibre-gl-js for the map engine.
- hyperknot/openfreemap for free open-source map tiles.
- komoot/photon for open-source geocoding.
- lonvia/Nominatim as geocoding fallback reference.
- geoman-io/maplibre-geoman for drawing/editing/measuring polygons.
- kashishgadhiya/maplibre-gl-multiple-color-draw as lightweight drawing reference.
- JamesLMilner/terra-draw as alternative geometry drawing reference.
- tyrasd/overpass-turbo for testing Overpass API queries.
- braedonsaunders/bidwright only as advanced architecture inspiration for AI estimating, MCP and assemblies.

Create these docs:
- docs/mainidea.md
- docs/taskplan.md
- docs/github-references.md
- docs/calculation-rules.md
- docs/ai-assistant-plan.md
- AGENTS.md

Development rules:
- Follow docs/taskplan.md step by step.
- Mark each checkbox after completing a task.
- Keep code modular.
- Separate map, geocoding, OSM/Overpass, geometry, scaffold calculation and AI logic.
- Do not add advanced role management yet.
- Do not add full project/client/company management yet.
```

This is the right direction: **fresh Next.js app + open-source map/data stack + deterministic scaffold calculator + OpenAI assistant + Codex workflow**.

[1]: https://platform.openai.com/docs/guides/function-calling "Function calling | OpenAI API"
[2]: https://platform.openai.com/docs/guides/structured-outputs "Structured model outputs | OpenAI API"
[3]: https://platform.openai.com/docs/api-reference/responses "Responses | OpenAI API Reference"
[4]: https://developers.openai.com/apps-sdk/quickstart "Quickstart – Apps SDK | OpenAI Developers"
[5]: https://developers.openai.com/apps-sdk/build/auth "Authentication – Apps SDK | OpenAI Developers"
[6]: https://developers.openai.com/codex/guides/agents-md "Custom instructions with AGENTS.md – Codex | OpenAI Developers"
