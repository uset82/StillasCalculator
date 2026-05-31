# Implementation Plan: StillasCalculator

## Overview

This plan converts the StillasCalculator design into incremental, test-driven coding tasks in **TypeScript** (Next.js App Router, React, Tailwind CSS). The build order follows the layered architecture and the architectural rule that "the AI talks, the calculator engine calculates, the report module documents":

1. Project setup and shared types.
2. The pure, deterministic engine layer first (Geometry Engine, Scaffold Calculator, material rules) so the trustworthy core is provable in isolation.
3. The `Project_State` controller (single source of truth) and field validation.
4. Service adapters and server routes (geocoding, Overpass, AI) behind their trust boundaries.
5. The Report module (PDF/CSV serializers).
6. The presentation layer (shell, map, editor, forms, material list, chat) wired into `Project_State`.
7. PWA packaging and final integration.

Property-based tests use `fast-check` (min 100 cases per property), one test per correctness property, tagged `// Feature: stillas-calculator, Property {n}: {text}`. Each property test references the property and the requirements it validates. Test sub-tasks are marked `*` (optional / skippable for MVP); core implementation tasks are never optional.

## Tasks

- [x] 1. Set up project, tooling, and core types
  - [x] 1.1 Initialize the Next.js + TypeScript + Tailwind project and test tooling
    - Scaffold a Next.js (App Router) app with TypeScript and Tailwind CSS; configure ESLint and the directory structure (`app/`, `components/`, `lib/`, `data/`) from the design
    - Install and configure Vitest + `fast-check` and `@testing-library/react`; add a `test` script that runs once (non-watch)
    - Add Turf.js, MapLibre GL JS, and OpenAI SDK as dependencies; do NOT add Google/paid map dependencies
    - _Requirements: 1.6, 2.5_

  - [x] 1.2 Define core domain types and the Verification_Disclaimer constant
    - Create `lib/types.ts` with `ProjectState`, `AddressSelection`, `GeoJsonPolygon`, `PolygonMeasurements`, `ScaffoldSystem`, `ScaffoldSystemId`, `ScaffoldCalculationInput`, `ScaffoldCalculationOutput`, `MaterialItem`, `CalculationResult`, `UpdateResult`, `ValidationError`, `ChatMessage`
    - Add the fixed `VERIFICATION_DISCLAIMER` string asserting estimated planning output requiring professional verification and manual verification of wall ties/anchors, using planning-estimate (never "certified/approved/safe") terminology
    - _Requirements: 17.1, 15.4, 15.5, 15.6_

- [x] 2. Implement the Geometry Engine (pure, Turf.js)
  - [x] 2.1 Implement `isValidPerimeter` and `measurePolygon`
    - In `lib/geometry/turfMeasurements.ts`, validate a ring (closed, ≥3 distinct vertices, no self-intersection) and compute perimeter (m), area (m²), and per-side lengths in ring order; report `valid:false` for invalid input
    - _Requirements: 6.1, 6.2, 6.3, 6.10, 5.5, 5.7, 5.8_

  - [x] 2.2 Write property test for polygon measurement correctness
    - **Property 1: Polygon measurement correctness** — non-negative perimeter/area, one non-negative side length per edge, side lengths sum to perimeter within float tolerance
    - Use generators for axis-aligned rectangles (analytically checkable) and random simple rings
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 2.3 Implement `computeScaffoldLength`
    - In `lib/geometry/turfMeasurements.ts`, sum of selected side lengths; full perimeter when no subset is selected; 0 when the selected subset is empty or sums to 0
    - _Requirements: 6.7, 6.8, 6.9_

  - [x] 2.4 Write property test for scaffold length aggregation
    - **Property 3: Scaffold length aggregation** — equals sum of selected sides, equals full perimeter when no subset, equals 0 when subset empty/zero
    - **Validates: Requirements 6.7, 6.8, 6.9**

- [x] 3. Implement the Scaffold Library, material rules, and calculator engine (pure)
  - [x] 3.1 Implement the Scaffold_Library
    - Create `data/scaffold-systems.json` and `lib/scaffold/scaffoldSystems.ts` with exactly five systems (Generic Frame, HAKI placeholder, Layher placeholder, Instant/Alufase placeholder, Custom Dimensions), each with default bay/width/lift, `isPlaceholder`, and `isCustom` flags
    - _Requirements: 7.1, 7.4, 7.5_

  - [x] 3.2 Implement `buildMaterialList` (material rules)
    - In `lib/scaffold/materialRules.ts`, derive each line item from bays B, levels L, and verticals V=B+1 per the design rule table; always include all listed items plus a wall ties/anchors item with quantity 0 and a "verify manually" note; attach warnings when an input is missing
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 3.3 Write property test for material list structural completeness
    - **Property 12: Material list is structurally complete** — all required line items present incl. wall ties/anchors note; every item has non-empty name, non-empty unit, non-negative-integer quantity
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.6**

  - [x] 3.4 Write property test for material quantity rules
    - **Property 13: Material quantities follow the deterministic rules** — for any (B, L): frames `V*L`, base plates `V`, base jacks `V`, ledgers `B*L*2`, platforms `B*L`, guardrails `B*L*2`, toe boards `B*L`, braces `V*L`, ladders `L`, wall ties `0`
    - **Validates: Requirements 10.4**

  - [x] 3.5 Implement `calculateScaffoldMaterials`
    - In `lib/scaffold/scaffoldCalculator.ts`, compute adjusted length, bays (ceil), levels (ceil), verticals; return a discriminated `CalculationResult`; reject non-positive scaffold length / bay length / lift height and missing inputs with an `InvalidInputError` identifying the offending value, with no side effects
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 8.4_

  - [x] 3.6 Write property test for the adjusted length formula
    - **Property 6: Adjusted length formula** — `scaffoldLength * (1 + clamp(waste,0,100)/100)`, equals scaffold length at waste 0, ≥ scaffold length for waste 0–100
    - **Validates: Requirements 9.1**

  - [x] 3.7 Write property test for number of bays
    - **Property 7: Number of bays is a correct ceiling division** — positive integer `ceil(adjustedLength / bayLength)` satisfying the bracketing inequality
    - **Validates: Requirements 9.2**

  - [x] 3.8 Write property test for number of levels
    - **Property 8: Number of levels is a correct ceiling division** — positive integer `ceil(workingHeight / liftHeight)` satisfying the bracketing inequality
    - **Validates: Requirements 9.4**

  - [x] 3.9 Write property test for invalid-input rejection
    - **Property 9: Invalid calculation inputs are rejected without side effects** — non-positive scaffold/bay/lift yields an invalid-input error identifying the value, no Material_List, state unchanged
    - **Validates: Requirements 9.3, 9.7**

  - [x] 3.10 Write property test for determinism
    - **Property 10: Calculation is deterministic** — repeated invocations on any input produce deeply-equal outputs
    - **Validates: Requirements 9.5**

  - [x] 3.11 Write property test for output completeness
    - **Property 11: Valid calculation output is structurally complete** — output has total scaffold length, bays, levels, Material_List, warnings with correct types
    - **Validates: Requirements 9.6**

  - [x] 3.12 Write property test for required-input enforcement
    - **Property 16: Calculation requires all inputs** — any missing scaffold length / working height / bay / lift yields no Material_List and identifies each missing value
    - **Validates: Requirements 8.4**

- [x] 4. Checkpoint - engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the Project_State controller and validation
  - [x] 5.1 Implement the controller core, subscriptions, selectors, and geometry updaters
    - In `lib/state/projectStateController.ts`, hold exactly one `ProjectState`, expose `getState`/`subscribe`, per-consumer selectors (map, calculator, material list, AI, export), and `setAddress`/`setPerimeter`/`setSelectedFacades` that validate the ring and retain last valid measurements on invalid input
    - _Requirements: 17.1, 17.2, 17.4, 5.5, 5.7, 5.8, 6.7, 6.8, 6.10_

  - [x] 5.2 Implement scalar-field validation updaters and result updaters
    - In `lib/state/projectStateController.ts`, add `setWasteFactor`, `setDecimalPlaces`, `setWorkingHeight`, `setDimension`, `setScaffoldSystem` (loads defaults), `setMaterialQuantity`, and `applyCalculation` (replaces manual edits); each validates per the Field Validation Rules table, retains the last valid value on rejection, and returns an `UpdateResult` with a `ValidationError`
    - _Requirements: 6.5, 6.6, 6.11, 7.2, 7.3, 7.6, 8.1, 8.2, 8.3, 11.3, 11.4, 11.6, 11.7, 17.5_

  - [x] 5.3 Implement the measurement formatting helper
    - In `lib/format/measurement.ts`, format a numeric measurement to exactly the configured decimal places
    - _Requirements: 6.5_

  - [x] 5.4 Write property test for perimeter validation and normalization
    - **Property 2: Perimeter validation and normalization** — valid simple rings store a closed GeoJSON ring containing the vertices; invalid (<3 vertices or self-intersecting) are rejected and nothing is stored
    - **Validates: Requirements 5.5, 5.7, 5.8**

  - [x] 5.5 Write property test for invalid-polygon retention
    - **Property 4: Invalid polygon is not measured** — `measurePolygon` reports `valid:false`, no new measurements are produced, and the last valid measurements remain in `Project_State`
    - **Validates: Requirements 6.10**

  - [x] 5.6 Write property test for total, atomic field validation
    - **Property 14: Field validation is total and atomic** — accept iff numeric and in range (integer where required); on rejection retain last valid value, leave rest of state unchanged, report a field-identifying error; identical for manual and AI-tool origins
    - **Validates: Requirements 6.11, 7.3, 7.6, 8.1, 8.2, 8.3, 11.3, 11.6, 12.5, 17.5**

  - [x] 5.7 Write property test for system-default loading
    - **Property 15: Selecting a system loads its defaults** — selecting any library system loads its default bay/width/lift into `Project_State`
    - **Validates: Requirements 7.2**

  - [x] 5.8 Write property test for decimal-place formatting
    - **Property 5: Measurement formatting honors decimal places** — for places 0–3 the formatted string has exactly that many decimals; out-of-range places are rejected for the last valid setting
    - **Validates: Requirements 6.5**

  - [x] 5.9 Write property test for calculation-replaces-manual-edits
    - **Property 17: New calculation replaces manual quantity adjustments** — after a new calculation every stored quantity equals the newly computed value, not the prior manual one
    - **Validates: Requirements 11.7**

  - [x] 5.10 Write property test for manual quantity persistence
    - **Property 18: Valid manual quantity adjustment persists** — any integer 0–999999 applied to an item is retained exactly for display and export
    - **Validates: Requirements 11.4**

  - [x] 5.11 Write property test for cross-consumer state consistency
    - **Property 32: Project_State consistency across consumers** — every consumer selector returns values deeply-equal to `Project_State`, including AI-originated changes
    - **Validates: Requirements 17.2, 17.3**

  - [x] 5.12 Write property test for navigation invariance
    - **Property 33: State is invariant under navigation** — any sequence of view navigations leaves `Project_State` unchanged
    - **Validates: Requirements 17.4**

- [x] 6. Implement the Geocoding service and address adapter
  - [x] 6.1 Implement the `/api/geocoding/photon` server route
    - In `app/api/geocoding/photon/route.ts`, query Photon server-side; on no-result/error/5s timeout retry exactly once via Nominatim; truncate to the first 5 results; enforce a per-session rate limit of at most 1 request per 300 ms; on both-fail return a "no matching address" signal
    - _Requirements: 3.1, 3.3, 3.6, 3.7, 3.8, 3.9_

  - [x] 6.2 Implement the client geocoding adapter
    - In `lib/geocoding/*`, debounce input 300 ms, suppress requests for <3 characters and clear suggestions, normalize route responses/errors
    - _Requirements: 3.1, 3.2, 3.8_

  - [x] 6.3 Write property test for short-query gating
    - **Property 21: Short queries are gated** — for any input with <3 characters, no geocoding request is issued and suggestions are cleared
    - **Validates: Requirements 3.2**

  - [x] 6.4 Write property test for suggestion truncation
    - **Property 22: Suggestions are truncated to five** — for N provider results the list shows exactly `min(5, N)` entries from the front, in order
    - **Validates: Requirements 3.3**

  - [x] 6.5 Write property test for geocoding rate limiting
    - **Property 23: Geocoding requests are rate-limited** — consecutive outbound requests in a session are spaced ≥300 ms apart
    - **Validates: Requirements 3.8**

  - [x] 6.6 Write unit tests for geocoding fallback and error branches
    - Exactly one Nominatim retry on Photon failure (3.6); both-fail message preserves view/marker (3.7); debounce timing (3.1)
    - _Requirements: 3.1, 3.6, 3.7_

- [x] 7. Implement the Building footprint service and selection
  - [x] 7.1 Implement the `/api/overpass/buildings` server route
    - In `app/api/overpass/buildings/route.ts`, query building ways and relations within 50 m using a 25 s timeout, server-side; surface error and empty-result signals for client fallback to manual drawing while retaining the coordinate
    - _Requirements: 4.1, 4.5, 4.6, 4.7_

  - [x] 7.2 Implement OSM-to-GeoJSON conversion
    - In `lib/osm/osmToGeoJSON.ts`, convert OSM ways/relations into closed GeoJSON polygon features preserving source vertex order
    - _Requirements: 4.2_

  - [x] 7.3 Write property test for OSM-to-GeoJSON conversion
    - **Property 19: OSM-to-GeoJSON conversion produces valid polygons** — rings are closed and preserve source vertex coordinates in order
    - **Validates: Requirements 4.2**

  - [x] 7.4 Implement singleton building selection
    - In `lib/osm/buildingSelection.ts`, model selection so a tap sets exactly one selected building and deselects any prior selection
    - _Requirements: 4.4_

  - [x] 7.5 Write property test for singleton building selection
    - **Property 20: Building selection is a singleton** — after any sequence of taps exactly one building is selected, the most recently tapped
    - **Validates: Requirements 4.4**

  - [x] 7.6 Write unit tests for Overpass error and empty branches
    - Network error / non-success / timeout offers manual drawing and retains coordinate (4.5); empty result offers manual drawing (4.6)
    - _Requirements: 4.5, 4.6_

- [x] 8. Checkpoint - engines, state, and services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the AI Assistant tools, route, and trust boundary
  - [x] 9.1 Implement AI tool definitions, JSON schemas, and system prompt
    - In `lib/ai/tools.ts`, `lib/ai/schemas.ts`, `lib/ai/systemPrompt.ts`, register the six tools (`calculateScaffoldMaterials`, `getSelectedBuildingMeasurements`, `getAvailableScaffoldSystems`, `updateWorkingHeight`, `generateMaterialList`, `generateReportSummary`) mapped to the deterministic engine functions, with Structured Output schemas for material list and report summary
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 9.2 Implement the `/api/ai/chat` server route
    - In `app/api/ai/chat/route.ts`, call the OpenAI Responses API server-side using the server-only key, dispatch tool calls to the shared engine functions, validate structured output against schemas and reject nonconforming output, enforce a 30 s timeout, route invalid tool values through the validated state updaters, and return an `unavailable` signal when no key is configured
    - _Requirements: 12.2, 12.5, 12.6, 12.7, 12.8, 13.1, 13.4, 13.5_

  - [x] 9.3 Implement the client AI adapter and message handling
    - In `lib/ai/*`, send chat requests, reject sending messages longer than 2000 characters, and preserve chronological ordering of messages
    - _Requirements: 12.1, 12.4_

  - [x] 9.4 Write property test for engine-only AI quantities
    - **Property 25: AI presents only engine-computed quantities** — every AI-surfaced scaffold quantity equals `calculateScaffoldMaterials` output exactly (no rounding/scaling) and never originates outside a tool-call result
    - **Validates: Requirements 13.1, 13.6**

  - [x] 9.5 Write property test for structured-output round-trip and rejection
    - **Property 26: Structured outputs round-trip and nonconforming output is rejected** — conforming output validates and parses back equivalently; nonconforming output is rejected and state preserved
    - **Validates: Requirements 13.3, 13.4**

  - [x] 9.6 Write property test for chat ordering and length bound
    - **Property 24: Chat messages are ordered and length-bounded** — messages display in chronological order; any message >2000 chars is rejected
    - **Validates: Requirements 12.1**

  - [x] 9.7 Write unit/integration tests for AI behavior branches
    - In-flight send disabling (12.3); tool-call state update (12.4); AI unavailable with no key and 30 s timeout preserving state (12.7, 12.8); tool missing-data prompting without fabrication (13.5); OpenAI call path with mocked response (12.2)
    - _Requirements: 12.2, 12.3, 12.4, 12.7, 12.8, 13.5_

- [x] 10. Implement the Report module (PDF/CSV export)
  - [x] 10.1 Implement the CSV serializer
    - In `lib/export/csvExport.ts`, emit one row per Material_List item (name, quantity, unit) using current stored quantities plus the Verification_Disclaimer; refuse to produce a file when no Material_List exists
    - _Requirements: 14.2, 14.4, 15.3_

  - [x] 10.2 Write property test for CSV row fidelity
    - **Property 28: CSV row fidelity and round-trip** — exactly one row per item with name/quantity/unit; parsing back yields the same values per item
    - **Validates: Requirements 14.2**

  - [x] 10.3 Implement the PDF serializer
    - In `lib/export/pdfExport.ts`, include address (whenever present, independent of perimeter), computed perimeter, selected system, current item quantities, optional AI summary, and the Verification_Disclaimer; refuse when no Material_List exists
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.6, 15.2_

  - [x] 10.4 Write property test for PDF content inclusion
    - **Property 27: PDF report content inclusion** — PDF includes address (when present), perimeter, selected system, every current item quantity, and the AI summary when one exists
    - **Validates: Requirements 14.1, 14.5, 14.6**

  - [x] 10.5 Write property test for export refusal without a material list
    - **Property 29: Export refused without a material list** — PDF/CSV requests with no Material_List produce no file and surface a "complete a calculation first" message
    - **Validates: Requirements 14.4**

  - [x] 10.6 Write property test for disclaimer presence in exports
    - **Property 30: Verification disclaimer always present in exports** — every exported PDF and CSV contains the Verification_Disclaimer text
    - **Validates: Requirements 14.3, 15.2, 15.3**

  - [x] 10.7 Write property test for forbidden certification terminology
    - **Property 31: Outputs never use certification terminology** — exported reports and material-list copy never contain "certified", "approved", or "safe for use"
    - **Validates: Requirements 15.6**

  - [x] 10.8 Write unit test for export failure handling
    - On PDF/CSV generation failure, surface an error message and preserve `Project_State`
    - _Requirements: 14.7_

- [x] 11. Checkpoint - AI and export
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement the application shell and responsive layout
  - [x] 12.1 Implement `AppShell`, `MobileBottomSheet`, and the primary calculator page skeleton
    - Single-column mobile arrangement with an openable/dismissable bottom sheet below 768px and a multi-pane arrangement at ≥768px, switching across the breakpoint while preserving page state; expose access points for map, scaffold inputs, material list, AI assistant, and export
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 12.2 Write responsive/layout component tests
    - Snapshot/layout assertions at 320, 375, 768, and 1920 px and touch-target sizing ≥44×44 CSS px
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 11.2, 16.3, 16.4_

- [x] 13. Implement the Map system
  - [x] 13.1 Implement `MapView`
    - Wrap MapLibre GL JS with the OpenFreeMap style, zoom/pan controls, single-marker management (replace + center), a below-768px full-screen toggle, and a tile-load error indication with retry
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 13.2 Implement `AddressSearch`
    - Debounced input wired to the geocoding adapter, render up to 5 selectable suggestions, and on selection center the map and place the single marker; show the no-match message
    - _Requirements: 3.3, 3.4, 3.5, 3.7_

  - [x] 13.3 Implement `BuildingFootprintLayer`
    - Render nearby footprints distinct from the basemap, render the selected building distinctly, and set the singleton selection on tap/click
    - _Requirements: 4.3, 4.4, 4.8_

  - [x] 13.4 Write unit/integration tests for map behavior
    - Single-marker replacement (2.3, 3.5) and MapLibre + OpenFreeMap initialization with a mocked map (2.1)
    - _Requirements: 2.1, 2.3, 3.5_

- [x] 14. Implement the Polygon editor and measurement UI
  - [x] 14.1 Implement `PolygonEditor`
    - Draw/edit/reset the perimeter with touch and pointer support, load a selected OSM polygon as editable, enforce ≥3 vertices and non-self-intersection with messages, and commit valid rings to `Project_State`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 14.2 Implement `MeasurementPanel`
    - Show live perimeter/area/side lengths (updating within 500 ms), the decimal-places control (0–3), the waste-factor control (0–100), and facade-subset selection; show the invalid-polygon error indication
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.10_

  - [x] 14.3 Write unit tests for editor validation messaging
    - <3-vertex prevention message and self-intersection rejection message
    - _Requirements: 5.7, 5.8_

- [x] 15. Implement the Scaffold configuration and Material list UI
  - [x] 15.1 Implement `ScaffoldSystemSelector`
    - List the five systems, show the non-certified notice for placeholders, and edit dimensions with >0 and ≤100 validation
    - _Requirements: 7.1, 7.3, 7.4, 7.5_

  - [x] 15.2 Implement `ScaffoldCalculatorForm`
    - Working-height and bay/lift/width inputs with range validation messages and a missing-required-value message that blocks calculation
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 15.3 Implement `MaterialList`
    - Table on desktop and cards below 768px, per-item name/quantity/unit with notes only when present, editable quantities (0–999999) with validation, a calculation summary (length/bays/levels), and the inline Verification_Disclaimer using planning-estimate terminology
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 15.1, 15.6_

  - [x] 15.4 Implement `ExportButtons`
    - Trigger PDF and CSV export from the current state, show the "complete a calculation first" message when no list exists, and show an export-failure message
    - _Requirements: 14.1, 14.2, 14.4, 14.7_

  - [x] 15.5 Write unit tests for scaffold/material UI branches
    - Placeholder notice (7.4), missing-dimension messaging for Custom Dimensions (7.5), and material-quantity validation messaging (11.6)
    - _Requirements: 7.4, 7.5, 11.6_

- [x] 16. Implement the AI chat panel UI
  - [x] 16.1 Implement `AiChatPanel`, `AiMessageList`, `AiInputBox`, and `AiCalculationCard`
    - Chronological chat with a 2000-char input, in-flight progress indicator that disables sending, rendering of tool-call results, and an "AI unavailable" state when no key is configured
    - _Requirements: 12.1, 12.3, 12.7, 13.1_

  - [x] 16.2 Write component tests for chat UI
    - In-flight disabling of additional sends (12.3) and rendering of engine-computed tool results (13.1)
    - _Requirements: 12.3, 13.1_

- [x] 17. Implement PWA packaging and mobile optimization
  - [x] 17.1 Add the web app manifest, service worker, and icons
    - Provide a manifest with name, start URL, standalone display, and 192×192 and 512×512 icons; register a service worker; degrade gracefully where PWA install is unsupported
    - _Requirements: 16.1, 16.2, 16.5_

  - [x] 17.2 Write PWA configuration tests
    - Assert manifest fields and graceful degradation when install is unsupported
    - _Requirements: 16.1, 16.5_

- [x] 18. Integrate, wire, and add configuration tests
  - [x] 18.1 Wire all components into the primary page through Project_State
    - Connect map, address search, footprint layer, polygon editor, measurement panel, scaffold selector/form, material list, export buttons, and AI chat to the single `projectStateController` so updates propagate to every consumer with no orphaned components, completing the address→estimate→export flow
    - _Requirements: 1.5, 17.1, 17.2, 17.3, 17.4_

  - [x] 18.2 Write smoke and configuration tests
    - No Google/paid map dependencies (2.5), geocoding/Overpass executed only server-side (3.9, 4.7), OpenAI key absent from the client bundle (12.6), the six AI tools registered (13.2), a single `Project_State` instance (17.1), and stack/build configuration (1.6)
    - _Requirements: 1.6, 2.5, 3.9, 4.7, 12.6, 13.2, 17.1_

  - [x] 18.3 Write an integration test for the happy-path flow
    - With mocked geocoding/Overpass/OpenAI responses, exercise address selection → footprint selection → measurement → calculation → material list → PDF/CSV export
    - _Requirements: 1.5, 17.2_

- [x] 19. Final checkpoint - all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each of the 33 correctness properties is implemented by exactly one `fast-check` property-based test (min 100 cases), tagged `// Feature: stillas-calculator, Property {n}: {text}`, placed close to the code it validates to catch errors early.
- Property tests cover the deterministic core (geometry, calculator, material rules, state/validation, services conversion/limits, AI trust boundary, and export serializers). UI, map rendering, external-service wiring, timing, and PWA installability are covered by example, integration, smoke, and responsive tests.
- Each task references specific requirement clauses for traceability; checkpoints provide incremental validation.
- The AI server route reuses the same engine functions as the UI, so Property 25 compares assistant-surfaced quantities directly against `calculateScaffoldMaterials`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "5.3", "6.1", "7.1", "7.2", "7.4", "10.1", "10.3", "17.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "6.2", "6.4", "6.5", "7.3", "7.6", "10.2", "10.4", "10.5", "10.6", "10.7", "10.8", "17.2"] },
    { "id": 4, "tasks": ["2.4", "3.3", "3.4", "3.5", "5.1", "6.3", "6.6", "7.5"] },
    { "id": 5, "tasks": ["3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "5.2", "9.1"] },
    { "id": 6, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12", "9.2", "12.1"] },
    { "id": 7, "tasks": ["9.3", "9.4", "9.5", "12.2", "13.1", "15.1", "15.2", "15.3", "15.4"] },
    { "id": 8, "tasks": ["9.6", "9.7", "13.2", "13.3", "14.1", "14.2", "15.5", "16.1"] },
    { "id": 9, "tasks": ["13.4", "14.3", "16.2", "18.1"] },
    { "id": 10, "tasks": ["18.2", "18.3"] }
  ]
}
```
