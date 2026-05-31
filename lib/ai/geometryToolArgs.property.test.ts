// Feature: ai-agent-building-drawing, Property G: Coordinate-to-ring closing is idempotent
//
// Property G (design.md / requirements.md Req 12.1, 12.3): Closing a ring that
// is already closed returns equal coordinates, and closing twice equals closing
// once. *PBT* over generated coordinate lists.
//
// Validates: Requirements 12.1, 12.3
//
// The mechanism under test is the pure adapter in `lib/ai/geometryToolArgs.ts`:
//
//   * `coordinatesToClosedRing` converts an ordered list of [lon, lat] pairs
//     into a closed GeoJSON ring, appending a copy of the first pair ONLY when
//     the first and last pairs are not already numerically identical (Req 12.1).
//   * `serializePolygonRing` emits the stored ring's exact ordered pairs.
//
// Idempotence is exercised by the round-trip the model performs across the tool
// boundary: close a coordinate list, serialize the resulting ring back to
// pairs, then close that serialized ring again. Because the first closing pass
// produces an already-closed ring, the second pass must NOT append another pair
// and must reproduce an equal ring (Req 12.3).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { coordinatesToClosedRing, serializePolygonRing } from './geometryToolArgs';

// ---------------------------------------------------------------------------
// Generators for arbitrary [lon, lat] coordinate lists
// ---------------------------------------------------------------------------

// A finite coordinate component. The adapter rejects non-finite values, so the
// generator stays within a broad finite range to exercise the well-formed path.
const coordArb: fc.Arbitrary<number> = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

// A single exact [lon, lat] pair.
const pairArb: fc.Arbitrary<number[]> = fc
  .tuple(coordArb, coordArb)
  .map(([lon, lat]) => [lon, lat]);

// An arbitrary ordered list of coordinate pairs (including empty/degenerate).
const coordinateListArb: fc.Arbitrary<number[][]> = fc.array(pairArb, {
  maxLength: 50,
});

// A list that is already closed (its last pair is a copy of its first pair),
// to exercise the "already closed" branch of Req 12.3 directly.
const alreadyClosedListArb: fc.Arbitrary<number[][]> = fc
  .array(pairArb, { minLength: 1, maxLength: 50 })
  .map((pairs) => {
    const first = pairs[0];
    return [...pairs, [first[0], first[1]]];
  });

// ---------------------------------------------------------------------------
// Property G — coordinate-to-ring closing is idempotent
// ---------------------------------------------------------------------------

describe('Property G: Coordinate-to-ring closing is idempotent (Req 12.1, 12.3)', () => {
  it('closing, serializing, then closing again yields an equal ring (closing twice equals closing once)', () => {
    fc.assert(
      fc.property(coordinateListArb, (coordinates) => {
        // First closing pass over the arbitrary coordinate list (Req 12.1).
        const once = coordinatesToClosedRing(coordinates);
        // Well-formed finite pairs are always accepted; malformed-geometry
        // rejection is the Geometry_Engine's job, not this adapter's.
        expect(once.ok).toBe(true);
        if (!once.ok) return;

        // Serialize the closed ring back to the exact ordered pairs the model
        // would receive, then close that serialized ring a second time.
        const serialized = serializePolygonRing(once.polygon);
        const twice = coordinatesToClosedRing(serialized);
        expect(twice.ok).toBe(true);
        if (!twice.ok) return;

        // Idempotence: re-closing an already-closed ring does not append another
        // pair and reproduces an equal ring (Req 12.3).
        expect(twice.polygon).toEqual(once.polygon);
      }),
      { numRuns: 500 },
    );
  });

  it('closing an already-closed list returns equal coordinates and appends no extra pair', () => {
    fc.assert(
      fc.property(alreadyClosedListArb, (closed) => {
        const result = coordinatesToClosedRing(closed);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const ring = result.polygon.coordinates[0];
        // No additional closing pair appended when input is already closed.
        expect(ring.length).toBe(closed.length);
        // Coordinates are equal to the input, value-for-value and in order.
        expect(ring).toEqual(closed);
      }),
      { numRuns: 500 },
    );
  });

  // -------------------------------------------------------------------------
  // Concrete named examples pinning the same Property G behavior
  // -------------------------------------------------------------------------

  it('closes an open square once, and re-closing the serialized ring is a no-op', () => {
    const openSquare = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];

    const once = coordinatesToClosedRing(openSquare);
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    // The first pass appends a copy of the first pair to close the ring.
    expect(once.polygon.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);

    const twice = coordinatesToClosedRing(serializePolygonRing(once.polygon));
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    // Closing twice equals closing once.
    expect(twice.polygon).toEqual(once.polygon);
  });

  it('leaves an already-closed square unchanged', () => {
    const closedSquare = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];

    const result = coordinatesToClosedRing(closedSquare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.polygon.coordinates[0]).toEqual(closedSquare);
  });
});
