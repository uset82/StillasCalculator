import { describe, it, expect } from "vitest";
import {
  createDebouncedGeocoder,
  createRateLimiter,
  DEBOUNCE_MS,
  type FetchLike,
  type GeocodeOutcome,
  type TimerHandle,
} from "./photon";

// Feature: stillas-calculator, Task 6.6 — debounce timing (Req 3.1).
//
// Req 3.1: "WHEN the user has typed at least 3 characters into the address
// search input and no further input occurs for 300 milliseconds, THE
// Geocoding_Service SHALL request matching address suggestions from Photon."
//
// createDebouncedGeocoder accepts an injectable clock (now), scheduler
// (schedule/cancel), and fetch, so we can drive virtual time deterministically
// and assert that a burst of keystrokes results in exactly one request fired
// only after the debounce window elapses.

// ---------------------------------------------------------------------------
// Deterministic fake scheduler + clock
// ---------------------------------------------------------------------------

interface FakeTimer {
  id: number;
  fireAt: number;
  callback: () => void;
  active: boolean;
}

function createFakeScheduler() {
  let currentTime = 0;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();

  const now = () => currentTime;

  const schedule = (callback: () => void, ms: number): TimerHandle => {
    const id = nextId++;
    timers.set(id, { id, fireAt: currentTime + ms, callback, active: true });
    return id;
  };

  const cancel = (handle: TimerHandle): void => {
    timers.delete(handle as number);
  };

  /**
   * Advances virtual time by `ms`, firing every due timer in chronological
   * order. Callbacks may schedule further timers (e.g. the rate-limit
   * re-defer), which are honoured as long as they fall within the window.
   */
  const advance = (ms: number): void => {
    const target = currentTime + ms;
    // Repeatedly fire the earliest due timer until none remain before `target`.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let next: FakeTimer | undefined;
      for (const timer of timers.values()) {
        if (timer.fireAt <= target && (!next || timer.fireAt < next.fireAt)) {
          next = timer;
        }
      }
      if (!next) break;
      currentTime = next.fireAt;
      timers.delete(next.id);
      next.callback();
    }
    currentTime = target;
  };

  return { now, schedule, cancel, advance, pendingCount: () => timers.size };
}

// Flush pending microtasks so geocode()'s promise chain settles. Uses a real
// macrotask (not the injected scheduler) so it does not interfere with virtual
// time accounting.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

// A fetch spy that records calls and returns one valid suggestion.
function makeFetchSpy() {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ label: "Storgata 1, Oslo", lat: 59.9139, lon: 10.7522 }],
      }),
    };
  };
  return { fetchImpl, callCount: () => calls };
}

describe("createDebouncedGeocoder: debounce timing (Req 3.1)", () => {
  it("fires exactly one request after the debounce window for a burst of keystrokes", async () => {
    const scheduler = createFakeScheduler();
    const { fetchImpl, callCount } = makeFetchSpy();
    const outcomes: GeocodeOutcome[] = [];

    const geocoder = createDebouncedGeocoder(
      { onOutcome: (o) => outcomes.push(o) },
      {
        fetchImpl,
        now: scheduler.now,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
        // Fresh limiter starting "unused" so the first allowed request fires.
        rateLimiter: createRateLimiter(),
      },
    );

    // A burst of keystrokes typed faster than the debounce window: each call
    // happens 50 ms apart, well under DEBOUNCE_MS (300 ms).
    geocoder.search("Sto");
    scheduler.advance(50);
    geocoder.search("Stor");
    scheduler.advance(50);
    geocoder.search("Storg");
    scheduler.advance(50);
    geocoder.search("Storgata");

    // No request should have fired yet — the window has not elapsed since the
    // last keystroke.
    expect(callCount()).toBe(0);

    // Advance just past the debounce window from the final keystroke.
    scheduler.advance(DEBOUNCE_MS);
    await flushMicrotasks();

    // Exactly one request fired for the whole burst (Req 3.1).
    expect(callCount()).toBe(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");
    expect(outcomes[0].results).toHaveLength(1);
  });

  it("does not fire before the debounce window fully elapses", async () => {
    const scheduler = createFakeScheduler();
    const { fetchImpl, callCount } = makeFetchSpy();

    const geocoder = createDebouncedGeocoder(
      { onOutcome: () => {} },
      {
        fetchImpl,
        now: scheduler.now,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
        rateLimiter: createRateLimiter(),
      },
    );

    geocoder.search("Oslo");

    // One tick short of the window: still nothing.
    scheduler.advance(DEBOUNCE_MS - 1);
    await flushMicrotasks();
    expect(callCount()).toBe(0);

    // Crossing the threshold fires the single pending request.
    scheduler.advance(1);
    await flushMicrotasks();
    expect(callCount()).toBe(1);
  });

  it("cancel() prevents a pending debounced request from firing", async () => {
    const scheduler = createFakeScheduler();
    const { fetchImpl, callCount } = makeFetchSpy();

    const geocoder = createDebouncedGeocoder(
      { onOutcome: () => {} },
      {
        fetchImpl,
        now: scheduler.now,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
        rateLimiter: createRateLimiter(),
      },
    );

    geocoder.search("Bergen");
    geocoder.cancel();

    scheduler.advance(DEBOUNCE_MS * 2);
    await flushMicrotasks();

    expect(callCount()).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
