import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';

import type { ChatMessage } from '@/lib/types';
import type { AiToolResult } from '@/app/api/ai/chat/route';
import {
  createToolDispatch,
  executeTool,
  getToolDefinitions,
  type ToolName,
} from '@/lib/ai/toolExecutor';
import { createControllerPlanContext } from '@/lib/ai/planToolContext';
import {
  buildStructuredOutput,
  StructuredOutputError,
} from '@/lib/ai/structuredOutputGate';
import { getSystemPrompt } from '@/lib/ai/systemPrompt';
import { scaffoldPlanController } from '@/lib/state/projectStateController';

export const MAX_TOOL_ITERATIONS = 8;
const DEFAULT_MODEL = 'gpt-4o';

// The Structured Output conformance gate (`buildStructuredOutput`,
// `StructuredOutputError`) lives in `lib/ai/structuredOutputGate.ts` so the
// OpenAI and Codex provider paths run the identical gate (Req 4.1). Re-exported
// here to preserve existing import sites (the chat route catches
// `StructuredOutputError`).
export { buildStructuredOutput, StructuredOutputError };

function buildOpenAiTools(): OpenAI.Responses.Tool[] {
  return getToolDefinitions().map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as Record<string, unknown>,
    strict: true,
  }));
}

function buildInputFromMessages(
  messages: ChatMessage[],
): OpenAI.Responses.ResponseInputItem[] {
  return messages
    .filter((message) => typeof message.content === 'string')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

export interface OpenAiAgentResult {
  reply: string;
  toolResults: AiToolResult[];
  structuredOutput?: unknown;
}

export async function runOpenAiAgentWithTools(
  client: OpenAI,
  messages: ChatMessage[],
  sessionId: string,
  signal: AbortSignal,
  requireToolCall = false,
  model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
): Promise<OpenAiAgentResult> {
  const planContext = createControllerPlanContext(scaffoldPlanController, sessionId);
  const dispatch = createToolDispatch(planContext);
  const tools = buildOpenAiTools();
  const instructions = getSystemPrompt();
  const input = buildInputFromMessages(messages);
  const toolResults: AiToolResult[] = [];
  let structuredOutput: unknown;

  let response = await client.responses.create(
    {
      model,
      instructions,
      tools,
      input,
      tool_choice: requireToolCall ? 'required' : 'auto',
    },
    { signal, maxRetries: 0 },
  );

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === 'function_call',
    );
    if (functionCalls.length === 0) break;

    for (const call of functionCalls) {
      input.push(call);
      const name = call.name as ToolName;
      const result = await executeTool(dispatch, planContext, name, parseToolArguments(call.arguments));

      if (result.ok) {
        const candidate = buildStructuredOutput(name, result.data);
        if (candidate !== undefined) structuredOutput = candidate;
        toolResults.push({ tool: name, ok: true, data: result.data });
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result.data),
        });
      } else {
        toolResults.push({ tool: name, ok: false, error: result.error });
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({ error: result.error }),
        });
      }
    }

    response = await client.responses.create(
      { model, instructions, tools, input },
      { signal, maxRetries: 0 },
    );
  }

  return {
    reply: response.output_text,
    toolResults,
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
  };
}

export function newAiSessionId(): string {
  return randomUUID();
}
