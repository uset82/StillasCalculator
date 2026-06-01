import { randomUUID } from 'node:crypto';

import {
  fromChatMessages,
  OpenRouter,
  stepCountIs,
  tool,
  type Item,
  type Tool,
} from '@openrouter/agent';
import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod/v4';

import type { ChatMessage } from '@/lib/types';
import type { AiToolResult } from '@/app/api/ai/chat/route';
import {
  createToolDispatch,
  executeTool,
  getToolDefinitions,
  type ToolName,
} from '@/lib/ai/toolExecutor';
import { createControllerPlanContext } from '@/lib/ai/planToolContext';
import type { JsonSchema } from '@/lib/ai/schemas';
import {
  buildStructuredOutput,
  StructuredOutputError,
} from '@/lib/ai/structuredOutputGate';
import { getSystemPrompt } from '@/lib/ai/systemPrompt';
import { scaffoldPlanController } from '@/lib/state/projectStateController';

export const MAX_TOOL_ITERATIONS = 8;
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';

// The Structured Output conformance gate (`buildStructuredOutput`,
// `StructuredOutputError`) lives in `lib/ai/structuredOutputGate.ts` so every
// provider path runs the identical validation gate (Req 4.1).
export { buildStructuredOutput, StructuredOutputError };

function withDescription<T extends ZodTypeAny>(schema: T, description?: string): T {
  return description ? (schema.describe(description) as T) : schema;
}

function literalUnion(values: readonly (string | number)[]): ZodTypeAny {
  if (values.length === 0) return z.never();
  const literals = values.map((value) => z.literal(value));
  if (literals.length === 1) return literals[0];
  return z.union(
    literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]],
  );
}

function numberSchema(schema: JsonSchema, integer: boolean): ZodTypeAny {
  let result = integer ? z.number().int() : z.number();
  if (typeof schema.minimum === 'number') result = result.min(schema.minimum);
  if (typeof schema.maximum === 'number') result = result.max(schema.maximum);
  return result;
}

function zodFromJsonSchema(schema: JsonSchema | undefined): ZodTypeAny {
  if (!schema) return z.unknown();

  const rawTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  const nullable = rawTypes.includes('null');
  const types = rawTypes.filter((typeName) => typeName !== 'null');

  let base: ZodTypeAny;
  if (schema.enum) {
    base = literalUnion(schema.enum);
  } else if (types.length > 1) {
    const variants = types.map((typeName) =>
      zodFromJsonSchema({ ...schema, type: typeName, enum: undefined }),
    );
    base = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  } else {
    const typeName = types[0];
    switch (typeName) {
      case 'object': {
        const required = new Set(schema.required ?? []);
        const shape: Record<string, ZodTypeAny> = {};
        for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
          const property = zodFromJsonSchema(propertySchema);
          shape[key] = required.has(key) ? property : property.optional();
        }
        base =
          schema.additionalProperties === false
            ? z.object(shape).strict()
            : z.object(shape).passthrough();
        break;
      }
      case 'array':
        base = z.array(zodFromJsonSchema(schema.items));
        break;
      case 'number':
        base = numberSchema(schema, false);
        break;
      case 'integer':
        base = numberSchema(schema, true);
        break;
      case 'string':
        base = z.string();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'null':
        base = z.null();
        break;
      default:
        base = z.unknown();
    }
  }

  if (nullable) {
    base = z.union([base, z.null()]);
  }
  return withDescription(base, schema.description);
}

function zodObjectFromJsonSchema(schema: JsonSchema): ZodObject<ZodRawShape> {
  const zodSchema = zodFromJsonSchema(schema);
  if (zodSchema instanceof z.ZodObject) {
    return zodSchema;
  }
  return z.object({});
}

function buildOpenRouterTools(
  toolResults: AiToolResult[],
  setStructuredOutput: (value: unknown) => void,
  sessionId: string,
): Tool[] {
  const planContext = createControllerPlanContext(scaffoldPlanController, sessionId);
  const dispatch = createToolDispatch(planContext);

  return getToolDefinitions().map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      inputSchema: zodObjectFromJsonSchema(definition.parameters),
      execute: async (args: unknown) => {
        const name = definition.name as ToolName;
        const result = await executeTool(dispatch, planContext, name, args);

        if (result.ok) {
          const candidate = buildStructuredOutput(name, result.data);
          if (candidate !== undefined) setStructuredOutput(candidate);
          toolResults.push({ tool: name, ok: true, data: result.data });
          return result.data;
        }

        toolResults.push({ tool: name, ok: false, error: result.error });
        return { error: result.error };
      },
    }),
  );
}

function buildInputFromMessages(messages: ChatMessage[]): Item[] {
  const chatMessages = messages
    .filter((message) => typeof message.content === 'string')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  return fromChatMessages(chatMessages) as unknown as Item[];
}

export interface OpenRouterAgentResult {
  reply: string;
  toolResults: AiToolResult[];
  structuredOutput?: unknown;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  siteUrl?: string;
  appTitle?: string;
}

export function createOpenRouterClient(options: OpenRouterClientOptions): OpenRouter {
  return new OpenRouter({
    apiKey: options.apiKey,
    ...(options.siteUrl ? { httpReferer: options.siteUrl } : {}),
    appTitle: options.appTitle ?? 'StillasCalculator',
  });
}

export async function runOpenRouterAgentWithTools(
  client: OpenRouter,
  messages: ChatMessage[],
  sessionId: string,
  signal: AbortSignal,
  requireToolCall = false,
  model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
): Promise<OpenRouterAgentResult> {
  const toolResults: AiToolResult[] = [];
  let structuredOutput: unknown;
  const tools = buildOpenRouterTools(
    toolResults,
    (value) => {
      structuredOutput = value;
    },
    sessionId,
  );

  const result = client.callModel(
    {
      model,
      instructions: getSystemPrompt(),
      input: buildInputFromMessages(messages),
      tools,
      toolChoice: requireToolCall ? 'required' : 'auto',
      stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
      allowFinalResponse: true,
    },
    {
      signal,
      retries: { strategy: 'none' },
    },
  );

  const reply = await result.getText();
  return {
    reply,
    toolResults,
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
  };
}

export function newAiSessionId(): string {
  return randomUUID();
}
