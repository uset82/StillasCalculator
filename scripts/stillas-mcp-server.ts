#!/usr/bin/env npx tsx
/**
 * StillasCalculator MCP server — exposes deterministic app tools to Codex CLI.
 * Env: STILLAS_PLAN_FILE (required), STILLAS_SESSION_ID (optional)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { readPlanFile, writePlanFile } from '../lib/ai/planFileSync';
import { createFilePlanContext } from '../lib/ai/planToolContext';
import {
  createToolDispatch,
  executeTool,
  getToolDefinitions,
  type ToolName,
} from '../lib/ai/toolExecutor';
import type { ScaffoldPlan } from '../lib/types';

const planFilePath = process.env.STILLAS_PLAN_FILE;
const sessionId = process.env.STILLAS_SESSION_ID ?? 'mcp-default';

if (!planFilePath) {
  console.error('STILLAS_PLAN_FILE is required');
  process.exit(1);
}

const planFile: string = planFilePath;

let cachedPlan: ScaffoldPlan | null = null;

async function loadPlan(): Promise<ScaffoldPlan> {
  if (!cachedPlan) {
    cachedPlan = await readPlanFile(planFile);
  }
  return cachedPlan;
}

async function savePlan(plan: ScaffoldPlan): Promise<void> {
  cachedPlan = plan;
  await writePlanFile(planFile, plan);
}

const context = createFilePlanContext(
  () => cachedPlan!,
  (plan) => {
    cachedPlan = plan;
    void writePlanFile(planFile, plan);
  },
  sessionId,
);

const dispatch = createToolDispatch(context);

const server = new Server(
  { name: 'stillas-calculator', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await loadPlan();
  const name = request.params.name as ToolName;
  const args = request.params.arguments ?? {};
  const result = await executeTool(dispatch, context, name, args);
  await savePlan(context.getScaffoldPlan());

  if (result.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }],
    isError: true,
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
