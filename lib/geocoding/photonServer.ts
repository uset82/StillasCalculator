// Server-only geocoding helpers for the `/api/geocoding/photon` route.
//
// This module owns the trust boundary for address geocoding (Req 3.9): all
// outbound requests to Photon and Nominatim happen here, server-side. It:
//
//   - queries Photon first (Req 3.1) with a 5 second timeout (Req 3.6);
//   - retries exactly once via Nominatim on Photon no-result/error/timeout
//     (Req 3.6), sending a descriptive User-Agent per Nominatim's usage policy;
//   - normalizes every external response into the trusted `GeocodingResult`
//     shape, treating the upstream payloads as untrusted (validate before use);
//   - truncates to the first 5 results (Req 3.3);
//   - reports a "no matching address" signal when both providers fail (Req 3.7).
//
// The per-session rate limiter (Req 3.8) lives here too. It is intentionally a
// simple in-memory limiter; this is acceptable because the limit is a courtesy
// guard for upstream services rather than a security control, and a single
// server instance is the common deployment for this app.
//
// NOTE: This file must only be imported from server code (route handlers). It
// is deliberately separate from `lib/geocoding/photon.ts`, which is reserved
// for the client-side debounce adapter (task 6.2).

import type { GeocodingResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Maximum suggestions returned to the client (Req 3.3). */
export const MAX_RESULTS = 5;

/** Photon request timeout in milliseconds (Req 3.6). */
export const PHOTON_TIMEOUT_MS = 5_000;

/** Minimum spacing between outbound requests per session (Req 3.8). */
export const RATE_LIMIT_WINDOW_MS = 300;

/**
 * A descriptive User-Agent is required by the Nominatim usage policy. Without
 * it Nominatim may reject the request. Override via NOMINATIM_USER_AGENT.
 */
const NOMINATIM_USER_AGENT =
  (typeof process !== 'undefined' && process.env?.NOMINATIM_USER_AGENT) ||
  'StillasCalculator/1.0 (open-source scaffolding estimator)';

// ---------------------------------------------------------------------------
// Fetch indirection (allows tests to inject a fake fetch)
// ---------------------------------------------------------------------------

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchLike = (input, init) =>
  (globalThis.fetch as unknown as FetchLike)(input, init);

// ---------------------------------------------------------------------------
// Per-session rate limiter (Req 3.8)
// ---------------------------------------------------------------------------

/** Maps a session key to the epoch-ms timestamp of its last allowed request. */
const lastRequestAtBySession = new Map<string, number>();

/**
 * Returns `true` when a request for `sessionKey` is allowed (i.e. at least
 * `RATE_LIMIT_WINDOW_MS` has elapsed since the previous allowed request), and
 * records the new timestamp. Returns `false` when the request is too soon and
 * must be rejected as rate-limited. Consecutive allowed requests in a session
 * are therefore spaced at least `RATE_LIMIT_WINDOW_MS` apart (Property 23).
 *
 * `now` is injectable so tests can drive the clock deterministically.
 */
export function tryConsumeRateLimit(
  sessionKey: string,
  now: number = Date.now(),
): boolean {
  const last = lastRequestAtBySession.get(sessionKey);
  if (last !== undefined && now - last < RATE_LIMIT_WINDOW_MS) {
    return false;
  }
  lastRequestAtBySession.set(sessionKey, now);
  return true;
}

/** Clears all rate-limiter state. Intended for test isolation only. */
export function __resetRateLimiter(): void {
  lastRequestAtBySession.clear();
}

/**
 * Derives a stable per-session key from request headers. Prefers an explicit
 * session cookie, then the forwarded client IP, then the real-IP header, and
 * finally falls back to a shared bucket. Keeping this server-side ensures the
 * limit cannot be bypassed by the client (Req 3.8, 3.9).
 */
export function sessionKeyFromHeaders(
  headers: Headers | { get(name: string): string | null },
): string {
  const cookie = headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)sc_session=([^;]+)/.exec(cookie);
  if (match) return `cookie:${match[1]}`;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`;

  const realIp = headers.get('x-real-ip');
  if (realIp) return `ip:${realIp.trim()}`;

  return 'session:shared';
}

// ---------------------------------------------------------------------------
// Normalization of untrusted upstream payloads
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Builds a human-readable label from Photon feature properties, joining the
 * meaningful parts that are present. Falls back to the `name` property.
 */
function buildPhotonLabel(props: Record<string, unknown>): string {
  const street =
    typeof props.street === 'string' && props.street
      ? typeof props.housenumber === 'string' && props.housenumber
        ? `${props.street} ${props.housenumber}`
        : props.street
      : undefined;

  const parts = [
    typeof props.name === 'string' ? props.name : undefined,
    street,
    typeof props.postcode === 'string' ? props.postcode : undefined,
    typeof props.city === 'string' ? props.city : undefined,
    typeof props.state === 'string' ? props.state : undefined,
    typeof props.country === 'string' ? props.country : undefined,
  ].filter((part): part is string => Boolean(part && part.trim()));

  // De-duplicate while preserving order (name may repeat city, etc.).
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.join(', ');
}

/**
 * Normalizes an untrusted Photon GeoJSON FeatureCollection into trusted
 * `GeocodingResult`s, discarding features with invalid coordinates or no
 * usable label. Truncation to `MAX_RESULTS` is applied by the caller.
 */
export function normalizePhotonResponse(payload: unknown): GeocodingResult[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { features?: unknown }).features)
  ) {
    return [];
  }

  const features = (payload as { features: unknown[] }).features;
  const results: GeocodingResult[] = [];

  for (const feature of features) {
    if (typeof feature !== 'object' || feature === null) continue;
    const geometry = (feature as { geometry?: unknown }).geometry;
    const properties = (feature as { properties?: unknown }).properties;
    if (typeof geometry !== 'object' || geometry === null) continue;

    const coordinates = (geometry as { coordinates?: unknown }).coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

    const lon = coordinates[0];
    const lat = coordinates[1];
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;
    if (!isValidLatLon(lat, lon)) continue;

    const props =
      typeof properties === 'object' && properties !== null
        ? (properties as Record<string, unknown>)
        : {};
    const label = buildPhotonLabel(props);
    if (!label) continue;

    results.push({ label, lat, lon });
  }

  return results;
}

/**
 * Normalizes an untrusted Nominatim search response (a JSON array of places)
 * into trusted `GeocodingResult`s.
 */
export function normalizeNominatimResponse(payload: unknown): GeocodingResult[] {
  if (!Array.isArray(payload)) return [];

  const results: GeocodingResult[] = [];
  for (const place of payload) {
    if (typeof place !== 'object' || place === null) continue;
    const record = place as Record<string, unknown>;

    const lat = typeof record.lat === 'string' ? Number(record.lat) : record.lat;
    const lon = typeof record.lon === 'string' ? Number(record.lon) : record.lon;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;
    if (!isValidLatLon(lat, lon)) continue;

    const label =
      typeof record.display_name === 'string' ? record.display_name.trim() : '';
    if (!label) continue;

    results.push({ label, lat, lon });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Provider queries
// ---------------------------------------------------------------------------

/**
 * Queries Photon with a hard 5 second timeout (Req 3.6) via AbortController.
 * Returns normalized results, or `null` to signal failure/timeout/no-result so
 * the caller can trigger the Nominatim fallback. Never throws.
 */
export async function queryPhoton(
  query: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<GeocodingResult[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);
  try {
    const url = `${PHOTON_ENDPOINT}?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const results = normalizePhotonResponse(payload);
    return results.length > 0 ? results : null;
  } catch {
    // Network error or abort (timeout) -> signal failure for fallback.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queries Nominatim as the fallback provider (Req 3.6), sending a descriptive
 * User-Agent as required by the Nominatim usage policy. Returns normalized
 * results, or `null` on failure/no-result. Never throws.
 */
export async function queryNominatim(
  query: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<GeocodingResult[] | null> {
  try {
    const url =
      `${NOMINATIM_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&format=jsonv2&limit=${MAX_RESULTS}&addressdetails=0`;
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const results = normalizeNominatimResponse(payload);
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Result of {@link geocodeWithFallback}. `noMatch` is `true` only when both
 * Photon and Nominatim produced no usable result (Req 3.7).
 */
export interface GeocodeOutcome {
  results: GeocodingResult[];
  noMatch: boolean;
}

/**
 * Runs the Photon-then-Nominatim flow: query Photon, and on no-result, error,
 * or 5 second timeout retry exactly once via Nominatim (Req 3.6). Results are
 * truncated to the first 5 (Req 3.3). When both providers fail, returns an
 * empty list with `noMatch: true` (Req 3.7).
 */
export async function geocodeWithFallback(
  query: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<GeocodeOutcome> {
  const photon = await queryPhoton(query, fetchImpl);
  if (photon && photon.length > 0) {
    return { results: photon.slice(0, MAX_RESULTS), noMatch: false };
  }

  const nominatim = await queryNominatim(query, fetchImpl);
  if (nominatim && nominatim.length > 0) {
    return { results: nominatim.slice(0, MAX_RESULTS), noMatch: false };
  }

  return { results: [], noMatch: true };
}
