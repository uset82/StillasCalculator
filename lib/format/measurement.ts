// Measurement formatting helper for the StillasCalculator display layer.
//
// This module exposes a single pure function, `formatMeasurement`, that renders
// a numeric measurement (perimeter, area, side length, scaffold length, ...) to
// exactly the configured number of decimal places (Req 6.5). It is the
// formatting half of Property 5 ("Measurement formatting honors decimal
// places"): for any decimal-places setting in the inclusive range 0 to 3, the
// formatted string has exactly that many decimals.
//
// Rejecting an out-of-range decimal-places *setting* in favor of the last valid
// one is the state controller's job (task 5.2 / Property 5 in task 5.8); this
// helper only performs the formatting given a count.

/** Smallest decimal-place setting supported by the measurement display (Req 6.5). */
const MIN_DECIMAL_PLACES = 0;

/** Largest decimal-place setting supported by the measurement display (Req 6.5). */
const MAX_DECIMAL_PLACES = 3;

/** Default decimal-place setting (Req 6.5). */
const DEFAULT_DECIMAL_PLACES = 2;

/**
 * Format a numeric measurement to exactly `decimalPlaces` decimal places.
 *
 * For any finite `value` and any `decimalPlaces` in the inclusive range 0 to 3,
 * the returned string has exactly `decimalPlaces` digits after the decimal
 * separator (and no separator at all when `decimalPlaces` is 0).
 *
 * The function is pure and total: `decimalPlaces` is rounded to the nearest
 * integer and clamped to the supported 0..3 range so it never throws, a
 * non-finite `value` is rendered as a zero of the requested precision, and a
 * value that rounds to zero is normalized so the output never carries a
 * spurious "-0" sign.
 *
 * @param value         the measurement to format (meters, square meters, ...)
 * @param decimalPlaces the configured number of decimals, expected 0..3
 * @returns the value rendered with exactly `decimalPlaces` decimal places
 */
export function formatMeasurement(value: number, decimalPlaces: number): string {
  const places = clampDecimalPlaces(decimalPlaces);

  // Non-finite values (NaN, +/-Infinity) cannot be rendered with a fixed number
  // of decimals; fall back to a zero of the requested precision so the output
  // shape stays stable in the UI.
  const safeValue = Number.isFinite(value) ? value : 0;

  const formatted = safeValue.toFixed(places);

  // Normalize "-0", "-0.00", ... (a value that rounds to zero) to a positive
  // zero string so the display never shows a misleading negative sign.
  if (Number.parseFloat(formatted) === 0) {
    return (0).toFixed(places);
  }

  return formatted;
}

/**
 * Round `decimalPlaces` to an integer and clamp it to the supported 0..3 range,
 * falling back to the default when the value is non-finite.
 */
function clampDecimalPlaces(decimalPlaces: number): number {
  if (!Number.isFinite(decimalPlaces)) {
    return DEFAULT_DECIMAL_PLACES;
  }
  const rounded = Math.round(decimalPlaces);
  if (rounded < MIN_DECIMAL_PLACES) {
    return MIN_DECIMAL_PLACES;
  }
  if (rounded > MAX_DECIMAL_PLACES) {
    return MAX_DECIMAL_PLACES;
  }
  return rounded;
}
