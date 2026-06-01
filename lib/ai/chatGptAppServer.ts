import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import { calculateScaffoldMaterials } from '@/lib/scaffold/scaffoldCalculator';
import { getAllScaffoldSystems, getScaffoldSystem } from '@/lib/scaffold/scaffoldSystems';
import { createProjectStateController } from '@/lib/state/projectStateController';
import { createControllerPlanContext } from '@/lib/ai/planToolContext';
import { createToolDispatch, executeTool } from '@/lib/ai/toolExecutor';
import { VERIFICATION_DISCLAIMER, type MaterialItem, type ScaffoldSystemId } from '@/lib/types';

const APP_BASE_URL = 'https://stillascalculator.netlify.app';
const WIDGET_URI = 'ui://stillas/estimate-widget-v1.html';

const scaffoldSystemIdSchema = z.enum([
  'generic-frame',
  'haki',
  'layher',
  'instant-alufase',
  'custom',
]);

const optionalDimensionSchema = z
  .number()
  .min(0.01)
  .max(5)
  .nullable()
  .describe('Override in meters, or null to use the selected scaffold system default.');

const wasteFactorSchema = z
  .number()
  .min(0)
  .max(100)
  .nullable()
  .describe('Waste factor percent, or null for 0.');

const estimateFromLengthInputShape = {
  scaffoldLengthMeters: z
    .number()
    .positive()
    .describe('Total scaffold run length in meters.'),
  workingHeightMeters: z
    .number()
    .min(0.01)
    .max(100)
    .describe('Working height in meters.'),
  scaffoldSystemId: scaffoldSystemIdSchema.describe('Scaffold system to use.'),
  bayLengthMeters: optionalDimensionSchema,
  liftHeightMeters: optionalDimensionSchema,
  scaffoldWidthMeters: optionalDimensionSchema,
  wasteFactorPercent: wasteFactorSchema,
};

const estimateFromLocationInputShape = {
  address: z
    .string()
    .min(1)
    .nullable()
    .describe('Free-text address, or null when lat/lon are provided.'),
  lat: z.number().min(-90).max(90).nullable().describe('Latitude, or null when address is provided.'),
  lon: z
    .number()
    .min(-180)
    .max(180)
    .nullable()
    .describe('Longitude, or null when address is provided.'),
  selectionStrategy: z
    .enum(['nearest', 'largest'])
    .describe('Use nearest by default; largest only when the user asks for the main/largest footprint.'),
  workingHeightMeters: z
    .number()
    .min(0.01)
    .max(100)
    .describe('Working height in meters.'),
  scaffoldSystemId: scaffoldSystemIdSchema.describe('Scaffold system to use.'),
  bayLengthMeters: optionalDimensionSchema,
  liftHeightMeters: optionalDimensionSchema,
  scaffoldWidthMeters: optionalDimensionSchema,
  wasteFactorPercent: wasteFactorSchema,
};

const materialItemOutputSchema = z.object({
  id: z.string(),
  itemName: z.string(),
  quantity: z.number().int().nonnegative(),
  unit: z.string(),
  notes: z.string().nullable(),
});

const scaffoldSystemOutputSchema = z.object({
  id: scaffoldSystemIdSchema,
  displayName: z.string(),
  defaultBayLengthMeters: z.number(),
  defaultScaffoldWidthMeters: z.number(),
  defaultLiftHeightMeters: z.number(),
  isPlaceholder: z.boolean(),
  isCustom: z.boolean(),
});

const estimateOutputShape = {
  estimate: z.object({
    source: z.enum(['length', 'location']),
    address: z.string().nullable(),
    coordinate: z.object({ lat: z.number(), lon: z.number() }).nullable(),
    candidateCount: z.number().int().nonnegative().nullable(),
    selectedCandidate: z
      .object({
        index: z.number().int().nonnegative(),
        perimeterMeters: z.number(),
        areaSquareMeters: z.number(),
      })
      .nullable(),
    scaffoldLengthMeters: z.number(),
    workingHeightMeters: z.number(),
    dimensions: z.object({
      bayLengthMeters: z.number(),
      liftHeightMeters: z.number(),
      scaffoldWidthMeters: z.number(),
      wasteFactorPercent: z.number(),
    }),
    scaffoldSystem: scaffoldSystemOutputSchema,
    numberOfBays: z.number().int().positive(),
    numberOfLevels: z.number().int().positive(),
    totalScaffoldLengthMeters: z.number(),
    materialList: z.array(materialItemOutputSchema),
    warnings: z.array(z.string()),
    disclaimer: z.string(),
  }),
};

const systemsOutputShape = {
  systems: z.array(scaffoldSystemOutputSchema),
};

const estimateFromLengthInputSchema = z.object(estimateFromLengthInputShape);
const estimateFromLocationInputSchema = z.object(estimateFromLocationInputShape);
const estimateOutputSchema = z.object(estimateOutputShape);
const systemsOutputSchema = z.object(systemsOutputShape);

type EstimateFromLengthInput = z.infer<typeof estimateFromLengthInputSchema>;
type EstimateFromLocationInput = z.infer<typeof estimateFromLocationInputSchema>;
type EstimateOutput = z.infer<typeof estimateOutputSchema>;
type SystemsOutput = z.infer<typeof systemsOutputSchema>;

interface NormalizedCalculationInput {
  scaffoldLengthMeters: number;
  workingHeightMeters: number;
  scaffoldSystemId: ScaffoldSystemId;
  bayLengthMeters: number;
  liftHeightMeters: number;
  scaffoldWidthMeters: number;
  wasteFactorPercent: number;
}

type EstimateBuildResult =
  | { ok: true; output: EstimateOutput }
  | { ok: false; error: string };

function normalizeMaterialItems(items: readonly MaterialItem[]): EstimateOutput['estimate']['materialList'] {
  return items.map((item) => ({
    id: item.id,
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes ?? null,
  }));
}

function normalizeSystem(systemId: ScaffoldSystemId): EstimateOutput['estimate']['scaffoldSystem'] | null {
  const system = getScaffoldSystem(systemId);
  if (!system) {
    return null;
  }
  return {
    id: system.id,
    displayName: system.displayName,
    defaultBayLengthMeters: system.defaultBayLengthMeters,
    defaultScaffoldWidthMeters: system.defaultScaffoldWidthMeters,
    defaultLiftHeightMeters: system.defaultLiftHeightMeters,
    isPlaceholder: system.isPlaceholder,
    isCustom: system.isCustom,
  };
}

function normalizeCalculationInput(
  args: Omit<EstimateFromLengthInput, 'scaffoldLengthMeters'> & {
    scaffoldLengthMeters: number;
  },
): { ok: true; input: NormalizedCalculationInput; system: NonNullable<ReturnType<typeof normalizeSystem>> } | { ok: false; error: string } {
  const system = normalizeSystem(args.scaffoldSystemId as ScaffoldSystemId);
  if (!system) {
    return { ok: false, error: `Unknown scaffold system "${args.scaffoldSystemId}".` };
  }

  return {
    ok: true,
    system,
    input: {
      scaffoldLengthMeters: args.scaffoldLengthMeters,
      workingHeightMeters: args.workingHeightMeters,
      scaffoldSystemId: args.scaffoldSystemId as ScaffoldSystemId,
      bayLengthMeters: args.bayLengthMeters ?? system.defaultBayLengthMeters,
      liftHeightMeters: args.liftHeightMeters ?? system.defaultLiftHeightMeters,
      scaffoldWidthMeters: args.scaffoldWidthMeters ?? system.defaultScaffoldWidthMeters,
      wasteFactorPercent: args.wasteFactorPercent ?? 0,
    },
  };
}

function buildEstimate(
  source: EstimateOutput['estimate']['source'],
  args: Omit<EstimateFromLengthInput, 'scaffoldLengthMeters'> & { scaffoldLengthMeters: number },
  location: Pick<
    EstimateOutput['estimate'],
    'address' | 'coordinate' | 'candidateCount' | 'selectedCandidate'
  >,
): EstimateBuildResult {
  const normalized = normalizeCalculationInput(args);
  if (!normalized.ok) {
    return normalized;
  }

  const calculation = calculateScaffoldMaterials(normalized.input);
  if (!calculation.ok) {
    return { ok: false, error: calculation.error.message };
  }

  const output = estimateOutputSchema.parse({
    estimate: {
      source,
      ...location,
      scaffoldLengthMeters: normalized.input.scaffoldLengthMeters,
      workingHeightMeters: normalized.input.workingHeightMeters,
      dimensions: {
        bayLengthMeters: normalized.input.bayLengthMeters,
        liftHeightMeters: normalized.input.liftHeightMeters,
        scaffoldWidthMeters: normalized.input.scaffoldWidthMeters,
        wasteFactorPercent: normalized.input.wasteFactorPercent,
      },
      scaffoldSystem: normalized.system,
      numberOfBays: calculation.output.numberOfBays,
      numberOfLevels: calculation.output.numberOfLevels,
      totalScaffoldLengthMeters: calculation.output.totalScaffoldLengthMeters,
      materialList: normalizeMaterialItems(calculation.output.materialList),
      warnings: calculation.output.warnings,
      disclaimer: VERIFICATION_DISCLAIMER,
    },
  });

  return {
    ok: true,
    output,
  };
}

export function buildEstimateFromLengthInput(args: EstimateFromLengthInput): EstimateBuildResult {
  const parsed = estimateFromLengthInputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return buildEstimate('length', parsed.data, {
    address: null,
    coordinate: null,
    candidateCount: null,
    selectedCandidate: null,
  });
}

export async function buildEstimateFromLocationInput(
  args: EstimateFromLocationInput,
): Promise<EstimateBuildResult> {
  const parsed = estimateFromLocationInputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  args = parsed.data;

  const hasAddress = typeof args.address === 'string' && args.address.trim().length > 0;
  const hasCoordinate = args.lat !== null && args.lon !== null;
  if (hasAddress === hasCoordinate) {
    return {
      ok: false,
      error: 'Provide exactly one location input: either address or lat/lon coordinates.',
    };
  }

  const controller = createProjectStateController();
  const context = createControllerPlanContext(controller, `chatgpt-${Date.now()}`);
  const dispatch = createToolDispatch(context);
  const footprint = await executeTool(dispatch, context, 'setBuildingPerimeterFromLocation', {
    address: hasAddress ? args.address : null,
    lat: hasCoordinate ? args.lat : null,
    lon: hasCoordinate ? args.lon : null,
    selectionStrategy: args.selectionStrategy,
  });

  if (!footprint.ok) {
    return { ok: false, error: footprint.error };
  }

  const footprintData = footprint.data as {
    coordinate?: { lat: number; lon: number };
    candidateCount?: number;
    selectedCandidate?: {
      index: number;
      perimeterMeters: number;
      areaSquareMeters: number;
    };
  };
  const plan = context.getScaffoldPlan();
  if (typeof plan.scaffoldLengthMeters !== 'number' || !Number.isFinite(plan.scaffoldLengthMeters)) {
    return {
      ok: false,
      error: 'No usable scaffold length was produced from that location.',
    };
  }

  return buildEstimate(
    'location',
    {
      ...args,
      scaffoldLengthMeters: plan.scaffoldLengthMeters,
    },
    {
      address: hasAddress ? args.address : null,
      coordinate: footprintData.coordinate ?? (hasCoordinate ? { lat: args.lat!, lon: args.lon! } : null),
      candidateCount: footprintData.candidateCount ?? null,
      selectedCandidate: footprintData.selectedCandidate ?? null,
    },
  );
}

function buildSystemsOutput(): SystemsOutput {
  return systemsOutputSchema.parse({
    systems: getAllScaffoldSystems().map((system) => ({
      id: system.id,
      displayName: system.displayName,
      defaultBayLengthMeters: system.defaultBayLengthMeters,
      defaultScaffoldWidthMeters: system.defaultScaffoldWidthMeters,
      defaultLiftHeightMeters: system.defaultLiftHeightMeters,
      isPlaceholder: system.isPlaceholder,
      isCustom: system.isCustom,
    })),
  });
}

function estimateText(output: EstimateOutput): string {
  const { estimate } = output;
  return [
    `${estimate.scaffoldSystem.displayName}: ${estimate.numberOfBays} bays and ${estimate.numberOfLevels} levels.`,
    `Scaffold length: ${estimate.scaffoldLengthMeters.toFixed(2)} m.`,
    `Materials: ${estimate.materialList.length} line items. Professional verification is required before use.`,
  ].join(' ');
}

function toolError(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

function widgetHtml(): string {
  return `
<div id="root" class="stillas-widget">
  <header>
    <div>
      <strong>StillasCalculator</strong>
      <span>planning estimate</span>
    </div>
    <a href="${APP_BASE_URL}" target="_blank" rel="noreferrer">Open full calculator</a>
  </header>
  <main id="content">
    <p class="empty">Run a Stillas estimate from ChatGPT to see scaffold quantities here.</p>
  </main>
</div>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: transparent;
  }
  .stillas-widget {
    box-sizing: border-box;
    width: 100%;
    min-height: 260px;
    padding: 16px;
    color: #172018;
    background: #f7f8f4;
    border: 1px solid #d7dece;
    border-radius: 8px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #d7dece;
  }
  header strong {
    display: block;
    font-size: 16px;
    line-height: 1.2;
  }
  header span {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: #5d675a;
  }
  a {
    flex: 0 0 auto;
    color: #1d5c46;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }
  .empty {
    margin: 32px 0 12px;
    color: #5d675a;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 14px 0;
  }
  .metric {
    min-width: 0;
    padding: 10px;
    background: #ffffff;
    border: 1px solid #dfe5d8;
    border-radius: 6px;
  }
  .metric b {
    display: block;
    font-size: 18px;
    line-height: 1.2;
  }
  .metric span {
    display: block;
    margin-top: 3px;
    color: #687263;
    font-size: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
    font-size: 13px;
  }
  th, td {
    padding: 8px 6px;
    border-bottom: 1px solid #dfe5d8;
    text-align: left;
    vertical-align: top;
  }
  th:last-child, td:last-child {
    text-align: right;
  }
  .note {
    margin: 12px 0 0;
    color: #687263;
    font-size: 12px;
    line-height: 1.4;
  }
  @media (max-width: 520px) {
    .stillas-widget { padding: 12px; }
    header { align-items: flex-start; flex-direction: column; }
    .summary { grid-template-columns: 1fr; }
  }
  @media (prefers-color-scheme: dark) {
    .stillas-widget {
      color: #edf3e8;
      background: #151a14;
      border-color: #384234;
    }
    header { border-color: #384234; }
    header span, .empty, .metric span, .note { color: #aebba8; }
    a { color: #7fd2a9; }
    .metric {
      background: #1d241b;
      border-color: #384234;
    }
    th, td { border-color: #384234; }
  }
</style>
<script type="module">
  const content = document.getElementById('content');
  const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
  const number = (value, digits = 2) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '0.00';
  const renderEstimate = (estimate) => {
    const rows = estimate.materialList.slice(0, 12).map((item) => \`
      <tr>
        <td>\${escapeText(item.itemName)}</td>
        <td>\${escapeText(item.unit)}</td>
        <td>\${escapeText(item.quantity)}</td>
      </tr>\`).join('');
    content.innerHTML = \`
      <section class="summary">
        <div class="metric"><b>\${number(estimate.scaffoldLengthMeters)}</b><span>meters scaffold</span></div>
        <div class="metric"><b>\${escapeText(estimate.numberOfBays)}</b><span>bays</span></div>
        <div class="metric"><b>\${escapeText(estimate.numberOfLevels)}</b><span>levels</span></div>
      </section>
      <div class="note">\${escapeText(estimate.scaffoldSystem.displayName)} · working height \${number(estimate.workingHeightMeters)} m</div>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
      <p class="note">\${escapeText(estimate.disclaimer)}</p>
    \`;
  };
  const renderSystems = (systems) => {
    const rows = systems.map((system) => \`
      <tr>
        <td>\${escapeText(system.displayName)}</td>
        <td>\${number(system.defaultBayLengthMeters)}</td>
        <td>\${number(system.defaultLiftHeightMeters)}</td>
      </tr>\`).join('');
    content.innerHTML = \`
      <table>
        <thead><tr><th>System</th><th>Bay m</th><th>Lift m</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    \`;
  };
  const renderToolResult = (params) => {
    const structured = params && params.structuredContent;
    if (structured && structured.estimate) renderEstimate(structured.estimate);
    else if (structured && structured.systems) renderSystems(structured.systems);
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method === 'ui/notifications/tool-result') renderToolResult(message.params);
  }, { passive: true });
</script>
  `.trim();
}

export function createStillasChatGptAppServer(): McpServer {
  const server = new McpServer(
    { name: 'stillas-calculator-chatgpt-app', version: '0.1.0' },
    {
      instructions:
        'Use StillasCalculator tools for scaffold planning estimates. Never invent quantities. ' +
        'Ask for a scaffold length or address plus working height before estimating materials.',
    },
  );

  registerAppResource(
    server,
    'Stillas estimate widget',
    WIDGET_URI,
    {
      description: 'Interactive StillasCalculator estimate summary.',
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml(),
          _meta: {
            ui: {
              domain: APP_BASE_URL,
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [APP_BASE_URL],
              },
            },
            'openai/widgetDescription':
              'Shows scaffold planning estimates and material quantities from StillasCalculator.',
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    'list_scaffold_systems',
    {
      title: 'List scaffold systems',
      description: 'List scaffold systems and default bay, lift, and width dimensions available in StillasCalculator.',
      inputSchema: {},
      outputSchema: systemsOutputShape,
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        'openai/toolInvocation/invoking': 'Loading scaffold systems',
        'openai/toolInvocation/invoked': 'Scaffold systems loaded',
      },
    },
    async () => {
      const output = buildSystemsOutput();
      return {
        structuredContent: output,
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    },
  );

  registerAppTool(
    server,
    'estimate_scaffold_materials',
    {
      title: 'Estimate scaffold materials',
      description:
        'Calculate scaffold bays, levels, and material quantities from an explicit scaffold length and working height.',
      inputSchema: estimateFromLengthInputShape,
      outputSchema: estimateOutputShape,
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        'openai/toolInvocation/invoking': 'Calculating scaffold estimate',
        'openai/toolInvocation/invoked': 'Scaffold estimate ready',
      },
    },
    async (args) => {
      const result = buildEstimateFromLengthInput(args);
      if (!result.ok) {
        return toolError(result.error);
      }
      return {
        structuredContent: result.output,
        content: [{ type: 'text', text: estimateText(result.output) }],
      };
    },
  );

  registerAppTool(
    server,
    'estimate_scaffold_for_location',
    {
      title: 'Estimate scaffold for location',
      description:
        'Resolve an address or coordinate, select a nearby building footprint, then calculate scaffold material quantities.',
      inputSchema: estimateFromLocationInputShape,
      outputSchema: estimateOutputShape,
      annotations: { readOnlyHint: true, idempotentHint: false },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        'openai/toolInvocation/invoking': 'Finding building footprint',
        'openai/toolInvocation/invoked': 'Location estimate ready',
      },
    },
    async (args) => {
      const result = await buildEstimateFromLocationInput(args);
      if (!result.ok) {
        return toolError(result.error);
      }
      return {
        structuredContent: result.output,
        content: [{ type: 'text', text: estimateText(result.output) }],
      };
    },
  );

  return server;
}
