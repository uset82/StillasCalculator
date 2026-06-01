import { NextResponse } from 'next/server';

import type { ChatMessage, ScaffoldPlan } from '@/lib/types';
import { sendCodexBackendChatRequest } from '@/lib/ai/codexBackendClient';
import {
  messageRequiresTools,
  runCodexAgentWithTools,
} from '@/lib/ai/codexAgentRunner';
import {
  createOpenRouterClient,
  newAiSessionId,
  runOpenRouterAgentWithTools,
  StructuredOutputError,
} from '@/lib/ai/openRouterAgentLoop';
import { buildStructuredOutputForToolResults } from '@/lib/ai/structuredOutputGate';
import {
  getAiProviderPreference,
  getOpenRouterApiKey,
} from '@/lib/server/aiAuth';
import { tryBuildDeterministicScaffoldEstimate } from '@/lib/ai/deterministicScaffoldEstimate';
import {
  getCodexBackendSessionCookie,
  getOpenAiAccountSessionState,
} from '@/lib/server/aiUserSession';
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

async function runOpenRouterBackedAgent(
  client: ReturnType<typeof createOpenRouterClient>,
  messages: ChatMessage[],
  sessionId: string,
  latestUser: ChatMessage | undefined,
  requiresTools: boolean,
  model?: string,
): Promise<NextResponse<AiChatResponse>> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const result = await runOpenRouterAgentWithTools(
      client,
      messages,
      sessionId,
      abortController.signal,
      requiresTools,
      model,
    );

    let finalResult = result;
    if (requiresTools && result.toolResults.length === 0 && latestUser) {
      const retryMessages: ChatMessage[] = [
        ...messages,
        {
          id: `retry-${Date.now()}`,
          role: 'user',
          content:
            'You must call the deterministic Stillas app tools before answering. ' +
            'For a selected house/address perimeter, use setBuildingPerimeterFromLocation. ' +
            'For scaffold math, use getScaffoldPlan and calculateScaffoldMaterials. ' +
            'Do not answer with invented numbers.',
          timestamp: Date.now(),
        },
      ];
      finalResult = await runOpenRouterAgentWithTools(
        client,
        retryMessages,
        sessionId,
        abortController.signal,
        true,
        model,
      );
    }

    if (requiresTools && finalResult.toolResults.length === 0) {
      return NextResponse.json(
        {
          error:
            'The assistant must use app tools for this request but no tool calls were executed.',
          toolResults: [],
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      reply: finalResult.reply,
      toolResults: finalResult.toolResults,
      scaffoldPlan: scaffoldPlanController.getScaffoldPlan(),
      ...(finalResult.structuredOutput !== undefined
        ? { structuredOutput: finalResult.structuredOutput }
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
  const openRouterApiKey = getOpenRouterApiKey();
  const openAiAccountSession = getOpenAiAccountSessionState(request);
  const backendSession = getCodexBackendSessionCookie(request);
  const sessionId = body.sessionId ?? newAiSessionId();

  if (providerPreference === 'off') {
    return NextResponse.json({ unavailable: true });
  }
  if (providerPreference === 'openai-api') {
    return NextResponse.json({ unavailable: true });
  }

  const latestUser = [...messages].reverse().find((m) => m.role === 'user');
  const requiresTools = latestUser ? messageRequiresTools(latestUser.content) : false;

  if (providerPreference === 'openai-account') {
    if (!backendSession.data?.sessionId) {
      return NextResponse.json({ unavailable: true });
    }
    const backendResult = await sendCodexBackendChatRequest(
      backendSession.data.sessionId,
      {
        messages,
        projectState: body.projectState,
        sessionId,
      },
    );
    if (!backendResult.ok) {
      if (backendResult.unavailable) {
        return NextResponse.json({ unavailable: true });
      }
      return NextResponse.json(
        {
          error: backendResult.error,
          ...(backendResult.timedOut ? { timedOut: true } : {}),
        },
        { status: backendResult.timedOut ? 504 : 502 },
      );
    }
    return NextResponse.json({
      reply: backendResult.reply,
      toolResults: backendResult.toolResults ?? [],
      scaffoldPlan: backendResult.scaffoldPlan,
      ...(backendResult.structuredOutput !== undefined
        ? { structuredOutput: backendResult.structuredOutput }
        : {}),
    });
  }

  const useOpenRouterSdk =
    (providerPreference === 'openrouter-api' || providerPreference === 'auto') &&
    Boolean(openRouterApiKey);

  if (!useOpenRouterSdk && providerPreference !== 'openrouter-api') {
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
      // the OpenRouter path. Validate any Material_List / report summary BEFORE
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

  if (!openRouterApiKey) {
    return NextResponse.json({ unavailable: true });
  }

  if (body.projectState) {
    scaffoldPlanController.applyScaffoldPlan(body.projectState);
  }

  const deterministicEstimate = await tryBuildDeterministicScaffoldEstimate(
    latestUser,
    body.projectState,
    scaffoldPlanController,
  );
  if (deterministicEstimate) {
    let structuredOutput: unknown;
    try {
      structuredOutput = buildStructuredOutputForToolResults(
        deterministicEstimate.toolResults,
      );
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        return NextResponse.json(
          { error: 'The AI returned a result that did not match the required format.' },
          { status: 502 },
        );
      }
      throw error;
    }

    return NextResponse.json({
      reply: deterministicEstimate.reply,
      toolResults: deterministicEstimate.toolResults,
      scaffoldPlan: deterministicEstimate.scaffoldPlan,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    });
  }

  return runOpenRouterBackedAgent(
    createOpenRouterClient({
      apiKey: openRouterApiKey,
      siteUrl: process.env.OPENROUTER_SITE_URL?.trim() || undefined,
      appTitle: process.env.OPENROUTER_APP_TITLE?.trim() || undefined,
    }),
    messages,
    sessionId,
    latestUser,
    requiresTools,
  );
}
