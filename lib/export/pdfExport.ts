// PDF export serializer (Report_Module, Req 14.1, 14.3, 14.4, 14.5, 14.6, 15.2).
//
// This is a PURE serializer over a snapshot of the Project_State. Given the
// single source of truth, it produces a PDF document that contains:
//   - the address whenever one is present, independently of whether a
//     perimeter has been computed (Req 14.5);
//   - the computed perimeter in meters when measurements exist (Req 14.1);
//   - the selected scaffold system (Req 14.1);
//   - one line per Material_List item using the quantities currently stored in
//     the Project_State (Req 14.1);
//   - the AI-generated summary when one exists in the Project_State (Req 14.6);
//   - the Verification_Disclaimer, always (Req 14.3, 15.2).
//
// It refuses to produce a file when no Material_List exists, returning a
// failure result with a "complete a calculation first" message rather than
// throwing (Req 14.4), and it never throws on a rendering failure either,
// returning a failure result instead so the caller can preserve Project_State
// and surface an error (Req 14.7).
//
// Design references:
// - Report Module: the PDF is a pure serializer over a Project_State snapshot
//   that bundles address, perimeter, selected system, the current material-list
//   quantities, an optional AI summary, and the disclaimer (design "Report
//   Module").
// - Property 27 (PDF report content inclusion): the textual content model
//   returned by `buildReportContent` is the faithful, inspectable
//   representation of everything rendered into the PDF, so the property test
//   can assert inclusion of the address (when present), perimeter, selected
//   system, every current item quantity, and the AI summary (when present)
//   without decoding PDF byte streams.
// - Property 29 (export refused without a material list): with no Material_List
//   the serializer produces no file and returns the shared "complete a
//   calculation first" message.
// - Property 30 (disclaimer always present in exports): the
//   VERIFICATION_DISCLAIMER text is always part of the content model and the
//   rendered PDF.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatMeasurement } from '../format/measurement';
import { getScaffoldSystem } from '../scaffold/scaffoldSystems';
import {
  MaterialItem,
  ProjectState,
  VERIFICATION_DISCLAIMER,
} from '../types';

/**
 * Discriminated result of {@link serializeReportPdf}. On success it carries the
 * serialized PDF bytes; on refusal or failure it carries a human-readable
 * reason. The serializer never throws (Req 14.4, 14.7).
 */
export type PdfExportResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; reason: string };

/** Message surfaced when no Material_List is available to export (Req 14.4). */
export const NO_MATERIAL_LIST_MESSAGE =
  'Complete a calculation first: there is no material list to export.';

/** Title rendered at the top of the report (planning-estimate terminology, Req 15.6). */
export const PDF_REPORT_TITLE = 'Scaffold Material Estimate';

/**
 * A single Material_List row as it appears in the report: the name, the
 * currently stored quantity, the unit, and the optional note (Req 14.1, 11.1).
 */
export interface ReportMaterialRow {
  name: string;
  quantity: number;
  unit: string;
  notes?: string;
}

/**
 * The faithful textual content model of the report. Every field here is
 * rendered into the PDF, so a property test can assert content inclusion
 * against this model directly (Property 27) without decoding the PDF bytes.
 */
export interface ReportContent {
  title: string;
  /** Address label, present whenever an address exists (Req 14.5). */
  address: string | null;
  /** Formatted perimeter with unit, present when measurements exist (Req 14.1). */
  perimeter: string | null;
  /** Selected scaffold system display name, present when a system is selected. */
  selectedSystem: string | null;
  /** One entry per Material_List item using current stored quantities (Req 14.1). */
  materialRows: ReportMaterialRow[];
  /** AI-generated summary, present only when one exists (Req 14.6). */
  aiSummary: string | null;
  /** The Verification_Disclaimer, always present (Req 14.3, 15.2). */
  disclaimer: string;
}

// --- Page geometry (A4 in PostScript points) -------------------------------
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// --- Font sizing -----------------------------------------------------------
const TITLE_SIZE = 20;
const HEADING_SIZE = 13;
const BODY_SIZE = 11;
const LINE_GAP = 4; // extra leading between rendered lines

/**
 * Returns the Material_List currently stored in the Project_State, preferring
 * the user's manual overrides (`materialListAdjusted`) when present and falling
 * back to the deterministic calculation output (Req 14.1 — "quantities
 * currently stored"). Returns `null` when neither exists.
 *
 * This mirrors the CSV serializer's selection so PDF and CSV always export the
 * same quantities from the same snapshot.
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
 * Builds the textual content model for the report from a Project_State
 * snapshot, or returns `null` when no Material_List exists (the signal to
 * refuse export, Req 14.4).
 *
 * - Address is included whenever present, independently of the perimeter
 *   (Req 14.5).
 * - Perimeter is formatted with the configured decimal places and a metre unit
 *   when measurements exist (Req 14.1, 6.5).
 * - The selected scaffold system uses its library display name, falling back to
 *   its id when the library has no match.
 * - Material rows use the currently stored quantities (Req 14.1).
 * - The AI summary is included only when present (Req 14.6).
 * - The disclaimer is always present (Req 14.3, 15.2).
 */
export function buildReportContent(state: ProjectState): ReportContent | null {
  const items = selectStoredMaterialList(state);
  if (items === null) {
    return null;
  }

  const address = state.address ? state.address.label : null;

  const perimeter =
    state.measurements !== null
      ? `${formatMeasurement(
          state.measurements.perimeterMeters,
          state.decimalPlaces
        )} m`
      : null;

  let selectedSystem: string | null = null;
  if (state.scaffoldSystemId !== null) {
    const system = getScaffoldSystem(state.scaffoldSystemId);
    selectedSystem = system ? system.displayName : state.scaffoldSystemId;
  }

  const aiSummary =
    state.aiSummary !== null && state.aiSummary.trim().length > 0
      ? state.aiSummary
      : null;

  return {
    title: PDF_REPORT_TITLE,
    address,
    perimeter,
    selectedSystem,
    materialRows: items.map((item) => ({
      name: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
    })),
    aiSummary,
    disclaimer: VERIFICATION_DISCLAIMER,
  };
}

/**
 * Replaces any character the StandardFonts (WinAnsi) encoding cannot represent
 * with a `?` so that text drawing never throws on out-of-range code points
 * (e.g. emoji or CJK). Latin-1 text — including Norwegian å/ø/æ — is preserved.
 */
function sanitizeForWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Keep tab/newline handling to the wrapper; drop other C0 controls.
    if (code === 0x09) {
      out += ' ';
    } else if (code < 0x20 || code > 0xff) {
      out += '?';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Wraps `text` to fit `maxWidth` at `size` using `font` metrics, splitting on
 * whitespace and hard-breaking words that are individually wider than the
 * available width. Returns at least one (possibly empty) line.
 */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = sanitizeForWinAnsi(text).split('\n');

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        lines.push(current);
        current = '';
      }

      // The word itself may exceed the width: hard-break it by characters.
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          const next = chunk + ch;
          if (font.widthOfTextAtSize(next, size) <= maxWidth) {
            chunk = next;
          } else {
            if (chunk.length > 0) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
    if (current.length > 0) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * A tiny stateful cursor that lays out lines top-to-bottom across one or more
 * A4 pages, adding a new page whenever the next line would cross the bottom
 * margin. Keeps the serializer's layout code linear and easy to follow.
 */
class PageCursor {
  private page: PDFPage;
  private y: number;

  constructor(private readonly doc: PDFDocument) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(lineHeight: number): void {
    if (this.y - lineHeight < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  /** Draws one already-fitted line of text and advances the cursor. */
  drawLine(text: string, font: PDFFont, size: number): void {
    const lineHeight = size + LINE_GAP;
    this.ensureSpace(lineHeight);
    this.y -= lineHeight;
    this.page.drawText(text, {
      x: MARGIN,
      y: this.y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  /** Wraps `text` to the content width and draws every resulting line. */
  drawWrapped(text: string, font: PDFFont, size: number): void {
    for (const line of wrapText(text, font, size, CONTENT_WIDTH)) {
      this.drawLine(line, font, size);
    }
  }

  /** Advances the cursor by a blank vertical gap (no drawing). */
  addGap(amount: number): void {
    this.y -= amount;
  }
}

/**
 * Serializes the current Project_State snapshot into a PDF report (Req 14.1,
 * 14.3, 14.5, 14.6, 15.2).
 *
 * Returns `{ ok: false, reason }` with the "complete a calculation first"
 * message when no Material_List exists (Req 14.4), and `{ ok: false, reason }`
 * with the thrown error's message if PDF generation fails for any other reason,
 * leaving it to the caller to preserve Project_State (Req 14.7). On success it
 * returns the generated PDF as a `Uint8Array` ready to download.
 */
export async function serializeReportPdf(
  state: ProjectState
): Promise<PdfExportResult> {
  const content = buildReportContent(state);
  if (content === null) {
    return { ok: false, reason: NO_MATERIAL_LIST_MESSAGE };
  }

  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const cursor = new PageCursor(doc);

    // Title.
    cursor.drawWrapped(content.title, boldFont, TITLE_SIZE);
    cursor.addGap(HEADING_SIZE);

    // Project details: address (when present, independent of perimeter),
    // perimeter (when measured), and the selected system.
    if (content.address !== null) {
      cursor.drawWrapped(`Address: ${content.address}`, font, BODY_SIZE);
    }
    if (content.perimeter !== null) {
      cursor.drawWrapped(`Perimeter: ${content.perimeter}`, font, BODY_SIZE);
    }
    if (content.selectedSystem !== null) {
      cursor.drawWrapped(
        `Scaffold system: ${content.selectedSystem}`,
        font,
        BODY_SIZE
      );
    }

    // Material list.
    cursor.addGap(HEADING_SIZE);
    cursor.drawLine('Material list', boldFont, HEADING_SIZE);
    for (const row of content.materialRows) {
      const base = `${row.name}: ${row.quantity} ${row.unit}`;
      const line = row.notes ? `${base} (${row.notes})` : base;
      cursor.drawWrapped(line, font, BODY_SIZE);
    }

    // Optional AI summary (Req 14.6).
    if (content.aiSummary !== null) {
      cursor.addGap(HEADING_SIZE);
      cursor.drawLine('Summary', boldFont, HEADING_SIZE);
      cursor.drawWrapped(content.aiSummary, font, BODY_SIZE);
    }

    // Verification disclaimer, always present (Req 14.3, 15.2).
    cursor.addGap(HEADING_SIZE);
    cursor.drawLine('Disclaimer', boldFont, HEADING_SIZE);
    cursor.drawWrapped(content.disclaimer, font, BODY_SIZE);

    const pdf = await doc.save();
    return { ok: true, pdf };
  } catch (error) {
    const reason =
      error instanceof Error
        ? `PDF export failed: ${error.message}`
        : 'PDF export failed.';
    return { ok: false, reason };
  }
}
