import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  gateQuery,
  geocode,
  isQueryLongEnough,
  normalizeQuery,
  MIN_QUERY_LENGTH,
  type FetchLike,
} from "./photon";

// Feature: stillas-calculator, Property 21: Short queries are gated
//
// Property 21 (design.md): For any search input string with fewer than 3
// characters, the system issues no geocoding request and clears any displayed
// suggestions.
//
// Validates: Requirements 3.2 — "IF the address search input contains fewer
// than 3 characters, THEN THE StillasCalculator SHALL clear any displayed
// suggestions and SHALL NOT issue a geocoding request."
//
// The client gates on the *trimmed* (normalized) length, mirroring the server
// which trims too, so whitespace-only or padded short inputs are gated. These
// generators therefore reason about the trimmed length of the produced input.

// A single non-whitespace character: `trim()` of a one-char string keeps it
// only when the character is not whitespace, so this filters whitespace out.
const nonWhitespaceChar = fc.char().filter((c) => c.trim().length === 1);

// Arbitrary surrounding whitespace (including tabs/newlines) that `trim()`
// strips, so it never affects the gated/effective length.
const whitespacePad = fc.stringOf(
  fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"),
  { maxLength: 5 }
);

// A "core" of non-whitespace characters padded with arbitrary whitespace. The
// trimmed length equals the core length because the core carries no leading or
// trailing whitespace, so callers control the effective length precisely.
function paddedQuery(core: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(whitespacePad, core, whitespacePad)
    .map(([lead, body, trail]) => lead + body + trail);
}

// Trimmed length in {0, 1, 2} — strictly below MIN_QUERY_LENGTH.
const shortQueryArb = paddedQuery(
  fc.stringOf(nonWhitespaceChar, { minLength: 0, maxLength: MIN_QUERY_LENGTH - 1 })
);

// Trimmed length >= MIN_QUERY_LENGTH — qualifies for a request.
const longQueryArb = paddedQuery(
  fc.stringOf(nonWhitespaceChar, { minLength: MIN_QUERY_LENGTH, maxLength: 40 })
);

describe("Property 21: Short queries are gated", () => {
  it("gates any input with fewer than 3 trimmed characters: no request, suggestions cleared", () => {
    fc.assert(
      fc.property(shortQueryArb, (raw) => {
        // Precondition the generator guarantees, asserted to keep the property honest.
        expect(normalizeQuery(raw).length).toBeLessThan(MIN_QUERY_LENGTH);
        expect(isQueryLongEnough(raw)).toBe(false);

        const gate = gateQuery(raw);
        expect(gate.shouldRequest).toBe(false);
        expect(gate.clearSuggestions).toBe(true);
        // The normalized query is always the trimmed input.
        expect(gate.query).toBe(normalizeQuery(raw));
      }),
      { numRuns: 200 }
    );
  });

  it("never issues a fetch for short queries and returns a 'gated' outcome with suggestions cleared", async () => {
    await fc.assert(
      fc.asyncProperty(shortQueryArb, async (raw) => {
        let fetchCalls = 0;
        const fetchSpy: FetchLike = async () => {
          fetchCalls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ results: [] }),
          };
        };

        const outcome = await geocode(raw, fetchSpy);

        // No outbound request was issued (Req 3.2).
        expect(fetchCalls).toBe(0);
        // The outcome instructs the UI to clear suggestions and shows nothing.
        expect(outcome.status).toBe("gated");
        expect(outcome.suggestionsCleared).toBe(true);
        expect(outcome.results).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });

  it("does NOT gate inputs with at least 3 trimmed characters (negative case)", () => {
    fc.assert(
      fc.property(longQueryArb, (raw) => {
        expect(normalizeQuery(raw).length).toBeGreaterThanOrEqual(MIN_QUERY_LENGTH);
        expect(isQueryLongEnough(raw)).toBe(true);

        const gate = gateQuery(raw);
        expect(gate.shouldRequest).toBe(true);
        expect(gate.clearSuggestions).toBe(false);
        expect(gate.query).toBe(normalizeQuery(raw));
      }),
      { numRuns: 200 }
    );
  });
});
