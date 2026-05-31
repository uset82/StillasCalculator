import { describe, it, expect } from "vitest";
import type { ScaffoldSystem, ScaffoldSystemId } from "@/lib/types";
import {
  SCAFFOLD_SYSTEMS,
  getAllScaffoldSystems,
  getScaffoldSystem,
} from "./scaffoldSystems";

// Unit tests for the Scaffold_Library (task 3.1, Req 7.1, 7.4, 7.5).
// These pin down the library contract: exactly the five required systems, each
// with default bay/width/lift dimensions and correct isPlaceholder/isCustom
// flags. System-default loading on selection (Req 7.2) is exercised by the
// state controller and its dedicated property test (task 5.7).
describe("Scaffold_Library", () => {
  const EXPECTED_IDS: ScaffoldSystemId[] = [
    "generic-frame",
    "haki",
    "layher",
    "instant-alufase",
    "custom",
  ];

  it("provides exactly the five required systems (Req 7.1)", () => {
    expect(SCAFFOLD_SYSTEMS).toHaveLength(5);
    expect(SCAFFOLD_SYSTEMS.map((s) => s.id)).toEqual(EXPECTED_IDS);
    expect(getAllScaffoldSystems()).toBe(SCAFFOLD_SYSTEMS);
  });

  it("gives every system a non-empty display name", () => {
    for (const system of SCAFFOLD_SYSTEMS) {
      expect(system.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every system positive default bay/width/lift dimensions", () => {
    for (const system of SCAFFOLD_SYSTEMS) {
      expect(system.defaultBayLengthMeters).toBeGreaterThan(0);
      expect(system.defaultScaffoldWidthMeters).toBeGreaterThan(0);
      expect(system.defaultLiftHeightMeters).toBeGreaterThan(0);
    }
  });

  it("flags exactly the three placeholder systems (Req 7.4)", () => {
    const placeholders = SCAFFOLD_SYSTEMS.filter((s) => s.isPlaceholder).map(
      (s) => s.id
    );
    expect(placeholders).toEqual(["haki", "layher", "instant-alufase"]);
  });

  it("marks only Custom Dimensions as custom (Req 7.5)", () => {
    const customs = SCAFFOLD_SYSTEMS.filter((s) => s.isCustom).map((s) => s.id);
    expect(customs).toEqual(["custom"]);

    const custom = getScaffoldSystem("custom");
    expect(custom?.isCustom).toBe(true);
    expect(custom?.isPlaceholder).toBe(false);
  });

  it("keeps the Generic Frame and Custom systems non-placeholder", () => {
    expect(getScaffoldSystem("generic-frame")?.isPlaceholder).toBe(false);
    expect(getScaffoldSystem("custom")?.isPlaceholder).toBe(false);
  });

  it("looks up a system by id and returns undefined for unknown ids", () => {
    for (const id of EXPECTED_IDS) {
      expect(getScaffoldSystem(id)?.id).toBe(id);
    }
    expect(
      getScaffoldSystem("does-not-exist" as ScaffoldSystemId)
    ).toBeUndefined();
  });

  it("exposes an immutable library that cannot be mutated at runtime", () => {
    expect(Object.isFrozen(SCAFFOLD_SYSTEMS)).toBe(true);
    expect(() => {
      (SCAFFOLD_SYSTEMS as ScaffoldSystem[]).push({
        id: "custom",
        displayName: "x",
        defaultBayLengthMeters: 1,
        defaultScaffoldWidthMeters: 1,
        defaultLiftHeightMeters: 1,
        isPlaceholder: false,
        isCustom: true,
      });
    }).toThrow();
  });
});
