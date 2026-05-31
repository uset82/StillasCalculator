import { NextResponse } from 'next/server';
import OpenAI from 'openai';

import type { ChatMessage, ScaffoldPlan } from '@/lib/types';
import {
  messageRequiresTools,
  runCodexAgentWithTools,
} from '@/lib/ai/codexAgentRunner';
import { newAiSessionId, runOpenAiAgentWithTools, StructuredOutputError } from '@/lib/ai/openAiAgentLoop';
import { buildStructuredOutputForToolResults } from '@/lib/ai/structuredOutputGate';
import {
  getAiProviderPreference,
  getOpenAiApiKey,
} from '@/lib/server/aiAuth';
import { getOpenAiAccountSessionState } from '@/lib/server/aiUserSession';
import { scaffoldPlanController } from '@/lib/state/projectStateController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_MS = 45_000;

export interface AiChatRequest {
  messages: ChatMessage[];
  projectState?: ScaffoldPlan;
  sessionId?: string;
}

export interface AiChatResponse {
  reply?: string;
  toolResults?: AiToolResult[];
  structuredOutput?: unknown;
  scaffoldPlan?: ScaffoldPlan;
  unavailable?: boolean;
  error?: string;
  timedOut?: boolean;
}

export interface AiToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function POST(request: Request): Promise<NextResponse<AiChatResponse>> {
  let body: AiChatRequest;
  try {
    body = (await request.json()) as AiChatRequest;
  } catch {
    return NextResponse.json(
      { error: 'The request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const providerPreference = getAiProviderPreference();
  const apiKey = getOpenAiApiKey();
  const openAiAccountSession = getOpenAiAccountSessionState(request);
  const sessionId = body.sessionId ?? newAiSessionId();

  if (providerPreference === 'off') {
    return NextResponse.json({ unavailable: true });
  }

  const latestUser = [...messages].reverse().find((m) => m.role === 'user');
  const requiresTools = latestUser ? messageRequiresTools(latestUser.content) : false;

  const useOpenAiSdk = providerPreference !== 'codex-cli' && Boolean(apiKey);

  if (!useOpenAiSdk && providerPreference !== 'openai-api') {
    if (!openAiAccountSession.authenticated) {
      return NextResponse.json({ unavailable: true });
    }

    const initialPlan =
      body.projectState ?? scaffoldPlanController.getScaffoldPlan();
    let codexResult = await runCodexAgentWithTools(messages, initialPlan, sessionId);

    if (
      codexResult.ok &&
      requiresTools &&
      codexResult.toolResults.length === 0 &&
      latestUser
    ) {
      const retryMessages: ChatMessage[] = [
        ...messages,
        {
          id: `retry-${Date.now()}`,
          role: 'user',
          content:
            'You must call the appropriate Stillas MCP tools before answering. ' +
            'Use getScaffoldPlan and the action tools now.',
          timestamp: Date.now(),
        },
      ];
      codexResult = await runCodexAgentWithTools(
        retryMessages,
        codexResult.scaffoldPlan,
        sessionId,
      );
    }

    if (codexResult.ok) {
      // Structured Output conformance gate (Req 4.1, 4.2) — identical gate to
      // the OpenAI path. Validate any Material_List / report summary BEFORE
      // applying the returned plan, so a nonconforming output is neither
      // presented nor stored and the existing Project_State is preserved.
      let structuredOutput: unknown;
      try {
        structuredOutput = buildStructuredOutputForToolResults(codexResult.toolResults);
      } catch (error) {
        if (error instanceof StructuredOutputError) {
          return NextResponse.json(
            { error: 'The AI returned a result that did not match the required format.' },
            { status: 502 },
          );
        }
        throw error;
      }

      scaffoldPlanController.applyScaffoldPlan(codexResult.scaffoldPlan);
      if (requiresTools && codexResult.toolResults.length === 0) {
        return NextResponse.json({
          error:
            'The assistant must use app tools for this request but no tool calls were executed.',
          toolResults: [],
        }, { status: 502 });
      }
      return NextResponse.json({
        reply: codexResult.reply,
        toolResults: codexResult.toolResults,
        scaffoldPlan: codexResult.scaffoldPlan,
        ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      });
    }
    if (codexResult.unavailable) {
      return NextResponse.json({ unavailable: true });
    }
    return NextResponse.json(
      {
        error: codexResult.error,
        ...(codexResult.timedOut ? { timedOut: true } : {}),
      },
      { status: codexResult.timedOut ? 504 : 502 },
    );
  }

  if (!apiKey) {
    return NextResponse.json({ unavailable: true });
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const client = new OpenAI({ apiKey });
    const result = await runOpenAiAgentWithTools(
      client,
      messages,
      sessionId,
      abortController.signal,
    );

    if (requiresTools && result.toolResults.length === 0) {
      return NextResponse.json({
        error: 'The assistant must use app tools for this request but no tool calls were executed.',
        toolResults: [],
      }, { status: 502 });
    }

    return NextResponse.json({
      reply: result.reply,
      toolResults: result.toolResults,
      scaffoldPlan: scaffoldPlanController.getScaffoldPlan(),
      ...(result.structuredOutput !== undefined
        ? { structuredOutput: result.structuredOutput }
        : {}),
    });
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      return NextResponse.json(
        { error: 'The AI returned a result that did not match the required format.' },
        { status: 502 },
      );
    }
    const timedOut = abortController.signal.aborted;
    return NextResponse.json(
      {
        error: timedOut
          ? 'The AI request timed out.'
          : 'The AI request could not be completed.',
        ...(timedOut ? { timedOut: true } : {}),
      },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
