# Requirements Document

## Introduction

StillasCalculator is a responsive web application (iPhone, Android, and desktop browsers) and installable PWA for estimating scaffolding (stillas) material needs around a building or a selected facade. The user searches for an address, views the location on an open-source map, fetches building footprints from OpenStreetMap, selects or manually draws the building perimeter, and computes perimeter, area, and side lengths. The user then selects a scaffold system and enters working parameters, and the application produces a deterministic estimate of bays, levels, and a material list. An integrated AI Assistant helps the user complete missing data and triggers calculations, but performs no math itself — all quantities come from deterministic internal functions. Reports are exportable as PDF and CSV, and every output carries a professional-verification disclaimer.

The application uses an open-source stack only: Next.js, React, TypeScript, Tailwind CSS, MapLibre GL JS, OpenFreeMap, Photon (with Nominatim fallback), Overpass API, and Turf.js. No Google Maps or paid map APIs are used, and the OpenAI API key remains server-side only.

This document organizes requirements so they map cleanly to the phased task plan in `mainidea.md`. Each requirement is annotated with the corresponding plan phase.

## Glossary

- **StillasCalculator**: The complete responsive web application and PWA described in this document.
- **Map_System**: The component responsible for rendering the interactive map using MapLibre GL JS with OpenFreeMap tiles.
- **Geocoding_Service**: The server-side service that resolves address text to coordinates using Photon, with Nominatim as a fallback provider.
- **Overpass_Service**: The server-side service that queries the Overpass API for OpenStreetMap building footprints near a coordinate and returns GeoJSON.
- **Polygon_Editor**: The component that lets the user select, draw, edit, and reset a building perimeter polygon (MapLibre Geoman or equivalent), usable via touch and pointer input.
- **Geometry_Engine**: The deterministic module (`lib/geometry/turfMeasurements.ts`) that computes perimeter, area, and side lengths from a GeoJSON polygon using Turf.js.
- **Scaffold_Library**: The data model and module (`lib/scaffold/scaffoldSystems.ts`, `data/scaffold-systems.json`) defining available scaffold systems and their editable dimensions.
- **Scaffold_Calculator**: The deterministic calculation engine (`lib/scaffold/scaffoldCalculator.ts`, `lib/scaffold/materialRules.ts`) that computes scaffold length, bays, levels, and the material list.
- **Material_List**: The structured list of estimated scaffold components, each with item name, quantity, unit, and optional notes.
- **AI_Assistant**: The in-app chat assistant backed by the OpenAI Responses API that helps the user via function/tool calling and Structured Outputs.
- **Report_Module**: The component that generates PDF and CSV reports (`lib/export/pdfExport.ts`, `lib/export/csvExport.ts`).
- **Working_Height**: The vertical working height of the scaffold in meters, entered by the user.
- **Bay_Length**: The horizontal length of a single scaffold bay in meters.
- **Lift_Height**: The vertical height of a single scaffold lift (level) in meters.
- **Scaffold_Width**: The depth/width of the scaffold in meters.
- **Waste_Factor**: A user-configurable percentage added to the scaffold length to account for waste and adjustment.
- **Scaffold_Length**: The total run length of scaffold derived from the selected perimeter or facade(s), in meters.
- **Project_State**: The in-memory and persisted set of current values (address, selected polygon, measurements, scaffold system, inputs, results) for the active session.
- **PWA**: Progressive Web App — the installable form of StillasCalculator with a web app manifest and app icon.
- **Verification_Disclaimer**: The fixed statement that outputs are estimated planning figures requiring professional verification and that anchors/wall ties must be verified manually.

## Requirements

### Requirement 1: Application Shell and Responsive Layout
_(Plan Phase 1 — Project setup)_

**User Story:** As a user on a phone or desktop, I want a responsive layout that adapts to my screen, so that I can use every feature comfortably on any device.

#### Acceptance Criteria

1. THE StillasCalculator SHALL render its layout across the inclusive viewport-width range 320 to 1920 pixels without horizontal scrolling and without content overflow, clipping, or overlapping controls.
2. WHILE the viewport width is within the inclusive range 320 to 767 pixels, THE StillasCalculator SHALL present navigation and content in a single-column, mobile-optimized arrangement, presenting secondary panels as a bottom sheet that the user can open and dismiss.
3. WHILE the viewport width is 768 pixels or greater, THE StillasCalculator SHALL present the map and side panels as a multi-pane arrangement with the panes visible simultaneously without navigating away from the page.
4. WHEN the viewport width crosses the 768 pixel breakpoint, THE StillasCalculator SHALL switch between the mobile and desktop arrangements while preserving current page state, including entered inputs and the selected map location.
5. THE StillasCalculator SHALL provide a primary calculator page that exposes access to the map, scaffold inputs, material list, AI assistant, and export actions.
6. THE StillasCalculator SHALL be implemented using Next.js, React, TypeScript, and Tailwind CSS.

### Requirement 2: Interactive Open-Source Map
_(Plan Phase 2 — Map system)_

**User Story:** As a user, I want to see my location on an interactive open-source map, so that I can visually confirm the building I want to measure.

#### Acceptance Criteria

1. WHEN the map view loads, THE Map_System SHALL render an interactive map using MapLibre GL JS with OpenFreeMap tile styles.
2. THE Map_System SHALL provide zoom and pan navigation controls.
3. WHEN a location is selected by the user, THE Map_System SHALL place a single marker at the selected coordinate, replacing any previous marker, and center the map so the marker sits at the center of the visible viewport.
4. WHILE the viewport width is below 768 pixels, THE Map_System SHALL provide a toggle control for a full-screen map mode that occupies 100 percent of the viewport width and height.
5. THE StillasCalculator SHALL NOT use Google Maps or any paid map service for tiles, geocoding, or routing.
6. IF map tiles fail to load, THEN THE Map_System SHALL display an error indication and provide a retry control.

### Requirement 3: Address Search and Geocoding
_(Plan Phase 3 — Address search)_

**User Story:** As a user, I want to search for an address and pick a result, so that the map moves to the building I want to work on.

#### Acceptance Criteria

1. WHEN the user has typed at least 3 characters into the address search input and no further input occurs for 300 milliseconds, THE Geocoding_Service SHALL request matching address suggestions from Photon.
2. IF the address search input contains fewer than 3 characters, THEN THE StillasCalculator SHALL clear any displayed suggestions and SHALL NOT issue a geocoding request.
3. WHEN the Geocoding_Service returns suggestions, THE StillasCalculator SHALL display up to the first 5 suggestions in a selectable results list.
4. WHEN the user selects an address suggestion, THE Map_System SHALL center the map on the selected coordinate.
5. WHEN the user selects an address suggestion, THE Map_System SHALL place a single marker at the selected coordinate, replacing any previous search marker.
6. IF the Photon request returns no results, returns an error response, or does not respond within 5 seconds, THEN THE Geocoding_Service SHALL retry the query exactly once using the Nominatim fallback provider.
7. IF both Photon and Nominatim fail to return results, THEN THE StillasCalculator SHALL display a message stating that no matching address was found and SHALL preserve the current map view and existing marker.
8. THE Geocoding_Service SHALL limit outbound geocoding requests to at most 1 request per 300 milliseconds per session.
9. THE Geocoding_Service SHALL execute all geocoding requests server-side through Next.js API routes.

### Requirement 4: Building Footprint Lookup
_(Plan Phase 4 — Building footprint lookup)_

**User Story:** As a user, I want the app to fetch nearby building outlines from OpenStreetMap, so that I can pick the correct building instead of drawing it by hand.

#### Acceptance Criteria

1. WHEN a coordinate is selected, THE Overpass_Service SHALL query the Overpass API for building ways and relations within a 50 meter radius of that coordinate, using a request timeout of 25 seconds.
2. WHEN the Overpass_Service receives a response, THE Overpass_Service SHALL convert the OpenStreetMap result into GeoJSON polygon features.
3. WHEN building polygons are available, THE Map_System SHALL render the nearby building polygons with a fill and outline style visually distinguishable from the base map.
4. WHEN the user taps or clicks a building polygon, THE StillasCalculator SHALL set that polygon as the single selected building and deselect any previously selected building.
5. IF the Overpass request fails with a network error, a non-success response, or a timeout, THEN THE StillasCalculator SHALL display an error message, offer the manual drawing option, and retain the selected coordinate.
6. IF the Overpass_Service returns no building polygons within the radius, THEN THE StillasCalculator SHALL display a message offering manual drawing of the perimeter.
7. THE Overpass_Service SHALL execute all Overpass requests server-side through Next.js API routes.
8. WHEN a building is selected, THE Map_System SHALL render the selected polygon visually distinct from unselected building polygons.

### Requirement 5: Manual Polygon Drawing and Editing
_(Plan Phase 5 — Polygon drawing/editing)_

**User Story:** As a user, I want to draw or adjust the building perimeter by hand, so that I can correct inaccurate footprints or measure buildings missing from OpenStreetMap.

#### Acceptance Criteria

1. THE Polygon_Editor SHALL allow the user to draw a closed perimeter polygon of at least 3 vertices by placing vertices on the map.
2. THE Polygon_Editor SHALL allow the user to move existing polygon vertices to edit the perimeter.
3. THE Polygon_Editor SHALL allow the user to reset the current polygon, clearing all vertices and returning the editor to an empty state with no perimeter stored in the Project_State.
4. WHEN the user selects an OpenStreetMap building polygon, THE Polygon_Editor SHALL load that polygon as an editable perimeter with movable vertices.
5. WHEN the user completes or edits a polygon that has at least 3 vertices and no self-intersecting sides, THE StillasCalculator SHALL store the perimeter as a closed GeoJSON polygon in the Project_State.
6. THE Polygon_Editor SHALL support drawing and editing the perimeter using touch input on iPhone and Android touch screens, including placing vertices and moving existing vertices.
7. IF the user attempts to complete a polygon with fewer than 3 vertices, THEN THE Polygon_Editor SHALL prevent completion, SHALL NOT store the polygon in the Project_State, and SHALL display a message indicating that a perimeter requires at least 3 vertices.
8. IF a completed or edited polygon contains self-intersecting sides, THEN THE Polygon_Editor SHALL reject the polygon, SHALL NOT store it in the Project_State, and SHALL display a message indicating that the perimeter sides must not cross.

### Requirement 6: Geometry Measurement
_(Plan Phase 6 — Geometry measurement)_

**User Story:** As a user, I want to see the perimeter, area, and side lengths of my polygon, so that I know the dimensions feeding the scaffold calculation.

#### Acceptance Criteria

1. WHEN a valid perimeter polygon (a closed ring of at least 3 distinct vertices with no self-intersecting sides) exists in the Project_State, THE Geometry_Engine SHALL calculate the polygon perimeter in meters using Turf.js.
2. WHEN a valid perimeter polygon exists in the Project_State, THE Geometry_Engine SHALL calculate the enclosed area in square meters using Turf.js.
3. WHEN a valid perimeter polygon exists in the Project_State, THE Geometry_Engine SHALL calculate the length in meters of each side of the polygon.
4. WHEN the polygon is created or edited, THE StillasCalculator SHALL update the displayed perimeter, area, and side-length measurements to reflect the current polygon within 500 milliseconds.
5. THE StillasCalculator SHALL allow the user to configure the number of decimal places used when displaying measurements within the inclusive range 0 to 3, defaulting to 2.
6. THE StillasCalculator SHALL allow the user to set a Waste_Factor as a percentage within the inclusive range 0 to 100, defaulting to 0.
7. WHERE the user selects a subset of polygon sides as the target facade(s), THE Geometry_Engine SHALL compute the Scaffold_Length as the sum of the selected side lengths.
8. WHERE no facade subset is selected, THE Geometry_Engine SHALL compute the Scaffold_Length as the full polygon perimeter.
9. WHERE the selected facade sides sum to 0 meters, THE Geometry_Engine SHALL report a Scaffold_Length of 0 meters.
10. IF a polygon in the Project_State is invalid, THEN THE Geometry_Engine SHALL skip measurement, display an error indication, and retain the last valid measurements.
11. IF a user-entered Waste_Factor is non-numeric or outside the inclusive range 0 to 100, THEN THE StillasCalculator SHALL reject the value, retain the last valid Waste_Factor, and display a validation message.

### Requirement 7: Scaffold System Library
_(Plan Phase 7 — Scaffold system library)_

**User Story:** As a user, I want to choose a scaffold system and adjust its dimensions, so that the estimate reflects the equipment I will actually use.

#### Acceptance Criteria

1. THE Scaffold_Library SHALL provide exactly the following selectable scaffold systems: Generic Frame, HAKI placeholder, Layher placeholder, Instant/Alufase placeholder, and Custom Dimensions.
2. WHEN the user selects a scaffold system, THE StillasCalculator SHALL load that system's default Bay_Length, Scaffold_Width, and Lift_Height into the Project_State.
3. THE StillasCalculator SHALL allow the user to edit the Bay_Length, Scaffold_Width, and Lift_Height for the selected scaffold system, each constrained to greater than 0 and at most 100 meters.
4. WHEN a placeholder scaffold system is selected, THE StillasCalculator SHALL display a notice that its values are non-certified placeholders.
5. WHERE the user selects Custom Dimensions, IF Bay_Length, Scaffold_Width, or Lift_Height is absent when a calculation is requested, THEN THE StillasCalculator SHALL reject the calculation and display a message identifying each missing dimension.
6. WHERE the user selects Custom Dimensions, IF an entered Bay_Length, Scaffold_Width, or Lift_Height is less than or equal to 0 or greater than 100 meters, THEN THE StillasCalculator SHALL reject the value, retain the previous valid value in the Project_State, and display a validation message identifying the invalid dimension.

### Requirement 8: Scaffold Input Parameters
_(Plan Phase 8 — Scaffold calculator engine, inputs)_

**User Story:** As a user, I want to enter the working height and scaffold dimensions, so that the calculator has the values it needs.

#### Acceptance Criteria

1. THE StillasCalculator SHALL allow the user to enter the Working_Height as a numeric value in meters within the inclusive range 0.01 to 100.
2. THE StillasCalculator SHALL allow the user to enter or confirm the Bay_Length, Lift_Height, and Scaffold_Width as numeric values in meters, each within the inclusive range 0.01 to 5.
3. IF the user submits a Working_Height, Bay_Length, Lift_Height, or Scaffold_Width that is non-numeric or outside its defined inclusive range, THEN THE StillasCalculator SHALL reject the input, retain the last valid value for that field, and display a validation message identifying the invalid field and its permitted range.
4. IF a calculation is requested while Scaffold_Length, Working_Height, Bay_Length, or Lift_Height is empty or unset, THEN THE StillasCalculator SHALL display a message identifying each missing value and SHALL NOT produce a Material_List.

### Requirement 9: Deterministic Scaffold Calculation
_(Plan Phase 8 — Scaffold calculator engine, computation)_

**User Story:** As a user, I want the app to calculate bays, levels, and total scaffold length deterministically, so that the same inputs always give the same trustworthy result.

#### Acceptance Criteria

1. WHEN a calculation is requested with valid inputs (Scaffold_Length, Working_Height, Bay_Length, and Lift_Height all present, with Scaffold_Length, Bay_Length, and Lift_Height greater than 0), THE Scaffold_Calculator SHALL compute the adjusted length in meters as Scaffold_Length multiplied by (1 + Waste_Factor / 100), applying a Waste_Factor of 0 when no Waste_Factor is set and treating Waste_Factor as a percentage between 0 and 100.
2. WHEN a calculation is requested with valid inputs, THE Scaffold_Calculator SHALL compute the number of bays as the smallest whole number greater than or equal to the adjusted length divided by Bay_Length, expressed as a positive integer.
3. IF a calculation is requested while Bay_Length or Lift_Height is less than or equal to 0, THEN THE Scaffold_Calculator SHALL reject the request with an invalid-input error indication identifying the offending value, SHALL NOT produce a Material_List, and SHALL leave the Project_State values unchanged.
4. WHEN a calculation is requested with valid inputs, THE Scaffold_Calculator SHALL compute the number of levels as the smallest whole number greater than or equal to Working_Height divided by Lift_Height, expressed as a positive integer.
5. WHEN given identical input values, THE Scaffold_Calculator SHALL produce identical outputs on every invocation, independent of session, device, or invocation count.
6. WHEN a calculation completes with valid inputs, THE Scaffold_Calculator SHALL return structured output containing the total Scaffold_Length in meters, the number of bays, the number of levels, the Material_List, and any warnings.
7. IF a calculation is requested while Scaffold_Length is less than or equal to 0, THEN THE Scaffold_Calculator SHALL reject the request with an invalid-input error indication, SHALL NOT produce a Material_List, and SHALL leave the Project_State values unchanged.

### Requirement 10: Estimated Material List Generation
_(Plan Phase 8 — Scaffold calculator engine, material rules)_

**User Story:** As a user, I want an estimated list of scaffold components with quantities, so that I can plan procurement.

#### Acceptance Criteria

1. WHEN a calculation completes, THE Scaffold_Calculator SHALL produce a Material_List containing a separate line item for each of the following components: frames/standards, base plates, adjustable base jacks, ledgers/horizontals, platforms/decks, guardrails, toe boards, diagonal braces, and ladders/access.
2. THE Scaffold_Calculator SHALL include each Material_List item with a non-empty item name, a quantity that is a non-negative whole number, and a non-empty unit label.
3. WHEN a calculation completes, THE Scaffold_Calculator SHALL include a wall ties/anchors line item in the Material_List carrying a note that the quantity must be verified manually.
4. THE Scaffold_Calculator SHALL derive all Material_List quantities from the deterministic rules in `lib/scaffold/materialRules.ts` using the computed bays and levels.
5. IF a required input for a quantity rule is missing or invalid, THEN THE Scaffold_Calculator SHALL add a warning to the calculation output identifying the affected item and the missing or invalid input.
6. WHERE some quantities cannot be derived, THE Scaffold_Calculator SHALL still return the Material_List with all derivable items included.

### Requirement 11: Material List Display and Adjustment
_(Plan Phase 9 — Material list UI)_

**User Story:** As a user, I want to view and fine-tune the material list, so that I can match it to real-world availability.

#### Acceptance Criteria

1. WHEN a Material_List is available, THE StillasCalculator SHALL display each item's name, quantity, and unit, and SHALL display notes only for items that have notes.
2. WHILE the viewport width is below 768 pixels, THE StillasCalculator SHALL present the Material_List as cards rather than a wide table.
3. THE StillasCalculator SHALL allow the user to manually adjust the quantity of any Material_List item to an integer value within the inclusive range 0 to 999999.
4. WHEN the user manually adjusts a quantity to a valid value, THE StillasCalculator SHALL retain the adjusted value in the Project_State for display and export.
5. WHEN a Material_List is available, THE StillasCalculator SHALL display a calculation summary showing Scaffold_Length in meters, the number of bays as a whole number, and the number of levels as a whole number.
6. IF the user enters a non-integer, negative, or out-of-range quantity, THEN THE StillasCalculator SHALL reject the value, retain the prior quantity, and display a validation message identifying the invalid item.
7. WHEN a new calculation completes, THE StillasCalculator SHALL replace previously manually adjusted quantities with the newly computed quantities.

### Requirement 12: AI Assistant Conversation
_(Plan Phase 10 — AI Assistant, conversation)_

**User Story:** As a user, I want to chat with an assistant to complete missing data and request calculations, so that I can work conversationally instead of filling every field manually.

#### Acceptance Criteria

1. THE AI_Assistant SHALL provide a chat panel where the user can send messages of up to 2000 characters and view assistant responses in chronological order.
2. WHEN the user sends a message, THE AI_Assistant SHALL request a response from the OpenAI Responses API through a server-side Next.js API route.
3. WHILE an AI_Assistant request is in flight, THE AI_Assistant SHALL display a progress indicator and SHALL disable sending of additional messages.
4. WHEN the user provides a value such as Working_Height or scaffold system in a message, THE AI_Assistant SHALL update the corresponding Project_State value through a tool call.
5. IF a value provided through an AI_Assistant tool call is invalid (less than or equal to 0 or otherwise failing the field validation defined in Requirements 7 and 8), THEN THE AI_Assistant SHALL reject the value and preserve the existing Project_State.
6. THE StillasCalculator SHALL keep the OpenAI API key on the server and SHALL NOT expose the OpenAI API key to the frontend.
7. IF no OpenAI API key is configured on the server, THEN THE StillasCalculator SHALL continue to operate all non-AI features and SHALL display a message that the AI_Assistant is unavailable.
8. IF the OpenAI request fails or does not respond within 30 seconds, THEN THE AI_Assistant SHALL display an error indication and SHALL preserve the existing Project_State values.

### Requirement 13: AI Assistant Deterministic Tool Calling
_(Plan Phase 10 — AI Assistant, tool calling and structured outputs)_

**User Story:** As a user, I want the assistant to compute quantities only through the real calculator, so that I can trust that figures are never invented by the model.

#### Acceptance Criteria

1. WHEN the AI_Assistant needs scaffold quantities, THE AI_Assistant SHALL obtain them by calling the deterministic function calculateScaffoldMaterials, and SHALL NOT present any quantity that did not originate from a tool call result.
2. THE AI_Assistant SHALL expose tool/function calls for calculateScaffoldMaterials, getSelectedBuildingMeasurements, getAvailableScaffoldSystems, updateWorkingHeight, generateMaterialList, and generateReportSummary.
3. WHEN the AI_Assistant returns a Material_List or report summary, THE AI_Assistant SHALL format the output using OpenAI Structured Outputs conforming to the defined JSON schema.
4. IF tool-call output does not conform to the defined JSON schema, THEN THE AI_Assistant SHALL reject the output, display an error indication, and preserve the existing Project_State.
5. IF a tool call returns an error or missing/incomplete data, THEN THE AI_Assistant SHALL identify the specific missing or failed value, request it from the user, and SHALL NOT fabricate or substitute a value.
6. THE AI_Assistant SHALL present quantities in chat exactly equal to the values returned by the deterministic Scaffold_Calculator for the same inputs, with no rounding, scaling, or other transformation.

### Requirement 14: PDF and CSV Report Export
_(Plan Phase 11 — Export)_

**User Story:** As a user, I want to export a PDF and CSV report, so that I can share and archive the estimate.

#### Acceptance Criteria

1. WHEN the user requests a PDF export and a Material_List exists in the Project_State, THE Report_Module SHALL generate a PDF document containing the address, the computed perimeter in meters, the selected scaffold system, and the Material_List item quantities currently stored in the Project_State, and SHALL make the generated PDF available to the user for download.
2. WHEN the user requests a CSV export and a Material_List exists in the Project_State, THE Report_Module SHALL generate a CSV file containing one row per Material_List item with item name, quantity, and unit columns, using the item quantities currently stored in the Project_State, and SHALL make the generated CSV file available to the user for download.
3. THE Report_Module SHALL include the Verification_Disclaimer in every exported PDF report.
4. IF a report export is requested while no Material_List exists in the Project_State, THEN THE StillasCalculator SHALL display a message stating that a calculation must be completed before export and SHALL NOT produce a PDF or CSV file.
5. WHERE the address exists in the Project_State, THE Report_Module SHALL include the address in the exported report independently of whether a perimeter has been computed.
6. WHERE an AI-generated summary exists in the Project_State, THE Report_Module SHALL include that AI-generated summary in the exported PDF document.
7. IF generation of a requested PDF or CSV export fails, THEN THE Report_Module SHALL display an error message indicating that the export could not be completed and SHALL preserve the existing Project_State values.

### Requirement 15: Safety and Legal Disclaimer
_(Plan Phase 8/11 — Safety/legal rule)_

**User Story:** As a user and as the product owner, I want every output to be clearly labeled as an estimate requiring professional verification, so that the app is not mistaken for a certified engineering approval.

#### Acceptance Criteria

1. WHEN the material list view is displayed, THE StillasCalculator SHALL show the Verification_Disclaimer within the visible content without requiring navigation to a separate screen.
2. WHEN a PDF report is exported, THE Report_Module SHALL include the Verification_Disclaimer in the PDF.
3. WHEN a CSV report is exported, THE Report_Module SHALL include the Verification_Disclaimer in the CSV.
4. THE Verification_Disclaimer SHALL state that the output is an estimated planning report that requires professional verification before use.
5. THE Verification_Disclaimer SHALL state that wall ties and anchors must be verified manually.
6. THE StillasCalculator SHALL describe outputs on the material list view and in exported reports using planning-estimate terminology and SHALL NOT describe a scaffold as certified, approved, or safe for use.

### Requirement 16: Installable PWA and Mobile Optimization
_(Plan Phase 12 — Responsive/PWA)_

**User Story:** As a mobile user, I want to install the app to my home screen and use it smoothly on my phone, so that it behaves like a native app in the field.

#### Acceptance Criteria

1. THE StillasCalculator SHALL provide a web app manifest specifying a name, a start URL, a standalone display mode, and app icons of 192x192 and 512x512 pixels.
2. WHEN the application is loaded over HTTPS in iPhone Safari or Android Chrome, THE StillasCalculator SHALL be installable to the device home screen and SHALL launch in a standalone window without browser chrome once installed.
3. THE StillasCalculator SHALL render and function at viewport widths down to 320 pixels without horizontal scrolling and without clipping of interactive controls.
4. THE StillasCalculator SHALL support completing the map drawing and report export workflows using single-finger touch input with touch targets of at least 44x44 CSS pixels.
5. IF the browser does not support PWA installation, THEN THE StillasCalculator SHALL continue to operate as a responsive web app without blocking non-installation features.

### Requirement 17: Session State Persistence
_(Plan Phase 1/6 — Project_State continuity)_

**User Story:** As a user, I want my current work to stay intact as I move between map, calculator, and assistant, so that I do not lose progress.

#### Acceptance Criteria

1. THE StillasCalculator SHALL maintain exactly one Project_State record, used as the single source of truth, containing the selected address, perimeter polygon, measurements, selected scaffold system, input parameters, and calculation results.
2. WHEN any input or selection changes, THE StillasCalculator SHALL update the Project_State and propagate values identical to the Project_State to the map, calculator, material list, AI assistant, and export views within 1 second.
3. WHEN a value is changed through the AI_Assistant, THE StillasCalculator SHALL reflect the change in the corresponding manual input control within 1 second.
4. WHEN the user navigates between the map, calculator, and assistant views, THE StillasCalculator SHALL retain all Project_State values without loss.
5. IF a Project_State update fails, THEN THE StillasCalculator SHALL retain the last valid state and display an error indication.
