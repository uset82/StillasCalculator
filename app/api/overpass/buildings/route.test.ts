import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

// Unit tests for the /api/overpass/buildings route error and empty branches
// (task 7.6). These pin down the client-fallback contract the route promises:
//
//   - Req 4.5: on a network error, a non-success upstream response, or a
//     timeout/abort, the route surfaces `error: 'overpass-failed'` (status 200)
//     so the client can show an error, offer manual drawing, and RETAIN the
//     selected coordinate (the route echoes lat/lon in every response).
//   - Req 4.6: when no building footprints exist within the radius, the route
//     surfaces `empty: true` so the client offers manual perimeter drawing,
//     again retaining the selected coordinate.
//
// fetch is stubbed so no real Overpass request is made; the conversion of any
// returned OSM elements is exercised by lib/osm/osmToGeoJSON's own tests.

const LAT = 59.9139;
const LON = 10.7522;

function buildingsRequest(lat: number = LAT, lon: number = LON): Request {
  return new Request(
    `http://localhost/api/overpass/buildings?lat=${lat}&lon=${lon}`,
  );
}

/** A fake upstream Response carrying the given JSON body. */
function fakeResponse(ok: boolean, body: unknown, status = ok ? 200 : 503) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('GET /api/overpass/buildings — error and empty branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // --- Req 4.5: non-success upstream response ----------------------------
  it('signals overpass-failed and retains the coordinate on a non-success upstream response (Req 4.5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(false, 'Service Unavailable', 503)),
    );

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBe('overpass-failed');
    expect(body.buildings).toEqual([]);
    // Coordinate retained so the client can offer manual drawing (Req 4.5).
    expect(body.lat).toBe(LAT);
    expect(body.lon).toBe(LON);
    expect(body.empty).toBeUndefined();
  });

  // --- Req 4.5: network error --------------------------------------------
  it('signals overpass-failed and retains the coordinate on a network error (Req 4.5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network error: failed to fetch');
      }),
    );

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBe('overpass-failed');
    expect(body.buildings).toEqual([]);
    expect(body.lat).toBe(LAT);
    expect(body.lon).toBe(LON);
  });

  // --- Req 4.5: timeout / abort ------------------------------------------
  it('signals overpass-failed and retains the coordinate on a timeout/abort (Req 4.5)', async () => {
    // A 25 s timeout aborts the request, surfacing as an AbortError rejection.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBe('overpass-failed');
    expect(body.buildings).toEqual([]);
    expect(body.lat).toBe(LAT);
    expect(body.lon).toBe(LON);
  });

  it('falls back to Overpass GET when a mirror rejects the POST form', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(false, 'Method rejected', 405))
      .mockResolvedValueOnce(
        fakeResponse(true, {
          elements: [
            {
              type: 'way',
              id: 123,
              geometry: [
                { lat: LAT, lon: LON },
                { lat: LAT, lon: LON + 0.0001 },
                { lat: LAT + 0.0001, lon: LON + 0.0001 },
                { lat: LAT + 0.0001, lon: LON },
                { lat: LAT, lon: LON },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.empty).toBe(false);
    expect(body.buildings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
  });

  it('continues to the next mirror when one mirror returns an empty element list', async () => {
    vi.stubEnv(
      'OVERPASS_ENDPOINTS',
      'https://empty.example/interpreter,https://fresh.example/interpreter',
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(true, { elements: [] }))
      .mockResolvedValueOnce(
        fakeResponse(true, {
          elements: [
            {
              type: 'way',
              id: 456,
              geometry: [
                { lat: LAT, lon: LON },
                { lat: LAT, lon: LON + 0.0001 },
                { lat: LAT + 0.0001, lon: LON + 0.0001 },
                { lat: LAT + 0.0001, lon: LON },
                { lat: LAT, lon: LON },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.empty).toBe(false);
    expect(body.buildings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // --- Req 4.6: empty result (no building elements) ----------------------
  it('signals empty and retains the coordinate when no buildings are returned (Req 4.6)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(true, { elements: [] })),
    );

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.empty).toBe(true);
    expect(body.buildings).toEqual([]);
    // Coordinate retained so the client can offer manual drawing (Req 4.6).
    expect(body.lat).toBe(LAT);
    expect(body.lon).toBe(LON);
    expect(body.error).toBeUndefined();
  });

  // --- Req 4.6: elements present but no valid polygon could be built ------
  it('signals empty when building elements yield no valid polygon (Req 4.6)', async () => {
    // A degenerate way (fewer than three distinct vertices) is dropped by the
    // converter, so the route must still report empty rather than buildings.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(true, {
          elements: [
            {
              type: 'way',
              id: 1,
              geometry: [
                { lat: LAT, lon: LON },
                { lat: LAT, lon: LON },
              ],
            },
          ],
        }),
      ),
    );

    const response = await GET(buildingsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.empty).toBe(true);
    expect(body.buildings).toEqual([]);
    expect(body.lat).toBe(LAT);
    expect(body.lon).toBe(LON);
  });
});
