// Structured Output conformance gate (Req 4.1, 4.2, 4.3 — Property E).
//
// This is the single, provider-agnostic gate that both AI provider paths run
// every Material_List / report summary through before it can be presented or
// stored:
//
//   - the OpenRouter_Provider path (`runOpenRouterAgentWithTools`) calls
//     `buildStructuredOutput` per tool result inside its agent loop;
//   - the Codex_Provider path (`runCodexAgentWithTools`) calls
//     `buildStructuredOutputForToolResults` over the collected MCP tool results.
//
// In both cases a candidate that has a missing required field, an additional
// field not defined by the schema, or a wrong-typed field throws a
// `StructuredOutputError`, which the caller turns into an error indication while
// preserving the existing Project_State (Req 4.2). Extracting the logic here —
// rather than leaving it in a provider loop — keeps the gate identical on
// both backends and lets the Codex runner reuse it without importing the OpenAI
// SDK.

import type { MaterialItem, ScaffoldCalculationOutput } from '@/lib/types';
import type { ReportSummary } from '@/lib/ai/reportSummary';
import type { ToolName } from '@/lib/ai/toolExecutor';
import {
  MATERIAL_LIST_STRUCTURED_OUTPUT,
  REPORT_SUMMARY_STRUCTURED_OUTPUT,
} from '@/lib/ai/schemas';
import { validateAgainstSchema } from '@/lib/ai/validateStructuredOutput';

/**
 * Normalizes engine `MaterialItem`s to the strict Structured Output shape: every
 * property present, with `notes` expressed as `string | null` (strict mode
 * forbids omitting it). Works on both in-process engine objects (OpenAI path)
 * and JSON-round-tripped objects from the MCP server (Codex path).
 */
function normalizeMaterialItems(items: readonly MaterialItem[]): unknown[] {
  return items.map((item) => ({
    id: item.id,
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes ?? null,
  }));
}

function toStructuredMaterialList(output: ScaffoldCalculationOutput): unknown {
  return {
    totalScaffoldLengthMeters: output.totalScaffoldLengthMeters,
    numberOfBays: output.numberOfBays,
    numberOfLevels: output.numberOfLevels,
    materialList: normalizeMaterialItems(output.materialList),
    warnings: output.warnings,
  };
}

function toStructuredReportSummary(summary: ReportSummary): unknown {
  return {
    ...summary,
    materialList: normalizeMaterialItems(summary.materialList),
  };
}

/**
 * Thrown when a candidate Structured Output fails strict-schema validation. The
 * provider paths catch it and return an error indication without presenting or
 * storing the nonconforming output, preserving the existing Project_State
 * (Req 4.2).
 */
export class StructuredOutputError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly issues: string[],
  ) {
    super(`Structured output for "${schemaName}" failed: ${issues.join('; ')}`);
    this.name = 'StructuredOutputError';
  }
}

/**
 * Validates a single tool result's data against its strict Structured Output
 * schema when the tool produces one (`calculateScaffoldMaterials` →
 * Material_List, `generateReportSummary` → report summary). Returns the
 * schema-validated candidate to surface, or `undefined` for tools that do not
 * produce Structured Output. Throws {@link StructuredOutputError} when the
 * candidate has a missing required field, an additional field, or a wrong-typed
 * field (Req 4.1).
 */
export function buildStructuredOutput(tool: ToolName, data: unknown): unknown | undefined {
  if (tool === 'calculateScaffoldMaterials') {
    const candidate = toStructuredMaterialList(data as ScaffoldCalculationOutput);
    const issues = validateAgainstSchema(candidate, MATERIAL_LIST_STRUCTURED_OUTPUT.schema);
    if (issues.length > 0) {
      throw new StructuredOutputError(MATERIAL_LIST_STRUCTURED_OUTPUT.name, issues);
    }
    return candidate;
  }
  if (tool === 'generateReportSummary') {
    const candidate = toStructuredReportSummary(data as ReportSummary);
    const issues = validateAgainstSchema(candidate, REPORT_SUMMARY_STRUCTURED_OUTPUT.schema);
    if (issues.length > 0) {
      throw new StructuredOutputError(REPORT_SUMMARY_STRUCTURED_OUTPUT.name, issues);
    }
    return candidate;
  }
  return undefined;
}

/**
 * Runs the conformance gate over an ordered collection of tool results (the
 * Codex_Provider path). Returns the last schema-validated Structured Output to
 * surface, or `undefined` when no tool produced one. Throws
 * {@link StructuredOutputError} on the first nonconforming candidate so the
 * caller can withhold it from presentation and storage (Req 4.1, 4.2).
 */
export function buildStructuredOutputForToolResults(
  toolResults: ReadonlyArray<{ tool: string; ok: boolean; data?: unknown }>,
): unknown | undefined {
  let structuredOutput: unknown;
  for (const result of toolResults) {
    if (!result.ok) continue;
    const candidate = buildStructuredOutput(result.tool as ToolName, result.data);
    if (candidate !== undefined) structuredOutput = candidate;
  }
  return structuredOutput;
}
