// Client-side geocoding adapter for the `/api/geocoding/photon` server route.
//
// This module is the browser-facing counterpart to `photonServer.ts`. The
// server route owns the trust boundary (it holds the Photon/Nominatim fallback
// logic, the per-session rate limit, and result truncation, Req 3.6/3.8/3.9);
// this adapter is what the address-search UI (AddressSearch, task 13.2) talks
// to. Its job is to:
//
//   - debounce keystrokes so a request is only issued after the input is idle
//     for 300 ms (Req 3.1);
//   - gate short queries: when the input has fewer than 3 characters, issue no
//     request and clear any displayed suggestions (Req 3.2);
//   - rate-limit outbound requests to at most one per 300 ms per session as a
//     client-side courtesy guard that mirrors the server limit (Req 3.8);
//   - normalize the (untrusted) route response/errors into a trusted outcome,
//     re-validating every suggestion and truncating to the first 5 (Req 3.3).
//
// The gating, truncation, rate-limiting, and normalization steps are exported
// as small PURE functions so they can be property-tested in isolation
// (Property 21 short-query gating, Property 22 truncation, Property 23 rate
// limiting). The debounced orchestration is provided by a factory that accepts
// an injectable clock/scheduler/fetch so timing behavior is testable too.

import type { GeocodingResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The server route this adapter talks to (Req 3.9). */
export const GEOCODING_ENDPOINT = '/api/geocoding/photon';

/** Minimum query length before a request is issued (Req 3.1, 3.2). */
export const MIN_QUERY_LENGTH = 3;

/** Idle time after the last keystroke before a request fires (Req 3.1). */
export const DEBOUNCE_MS = 300;

/** Minimum spacing between outbound requests per session (Req 3.8). */
export const RATE_LIMIT_WINDOW_MS = 300;

/** Maximum suggestions surfaced to the UI (Req 3.3). */
export const MAX_SUGGESTIONS = 5;

// ---------------------------------------------------------------------------
// Outcome shape
// ---------------------------------------------------------------------------

/**
 * The normalized result of an attempted geocode. The discriminated `status`
 * lets the UI react precisely:
 *
 *   - `gated`        the query was too short; suggestions must be cleared and
 *                    no request was issued (Req 3.2);
 *   - `ok`           up to 5 normalized suggestions are available (Req 3.3);
 *   - `no-match`     both providers failed upstream; show the "no matching
 *                    address" message and preserve the map view/marker (Req 3.7);
 *   - `rate-limited` the request was throttled (client or server, Req 3.8);
 *   - `error`        the request failed (network/parse); surface an error.
 *
 * `results` is always present (empty for non-`ok` statuses) so callers can
 * render it without branching.
 */
export type GeocodeStatus =
  | 'gated'
  | 'ok'
  | 'no-match'
  | 'rate-limited'
  | 'error';

export interface GeocodeOutcome {
  status: GeocodeStatus;
  results: GeocodingResult[];
  /** True when the UI should clear any displayed suggestions (Req 3.2). */
  suggestionsCleared: boolean;
  /** Human-readable detail for the `error` status. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Pure: short-query gating (Req 3.2, Property 21)
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw input value into the query string that would actually be
 * sent: leading/trailing whitespace is trimmed (the server trims too, so the
 * client gates on the same effective length).
 */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/**
 * Whether a (raw) input is long enough to trigger a geocoding request. Uses the
 * trimmed length so that whitespace-only or padded short inputs are gated.
 */
export function isQueryLongEnough(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Result of gating a raw input before any request is issued.
 *
 * - `shouldRequest`     whether an outbound request is permitted to proceed;
 * - `clearSuggestions`  whether the UI must clear displayed suggestions;
 * - `query`             the normalized (trimmed) query to send when allowed.
 *
 * Property 21: for any input with fewer than 3 (trimmed) characters,
 * `shouldRequest` is `false` and `clearSuggestions` is `true` — i.e. no request
 * is issued and suggestions are cleared (Req 3.2).
 */
export interface QueryGate {
  shouldRequest: boolean;
  clearSuggestions: boolean;
  query: string;
}

export function gateQuery(raw: string): QueryGate {
  const query = normalizeQuery(raw);
  if (query.length < MIN_QUERY_LENGTH) {
    // Too short: never issue a request, and always clear suggestions (Req 3.2).
    return { shouldRequest: false, clearSuggestions: true, query };
  }
  return { shouldRequest: true, clearSuggestions: false, query };
}

// ---------------------------------------------------------------------------
// Pure: suggestion truncation (Req 3.3, Property 22)
// ---------------------------------------------------------------------------

/**
 * Truncates a list of suggestions to at most `MAX_SUGGESTIONS`, taking the
 * entries from the front and preserving their order.
 *
 * Property 22: for N provider results the returned list has exactly
 * `min(5, N)` entries, taken from the front, in order. The server already
 * truncates, but the client re-applies this defensively because the route
 * response is untrusted.
 */
export function truncateSuggestions(
  results: readonly GeocodingResult[],
): GeocodingResult[] {
  return results.slice(0, MAX_SUGGESTIONS);
}

// ---------------------------------------------------------------------------
// Pure: response normalization (normalize route responses/errors)
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Validates a single untrusted entry from the route's `results` array into a
 * trusted `GeocodingResult`, or returns `null` when it is malformed. The route
 * already normalizes, but the response crosses the network boundary so it is
 * treated as untrusted and re-validated here.
 */
function normalizeResult(value: unknown): GeocodingResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!label) return null;

  const lat = record.lat;
  const lon = record.lon;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (!isValidLatLon(lat, lon)) return null;

  return { label, lat, lon };
}

/**
 * Normalizes an untrusted route response body into a `GeocodeOutcome`. This is
 * the pure core of error/response handling, separated from the network call so
 * it can be unit-tested directly.
 *
 * - HTTP 429 or a `rateLimited` flag becomes `rate-limited` (Req 3.8).
 * - A `noMatch` flag (or an `ok` response with zero valid results) becomes
 *   `no-match` (Req 3.7).
 * - Otherwise the valid results are returned, truncated to 5 (Req 3.3).
 *
 * `httpOk`/`httpStatus` describe the transport result; `payload` is the parsed
 * JSON body (or `undefined`/`null` when parsing failed).
 */
export function normalizeRouteResponse(
  httpOk: boolean,
  httpStatus: number,
  payload: unknown,
): GeocodeOutcome {
  // Rate limited by the server (Req 3.8): the route returns 429.
  if (httpStatus === 429) {
    return { status: 'rate-limited', results: [], suggestionsCleared: false };
  }

  const body =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;

  if (body?.rateLimited === true) {
    return { status: 'rate-limited', results: [], suggestionsCleared: false };
  }

  // Any non-success HTTP status without a recognized signal is an error.
  if (!httpOk || body === null) {
    return {
      status: 'error',
      results: [],
      suggestionsCleared: false,
      message: `Geocoding request failed (status ${httpStatus}).`,
    };
  }

  // Both providers failed upstream (Req 3.7).
  if (body.noMatch === true) {
    return { status: 'no-match', results: [], suggestionsCleared: false };
  }

  const rawResults = Array.isArray(body.results) ? body.results : [];
  const normalized = rawResults
    .map(normalizeResult)
    .filter((r): r is GeocodingResult => r !== null);
  const results = truncateSuggestions(normalized);

  // An empty result set with no explicit signal is treated as "no match" so the
  // UI shows the same message and preserves the current view/marker (Req 3.7).
  if (results.length === 0) {
    return { status: 'no-match', results: [], suggestionsCleared: false };
  }

  return { status: 'ok', results, suggestionsCleared: false };
}

// ---------------------------------------------------------------------------
// Pure: client-side rate limiter (Req 3.8, Property 23)
// ---------------------------------------------------------------------------

/**
 * A minimal client-side rate limiter that ensures consecutive allowed requests
 * are spaced at least `RATE_LIMIT_WINDOW_MS` apart. It mirrors the server limit
 * as a courtesy guard so the browser does not fire bursts at the route.
 *
 * Property 23: across any sequence of attempts, the timestamps of the requests
 * it allows are spaced at least `RATE_LIMIT_WINDOW_MS` apart.
 */
export interface RateLimiter {
  /**
   * Attempts to consume the limiter at time `now` (epoch ms). Returns `true`
   * when the request is allowed (recording `now` as the last allowed time), or
   * `false` when it arrived too soon and must be suppressed.
   */
  tryConsume(now: number): boolean;
  /** Resets the limiter so the next attempt is always allowed. */
  reset(): void;
}

export function createRateLimiter(
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimiter {
  let lastAllowedAt: number | null = null;
  return {
    tryConsume(now: number): boolean {
      if (lastAllowedAt !== null && now - lastAllowedAt < windowMs) {
        return false;
      }
      lastAllowedAt = now;
      return true;
    },
    reset(): void {
      lastAllowedAt = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Single-shot async adapter
// ---------------------------------------------------------------------------

/**
 * Loose `fetch` shape so tests can inject a fake without DOM types. The real
 * `globalThis.fetch` is structurally compatible.
 */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchLike = (input, init) =>
  (globalThis.fetch as unknown as FetchLike)(input, init);

/** Builds the route URL for a (already-normalized) query. */
export function buildRequestUrl(query: string): string {
  return `${GEOCODING_ENDPOINT}?q=${encodeURIComponent(query)}`;
}

/**
 * Issues a single geocoding request for `rawQuery` and returns a normalized
 * outcome. Short queries are gated locally (Req 3.2) and never hit the network.
 * This is the un-debounced primitive; the debounced UI flow is provided by
 * {@link createDebouncedGeocoder}.
 *
 * Never throws: transport/parse failures are surfaced as an `error` outcome so
 * the caller can preserve `Project_State` (Req 3.7-style preservation).
 */
export async function geocode(
  rawQuery: string,
  fetchImpl: FetchLike = defaultFetch,
  signal?: AbortSignal,
): Promise<GeocodeOutcome> {
  const gate = gateQuery(rawQuery);
  if (!gate.shouldRequest) {
    return { status: 'gated', results: [], suggestionsCleared: true };
  }

  try {
    const response = await fetchImpl(buildRequestUrl(gate.query), { signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return normalizeRouteResponse(response.ok, response.status, payload);
  } catch {
    return {
      status: 'error',
      results: [],
      suggestionsCleared: false,
      message: 'Geocoding request could not be completed.',
    };
  }
}

// ---------------------------------------------------------------------------
// Debounced client (Req 3.1, 3.2, 3.8)
// ---------------------------------------------------------------------------

/** Opaque handle returned by the injectable scheduler. */
export type TimerHandle = unknown;

/**
 * Callbacks the UI supplies to react to each search lifecycle event. Only
 * `onOutcome` is required; the rest are optional convenience hooks.
 */
export interface GeocoderHandlers {
  /** Called with the normalized outcome of every completed (non-gated) search. */
  onOutcome(outcome: GeocodeOutcome): void;
  /**
   * Called when suggestions must be cleared because the query was gated as too
   * short (Req 3.2). Fires synchronously, without waiting for the debounce.
   */
  onClearSuggestions?(): void;
}

/**
 * Injectable dependencies so timing/network are deterministic under test. All
 * default to real browser implementations.
 */
export interface DebouncedGeocoderDeps {
  fetchImpl?: FetchLike;
  debounceMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  rateLimiter?: RateLimiter;
}

/**
 * A debounced geocoding client bound to a set of handlers.
 */
export interface DebouncedGeocoder {
  /**
   * Records a new raw input. Short queries clear suggestions immediately and
   * cancel any pending request (Req 3.2). Otherwise the request is scheduled to
   * fire after the debounce window once typing pauses (Req 3.1), subject to the
   * client rate limit (Req 3.8).
   */
  search(rawQuery: string): void;
  /** Cancels any pending debounced request without firing it. */
  cancel(): void;
}

/**
 * Creates a debounced geocoding client. The returned client:
 *
 *   1. gates short queries synchronously, clearing suggestions and cancelling
 *      any pending request (Req 3.2);
 *   2. debounces qualifying queries by `debounceMs` so only the final query in
 *      a burst of keystrokes is sent (Req 3.1);
 *   3. consults the client rate limiter before firing; if the request would
 *      arrive too soon it is re-deferred so outbound requests stay ≥300 ms
 *      apart (Req 3.8);
 *   4. delivers the normalized outcome to `handlers.onOutcome`.
 *
 * Out-of-order responses are dropped: only the most recent search's result is
 * delivered, using a monotonically increasing request token.
 */
export function createDebouncedGeocoder(
  handlers: GeocoderHandlers,
  deps: DebouncedGeocoderDeps = {},
): DebouncedGeocoder {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const now =
    deps.now ?? (() => (typeof Date !== 'undefined' ? Date.now() : 0));
  const schedule =
    deps.schedule ??
    ((callback, ms) =>
      setTimeout(callback, ms) as unknown as TimerHandle);
  const cancelTimer =
    deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const rateLimiter = deps.rateLimiter ?? createRateLimiter();

  let pendingTimer: TimerHandle | null = null;
  // Token identifying the most recent search; stale responses are ignored.
  let latestToken = 0;

  function clearPendingTimer(): void {
    if (pendingTimer !== null) {
      cancelTimer(pendingTimer);
      pendingTimer = null;
    }
  }

  function fire(query: string, token: number): void {
    // Respect the client rate limit (Req 3.8). If we are inside the window,
    // re-defer just enough so consecutive requests stay spaced apart.
    if (!rateLimiter.tryConsume(now())) {
      pendingTimer = schedule(() => fire(query, token), RATE_LIMIT_WINDOW_MS);
      return;
    }

    pendingTimer = null;
    void geocode(query, fetchImpl).then((outcome) => {
      // Drop results from superseded searches.
      if (token !== latestToken) return;
      handlers.onOutcome(outcome);
    });
  }

  return {
    search(rawQuery: string): void {
      const token = ++latestToken;
      const gate = gateQuery(rawQuery);

      // Any new input cancels a still-pending request.
      clearPendingTimer();

      if (!gate.shouldRequest) {
        // Too short: clear suggestions now and issue nothing (Req 3.2).
        handlers.onClearSuggestions?.();
        handlers.onOutcome({
          status: 'gated',
          results: [],
          suggestionsCleared: true,
        });
        return;
      }

      pendingTimer = schedule(() => fire(gate.query, token), debounceMs);
    },

    cancel(): void {
      clearPendingTimer();
    },
  };
}
