import { describe, it, expect } from "vitest";
import {
  geocodeWithFallback,
  PHOTON_ENDPOINT,
  NOMINATIM_ENDPOINT,
  type FetchLike,
} from "./photonServer";

// Feature: stillas-calculator, Task 6.6 — geocoding fallback & error branches.
//
// These are example-based unit tests (complementing the property tests for rate
// limiting/truncation) that pin down the Photon -> Nominatim fallback contract
// in geocodeWithFallback:
//
//   - exactly ONE Nominatim retry on any Photon failure/no-result (Req 3.6);
//   - when BOTH providers fail, a noMatch:true outcome (Req 3.7).
//
// The injected FetchLike counts calls per upstream endpoint so we can assert the
// "exactly once" retry contract precisely.

// ---------------------------------------------------------------------------
// Test fetch factory
// ---------------------------------------------------------------------------

type ProviderBehavior =
  | { kind: "empty" } // 200 OK but no usable results
  | { kind: "error" } // non-2xx response
  | { kind: "throw" } // network error / abort (timeout)
  | { kind: "ok"; payload: unknown }; // 200 OK with a usable payload

interface CallCounts {
  photon: number;
  nominatim: number;
}

function respond(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function makeFetch(
  photon: ProviderBehavior,
  nominatim: ProviderBehavior,
): { fetchImpl: FetchLike; calls: CallCounts } {
  const calls: CallCounts = { photon: 0, nominatim: 0 };

  const handle = async (behavior: ProviderBehavior) => {
    switch (behavior.kind) {
      case "throw":
        throw new Error("network failure");
      case "error":
        return { ok: false, status: 500, json: async () => ({}) };
      case "empty":
        // A shape that normalizes to zero results for the given provider.
        return respond({ features: [] });
      case "ok":
        return respond(behavior.payload);
    }
  };

  const fetchImpl: FetchLike = async (input) => {
    if (input.startsWith(PHOTON_ENDPOINT)) {
      calls.photon += 1;
      return handle(photon);
    }
    if (input.startsWith(NOMINATIM_ENDPOINT)) {
      calls.nominatim += 1;
      return handle(nominatim);
    }
    throw new Error(`unexpected URL: ${input}`);
  };

  return { fetchImpl, calls };
}

// A valid Nominatim search payload (array of places) that normalizes to results.
const NOMINATIM_OK_PAYLOAD = [
  { display_name: "Storgata 1, 0155 Oslo, Norway", lat: "59.9139", lon: "10.7522" },
  { display_name: "Storgata 2, 0155 Oslo, Norway", lat: "59.9141", lon: "10.7525" },
];

// A valid Photon FeatureCollection that normalizes to a result.
const PHOTON_OK_PAYLOAD = {
  features: [
    {
      geometry: { type: "Point", coordinates: [10.7522, 59.9139] },
      properties: { name: "Storgata", city: "Oslo", country: "Norway" },
    },
  ],
};

describe("geocodeWithFallback: Nominatim retry on Photon failure (Req 3.6)", () => {
  // Each Photon failure mode must trigger exactly one Nominatim retry whose
  // results are returned to the caller.
  const photonFailures: Array<{ name: string; behavior: ProviderBehavior }> = [
    { name: "no results", behavior: { kind: "empty" } },
    { name: "error response", behavior: { kind: "error" } },
    { name: "timeout / network error", behavior: { kind: "throw" } },
  ];

  for (const { name, behavior } of photonFailures) {
    it(`retries Nominatim exactly once when Photon returns ${name}`, async () => {
      const { fetchImpl, calls } = makeFetch(behavior, {
        kind: "ok",
        payload: NOMINATIM_OK_PAYLOAD,
      });

      const outcome = await geocodeWithFallback("Storgata 1 Oslo", fetchImpl);

      // Photon was attempted once, Nominatim retried exactly once (Req 3.6).
      expect(calls.photon).toBe(1);
      expect(calls.nominatim).toBe(1);

      // The Nominatim results are surfaced and it is not a no-match.
      expect(outcome.noMatch).toBe(false);
      expect(outcome.results).toHaveLength(NOMINATIM_OK_PAYLOAD.length);
      expect(outcome.results[0]).toEqual({
        label: "Storgata 1, 0155 Oslo, Norway",
        lat: 59.9139,
        lon: 10.7522,
      });
    });
  }

  it("does NOT call Nominatim when Photon succeeds", async () => {
    const { fetchImpl, calls } = makeFetch(
      { kind: "ok", payload: PHOTON_OK_PAYLOAD },
      { kind: "ok", payload: NOMINATIM_OK_PAYLOAD },
    );

    const outcome = await geocodeWithFallback("Storgata Oslo", fetchImpl);

    expect(calls.photon).toBe(1);
    // No fallback retry should happen on a Photon success (Req 3.6).
    expect(calls.nominatim).toBe(0);
    expect(outcome.noMatch).toBe(false);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].label).toContain("Storgata");
  });
});

describe("geocodeWithFallback: both providers fail (Req 3.7)", () => {
  // When Photon AND Nominatim both fail, the caller gets an empty result set
  // flagged with noMatch so the UI can show "no matching address" and preserve
  // the current map view/marker.
  const bothFailCombos: Array<{
    name: string;
    photon: ProviderBehavior;
    nominatim: ProviderBehavior;
  }> = [
    { name: "both empty", photon: { kind: "empty" }, nominatim: { kind: "empty" } },
    { name: "both error", photon: { kind: "error" }, nominatim: { kind: "error" } },
    { name: "both throw", photon: { kind: "throw" }, nominatim: { kind: "throw" } },
    {
      name: "Photon error, Nominatim empty",
      photon: { kind: "error" },
      nominatim: { kind: "empty" },
    },
  ];

  for (const { name, photon, nominatim } of bothFailCombos) {
    it(`returns noMatch:true with no results when ${name}`, async () => {
      const { fetchImpl, calls } = makeFetch(photon, nominatim);

      const outcome = await geocodeWithFallback("Nowhere at all", fetchImpl);

      // Photon tried once, then exactly one Nominatim retry, then give up.
      expect(calls.photon).toBe(1);
      expect(calls.nominatim).toBe(1);

      expect(outcome.noMatch).toBe(true);
      expect(outcome.results).toEqual([]);
    });
  }
});
