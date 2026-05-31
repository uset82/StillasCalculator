import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Smoke test confirming the Vitest + fast-check test tooling is wired up
// correctly. This validates the test scaffolding for task 1.1; feature
// behavior is covered by dedicated tests in later tasks.
describe("test tooling", () => {
  it("runs Vitest assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("runs fast-check property checks", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 },
    );
  });
});
