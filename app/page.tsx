import { StillasCalculatorApp } from "@/components/StillasCalculatorApp";

/**
 * Primary calculator page (Req 1.5). This is a thin server entry that renders
 * the `'use client'` {@link StillasCalculatorApp} container, which wires the
 * map, address search, footprint layer, polygon editor, measurement panel,
 * scaffold selector/form, material list, export buttons, and AI chat to the
 * single `projectStateController` (Req 17.1). All five access points — map,
 * scaffold inputs, material list, AI assistant, and export — are exposed
 * through the responsive AppShell, completing the address → estimate → export
 * flow.
 */
export default function Home() {
  return <StillasCalculatorApp />;
}
