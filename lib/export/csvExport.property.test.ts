// Feature: stillas-calculator, Property 28: CSV row fidelity and round-trip
//
// Property 28 (design.md): *For any* Material_List, the generated CSV contains
// exactly one row per item with item-name, quantity, and unit columns, and
// parsing the CSV back yields the same item name/quantity/unit for every item.
//
// Validates: Requirements 14.2
//
// The serializer (lib/export/csvExport.ts) escapes fields per RFC 4180 so that
// names containing commas, double quotes, or CR/LF round-trip losslessly. This
// test therefore deliberately generates item names and units that contain those
// characters, serializes them, then parses the data rows back with an
// independent quote-aware RFC 4180 reader and asserts the values are preserved
// exactly, with exactly one data row per Material_List item.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { MaterialItem, ProjectState } from "@/lib/types";
import {
  serializeMaterialListCsv,
  CSV_HEADER,
} from "./csvExport";

// ---------------------------------------------------------------------------
// Independent, quote-aware RFC 4180 parser
// ---------------------------------------------------------------------------
//
// Returns one record (array of unescaped fields) per logical CSV row. A quoted
// field may span multiple physical lines (embedded CR/LF) and may contain
// doubled double-quotes; both are decoded here, independently of the serializer
// implementation, so the round-trip assertion is meaningful.
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      endField();
      i += 1;
    } else if (c === "\r") {
      endRecord();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (c === "\n") {
      endRecord();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  // Flush the trailing field/record (the file does not end with a newline).
  endRecord();
  return records;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A string that frequently contains the RFC 4180 "special" characters
// (comma, double quote, CR, LF, CRLF) interleaved with arbitrary text, so the
// escaping/round-trip logic is exercised across the interesting input space.
const trickyTextArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      fc.string(),
      fc.constantFrom(",", '"', "\n", "\r", "\r\n", '""', 'a,b', '"q"', " "),
    ),
    { maxLength: 6 },
  )
  .map((parts) => parts.join(""));

// Units are typically short tokens, but may also carry special characters.
const unitArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom("stk", "m", "m²", "pcs", "kg", "sett", "rør"),
  trickyTextArb,
);

// A Material_List of 1..30 items. Quantities are non-negative integers
// (Req 10.2). ids are synthesized and are irrelevant to the CSV round-trip.
const materialListArb: fc.Arbitrary<MaterialItem[]> = fc
  .array(
    fc.record({
      itemName: trickyTextArb,
      quantity: fc.nat({ max: 1_000_000 }),
      unit: unitArb,
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((rows) =>
    rows.map((row, index) => ({ id: `item-${index}`, ...row })),
  );

// Builds a minimal Project_State carrying the given Material_List either as the
// calculation output or as the manual override (materialListAdjusted); both are
// valid sources the serializer reads from (Req 14.2 — "quantities currently
// stored").
function buildState(
  items: MaterialItem[],
  useAdjusted: boolean,
): ProjectState {
  return {
    address: null,
    perimeterPolygon: null,
    measurements: null,
    selectedFacadeSideIndices: null,
    scaffoldLengthMeters: null,
    decimalPlaces: 2,
    wasteFactorPercent: 0,
    scaffoldSystemId: null,
    bayLengthMeters: null,
    liftHeightMeters: null,
    scaffoldWidthMeters: null,
    workingHeightMeters: null,
    calculation: useAdjusted
      ? null
      : {
          totalScaffoldLengthMeters: 0,
          numberOfBays: 1,
          numberOfLevels: 1,
          materialList: items,
          warnings: [],
        },
    materialListAdjusted: useAdjusted ? items : null,
    aiMessages: [],
    aiSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Property 28
// ---------------------------------------------------------------------------

describe("Property 28: CSV row fidelity and round-trip (Req 14.2)", () => {
  it("emits exactly one data row per item whose name/quantity/unit round-trips", () => {
    fc.assert(
      fc.property(
        materialListArb,
        fc.boolean(),
        (items, useAdjusted) => {
          const result = serializeMaterialListCsv(buildState(items, useAdjusted));

          // A non-empty Material_List always produces a CSV (Req 14.2).
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const records = parseCsvRecords(result.csv);

          // Record 0 is the header row: name,quantity,unit.
          expect(records[0]).toEqual(CSV_HEADER.split(","));

          // Records 1..N are exactly one data row per item, preserving every
          // field value verbatim through the RFC 4180 escape/parse round-trip.
          for (let i = 0; i < items.length; i += 1) {
            const row = records[i + 1];
            expect(row).toHaveLength(3);
            expect(row[0]).toBe(items[i].itemName);
            expect(row[1]).toBe(String(items[i].quantity));
            expect(row[2]).toBe(items[i].unit);
            // quantity column parses back to the exact integer.
            expect(Number(row[1])).toBe(items[i].quantity);
          }

          // "Exactly one row per item": the record immediately after the data
          // rows is the blank separator (a single empty field), confirming no
          // extra data rows were emitted beyond the N items.
          expect(records[items.length + 1]).toEqual([""]);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Concrete round-trip examples for the RFC 4180 escape characters, pinning
  // down the same Property 28 behavior on named edge cases.
  it("round-trips names containing commas, quotes, and newlines", () => {
    const items: MaterialItem[] = [
      { id: "a", itemName: "Standard, 3.0m", quantity: 12, unit: "stk" },
      { id: "b", itemName: 'Ledger "heavy"', quantity: 0, unit: "m" },
      { id: "c", itemName: "Brace\nwith newline", quantity: 7, unit: "sett" },
      { id: "d", itemName: "CRLF\r\nname", quantity: 3, unit: 'unit,"x"' },
    ];

    const result = serializeMaterialListCsv(buildState(items, false));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const records = parseCsvRecords(result.csv);
    expect(records[0]).toEqual(["name", "quantity", "unit"]);
    for (let i = 0; i < items.length; i += 1) {
      expect(records[i + 1]).toEqual([
        items[i].itemName,
        String(items[i].quantity),
        items[i].unit,
      ]);
    }
    expect(records[items.length + 1]).toEqual([""]);
  });
});
