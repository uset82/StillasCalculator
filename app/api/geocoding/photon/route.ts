// Server route: GET /api/geocoding/photon?q=<query>
//
// Proxies address geocoding through the server so the rate-limited public
// providers (Photon, Nominatim) are never called from the browser (Req 3.9).
// The route:
//   - enforces a per-session rate limit of at most 1 request / 300 ms (Req 3.8);
//   - queries Photon, retrying exactly once via Nominatim on
//     no-result/error/5s-timeout (Req 3.6);
//   - returns up to the first 5 normalized suggestions (Req 3.3);
//   - returns a "no matching address" signal when both providers fail (Req 3.7).
//
// All upstream payloads are treated as untrusted and normalized in
// `lib/geocoding/photonServer.ts` before being returned.

import { NextResponse } from 'next/server';

import type { GeocodingResponse } from '@/lib/types';
import {
  geocodeWithFallback,
  sessionKeyFromHeaders,
  tryConsumeRateLimit,
} from '@/lib/geocoding/photonServer';

// This route performs outbound network I/O and must never be statically cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse<GeocodingResponse>> {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();

  // Defensive gating: the client adapter (task 6.2) suppresses <3-char queries
  // (Req 3.2), but the server must not issue empty/short outbound requests.
  if (query.length < 3) {
    return NextResponse.json({ results: [] });
  }

  // Per-session rate limit (Req 3.8): reject requests arriving < 300 ms apart.
  const sessionKey = sessionKeyFromHeaders(request.headers);
  if (!tryConsumeRateLimit(sessionKey)) {
    return NextResponse.json(
      { results: [], rateLimited: true },
      { status: 429 },
    );
  }

  // Photon with single Nominatim fallback (Req 3.6), truncated to 5 (Req 3.3).
  const outcome = await geocodeWithFallback(query);

  if (outcome.noMatch) {
    // Both providers failed: signal "no matching address" (Req 3.7).
    return NextResponse.json({ results: [], noMatch: true });
  }

  return NextResponse.json({ results: outcome.results });
}
