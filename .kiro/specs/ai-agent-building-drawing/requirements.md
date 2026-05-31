# Requirements Document

## Introduction

This feature **hardens and guarantees** capabilities that already exist in StillasCalculator's AI Assistant (stillas-calculator spec, Requirements 12–13). An earlier draft of this document described a tool-less Codex chat path as the starting point; that premise was wrong. The current code already routes the Codex/ChatGPT-login provider through tools. This feature is therefore primarily about **proving and locking in correctness**, not building tool access from scratch.

What the code already does (verified against the current sources):

1. **The Codex provider already has tool access.** The chat route (`app/api/ai/chat/route.ts`) routes the Codex/ChatGPT-login provider through `runCodexAgentWithTools` (`lib/ai/codexAgentRunner.ts`). That runner starts the Codex SDK with an MCP server (`scripts/stillas-mcp-server.ts`, configured via `mcp_servers.stillas`) so the model can already call the app's deterministic tools. The Codex thread is created with `sandboxMode: 'read-only'`, `approvalPolicy: 'never'`, `networkAccessEnabled: false`, and `webSearchMode: 'disabled'`. The OpenAI provider path (`runOpenAiAgentWithTools` in `lib/ai/openAiAgentLoop.ts`) calls the same tools through the same dispatch.

2. **The geometry, drawing, and CAD tools already exist.** `lib/ai/toolExecutor.ts` defines `AI_TOOLS` and `createToolDispatch`, exposing `getScaffoldPlan`, `calculateScaffoldMaterials`, `getSelectedBuildingMeasurements`, `getAvailableScaffoldSystems`, `updateWorkingHeight`, `generateMaterialList`, `generateReportSummary`, `setBuildingPerimeter`, `selectFacadeSides`, `setScaffoldSystem`, `setScaffoldDimensions`, `generateScaffoldDrawing`, `clearScaffoldDrawing`, `generateCadModel`, and `exportCadFormat` (scad/stl/dxf). Drawing and parametric-CAD generation (the directions inspired by Adam-CAD/CADAM text-to-CAD, CesiumGS/3d-tiles, and pascalorg/editor) are already partly realized by `generateScaffoldDrawing` plus `generateCadModel`/`exportCadFormat` OpenSCAD output.

3. **The single source of truth is a `ScaffoldPlan`.** State flows through `scaffoldPlanController` (the `projectStateController` singleton, aliased as `scaffoldPlanController`). The validated updaters live on that controller and are mirrored, with identical validation ranges, in `lib/ai/planToolContext.ts` (`createControllerPlanContext` for the in-process OpenAI path; `createFilePlanContext` for the file-backed MCP path).

Accordingly, this feature exists to **harden and guarantee** the following, each verified by the Correctness Properties:

- **(a) Tool access is non-optional and provider-agnostic** across the OpenAI_Provider and the Codex/MCP Codex_Provider — the same tool names, the same argument schemas, and the same backing deterministic functions on both backends.
- **(b) The trust boundary and field validation hold identically on both backends** — stateful updates pass only through the validated updater (`createControllerPlanContext` → `scaffoldPlanController` on the OpenAI path; `createFilePlanContext` on the MCP path), with the same numeric ranges.
- **(c) AI-produced geometry always flows through the deterministic engine and stays user-correctable** — the AI supplies only candidate geometry; every perimeter, area, side length, and Scaffold_Length is computed by the Geometry_Engine, and every AI-produced perimeter is stored through the same validated `setPerimeter` updater used for manual drawing.
- **(d) The Codex sandbox restrictions remain enforced** — read-only filesystem, no automatic command approval, no direct model network access, and disabled web search.
- **(e) The Request_Deadline, Project_State preservation, and availability handling behave uniformly** across both providers.

In addition, this feature adds the one genuinely missing capability: a net-new `retrieveBuildingFootprints` tool that resolves an address to a coordinate via the Geocoding_Service and queries the Overpass_Service for nearby footprints, so the assistant can "draw the house from the address provided" end to end. Finally, this feature **retires the legacy tool-less `runCodexSdkChat` chat path** in `lib/ai/codexSdkAdapter.ts` so a single tool-enabled Codex path remains and no dormant tool-less code path can regress the guarantee in (a).

This feature introduces no new map stack, no new calculation engine, and no client-exposed credentials. It builds on the existing single Project_State (single source of truth, stillas-calculator Req 17.1), the server-only AI trust boundary, and the open-source map/geocoding/footprint services already present.

## Glossary

- **AI_Agent**: The in-app AI assistant as a whole, across both provider paths. It is the `AI_Assistant` of the stillas-calculator spec, extended by this feature with the net-new footprint-retrieval tool and the cross-provider correctness guarantees.
- **AI_Provider**: A backend that fulfills an AI request. Exactly two exist: the **OpenAI_Provider** (OpenAI Responses API via `runOpenAiAgentWithTools` in `lib/ai/openAiAgentLoop.ts`, used when a server-only OpenAI API key is configured) and the **Codex_Provider** (the official Codex SDK via `runCodexAgentWithTools` in `lib/ai/codexAgentRunner.ts`, using the local `codex login` ChatGPT session and the Stillas MCP server).
- **Provider_Adapter**: The server-side component that runs a single AI turn against one AI_Provider and returns a normalized result (assistant reply, tool results, optional structured output, and unavailable/error/timeout signals). The OpenAI_Provider adapter is `runOpenAiAgentWithTools`; the Codex_Provider adapter is `runCodexAgentWithTools`.
- **MCP_Server**: The Stillas Model Context Protocol server (`scripts/stillas-mcp-server.ts`) that exposes the deterministic Application_Tools to the Codex_Provider. It builds its dispatch from the same `createToolDispatch` and `getToolDefinitions` as the OpenAI path, backed by a file-synced `ScaffoldPlan` through `createFilePlanContext`.
- **Tool_Dispatch**: The deterministic dispatch (`createToolDispatch` in `lib/ai/toolExecutor.ts`, re-exported via `lib/ai/tools.ts`) that maps a tool name and JSON arguments to the backing deterministic engine function and returns a `ToolResult`. It is the single execution path for every tool call from any AI_Provider — directly for the OpenAI_Provider and through the MCP_Server for the Codex_Provider.
- **Application_Tool**: One of the deterministic tools the AI_Agent may call, defined in `AI_TOOLS` (`lib/ai/toolExecutor.ts`). The existing set is `getScaffoldPlan`, `calculateScaffoldMaterials`, `getSelectedBuildingMeasurements`, `getAvailableScaffoldSystems`, `updateWorkingHeight`, `generateMaterialList`, `generateReportSummary`, `setBuildingPerimeter`, `selectFacadeSides`, `setScaffoldSystem`, `setScaffoldDimensions`, `generateScaffoldDrawing`, `clearScaffoldDrawing`, `generateCadModel`, and `exportCadFormat`, plus the net-new `retrieveBuildingFootprints` tool added by this feature.
- **Geometry_Tool**: An Application_Tool that retrieves or alters building geometry: `retrieveBuildingFootprints` (net-new), `setBuildingPerimeter`, and `selectFacadeSides`.
- **Drawing_Tool**: An Application_Tool that produces or clears a derived drawing/CAD artifact from the stored plan: `generateScaffoldDrawing`, `clearScaffoldDrawing`, `generateCadModel`, and `exportCadFormat`. (Note: `clearScaffoldDrawing` clears the 2D scaffold drawing overlay on `ScaffoldPlan.drawing`; it does not clear the building perimeter.)
- **Perimeter_Polygon**: A closed GeoJSON polygon ring of [longitude, latitude] coordinate pairs that represents the building perimeter, as defined by `GeoJsonPolygon` in `lib/types.ts`.
- **Geometry_Engine**: The existing deterministic module (`lib/geometry/turfMeasurements.ts`, `isValidPerimeter`/`measurePolygon`/`computeScaffoldLength`) that validates a Perimeter_Polygon and computes perimeter, area, per-side lengths, and Scaffold_Length.
- **Overpass_Service**: The existing server-side service (`/api/overpass/buildings`) that queries OpenStreetMap for nearby building footprints (60-meter radius, 25-second overall deadline) and returns GeoJSON polygons.
- **Geocoding_Service**: The existing server-side service (`/api/geocoding/photon`) that resolves address text to coordinates via Photon with a single Nominatim fallback.
- **Polygon_Editor**: The existing component (`components/map/PolygonEditor.tsx`) that renders a stored Perimeter_Polygon as an editable polygon with movable vertices and a reset action wired to `scaffoldPlanController.clearPerimeter`.
- **Project_State**: The single in-memory source of truth — a `ScaffoldPlan` record owned by `scaffoldPlanController` (the `projectStateController` singleton, aliased as `scaffoldPlanController`) and shared by the map, calculator, material list, AI_Agent, and export views (stillas-calculator Req 17.1). On the Codex/MCP path the same `ScaffoldPlan` shape is carried through a synced plan file and mutated via `createFilePlanContext`.
- **Plan_Updater**: The validated mutation surface for the Project_State. On the OpenAI path it is `createControllerPlanContext` delegating to `scaffoldPlanController` (e.g. `setWorkingHeight`, `setPerimeter`, `setSelectedFacades`, `setScaffoldSystem`, `setDimension`, `applyCalculation`, `setDrawingOverlay`/`clearDrawingOverlay`, `setCadModel`/`addCadExport`). On the MCP path it is `createFilePlanContext`, which enforces identical validation ranges.
- **Tool_Result**: The discriminated outcome of executing an Application_Tool: a success carrying deterministic engine output, or a failure carrying a human-readable reason.
- **Structured_Output**: A Material_List or report summary the AI_Agent surfaces, validated against its strict JSON Schema (`lib/ai/schemas.ts`) before presentation.
- **Request_Deadline**: The configured ceiling on a single AI chat request, including all tool round-trips. It is currently 45 seconds (45,000 ms): `REQUEST_TIMEOUT_MS` in `app/api/ai/chat/route.ts` for the OpenAI path, and `DEFAULT_CODEX_TIMEOUT_MS` (overridable by `STILLAS_CODEX_TIMEOUT_MS`) in `lib/ai/codexAgentRunner.ts` for the Codex path.
- **Verification_Disclaimer**: The fixed statement that outputs are estimated planning figures requiring professional verification and that anchors/wall ties must be verified manually (stillas-calculator Req 15.4–15.6).

## Requirements

### Requirement 1: Provider-Agnostic Tool Dispatch

**User Story:** As a user, I want the assistant to use the same real calculator tools no matter which AI backend is running, so that I get identical, trustworthy behavior regardless of how the app is configured.

#### Acceptance Criteria

1. THE Tool_Dispatch SHALL expose to the OpenAI_Provider and the Codex_Provider an identical set of Application_Tools, where identity means the same set of tool names and, for each name, the same argument schema and the same backing deterministic engine function, both providers building their dispatch from the same `createToolDispatch` and `getToolDefinitions` in `lib/ai/toolExecutor.ts`.
2. WHEN any AI_Provider invokes an Application_Tool, THE Tool_Dispatch SHALL execute the call through the same deterministic engine function used for that tool name irrespective of the active AI_Provider.
3. WHEN two requests invoke the same tool name with identical arguments against an identical Project_State, THE Tool_Dispatch SHALL return identical Tool_Results — the same outcome discriminant (success or failure) and the same payload values, with no provider-dependent fields — irrespective of the active AI_Provider.
4. IF an AI_Provider requests a tool name that is not a defined Application_Tool, THEN THE Tool_Dispatch SHALL return a Tool_Result error that names the unknown tool, SHALL execute no deterministic engine function, and SHALL leave the Project_State unchanged.
5. WHEN an AI request completes, THE AI_Agent SHALL return the executed Tool_Results to the client in one response shape that is identical for the OpenAI_Provider and the Codex_Provider, with the Tool_Results ordered as the tool calls were executed.
6. WHEN an AI request completes without invoking any Application_Tool, THE AI_Agent SHALL return an empty Tool_Result collection in the same response shape, identical for the OpenAI_Provider and the Codex_Provider.

### Requirement 2: Mandatory, Non-Optional Codex Tool Access

**User Story:** As a user running the assistant through my ChatGPT/Codex login, I want it to keep full, non-optional access to the app's tools, so that it can do the same work as the API-key backend and no configuration can silently take that access away.

#### Acceptance Criteria

1. THE Codex_Provider SHALL have access to every Application_Tool that the OpenAI_Provider has access to, served through the MCP_Server built from the same `getToolDefinitions`/`createToolDispatch`.
2. WHILE the active AI_Provider is the Codex_Provider, WHEN the model requests an Application_Tool, THE AI_Agent SHALL execute that tool through the Tool_Dispatch and return the resulting Tool_Result to the model before the model produces its final response for that turn and within the Request_Deadline.
3. THE AI_Agent SHALL provide tool access to the Codex_Provider unconditionally, without any configuration option that disables Application_Tool access for the Codex_Provider while retaining it for the OpenAI_Provider.
4. WHEN the Codex_Provider completes a turn that invoked one or more Application_Tools, THE AI_Agent SHALL surface every executed Tool_Result to the client.
5. WHEN the Codex_Provider model presents a scaffold quantity, THE AI_Agent SHALL present a value equal to the quantity carried by an executed Tool_Result for the same inputs, with no rounding, scaling, or other transformation.
6. IF a scaffold quantity presented by the Codex_Provider model does not originate from an executed Tool_Result, THEN THE AI_Agent SHALL suppress that quantity, return an error indication to the model, and preserve the existing Project_State.
7. THE AI_Agent SHALL retire the legacy tool-less chat path `runCodexSdkChat` (`lib/ai/codexSdkAdapter.ts`) so that the only Codex_Provider chat path is the tool-enabled `runCodexAgentWithTools`, leaving no dormant tool-less Codex chat path, while preserving the still-used `getCodexCliAuthStatus` and `startCodexChatGptSignIn` exports of that module.

### Requirement 3: Uniform Trust Boundary and Field Validation Across Providers

**User Story:** As a user, I want invalid inputs rejected and my project data protected the same way on every backend, so that the assistant can never corrupt my project regardless of which provider runs.

#### Acceptance Criteria

1. WHEN any AI_Provider supplies a value to a stateful Application_Tool, THE AI_Agent SHALL apply that value exclusively through the validated Plan_Updater — `createControllerPlanContext` delegating to `scaffoldPlanController` on the OpenAI path, or `createFilePlanContext` on the MCP path — with no direct write bypassing that updater.
2. IF a value supplied through any AI_Provider's tool call is non-numeric, out of its permitted range, or references an unknown identifier, THEN THE AI_Agent SHALL reject the value, retain the last valid Project_State value for the affected field, apply no partial update to any other field, and return an error to the model that names the affected field and its permitted range.
3. WHEN any AI_Provider presents a scaffold quantity, THE AI_Agent SHALL present a value equal to the deterministic engine result for the same inputs, with no rounding, scaling, or other transformation.
4. IF an Application_Tool returns an error or missing data, THEN THE AI_Agent SHALL preserve the existing Project_State, relay the specific missing or failed value to the model, and require the model to request that value from the user rather than substitute, default, or fabricate one.
5. THE AI_Agent SHALL apply the field-validation rules of stillas-calculator Requirements 6, 7, and 8 to tool-supplied values identically for the OpenAI_Provider and the Codex_Provider, where those rules constrain Working_Height to 0.01–100 m (`setWorkingHeight`), input Bay_Length, Lift_Height, and Scaffold_Width to 0.01–5 m in the calculator context (`setDimension`/`setScaffoldDimensions`), editable scaffold-system dimensions to greater than 0 and at most 100 m in the system-editor context, and Waste_Factor to 0–100 percent.

### Requirement 4: Structured Output Validation Across Providers

**User Story:** As a user, I want any material list or summary the assistant returns to match the required format on every backend, so that malformed AI output is never shown or stored.

#### Acceptance Criteria

1. WHEN any AI_Provider produces a Material_List or report summary as Structured_Output, THE AI_Agent SHALL validate that output against its defined strict JSON Schema (`MATERIAL_LIST_STRUCTURED_OUTPUT` or `REPORT_SUMMARY_STRUCTURED_OUTPUT` in `lib/ai/schemas.ts`) — rejecting any output that has a missing required field, an additional field not defined by the schema, or a field whose value type differs from the schema — before presenting or storing it.
2. IF Structured_Output produced through any AI_Provider does not conform to its JSON Schema, THEN THE AI_Agent SHALL neither present nor store that output, SHALL return an error indication that the output failed schema validation, SHALL preserve the existing Project_State, and SHALL withhold the nonconforming output from presentation and storage even if preserving the existing Project_State fails.
3. WHEN Structured_Output produced through any AI_Provider conforms to its JSON Schema, THE AI_Agent SHALL surface field values equal to the deterministic engine values they were derived from, with no rounding, scaling, or other transformation.

### Requirement 5: AI-Driven Building Footprint Retrieval

**User Story:** As a user, I want to give the assistant a house by address or location and have it find the building outline, so that it can draw the correct building instead of me hunting for it.

#### Acceptance Criteria

1. THE AI_Agent SHALL expose a `retrieveBuildingFootprints` Geometry_Tool that accepts an address or a coordinate, resolves an address to a coordinate by calling the Geocoding_Service, and obtains candidate building footprints within a 60-meter radius of that coordinate by calling the Overpass_Service, performing both calls server-side.
2. WHEN the user asks the AI_Agent to draw a house identified by an address, THE AI_Agent SHALL call the `retrieveBuildingFootprints` Geometry_Tool with that address.
3. WHEN `retrieveBuildingFootprints` returns one or more candidate footprints, THE AI_Agent SHALL return the candidate footprints as a Tool_Result so the model can select or confirm one with the user.
4. IF `retrieveBuildingFootprints` returns no footprints within the 60-meter search radius, THEN THE AI_Agent SHALL inform the user that no footprint was found and SHALL offer to draw the perimeter from user-provided dimensions or manual editing.
5. IF the Overpass_Service step of `retrieveBuildingFootprints` fails with a network error, a non-success response, or no response within the Overpass_Service's 25-second deadline, THEN THE AI_Agent SHALL report the failure, SHALL preserve the existing Project_State, and SHALL offer manual drawing.
6. THE `retrieveBuildingFootprints` Geometry_Tool SHALL execute every Overpass and geocoding request server-side and SHALL NOT expose the Overpass or geocoding endpoints to the client.
7. IF the Geocoding_Service does not resolve the provided address to a coordinate, returning no matching address or a service error, THEN THE AI_Agent SHALL report that the address could not be located, SHALL preserve the existing Project_State, and SHALL offer manual drawing or prompt the user for a more specific address or coordinate.

### Requirement 6: AI-Driven Perimeter Drawing and Editing

**User Story:** As a user, I want the assistant to actually draw and adjust the building perimeter for the house I described, so that it takes control of the drawing rather than only talking about it.

#### Acceptance Criteria

1. WHEN the AI_Agent has a candidate footprint or an ordered set of perimeter vertices for the provided house, THE AI_Agent SHALL store the perimeter by calling the `setBuildingPerimeter` Geometry_Tool, which validates the Perimeter_Polygon with the Geometry_Engine before storing it through the Plan_Updater in the Project_State.
2. WHEN the AI_Agent selects one of the candidate footprints returned by `retrieveBuildingFootprints`, THE AI_Agent SHALL store that footprint as the single building perimeter by calling the `setBuildingPerimeter` Geometry_Tool with the selected footprint polygon, replacing any previously stored perimeter.
3. WHEN the AI_Agent stores a valid Perimeter_Polygon, THE Polygon_Editor SHALL render that perimeter as an editable polygon presenting one movable vertex handle per distinct ring vertex.
4. IF a Perimeter_Polygon supplied through the `setBuildingPerimeter` Geometry_Tool has fewer than 3 distinct vertices, is not a closed ring, or has self-intersecting sides, THEN THE Geometry_Tool SHALL reject the polygon via the Geometry_Engine, retain the last valid perimeter in the Project_State (or leave the Project_State with no perimeter when none was previously stored), and return an error to the model that identifies that the perimeter validation failed.
5. WHEN the user asks the AI_Agent to scaffold a subset of facades, THE AI_Agent SHALL set the target facade subset, expressed as the requested facade side indices over the stored perimeter's sides, by calling the `selectFacadeSides` Geometry_Tool (passing `null` to select the whole perimeter).
6. WHEN the user asks the AI_Agent to remove the generated 2D scaffold drawing overlay, THE AI_Agent SHALL call the `clearScaffoldDrawing` Drawing_Tool, which removes the stored drawing overlay from `ScaffoldPlan.drawing` without altering the building perimeter, its measurements, or the facade selection.
7. WHEN the user asks the AI_Agent to replace the building perimeter, THE AI_Agent SHALL call the `setBuildingPerimeter` Geometry_Tool with the new perimeter, superseding the previously stored perimeter through the same validated Plan_Updater; the AI_Agent SHALL NOT claim a dedicated perimeter-clearing tool that does not exist, and clearing an existing perimeter without replacement remains a user action through the Polygon_Editor's reset.
8. IF a facade subset supplied to the `selectFacadeSides` Geometry_Tool references a facade side index outside the range of the stored perimeter's sides, THEN THE Geometry_Tool SHALL reject the subset, retain the existing facade selection in the Project_State, and return an error to the model that identifies the invalid subset.

### Requirement 7: AI Geometry Feeds the Deterministic Measurement Pipeline

**User Story:** As a user, I want every measurement of an AI-drawn building to come from the real geometry engine, so that the dimensions feeding my estimate are trustworthy.

#### Acceptance Criteria

1. WHEN a Perimeter_Polygon is stored through the `setBuildingPerimeter` Geometry_Tool, THE Geometry_Engine SHALL compute the perimeter, area, per-side lengths, and Scaffold_Length from that polygon, producing values equal to those it produces for a manually drawn perimeter whose coordinates are identical to that polygon.
2. WHEN the AI_Agent reports a measurement or a Scaffold_Length for an AI-drawn perimeter, THE AI_Agent SHALL obtain that value from the Project_State as computed by the Geometry_Engine.
3. WHEN the AI_Agent reports a measurement for an AI-drawn perimeter, THE AI_Agent SHALL present a value equal to the Geometry_Engine's computed value for that polygon, with no rounding, scaling, or other transformation.
4. WHEN a scaffold calculation is performed for an AI-drawn perimeter, THE AI_Agent SHALL obtain the Scaffold_Length used for that calculation from the Geometry_Engine's computation over the stored Perimeter_Polygon and the current facade selection.
5. IF the AI_Agent is asked to report a measurement or a Scaffold_Length for an AI-drawn perimeter for which the Geometry_Engine has produced no computed value, THEN THE AI_Agent SHALL report that the value is unavailable, SHALL request the missing geometry from the user, and SHALL NOT present a substituted or fabricated value.

### Requirement 8: AI Geometry Remains User-Correctable and Never Bypasses the Engine

**User Story:** As a user, I want to be able to fix or replace anything the assistant draws, and I want to be sure it cannot inject numbers behind the engine's back, so that I stay in control of the result.

#### Acceptance Criteria

1. THE AI_Agent SHALL store every AI-produced Perimeter_Polygon through the same validated `setPerimeter` Plan_Updater used for manual drawing — `scaffoldPlanController.setPerimeter` on the OpenAI path and the `createFilePlanContext` `setPerimeter` on the MCP path — both of which validate the ring via the Geometry_Engine.
2. WHEN an AI-produced Perimeter_Polygon is stored, THE StillasCalculator SHALL render it in the Polygon_Editor as an editable polygon whose vertices the user can move, whose reset action restores the polygon to the last stored valid Perimeter_Polygon, and which the user can replace with a newly drawn perimeter.
3. WHEN the user commits an edit to an AI-drawn Perimeter_Polygon by moving a vertex, resetting it, or replacing it, THE StillasCalculator SHALL recompute the perimeter, area, per-side lengths, and Scaffold_Length from the edited polygon through the Geometry_Engine and SHALL treat the edited polygon as the current building perimeter, superseding the AI-drawn polygon.
4. THE AI_Agent SHALL write building geometry to the Project_State only as a Perimeter_Polygon or facade selection submitted through a Geometry_Tool.
5. THE AI_Agent SHALL obtain every measurement, Scaffold_Length, and Material_List quantity it presents only as a deterministic output of the Geometry_Engine or the calculation engines, with no rounding, scaling, or other transformation applied to the obtained value.
6. IF an AI-produced value would set a measurement, Scaffold_Length, or material quantity directly rather than through the deterministic engines, THEN THE AI_Agent SHALL reject the entire operation, applying no partial update, and SHALL preserve the complete existing Project_State.
7. IF a committed user edit produces a Perimeter_Polygon that has fewer than 3 distinct vertices, is not a closed ring, or has self-intersecting sides, THEN THE StillasCalculator SHALL reject the edit, retain the last valid Perimeter_Polygon and its derived measurements in the Project_State, and indicate to the user that the edit was rejected.

### Requirement 9: Codex SDK Sandbox and Safety for Tool Execution

**User Story:** As the product owner, I want the Codex backend to stay sandboxed while it uses tools, so that giving the assistant tools never gives the model the local machine.

#### Acceptance Criteria

1. WHILE the Codex_Provider is active, THE AI_Agent SHALL run the Codex model with filesystem access restricted to read-only (`sandboxMode: 'read-only'`), automatic command approval disabled (`approvalPolicy: 'never'`), direct model network access disabled (`networkAccessEnabled: false`), and web search disabled (`webSearchMode: 'disabled'`), and SHALL treat any configuration that satisfies fewer than all four of these restrictions as non-compliant.
2. THE AI_Agent SHALL mediate every external effect available to the Codex model — geometry changes, Project_State updates, footprint retrieval, geocoding, calculation, drawing, and CAD export — exclusively through the deterministic Tool_Dispatch served by the MCP_Server.
3. WHEN any AI_Provider supplies tool arguments, THE AI_Agent SHALL treat the arguments as untrusted input and SHALL validate them against the tool's defined JSON Schema before execution, admitting to the Tool_Dispatch only arguments that fully conform to that schema.
4. THE OpenAI_Provider agent loop SHALL bound the number of tool round-trips to a fixed maximum of 8 per request (`MAX_TOOL_ITERATIONS` in `lib/ai/openAiAgentLoop.ts`), and THE AI_Agent SHALL guarantee an equivalent fixed upper bound on tool round-trips for the Codex_Provider so that neither provider can exceed the bound within the Request_Deadline.
5. IF tool arguments from any AI_Provider fail JSON Schema validation or cannot be parsed, THEN THE AI_Agent SHALL reject the tool call without executing the tool, return an error to the model that identifies the rejected tool call, and leave the Project_State unchanged.
6. WHEN the number of tool round-trips in a request reaches the fixed maximum, THE AI_Agent SHALL stop dispatching further tool calls for that request, return the result produced so far to the client, and apply no further Project_State change.

### Requirement 10: Request Deadline and Project_State Preservation

**User Story:** As a user, I want AI requests to fail safely within a bounded time on every backend, so that a slow or failing model never hangs the app or corrupts my project.

#### Acceptance Criteria

1. THE AI_Agent SHALL bound every AI request to the Request_Deadline (currently 45 seconds, configured as `REQUEST_TIMEOUT_MS` for the OpenAI path and `DEFAULT_CODEX_TIMEOUT_MS`/`STILLAS_CODEX_TIMEOUT_MS` for the Codex path), measured from receipt of the request through completion of all tool round-trips, applied with the same configured value for the OpenAI_Provider and the Codex_Provider.
2. IF an AI request fails due to a provider error, a network failure, or an unhandled exception, THEN THE AI_Agent SHALL return an error indication to the client and SHALL preserve the Project_State except for the validated Geometry_Tool and stateful-tool updates already applied through the validated Plan_Updater within that request.
3. IF an AI request does not complete within the Request_Deadline, THEN THE AI_Agent SHALL terminate the request, return a timeout indication to the client, apply no Project_State change after the deadline, and preserve every value already validly stored before the deadline.
4. WHEN an AI request fails or times out, THE AI_Agent SHALL return a result that the client adapter normalizes into the existing `error`/`timedOut` outcome shape identically for the OpenAI_Provider and the Codex_Provider.

### Requirement 11: AI Provider Availability Handling

**User Story:** As a user, I want the app to keep working and tell me clearly when no AI backend is available, so that AI configuration never blocks the rest of the calculator.

#### Acceptance Criteria

1. IF neither a configured non-empty server-side OpenAI API key nor an authenticated Codex/ChatGPT login session is available, THEN THE StillasCalculator SHALL continue to operate all non-AI features and SHALL present a persistent visible indication in the AI_Agent interface that the AI_Agent is unavailable.
2. IF the configured AI_Provider preference selects the Codex_Provider and no authenticated Codex/ChatGPT login session is available, THEN THE AI_Agent SHALL return an unavailable indication, distinct from the error and timeout outcomes of Requirement 10, rather than an error.
3. WHILE exactly one AI_Provider is available, WHEN the AI_Agent receives a request, THE AI_Agent SHALL fulfill it through the available AI_Provider with access to every Application_Tool defined in Requirements 1 and 2.
4. THE StillasCalculator SHALL keep all AI provider credentials server-side and SHALL NOT expose any AI provider credential to the frontend.
5. WHILE both AI_Providers are available, WHEN the AI_Agent receives a request, THE AI_Agent SHALL select the AI_Provider named by the configured AI_Provider preference (`getAiProviderPreference`) and SHALL fulfill the request through it with access to every Application_Tool defined in Requirements 1 and 2.
6. IF the availability of an AI_Provider cannot be determined within 5 seconds, THEN THE AI_Agent SHALL treat that AI_Provider as unavailable.

### Requirement 12: Geometry Tool Argument Round-Trip Integrity

**User Story:** As a user, I want the polygons the assistant passes around to survive the trip through the tool boundary without distortion, so that the building it draws is the building it measures.

#### Acceptance Criteria

1. WHEN a Geometry_Tool receives building geometry expressed as an ordered list of [longitude, latitude] coordinate pairs, THE AI_Agent SHALL convert the coordinates into a closed GeoJSON Perimeter_Polygon ring by appending a copy of the first coordinate pair as the final coordinate pair when the first and last pairs are not already numerically identical, and SHALL pass the resulting ring to the Geometry_Engine validation step before storing it.
2. WHEN a Geometry_Tool serializes a stored Perimeter_Polygon for return to the model, THE AI_Agent SHALL emit the same ordered [longitude, latitude] coordinate pairs that define the stored ring, with each emitted numeric value identical to the corresponding stored value and with no rounding, truncation, scaling, reprojection, or reordering.
3. WHEN a coordinate list whose first and last coordinate pairs are already numerically identical is converted, THE AI_Agent SHALL produce a ring whose coordinate pairs are identical to the input coordinate pairs and SHALL NOT append any additional closing coordinate pair.
4. WHEN converting any coordinate list, THE AI_Agent SHALL preserve every input coordinate value exactly, including when the list forms geometry the Geometry_Engine would reject (fewer than 3 distinct vertices, not a closed ring, or self-intersecting sides per Requirement 6.4), deferring rejection of such malformed geometry to the Geometry_Engine validation step.
5. WHEN a stored valid Perimeter_Polygon (one accepted by the Geometry_Engine per Requirement 6.4) is serialized for return to the model and that serialized form is parsed back into a polygon, THE AI_Agent SHALL produce a polygon whose Geometry_Engine measurements — perimeter, area, per-side lengths, and Scaffold_Length — are each numerically identical to the corresponding measurement of the original stored polygon.
6. IF a Geometry_Tool receives a coordinate list containing more than 10,000 coordinate pairs, or a coordinate pair that is not exactly two finite numeric values, THEN THE AI_Agent SHALL reject the input, return an error to the model identifying the malformed coordinate input, and leave the Project_State unchanged.

## Correctness Properties

These properties are candidates for verification. Each notes whether it suits property-based testing (PBT) or is better covered by example/integration tests, per the project's testing guidance (PBT is for input-varying logic in our own code; external services, fixed configuration, and one-shot behavior use example/integration tests).

- **Property A — Provider-agnostic dispatch equivalence (Req 1.2, 1.3, 2.1).** For any defined tool name, any schema-valid arguments, and any Project_State, executing the Tool_Dispatch yields the same Tool_Result regardless of which AI_Provider label is attached. *PBT* over generated tool names, arguments, and `ScaffoldPlan` snapshots, asserting equality of the dispatch result.
- **Property B — Unknown tool is inert (Req 1.4, 9.5).** For any tool name not in the Application_Tool set and any arguments, the Tool_Dispatch returns an error naming the tool and the Project_State is byte-for-byte unchanged. *PBT* over generated unknown names and arbitrary argument objects.
- **Property C — Field validation is total and state-preserving across providers (Req 3.1, 3.2, 3.5).** For any value supplied to a stateful tool, the value is accepted iff it satisfies the field's validation rule; on rejection the prior valid value is retained and the rest of Project_State is untouched. *PBT* over generated in-range and out-of-range values for each stateful field, run identically against the `createControllerPlanContext` and `createFilePlanContext` Plan_Updaters.
- **Property D — No fabricated quantities (Req 2.5, 3.3, 7.3).** Every scaffold quantity or measurement the AI_Agent presents equals a value present in an executed Tool_Result / Geometry_Engine output for the same inputs. *PBT* at the boundary that maps engine output to presented values, asserting value equality (no rounding/scaling).
- **Property E — Structured output conformance gate (Req 4.1, 4.2).** For any candidate Structured_Output, the AI_Agent presents it iff it validates against the strict schema; a nonconforming candidate is rejected and Project_State is preserved. *PBT* over generated conforming and mutated-nonconforming candidates against `validateAgainstSchema` (reuses the existing structured-output property harness).
- **Property F — Perimeter validation gate (Req 6.1, 6.4).** For any coordinate list, `setBuildingPerimeter` stores a perimeter iff the Geometry_Engine validates it (closed ring, ≥3 distinct vertices, no self-intersection); otherwise the last valid perimeter is retained. *PBT* over generated valid polygons and degenerate/self-intersecting inputs.
- **Property G — Coordinate-to-ring closing is idempotent (Req 12.1, 12.3).** Closing a ring that is already closed returns equal coordinates, and closing twice equals closing once. *PBT* over generated coordinate lists.
- **Property H — Geometry tool round-trip preserves measurements (Req 12.5).** For all valid Perimeter_Polygons, measuring the polygon obtained by parsing the serialized form of a stored perimeter equals measuring the original. *PBT* over generated valid polygons; this is the parser/serializer round-trip required for geometry passed across the tool boundary.
- **Property I — AI-drawn geometry equals manually-drawn geometry in the pipeline (Req 7.1, 8.1, 8.3).** For any valid polygon, storing it via the `setBuildingPerimeter` Geometry_Tool and storing it via the manual `setPerimeter` path yield identical measurements and Scaffold_Length. *PBT* over generated valid polygons, asserting equality of the two state results.
- **Property J — AI cannot write derived values directly (Req 8.4, 8.5).** No Application_Tool in `createToolDispatch` sets measurements, Scaffold_Length, or material quantities except as a deterministic engine output. *Example/structural test* enumerating the dispatch table (behavior does not vary with input).
- **Property K — Request deadline and state preservation (Req 10.1, 10.2, 10.3).** A request that exceeds the Request_Deadline returns a timeout outcome and applies no further state change. *Example/integration test* with a stubbed slow provider against the configured 45-second deadline (the deadline is fixed, so a small number of representative cases suffices; not input-varying).
- **Property L — Codex sandbox flags (Req 9.1, 9.2).** While the Codex_Provider is active, the Codex thread runs with `sandboxMode: 'read-only'`, `approvalPolicy: 'never'`, `networkAccessEnabled: false`, and `webSearchMode: 'disabled'`, and external effects flow only through the MCP_Server's Tool_Dispatch. *Example/integration test* asserting the `runCodexAgentWithTools` thread configuration and that the dispatch is the sole effect path (fixed configuration; not PBT).
- **Property M — Footprint retrieval fallback (Req 5.4, 5.5, 5.7).** When `retrieveBuildingFootprints` geocoding fails or Overpass returns empty/fails/times out, the AI_Agent surfaces the appropriate fallback signal and preserves Project_State. *Example/integration test* with stubbed Geocoding/Overpass empty/error/timeout responses (testing the external service contract; not PBT).
- **Property N — Availability signalling (Req 11.1, 11.2).** When no provider is usable, the route returns the unavailable signal and non-AI features are unaffected. *Example/integration test* over the small set of provider-preference/credential combinations.
- **Property O — Single tool-enabled Codex path (Req 2.7).** No reachable Codex_Provider chat path calls the legacy tool-less `runCodexSdkChat`; the only Codex chat entry point is `runCodexAgentWithTools`, while `getCodexCliAuthStatus`/`startCodexChatGptSignIn` remain available. *Example/structural test* asserting the chat route and Codex adapter wiring (fixed wiring; not PBT).
