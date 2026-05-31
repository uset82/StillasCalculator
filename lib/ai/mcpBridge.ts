import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import { writePlanFile } from '@/lib/ai/planFileSync';
import { getToolDefinitions } from '@/lib/ai/toolExecutor';

const MCP_BRIDGE_TIMEOUT_MS = 8_000;

export interface StillasMcpServerConfig {
  [key: string]: string | string[] | Record<string, string>;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface StillasMcpBridgeStatus {
  connected: boolean;
  persistent: boolean;
  toolCount: number;
  missingTools: string[];
  checkedAt: number | null;
  error?: string;
}

interface PersistentBridge {
  client: Client;
  tempDir: string;
  planFile: string;
}

let persistentBridge: PersistentBridge | null = null;
let persistentStartPromise: Promise<StillasMcpBridgeStatus> | null = null;

function getMcpServerScriptPath(): string {
  return join(process.cwd(), 'scripts', 'stillas-mcp-server.ts');
}

function getTsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

function getTsconfigPath(): string {
  return join(process.cwd(), 'tsconfig.json');
}

export function buildStillasMcpServerConfig(
  planFile: string,
  sessionId: string,
  cwd = process.cwd(),
): StillasMcpServerConfig {
  return {
    command: process.execPath,
    args: [getTsxCliPath(), getMcpServerScriptPath()],
    cwd,
    env: {
      STILLAS_PLAN_FILE: planFile,
      STILLAS_SESSION_ID: sessionId,
      TSX_TSCONFIG_PATH: getTsconfigPath(),
    },
  };
}

function requiredToolNames(): string[] {
  return getToolDefinitions().map((tool) => tool.name);
}

function statusFromToolNames(
  toolNames: readonly string[],
  persistent: boolean,
): StillasMcpBridgeStatus {
  const available = new Set(toolNames);
  const missingTools = requiredToolNames().filter((name) => !available.has(name));
  return {
    connected: missingTools.length === 0,
    persistent,
    toolCount: toolNames.length,
    missingTools,
    checkedAt: Date.now(),
    ...(missingTools.length > 0
      ? { error: `MCP bridge is missing tools: ${missingTools.join(', ')}.` }
      : {}),
  };
}

function disconnectedStatus(
  persistent: boolean,
  error: unknown,
): StillasMcpBridgeStatus {
  return {
    connected: false,
    persistent,
    toolCount: 0,
    missingTools: requiredToolNames(),
    checkedAt: Date.now(),
    error:
      error instanceof Error
        ? error.message
        : 'The Stillas MCP tool bridge could not be reached.',
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out.`)),
      MCP_BRIDGE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function listBridgeToolNames(client: Client): Promise<string[]> {
  const response = await withTimeout(
    client.listTools(),
    'Listing Stillas MCP tools',
  );
  return response.tools.map((tool) => tool.name);
}

async function connectClient(config: StillasMcpServerConfig): Promise<Client> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stillas-calculator-app', version: '1.0.0' });
  await withTimeout(client.connect(transport), 'Connecting Stillas MCP bridge');
  return client;
}

export async function checkStillasMcpBridgeForPlan(
  planFile: string,
  sessionId: string,
): Promise<StillasMcpBridgeStatus> {
  let client: Client | null = null;
  try {
    client = await connectClient(buildStillasMcpServerConfig(planFile, sessionId));
    const toolNames = await listBridgeToolNames(client);
    return statusFromToolNames(toolNames, false);
  } catch (error) {
    return disconnectedStatus(false, error);
  } finally {
    if (client) {
      await client.close().catch(() => undefined);
    }
  }
}

async function startPersistentBridge(): Promise<StillasMcpBridgeStatus> {
  const tempDir = await mkdtemp(join(tmpdir(), 'stillas-mcp-bridge-'));
  const planFile = join(tempDir, 'scaffold-plan.json');
  await writePlanFile(planFile, createScaffoldPlan());

  try {
    const client = await connectClient(
      buildStillasMcpServerConfig(planFile, 'persistent-mcp-bridge', tempDir),
    );
    const toolNames = await listBridgeToolNames(client);
    const status = statusFromToolNames(toolNames, true);
    if (!status.connected) {
      await client.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      return status;
    }
    persistentBridge = { client, tempDir, planFile };
    return status;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return disconnectedStatus(true, error);
  }
}

export async function ensurePersistentMcpToolBridge(): Promise<StillasMcpBridgeStatus> {
  if (persistentBridge) {
    try {
      const toolNames = await listBridgeToolNames(persistentBridge.client);
      return statusFromToolNames(toolNames, true);
    } catch {
      await closePersistentMcpToolBridge();
    }
  }

  if (!persistentStartPromise) {
    persistentStartPromise = startPersistentBridge().finally(() => {
      persistentStartPromise = null;
    });
  }
  return persistentStartPromise;
}

export async function closePersistentMcpToolBridge(): Promise<void> {
  const bridge = persistentBridge;
  persistentBridge = null;
  if (!bridge) return;
  await bridge.client.close().catch(() => undefined);
  await rm(bridge.tempDir, { recursive: true, force: true }).catch(() => undefined);
}
