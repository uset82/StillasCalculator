import { describe, it, expect } from "vitest";
import { formatMeasurement } from "./measurement";

// Unit tests for the measurement formatting helper (task 5.3, Req 6.5).
// Property 5 (formatted string has exactly the configured decimals for 0..3)
// is covered by the dedicated property test in task 5.8; these examples pin
// down specific edge cases and the helper's total, defensive behavior.
describe("formatMeasurement", () => {
  it("formats with exactly the configured decimal places (0..3)", () => {
    expect(formatMeasurement(12.3456, 0)).toBe("12");
    expect(formatMeasurement(12.3456, 1)).toBe("12.3");
    expect(formatMeasurement(12.3456, 2)).toBe("12.35");
    expect(formatMeasurement(12.3456, 3)).toBe("12.346");
  });

  it("pads with trailing zeros to reach the requested precision", () => {
    expect(formatMeasurement(5, 2)).toBe("5.00");
    expect(formatMeasurement(5.1, 3)).toBe("5.100");
  });

  it("rounds half values to the nearest representable decimal", () => {
    expect(formatMeasurement(0.005, 2)).toBe("0.01");
    expect(formatMeasurement(2.5, 0)).toBe("3");
  });

  it("normalizes values that round to zero so no '-0' is shown", () => {
    expect(formatMeasurement(-0.0001, 2)).toBe("0.00");
    expect(formatMeasurement(-0, 2)).toBe("0.00");
    expect(formatMeasurement(0, 0)).toBe("0");
  });

  it("clamps an out-of-range decimal-places count into 0..3", () => {
    // The helper formats with whatever count it is given; the controller is
    // responsible for rejecting out-of-range settings. Clamping keeps it total.
    expect(formatMeasurement(1.23456, -1)).toBe("1");
    expect(formatMeasurement(1.23456, 5)).toBe("1.235");
  });

  it("renders non-finite values as a zero of the requested precision", () => {
    expect(formatMeasurement(Number.NaN, 2)).toBe("0.00");
    expect(formatMeasurement(Number.POSITIVE_INFINITY, 1)).toBe("0.0");
  });
});
