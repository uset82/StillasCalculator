# Implementation Plan: AI Agent Building Drawing

## Overview

This plan hardens and guarantees the cross-provider AI tool layer that already exists in StillasCalculator, adds the one genuinely missing capability (`retrieveBuildingFootprints`), and retires the dormant legacy tool-less Codex path. Because the architecture is already realized, most tasks touch existing modules and lock in their correctness through property-based and example/integration tests derived from the design's Correctness Properties (A–O). All code is TypeScript (Next.js App Router), tested with Vitest + fast-check.

Each task builds on the previous ones and ends with the net-new tool wired through the same shared dispatch and trust boundary that governs every other tool, leaving no orphaned code.

## Tasks

- [x] 1. Geometry tool argument round-trip integrity (Req 12)
  - [x] 1.1 Implement coordinate-list to closed-ring conversion and input guards
    - Create `lib/ai/geometryToolArgs.ts` with a function that converts an ordered list of `[lon, lat]` pairs into a closed GeoJSON ring, appending a copy of the first pair only when first and last pairs are not numerically identical
    - Preserve every input coordinate value exactly (no rounding/scaling/reprojection/reordering), deferring malformed-geometry rejection to the Geometry_Engine
    - Reject inputs with more than 10,000 coordinate pairs or any pair that is not exactly two finite numeric values, returning an error that identifies the malformed coordinate input and leaves Project_State unchanged
    - Add a serializer that emits the stored ring's exact ordered pairs for return to the model
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_

  - [x] 1.2 Write property test for ring-closing idempotence
    - **Property G: Coordinate-to-ring closing is idempotent**
    - **Validates: Requirements 12.1, 12.3**

  - [x] 1.3 Write property test for geometry round-trip measurement preservation
    - **Property H: Geometry tool round-trip preserves measurements**
    - **Validates: Requirements 12.5**

  - [x] 1.4 Write unit tests for malformed coordinate rejection
    - Cover the >10,000-pair limit and non-two-finite-number pairs
    - Assert Project_State is left unchanged on rejection
    - _Requirements: 12.6_

- [x] 2. Footprint retrieval schema and system-prompt guidance (Req 5.1, 5.2, 6.2)
  - [x] 2.1 Add the `retrieveBuildingFootprints` argument schema
    - Add `RETRIEVE_BUILDING_FOOTPRINTS_PARAMS` to `lib/ai/schemas.ts` with strict `address`/`lat`/`lon` nullable properties, all listed in `required`, `additionalProperties: false`
    - _Requirements: 5.1_

  - [x] 2.2 Document footprint retrieval and storage in the system prompt
    - Add one line in `lib/ai/systemPrompt.ts` instructing the model to call `retrieveBuildingFootprints` for "draw the house at <address>" requests and to commit a chosen candidate via `setBuildingPerimeter`
    - _Requirements: 5.2, 6.2_

- [x] 3. Implement the net-new `retrieveBuildingFootprints` tool (Req 5)
  - [x] 3.1 Implement the server-side footprint composition module
    - Create `lib/ai/buildingFootprints.ts` that resolves an address to a coordinate via the Geocoding_Service (`/api/geocoding/photon`) and queries the Overpass_Service (`/api/overpass/buildings`, 60 m radius), both server-side only
    - Build each candidate's engine-ready closed ring (reusing `lib/ai/geometryToolArgs.ts`) plus preview `perimeterMeters`/`areaSquareMeters` from the Geometry_Engine
    - Map fallbacks: geocoding no-match/error → `address-not-found` with `offerManual`; Overpass error/non-success/timeout → `overpass-failed` with `offerManual`; no footprints in 60 m → `{ empty: true, candidates: [] }`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 3.2 Register and wire the tool into the shared executor
    - Add `retrieveBuildingFootprints` to `ToolName` and `AI_TOOLS` in `lib/ai/toolExecutor.ts` so both providers expose it identically
    - Add a synchronous-dispatch guard entry that instructs callers to use `executeTool`, and handle the async branch in `executeTool` by delegating to `lib/ai/buildingFootprints.ts`
    - _Requirements: 5.1, 1.1, 2.1_

  - [x] 3.3 Write integration test for footprint retrieval fallbacks
    - **Property M: Footprint retrieval fallback**
    - **Validates: Requirements 5.4, 5.5, 5.7**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. AI perimeter storage and facade selection through the deterministic engine (Req 6, 7, 8)
  - [x] 5.1 Harden perimeter storage and facade-subset validation in the Plan_Updater
    - In `lib/ai/planToolContext.ts`, ensure `setPerimeter` stores a candidate/AI-produced polygon only after Geometry_Engine validation, replacing any prior perimeter, and that on rejection the last valid perimeter is retained (or none when none existed)
    - Ensure `selectFacadeSides` rejects side indices outside the stored perimeter's range, retaining the existing facade selection, and accepts `null` to select the whole perimeter
    - Confirm AI-produced geometry uses the same `setPerimeter` path as manual drawing so measurements/Scaffold_Length are engine-derived
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.7, 6.8, 7.1, 7.2, 8.1, 8.4_

  - [x] 5.2 Write property test for the perimeter validation gate
    - **Property F: Perimeter validation gate**
    - **Validates: Requirements 6.1, 6.4**

  - [x] 5.3 Write property test for AI-drawn vs manually-drawn equivalence
    - **Property I: AI-drawn geometry equals manually-drawn geometry in the pipeline**
    - **Validates: Requirements 7.1, 8.1, 8.3**

  - [x] 5.4 Write unit tests for facade-subset rejection
    - Cover out-of-range indices and the `null` whole-perimeter case
    - Assert existing facade selection is retained on rejection
    - _Requirements: 6.8_

- [x] 6. Provider-agnostic dispatch equivalence and unknown-tool handling (Req 1, 2.1, 9.5, 8)
  - [x] 6.1 Lock in unknown-tool inertness and provider-agnostic definitions
    - In `lib/ai/toolExecutor.ts`, confirm `createToolDispatch`/`executeTool` return an error naming an unknown tool, execute no engine function, and leave Project_State unchanged
    - Confirm `getToolDefinitions()` is the single source both providers build from, and that no tool writes derived measurements/Scaffold_Length/material quantities except as deterministic engine output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 8.5, 8.6, 9.5_

  - [x] 6.2 Write property test for provider-agnostic dispatch equivalence
    - **Property A: Provider-agnostic dispatch equivalence**
    - **Validates: Requirements 1.2, 1.3, 2.1**

  - [x] 6.3 Write property test for unknown-tool inertness
    - **Property B: Unknown tool is inert**
    - **Validates: Requirements 1.4, 9.5**

  - [x] 6.4 Write structural test for no-direct-derived-writes
    - **Property J: AI cannot write derived values directly**
    - **Validates: Requirements 8.4, 8.5**

- [x] 7. Uniform field validation across providers (Req 3)
  - [x] 7.1 Align file-backed validation ranges with the controller
    - In `lib/ai/planToolContext.ts`, ensure `createFilePlanContext` enforces the identical ranges as `createControllerPlanContext` (working height 0.01–100 m, calculator dimensions 0.01–5 m, system editor >0 and ≤100 m, waste factor 0–100%), rejecting non-numeric/out-of-range/unknown-identifier values with a field-named error and applying no partial update
    - On any tool error or missing data, preserve Project_State and relay the specific missing/failed value to the model
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 7.2 Write property test for cross-provider field validation parity
    - **Property C: Field validation is total and state-preserving across providers**
    - **Validates: Requirements 3.1, 3.2, 3.5**

  - [x] 7.3 Write property test for no fabricated quantities
    - **Property D: No fabricated quantities**
    - **Validates: Requirements 2.5, 3.3, 7.3**

- [x] 8. Structured output conformance gate across providers (Req 4)
  - [x] 8.1 Ensure the strict-schema validation gate is wired on both providers
    - Confirm `lib/ai/validateStructuredOutput.ts` rejects any Material_List/report summary with a missing required field, an extra field, or a wrong-typed field before presenting or storing, on both the OpenAI and Codex paths, preserving Project_State on failure
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.2 Write property test for the structured-output conformance gate
    - **Property E: Structured output conformance gate**
    - **Validates: Requirements 4.1, 4.2**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Retire the legacy tool-less Codex path (Req 2.7)
  - [x] 10.1 Remove `runCodexSdkChat` and its now-unused helpers
    - In `lib/ai/codexSdkAdapter.ts`, remove `runCodexSdkChat` and the private helpers that become unused (`buildCodexSdkPrompt`, `summarizeProjectState`, `summarizeCodexFailure`, `getCodexTimeoutMs`, the `CodexSdkChatResult` type)
    - Keep `getCodexCliAuthStatus`, `startCodexChatGptSignIn`, and the auth/sign-in discovery helpers they depend on
    - Confirm the chat route's only Codex entry point is `runCodexAgentWithTools`
    - _Requirements: 2.7_

  - [x] 10.2 Write structural test for the single tool-enabled Codex path
    - **Property O: Single tool-enabled Codex path**
    - **Validates: Requirements 2.7**

- [x] 11. Sandbox, deadline, and availability uniformity (Req 9, 10, 11)
  - [x] 11.1 Lock sandbox flags, bounded round-trips, and the mandatory-tool guard
    - In `lib/ai/codexAgentRunner.ts`, confirm every Codex thread sets `sandboxMode: 'read-only'`, `approvalPolicy: 'never'`, `networkAccessEnabled: false`, `webSearchMode: 'disabled'`, and that all external effects flow through the MCP Tool_Dispatch
    - Confirm both providers cap tool round-trips (OpenAI `MAX_TOOL_ITERATIONS = 8`; Codex equivalent bound) and apply the same 45 s `Request_Deadline`
    - In `app/api/ai/chat/route.ts`, confirm the mandatory-tool guard returns `502` when `requiresTools` but zero tools ran (with the single Codex retry), and that unavailable/error/timeout map to the uniform response shape
    - _Requirements: 9.1, 9.2, 9.4, 9.6, 10.1, 10.4, 11.3, 11.5_

  - [x] 11.2 Write integration test for Codex sandbox flags
    - **Property L: Codex sandbox flags**
    - **Validates: Requirements 9.1, 9.2**

  - [x] 11.3 Write integration test for request deadline and state preservation
    - **Property K: Request deadline and state preservation**
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [x] 11.4 Write integration test for availability signalling
    - **Property N: Availability signalling**
    - **Validates: Requirements 11.1, 11.2**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties A–O from the design)
- Unit and integration tests validate specific examples, edge cases, and external-service contracts
- This is a hardening feature: most tasks tighten and prove existing modules; `retrieveBuildingFootprints` (Task 3) is the only net-new capability and Task 10 retires the dormant legacy path

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "3.1", "5.1", "8.1", "10.1", "11.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "3.2", "7.1", "5.2", "5.3", "5.4", "8.2", "10.2", "11.2", "11.3", "11.4"] },
    { "id": 2, "tasks": ["6.1", "3.3", "7.2", "7.3"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4"] }
  ]
}
```
