import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Codex, type McpToolCallItem, type ThreadEvent } from '@openai/codex-sdk';

import type { ChatMessage, ScaffoldPlan } from '@/lib/types';
import { getSystemPrompt } from '@/lib/ai/systemPrompt';
import { readPlanFile, writePlanFile } from '@/lib/ai/planFileSync';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import {
  buildStillasMcpServerConfig,
  checkStillasMcpBridgeForPlan,
} from '@/lib/ai/mcpBridge';

const DEFAULT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_CODEX_TIMEOUT_MS = 45_000;
/**
 * Fixed upper bound on Codex tool round-trips per request, equivalent to the
 * OpenAI path's `MAX_TOOL_ITERATIONS = 8` (Req 9.4). Once this many tool calls
 * have executed, the runner stops consuming further tool calls for the turn and
 * returns the result produced so far (Req 9.6).
 */
const MAX_CODEX_TOOL_CALLS = 8;

export interface CodexToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type CodexAgentResult =
  | {
      ok: true;
      reply: string;
      toolResults: CodexToolResult[];
      scaffoldPlan: ScaffoldPlan;
    }
  | { ok: false; unavailable?: boolean; timedOut?: boolean; error: string };

function getCodexTimeoutMs(): number {
  const configured = Number(process.env.STILLAS_CODEX_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CODEX_TIMEOUT_MS;
}

function buildCodexPrompt(messages: readonly ChatMessage[]): string {
  const conversation = messages
    .filter((m) => typeof m.content === 'string')
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  return [
    getSystemPrompt(),
    '',
    'MANDATORY: You MUST use Stillas MCP tools for every calculation, drawing, CAD export,',
    'facade selection, scaffold update, and material list. Never invent quantities.',
    'Call getScaffoldPlan first when you need project context.',
    'After tool calls complete, explain results to the user.',
    '',
    'CONVERSATION:',
    conversation || '(no prior messages)',
    '',
    'Respond to the latest user message using the required tools.',
  ].join('\n');
}

function parseMcpToolResult(item: McpToolCallItem): CodexToolResult {
  const tool = item.tool;
  if (item.status === 'failed' || item.error) {
    return {
      tool,
      ok: false,
      error: item.error?.message ?? 'MCP tool call failed.',
    };
  }
  const textBlock = item.result?.content?.find((b) => b.type === 'text');
  const text =
    textBlock && 'text' in textBlock ? String(textBlock.text) : undefined;
  if (!text) {
    return { tool, ok: true, data: item.result?.structured_content };
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.error === 'string') {
      return { tool, ok: false, error: parsed.error };
    }
    return { tool, ok: true, data: parsed };
  } catch {
    return { tool, ok: true, data: { raw: text } };
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
  );
}

export async function runCodexAgentWithTools(
  messages: readonly ChatMessage[],
  initialPlan: ScaffoldPlan,
  sessionId: string,
): Promise<CodexAgentResult> {
  const auth = await getCodexCliAuthStatus();
  if (!auth.loggedIn || auth.method !== 'chatgpt') {
    return {
      ok: false,
      unavailable: true,
      error:
        'Codex CLI must be signed in with a ChatGPT/OpenAI account. Use the app sign-in flow or run `codex login`.',
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'stillas-codex-agent-'));
  const planFile = join(tempDir, 'scaffold-plan.json');
  await writePlanFile(planFile, initialPlan);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), getCodexTimeoutMs());
  const model =
    process.env.STILLAS_CODEX_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_CODEX_MODEL;

  const toolResults: CodexToolResult[] = [];
  let reply = '';

  try {
    const mcpStatus = await checkStillasMcpBridgeForPlan(planFile, sessionId);
    if (!mcpStatus.connected) {
      return {
        ok: false,
        unavailable: true,
        error:
          mcpStatus.error ??
          'The Stillas MCP tool bridge is not connected, so Codex cannot access the app tools.',
      };
    }

    const mcpServer = buildStillasMcpServerConfig(planFile, sessionId);
    const codex = new Codex({
      config: {
        mcp_servers: {
          stillas: mcpServer,
        },
      },
    });

    const thread = codex.startThread({
      workingDirectory: tempDir,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      model,
      modelReasoningEffort: 'low',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    });

    const streamed = await thread.runStreamed(buildCodexPrompt(messages), {
      signal: abortController.signal,
    });

    for await (const event of streamed.events as AsyncIterable<ThreadEvent>) {
      if (event.type === 'item.completed') {
        const item = event.item;
        if (item.type === 'mcp_tool_call') {
          if (toolResults.length >= MAX_CODEX_TOOL_CALLS) {
            // Reached the fixed tool round-trip bound (Req 9.4, 9.6): stop
            // consuming further tool calls and return the result so far.
            break;
          }
          toolResults.push(parseMcpToolResult(item));
        }
        if (item.type === 'agent_message') {
          reply = item.text;
        }
      }
      if (event.type === 'turn.failed') {
        return {
          ok: false,
          error: event.error.message ?? 'Codex turn failed.',
        };
      }
    }

    if (!reply.trim()) {
      reply = 'Done.';
    }

    const scaffoldPlan = await readPlanFile(planFile);
    return { ok: true, reply: reply.trim(), toolResults, scaffoldPlan };
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      return {
        ok: false,
        timedOut: true,
        error: 'The Codex SDK request timed out.',
      };
    }
    const message =
      error instanceof Error ? error.message : 'The Codex SDK request could not be completed.';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeoutId);
    try {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best-effort temp cleanup
    }
  }
}

/** Detects user messages that require tool execution. */
export function messageRequiresTools(content: string): boolean {
  const normalized = content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return /\b((?:re)?calcul\w*|math|measure\w*|drawing?|draw\w*|export\w*|cad|scaffold\w*|stillas\w*|material\w*|facade\w*|fasade\w*|perimeter\w*|perimetr\w*|omkrets\w*|estimate\w*|estimaci\w*|boms?|report\w*|informe\w*|andami\w*|fachad\w*|medici\w*|medid\w*|matematic\w*|dibuj\w*|tegning\w*|tegn\w*|beregn\w*|house|casa|building\w*|edificio\w*|footprint\w*|huella\w*|address\w*|direccion\w*|adresse\w*|length|lengde\w*|area|areal\w*)\b/.test(
    normalized,
  );
}

export async function writeSessionPlanFile(
  dir: string,
  plan: ScaffoldPlan,
): Promise<string> {
  const planFile = join(dir, 'scaffold-plan.json');
  await writeFile(planFile, JSON.stringify(plan, null, 2), 'utf8');
  return planFile;
}
