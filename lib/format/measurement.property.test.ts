// Feature: stillas-calculator, Property 5: Measurement formatting honors decimal places
//
// Property 5 (design.md "Correctness Properties"):
//   For any numeric measurement value and any decimal-places setting in the
//   inclusive range 0 to 3, the formatted display string has exactly that many
//   decimal places, and any decimal-places value outside 0 to 3 is rejected in
//   favor of the last valid setting.
//
// Validates: Requirements 6.5
//
// The property has two halves, each backed by its own deterministic component:
//
//   Part 1 (formatting) exercises `formatMeasurement(value, places)`: for any
//   finite value and any `places` in 0..3 the result must carry exactly
//   `places` digits after the decimal point — and no decimal point at all when
//   `places === 0`. We verify the digit count by splitting on '.'.
//
//   Part 2 (setting rejection) exercises the state controller's
//   `setDecimalPlaces`: integers 0..3 are accepted and stored, while every
//   out-of-range or non-integer candidate is rejected so the last valid setting
//   is retained in `getState().decimalPlaces`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatMeasurement } from './measurement';
import { createProjectStateController } from '@/lib/state/projectStateController';

const MIN_RUNS = 200;

/** The inclusive decimal-places range the display supports (Req 6.5). */
const VALID_PLACES = [0, 1, 2, 3] as const;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Any finite measurement value: covers positive/negative magnitudes, tiny
 * fractions, large values, and exact integers. `noNaN`/`noDefaultInfinity`
 * keep the value finite, which is the documented input domain for formatting.
 */
const finiteValueArb: fc.Arbitrary<number> = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A valid decimal-places setting in the inclusive range 0..3. */
const validPlacesArb: fc.Arbitrary<number> = fc.constantFrom(...VALID_PLACES);

/**
 * Candidate decimal-places values that must be rejected by `setDecimalPlaces`:
 *   - out-of-range integers (negative or > 3), and
 *   - non-integer finite numbers (including ones whose integer part is in 0..3).
 * Excludes the accepted integers 0..3 so every generated value is genuinely
 * invalid.
 */
const invalidPlacesArb: fc.Arbitrary<number> = fc
  .oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  )
  .filter((value) => !(Number.isInteger(value) && value >= 0 && value <= 3));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counts the digits after the decimal point in a formatted string. */
function decimalDigitCount(formatted: string): number {
  const dotIndex = formatted.indexOf('.');
  return dotIndex === -1 ? 0 : formatted.length - dotIndex - 1;
}

// ---------------------------------------------------------------------------
// Part 1 — formatting honors the requested decimal places
// ---------------------------------------------------------------------------

describe('Property 5 (Part 1): formatMeasurement honors decimal places', () => {
  it('produces exactly `places` decimal digits for any finite value and places 0..3', () => {
    fc.assert(
      fc.property(finiteValueArb, validPlacesArb, (value, places) => {
        const formatted = formatMeasurement(value, places);

        // Exactly `places` digits after the decimal separator (Req 6.5).
        expect(decimalDigitCount(formatted)).toBe(places);

        if (places === 0) {
          // No decimal point at all at 0 places.
          expect(formatted.includes('.')).toBe(false);
        } else {
          // A single decimal point followed by exactly `places` digits.
          const parts = formatted.split('.');
          expect(parts).toHaveLength(2);
          expect(parts[1]).toHaveLength(places);
          expect(/^\d+$/.test(parts[1])).toBe(true);
        }

        // The formatted string is a faithful, parseable rendering of a number.
        expect(Number.isNaN(Number.parseFloat(formatted))).toBe(false);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the decimal-places setting accepts 0..3 and rejects everything else
// ---------------------------------------------------------------------------

describe('Property 5 (Part 2): setDecimalPlaces accepts 0..3 and retains last valid on rejection', () => {
  it('accepts every integer in 0..3 and stores it', () => {
    fc.assert(
      fc.property(validPlacesArb, (places) => {
        const controller = createProjectStateController();
        const result = controller.setDecimalPlaces(places);

        expect(result.ok).toBe(true);
        expect(controller.getState().decimalPlaces).toBe(places);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('rejects out-of-range / non-integer values, retaining the last valid setting', () => {
    fc.assert(
      fc.property(validPlacesArb, invalidPlacesArb, (lastValid, invalid) => {
        const controller = createProjectStateController();

        // Establish a known last-valid setting.
        expect(controller.setDecimalPlaces(lastValid).ok).toBe(true);
        expect(controller.getState().decimalPlaces).toBe(lastValid);

        // The invalid candidate is rejected with a field-identifying error...
        const result = controller.setDecimalPlaces(invalid);
        expect(result.ok).toBe(false);
        expect(result.error?.field).toBe('decimalPlaces');

        // ...and the previously accepted setting is retained (Req 6.5).
        expect(controller.getState().decimalPlaces).toBe(lastValid);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
