import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  geocodeWithFallback,
  MAX_RESULTS,
  type FetchLike,
} from "./photonServer";

// Feature: stillas-calculator, Property 22: Suggestions are truncated to five
//
// Validates: Requirements 3.3
//
// For any provider response containing N suggestions, the displayed list
// contains exactly min(5, N) entries, taken from the front of the response, in
// order. We drive `geocodeWithFallback` with a fake `FetchLike` that returns N
// synthetic Photon features (all with valid coordinates and a non-empty label
// so none are discarded during normalization). This lets us assert that the
// returned results are exactly the first min(5, N) features, preserving order.

/** A single synthetic Photon feature plus the values we expect to read back. */
interface SyntheticFeature {
  name: string;
  lat: number;
  lon: number;
}

/** Non-empty alphanumeric label (avoids whitespace-only labels being dropped). */
const nameArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(
        ""
      )
    ),
    { minLength: 1, maxLength: 12 }
  )
  .map((chars) => chars.join(""));

const featureArb: fc.Arbitrary<SyntheticFeature> = fc.record({
  name: nameArb,
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

/**
 * Builds a fake fetch that responds to the Photon query with a GeoJSON
 * FeatureCollection containing exactly the given synthetic features.
 */
function makePhotonFetch(features: SyntheticFeature[]): FetchLike {
  const payload = {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      properties: { name: f.name },
    })),
  };
  return async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

describe("Property 22: Suggestions are truncated to five", () => {
  it("returns exactly min(5, N) results from the front, in order", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Range spans below, at, and above the cap to exercise truncation.
        fc.array(featureArb, { minLength: 0, maxLength: 12 }),
        async (features) => {
          const fetchImpl = makePhotonFetch(features);
          const outcome = await geocodeWithFallback("oslo", fetchImpl);

          const expectedCount = Math.min(MAX_RESULTS, features.length);
          const expected = features.slice(0, expectedCount);

          // Exactly min(5, N) entries.
          expect(outcome.results).toHaveLength(expectedCount);

          // Entries are the front of the provider response, in order.
          expect(outcome.results.map((r) => r.label)).toEqual(
            expected.map((f) => f.name)
          );
          expect(outcome.results.map((r) => r.lat)).toEqual(
            expected.map((f) => f.lat)
          );
          expect(outcome.results.map((r) => r.lon)).toEqual(
            expected.map((f) => f.lon)
          );

          // noMatch only when there were no provider results at all.
          expect(outcome.noMatch).toBe(features.length === 0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
