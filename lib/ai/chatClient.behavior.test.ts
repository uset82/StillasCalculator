// Unit/integration tests for AI client-adapter behavior branches (task 9.7).
//
// These tests exercise the client-side AI adapter (lib/ai/chatClient.ts) at the
// branches the calculator's UI depends on, using an INJECTED FetchLike stub so
// no real network request is ever issued:
//
//   * normalizeChatResponse maps an `unavailable` signal to status
//     'unavailable' (Req 12.7 — no key configured; non-AI features keep working).
//   * normalizeChatResponse maps a timed-out / error body to status 'error',
//     preserves the `timedOut` flag, and surfaces no reply/toolResults so the
//     caller can keep Project_State untouched (Req 12.8).
//   * normalizeChatResponse maps a successful body to status 'ok' with the
//     assistant reply and the deterministic tool results (Req 12.2 — the
//     OpenRouter call path's response, mocked here at the transport boundary).
//   * sendChatRequest rejects an over-length (>2000 char) message client-side
//     WITHOUT issuing a fetch, the local send-gate that backs the in-flight
//     send disabling (Req 12.3 support) and the 2000-char bound (Req 12.1).
//   * sendChatRequest posts the conversation to the chat endpoint and returns a
//     normalized 'ok' outcome for a mocked OpenRouter-backed response (Req 12.2),
//     and returns an 'error' outcome (state preserved) when the transport
//     throws (Req 12.8).
//
// Requirements: 12.2, 12.3, 12.7, 12.8

import { describe, it, expect, vi } from 'vitest';

import {
  AI_AUTH_SIGN_IN_ENDPOINT,
  AI_AUTH_STATUS_ENDPOINT,
  CHAT_ENDPOINT,
  MAX_MESSAGE_LENGTH,
  fetchAiAuthStatus,
  normalizeChatResponse,
  sendChatRequest,
  startAiChatGptSignIn,
  type ChatOutcome,
  type FetchLike,
} from './chatClient';
import type { AiChatRequest, AiChatResponse } from '@/app/api/ai/chat/route';
import type { ChatMessage } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextTimestamp = 1_000;

/** Builds a chat message with a monotonically increasing timestamp. */
function userMessage(content: string): ChatMessage {
  nextTimestamp += 1;
  return {
    id: `m${nextTimestamp}`,
    role: 'user',
    content,
    timestamp: nextTimestamp,
  };
}

/**
 * Builds a FetchLike stub that resolves to a response with the given transport
 * status and JSON body. The returned `calls` array records every invocation so
 * a test can assert that a fetch was (or was not) issued.
 */
function makeFetchStub(
  ok: boolean,
  status: number,
  body: unknown,
): { fetchImpl: FetchLike; calls: Array<{ input: string; init?: unknown }> } {
  const calls: Array<{ input: string; init?: unknown }> = [];
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// normalizeChatResponse — AI unavailable (Req 12.7)
// ---------------------------------------------------------------------------

describe('normalizeChatResponse: AI unavailable signal (Req 12.7)', () => {
  it('maps an { unavailable: true } body to status "unavailable" with no reply/tool results', () => {
    const body: AiChatResponse = { unavailable: true };
    const outcome = normalizeChatResponse(true, 200, body);

    expect(outcome.status).toBe('unavailable');
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toEqual([]);
    // No error/timeout is implied: AI is simply unavailable, non-AI features run.
    expect(outcome.timedOut).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeChatResponse — failure / timeout (Req 12.8)
// ---------------------------------------------------------------------------

describe('normalizeChatResponse: failure and timeout preserve state (Req 12.8)', () => {
  it('maps a { error, timedOut: true } body to status "error" and preserves the timedOut flag', () => {
    const body: AiChatResponse = {
      error: 'The AI request timed out. Your project data is unchanged.',
      timedOut: true,
    };
    const outcome = normalizeChatResponse(false, 504, body);

    expect(outcome.status).toBe('error');
    expect(outcome.timedOut).toBe(true);
    // Nothing is surfaced that could mutate Project_State (Req 12.8).
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toEqual([]);
    expect(outcome.structuredOutput).toBeUndefined();
    expect(outcome.message).toBe(body.error);
  });

  it('maps a generic { error } body (no timedOut) to status "error" without a timeout flag', () => {
    const body: AiChatResponse = {
      error: 'The AI request could not be completed. Your project data is unchanged.',
    };
    const outcome = normalizeChatResponse(false, 502, body);

    expect(outcome.status).toBe('error');
    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toEqual([]);
  });

  it('maps a non-success HTTP status with an unparseable body to status "error"', () => {
    const outcome = normalizeChatResponse(false, 500, null);

    expect(outcome.status).toBe('error');
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toEqual([]);
    expect(outcome.message).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// normalizeChatResponse — success (Req 12.2)
// ---------------------------------------------------------------------------

describe('normalizeChatResponse: successful OpenRouter-backed response (Req 12.2)', () => {
  it('maps a successful body to status "ok" with reply, tool results, and structured output', () => {
    const body: AiChatResponse = {
      reply: 'Here is your scaffold estimate.',
      toolResults: [
        { tool: 'calculateScaffoldMaterials', ok: true, data: { numberOfBays: 7 } },
      ],
      structuredOutput: { numberOfBays: 7, numberOfLevels: 3 },
    };
    const outcome = normalizeChatResponse(true, 200, body);

    expect(outcome.status).toBe('ok');
    expect(outcome.reply).toBe('Here is your scaffold estimate.');
    expect(outcome.toolResults).toHaveLength(1);
    expect(outcome.toolResults[0]).toMatchObject({
      tool: 'calculateScaffoldMaterials',
      ok: true,
    });
    expect(outcome.structuredOutput).toEqual({ numberOfBays: 7, numberOfLevels: 3 });
  });

  it('drops malformed tool-result entries and defaults a missing reply to an empty string', () => {
    const body = {
      // reply omitted on purpose.
      toolResults: [
        { tool: 'calculateScaffoldMaterials', ok: true, data: { numberOfBays: 2 } },
        { notATool: true }, // malformed — must be filtered out
        'garbage',
      ],
    } as unknown;
    const outcome = normalizeChatResponse(true, 200, body);

    expect(outcome.status).toBe('ok');
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toHaveLength(1);
    expect(outcome.toolResults[0].tool).toBe('calculateScaffoldMaterials');
  });
});

// ---------------------------------------------------------------------------
// sendChatRequest — over-length send gate (Req 12.1, supports 12.3)
// ---------------------------------------------------------------------------

describe('sendChatRequest: over-length message is rejected without a fetch (Req 12.1, 12.3)', () => {
  it('rejects a message longer than 2000 characters and issues NO network request', async () => {
    const { fetchImpl, calls } = makeFetchStub(true, 200, { reply: 'ignored' });
    const request: AiChatRequest = {
      messages: [userMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1))],
    };

    const outcome: ChatOutcome = await sendChatRequest(request, fetchImpl);

    expect(outcome.status).toBe('rejected');
    expect(outcome.message).toContain(String(MAX_MESSAGE_LENGTH));
    // The over-length message never leaves the browser (Req 12.1) and no send
    // proceeds, which is what backs the in-flight send-gating (Req 12.3).
    expect(calls).toHaveLength(0);
  });

  it('allows a message of exactly 2000 characters to be sent', async () => {
    const { fetchImpl, calls } = makeFetchStub(true, 200, { reply: 'ok' });
    const request: AiChatRequest = {
      messages: [userMessage('y'.repeat(MAX_MESSAGE_LENGTH))],
    };

    const outcome = await sendChatRequest(request, fetchImpl);

    expect(outcome.status).toBe('ok');
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// sendChatRequest — OpenRouter call path with a mocked response (Req 12.2, 12.8)
// ---------------------------------------------------------------------------

describe('sendChatRequest: posts to the chat endpoint and normalizes the response (Req 12.2, 12.8)', () => {
  it('POSTs the conversation to the chat endpoint and returns an "ok" outcome', async () => {
    const body: AiChatResponse = {
      reply: 'Calculated.',
      toolResults: [{ tool: 'calculateScaffoldMaterials', ok: true, data: { numberOfBays: 4 } }],
    };
    const { fetchImpl, calls } = makeFetchStub(true, 200, body);
    const request: AiChatRequest = { messages: [userMessage('Estimate my scaffold.')] };

    const outcome = await sendChatRequest(request, fetchImpl);

    expect(outcome.status).toBe('ok');
    expect(outcome.reply).toBe('Calculated.');
    expect(outcome.toolResults[0].tool).toBe('calculateScaffoldMaterials');

    // The request went to the server route via POST with a JSON body (Req 12.2).
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(CHAT_ENDPOINT);
    const init = calls[0].init as { method?: string; body?: string };
    expect(init.method).toBe('POST');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string).messages).toHaveLength(1);
  });

  it('returns an "error" outcome (state preserved) when the transport throws', async () => {
    const throwingFetch: FetchLike = vi.fn(() => Promise.reject(new Error('network down')));
    const request: AiChatRequest = { messages: [userMessage('Estimate my scaffold.')] };

    const outcome = await sendChatRequest(request, throwingFetch);

    expect(outcome.status).toBe('error');
    expect(outcome.reply).toBe('');
    expect(outcome.toolResults).toEqual([]);
    // The adapter never throws, so the caller can preserve Project_State (Req 12.8).
    expect(outcome.message).toBeTruthy();
  });
});

describe('fetchAiAuthStatus: reads the server-side AI connection state', () => {
  it('GETs the AI auth status endpoint and returns the parsed status body', async () => {
    const statusBody = {
      providerPreference: 'codex-cli',
      activeProvider: 'codex-cli',
      canUseAssistant: true,
      openRouterApiKeyConfigured: false,
      openAiApiKeyConfigured: false,
      codexCli: { loggedIn: true, method: 'chatgpt' },
      openAiAccountSession: {
        authenticated: true,
        pending: false,
        expiresAt: 86_400_000,
      },
      mcp: {
        connected: true,
        persistent: true,
        toolCount: 16,
        missingTools: [],
        checkedAt: 1_000,
      },
      setup: {
        chatGptSignInCommand: 'codex login',
        providerEnvValue: 'openai-codex',
      },
    };
    const { fetchImpl, calls } = makeFetchStub(true, 200, statusBody);

    const status = await fetchAiAuthStatus(fetchImpl);

    expect(status).toEqual(statusBody);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(AI_AUTH_STATUS_ENDPOINT);
    expect((calls[0].init as { method?: string }).method).toBe('GET');
  });
});

describe('startAiChatGptSignIn: launches the server-side Codex sign-in flow', () => {
  it('POSTs to the AI auth sign-in endpoint and returns the parsed action body', async () => {
    const body = {
      ok: true,
      alreadyConnected: false,
      message:
        'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-12345',
        expiresAt: 1_000,
      },
    };
    const { fetchImpl, calls } = makeFetchStub(true, 200, body);

    const result = await startAiChatGptSignIn(fetchImpl);

    expect(result).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(AI_AUTH_SIGN_IN_ENDPOINT);
    expect((calls[0].init as { method?: string }).method).toBe('POST');
  });
});
