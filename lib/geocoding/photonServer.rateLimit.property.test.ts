import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import {
  tryConsumeRateLimit,
  __resetRateLimiter,
  RATE_LIMIT_WINDOW_MS,
} from "./photonServer";

// Feature: stillas-calculator, Property 23: Geocoding requests are rate-limited
//
// Property 23 (design.md): For any sequence of address-input events with
// timestamps, the spacing between consecutive outbound geocoding requests
// within a session is never less than 300 milliseconds.
//
// Validates: Requirements 3.8 — "THE Geocoding_Service SHALL limit outbound
// geocoding requests to at most 1 request per 300 milliseconds per session."
//
// The rate limiter (`tryConsumeRateLimit`) is the trust boundary that decides
// whether an outbound request is "allowed" (returns true) for a given session.
// An allowed request is exactly one that would be sent upstream, so the
// property reduces to: for each session, the timestamps of consecutive ALLOWED
// requests are spaced at least RATE_LIMIT_WINDOW_MS apart.

describe("Property 23: Geocoding requests are rate-limited", () => {
  beforeEach(() => {
    __resetRateLimiter();
  });

  // A single global clock drives every session: we accumulate non-negative
  // deltas so timestamps are monotonically non-decreasing, modelling real wall
  // time shared across interleaved sessions.
  const eventArb = fc.record({
    delta: fc.integer({ min: 0, max: 2000 }),
    sessionKey: fc.constantFrom("session-a", "session-b", "session-c"),
  });

  it("spaces consecutive allowed requests within a session at least 300 ms apart", () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (events, baseTime) => {
          // Isolate each generated case from the shared in-memory limiter.
          __resetRateLimiter();

          // Process events in order against a single shared clock, recording
          // the timestamp of every ALLOWED request grouped by session.
          let now = baseTime;
          const allowedTimestamps = new Map<string, number[]>();

          for (const { delta, sessionKey } of events) {
            now += delta;
            const allowed = tryConsumeRateLimit(sessionKey, now);
            if (allowed) {
              const list = allowedTimestamps.get(sessionKey) ?? [];
              list.push(now);
              allowedTimestamps.set(sessionKey, list);
            }
          }

          // Within each session, consecutive allowed requests must be spaced at
          // least the rate-limit window apart.
          for (const timestamps of allowedTimestamps.values()) {
            for (let i = 1; i < timestamps.length; i++) {
              expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(
                RATE_LIMIT_WINDOW_MS
              );
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("isolates sessions: a busy session never suppresses another session's request", () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (events, baseTime) => {
          __resetRateLimiter();

          let now = baseTime;
          // Track the last allowed timestamp per session independently and
          // assert the limiter's decision matches the per-session window only.
          const lastAllowedAt = new Map<string, number>();

          for (const { delta, sessionKey } of events) {
            now += delta;
            const last = lastAllowedAt.get(sessionKey);
            const expectedAllowed =
              last === undefined || now - last >= RATE_LIMIT_WINDOW_MS;

            const allowed = tryConsumeRateLimit(sessionKey, now);

            expect(allowed).toBe(expectedAllowed);
            if (allowed) {
              lastAllowedAt.set(sessionKey, now);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
