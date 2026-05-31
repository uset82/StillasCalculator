// CSV export serializer (Report_Module, Req 14.2, 14.4, 15.3).
//
// This is a PURE serializer over a snapshot of the Project_State. Given the
// single source of truth, it produces a CSV document with exactly one row per
// Material_List item (columns: name, quantity, unit) using the quantities
// currently stored in the Project_State, and embeds the Verification_Disclaimer
// in the output (Req 15.3). It refuses to produce a file when no Material_List
// exists, returning a failure result with a "complete a calculation first"
// message rather than throwing (Req 14.4).
//
// Design references:
// - Report Module: emits one row per item plus the disclaimer (Req 14.2, 15.3).
// - Property 28 (CSV row fidelity and round-trip): exactly one data row per
//   item, with name/quantity/unit columns that parse back to equal values.
//   Fields are escaped per RFC 4180 so that names containing commas, quotes,
//   or newlines round-trip losslessly.
// - Property 30 (disclaimer always present in exports): the
//   VERIFICATION_DISCLAIMER text always appears in the emitted CSV.

import {
  MaterialItem,
  ProjectState,
  VERIFICATION_DISCLAIMER,
} from '../types';

/**
 * Discriminated result of {@link serializeMaterialListCsv}. On success it
 * carries the serialized CSV text; on refusal it carries a human-readable
 * reason. The serializer never throws (Req 14.4, 14.7).
 */
export type CsvExportResult =
  | { ok: true; csv: string }
  | { ok: false; reason: string };

/** Column header row for the Material_List table (Req 14.2). */
export const CSV_HEADER = 'name,quantity,unit';

/**
 * Prefix used to mark the trailing Verification_Disclaimer line. Beginning the
 * line with `#` keeps it visually and programmatically distinct from the data
 * rows, so a reader can recover exactly one row per item (Property 28) while
 * the disclaimer text remains present in the file (Property 30).
 */
export const CSV_DISCLAIMER_PREFIX = '# ';

/** Message surfaced when no Material_List is available to export (Req 14.4). */
export const NO_MATERIAL_LIST_MESSAGE =
  'Complete a calculation first: there is no material list to export.';

// Line separator for the emitted CSV. A single LF keeps the output compact and
// platform-neutral; quoted fields may still contain embedded newlines, which a
// quote-aware reader handles per RFC 4180.
const LINE_SEP = '\n';

/**
 * Returns the Material_List currently stored in the Project_State, preferring
 * the user's manual overrides (`materialListAdjusted`) when present and falling
 * back to the deterministic calculation output (Req 14.2 — "quantities
 * currently stored"). Returns `null` when neither exists.
 */
function selectStoredMaterialList(state: ProjectState): MaterialItem[] | null {
  if (state.materialListAdjusted && state.materialListAdjusted.length > 0) {
    return state.materialListAdjusted;
  }
  if (state.calculation && state.calculation.materialList.length > 0) {
    return state.calculation.materialList;
  }
  return null;
}

/**
 * Escapes a single CSV field per RFC 4180: a field is wrapped in double quotes
 * when it contains a comma, a double quote, a carriage return, or a line feed,
 * and any embedded double quotes are doubled. This guarantees that arbitrary
 * item names round-trip losslessly through a quote-aware parser (Property 28).
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serializes one Material_List item into a `name,quantity,unit` CSV row. */
function serializeRow(item: MaterialItem): string {
  return [
    escapeCsvField(item.itemName),
    escapeCsvField(String(item.quantity)),
    escapeCsvField(item.unit),
  ].join(',');
}

/**
 * Serializes the current Material_List from a Project_State snapshot into a CSV
 * document (Req 14.2, 15.3).
 *
 * The output is a header row (`name,quantity,unit`), exactly one data row per
 * Material_List item using the currently stored quantities, a blank separator
 * line, and the Verification_Disclaimer on a final `#`-prefixed line.
 *
 * When the Project_State has no Material_List, it refuses to produce a file and
 * returns `{ ok: false, reason }` with a "complete a calculation first" message
 * (Req 14.4); it never throws.
 */
export function serializeMaterialListCsv(state: ProjectState): CsvExportResult {
  const items = selectStoredMaterialList(state);
  if (items === null) {
    return { ok: false, reason: NO_MATERIAL_LIST_MESSAGE };
  }

  const lines: string[] = [CSV_HEADER];
  for (const item of items) {
    lines.push(serializeRow(item));
  }

  // Blank separator keeps the data table contiguous, then the disclaimer is
  // appended on its own marked line so it is always present (Property 30)
  // without being mistaken for a Material_List row (Property 28).
  lines.push('');
  lines.push(CSV_DISCLAIMER_PREFIX + escapeCsvField(VERIFICATION_DISCLAIMER));

  return { ok: true, csv: lines.join(LINE_SEP) };
}
