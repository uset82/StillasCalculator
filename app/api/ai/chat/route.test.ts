// @vitest-environment node
//
// Integration test for Property K — Request deadline and state preservation
// (task 11.3).
//
// Property K (design "Correctness Properties"): a request that exceeds the
// Request_Deadline returns a timeout outcome and applies no further state
// change. This is an example/integration test driven through the real
// `POST /api/ai/chat` handler so the actual deadline wiring is exercised:
//
//   - Req 10.1: every AI request is bounded by the Request_Deadline (45 s),
//     applied with the same configured value for the OpenRouter_Provider
//     (`REQUEST_TIMEOUT_MS`) and the Codex_Provider
//     (`DEFAULT_CODEX_TIMEOUT_MS` / `STILLAS_CODEX_TIMEOUT_MS`).
//   - Req 10.2: a provider error / network failure / unhandled exception
//     returns an error indication and preserves the Project_State (except the
//     allowed validated mutations already applied — none occur here).
//   - Req 10.3: a request that does not complete within the deadline is
//     terminated, returns a timeout indication (504 / `timedOut: true`), and
//     applies NO Project_State change after the deadline.
//
// Strategy:
//   * OpenRouter path — the route's own 45 s `setTimeout` + `AbortController` are
//     exercised with FAKE timers; `runOpenRouterAgentWithTools` is mocked to hang
//     until its abort signal fires. We assert the request is still pending at
//     44 999 ms and only times out at exactly 45 000 ms (the bound is the
//     configured deadline, Req 10.1), maps to 504 / `timedOut: true`, and
//     leaves the controller state byte-for-byte unchanged (Req 10.3).
//   * Codex path — the REAL `runCodexAgentWithTools` runs against a mocked
//     Codex SDK whose streamed turn never completes, with a short
//     `STILLAS_CODEX_TIMEOUT_MS` so the runner's own abort deadline fires; the
//     route maps the result to 504 / `timedOut: true` and preserves state.
//   * Provider error — `runOpenRouterAgentWithTools` rejects with a non-abort
//     error; the route maps it to 502 (no `timedOut`) and preserves state
//     (Req 10.2).
//
// No real OpenRouter/Codex provider, network, or MCP process is ever contacted.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

// --- Mock the OpenRouter agent loop: keep `newAiSessionId`/`StructuredOutputError`
//     real (the route imports them) and replace only the provider call so we
//     can make it hang (timeout) or reject (error) on demand.
vi.mock('@/lib/ai/openRouterAgentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openRouterAgentLoop')>();
  return { ...actual, runOpenRouterAgentWithTools: vi.fn() };
});

// --- Mock Codex CLI auth so the REAL runner believes a ChatGPT login exists.
vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(async () => ({ loggedIn: true, method: 'chatgpt' })),
  startCodexChatGptSignIn: vi.fn(),
}));

// --- Mock the Codex SDK: a thread whose streamed turn never yields an event
//     and rejects only when its abort signal fires. This lets the real
//     `runCodexAgentWithTools` deadline (STILLAS_CODEX_TIMEOUT_MS) drive the
//     timeout exactly as it would against a hung provider.
vi.mock('@openai/codex-sdk', () => {
  function makeAbortError(): Error {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
  class MockThread {
    async runStreamed(_input: unknown, opts?: { signal?: AbortSignal }) {
      const signal = opts?.signal;
      return {
        events: (async function* () {
          // Block forever until the runner's deadline aborts the signal.
          await new Promise<never>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(makeAbortError());
              return;
            }
            signal?.addEventListener('abort', () => reject(makeAbortError()), {
              once: true,
            });
          });
          // Unreachable: the await above always rejects on timeout.
        })(),
      };
    }
  }
  class MockCodex {
    constructor(_options?: unknown) {}
    startThread(_options?: unknown) {
      return new MockThread();
    }
  }
  return { Codex: MockCodex };
});

import { POST } from './route';
import { runOpenRouterAgentWithTools } from '@/lib/ai/openRouterAgentLoop';
import { scaffoldPlanController } from '@/lib/state/projectStateController';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import {
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
  createOpenAiAccountSessionCookieValue,
} from '@/lib/server/aiUserSession';
import type { ScaffoldPlan } from '@/lib/types';

// The route's configured Request_Deadline for the OpenRouter path (Req 10.1).
const REQUEST_TIMEOUT_MS = 45_000;

const mockRunOpenRouter = runOpenRouterAgentWithTools as unknown as Mock;

/** A never-default Project_State used to prove nothing mutates on failure. */
function knownPlan(): ScaffoldPlan {
  return createScaffoldPlan({
    workingHeightMeters: 12,
    wasteFactorPercent: 7,
    decimalPlaces: 1,
  });
}

/** Builds a POST request to the chat route with the given JSON body. */
function chatRequest(body: unknown, authenticated = false): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) {
    headers.cookie = `${AI_OPENAI_ACCOUNT_SESSION_COOKIE}=${
      createOpenAiAccountSessionCookieValue().value
    }`;
  }

  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const userMessage = {
  id: 'm1',
  role: 'user' as const,
  content: 'Hi there',
  timestamp: 1_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the single source of truth to a known, non-default state so a later
  // deep-equality check proves the request applied no Project_State change.
  scaffoldPlanController.applyScaffoldPlan(knownPlan());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// OpenRouter path — deadline bound + timeout outcome + state preservation
// (Req 10.1, 10.3)
// ---------------------------------------------------------------------------

describe('POST /api/ai/chat — OpenRouter request deadline (Property K, Req 10.1, 10.3)', () => {
  it('stays pending until exactly the 45 s deadline, then returns a timeout and preserves state', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'auto');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');

    // The provider call hangs until its abort signal fires (a stuck model).
    mockRunOpenRouter.mockImplementation(
      (_client: unknown, _messages: unknown, _sessionId: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }),
    );

    const before = structuredClone(scaffoldPlanController.getScaffoldPlan());

    vi.useFakeTimers();
    let settled = false;
    const responsePromise = POST(
      chatRequest({ messages: [userMessage], sessionId: 'sess-openrouter' }),
    ).then((response) => {
      settled = true;
      return response;
    });

    // Req 10.1: the request is bound to the deadline — not a millisecond less.
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;
    expect(settled).toBe(true);

    // Req 10.3: a timeout terminates the request with a timeout indication.
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.timedOut).toBe(true);
    expect(typeof body.error).toBe('string');
    expect(body.reply).toBeUndefined();
    expect(body.scaffoldPlan).toBeUndefined();

    // Req 10.3: no Project_State change is applied after the deadline.
    expect(scaffoldPlanController.getScaffoldPlan()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Codex path — same deadline/timeout shape through the real runner
// (Req 10.1, 10.3)
// ---------------------------------------------------------------------------

describe('POST /api/ai/chat — Codex request deadline (Property K, Req 10.1, 10.3)', () => {
  it('returns a timeout and preserves state when the Codex turn exceeds the deadline', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    // Drive the real runner's deadline quickly; the mocked SDK never completes.
    vi.stubEnv('STILLAS_CODEX_TIMEOUT_MS', '50');

    const before = structuredClone(scaffoldPlanController.getScaffoldPlan());

    const response = await POST(
      chatRequest({ messages: [userMessage], sessionId: 'sess-codex' }, true),
    );

    // Req 10.3: uniform timeout outcome (504 / timedOut) on the Codex path too.
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.timedOut).toBe(true);
    expect(typeof body.error).toBe('string');
    expect(body.reply).toBeUndefined();
    expect(body.scaffoldPlan).toBeUndefined();

    // Req 10.3: nothing was applied to the single source of truth.
    expect(scaffoldPlanController.getScaffoldPlan()).toEqual(before);

    // The OpenRouter provider was never invoked on the Codex path.
    expect(mockRunOpenRouter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Provider error — error outcome + state preservation (Req 10.2)
// ---------------------------------------------------------------------------

describe('POST /api/ai/chat — provider error preserves state (Property K, Req 10.2)', () => {
  it('returns a non-timeout error (502) and leaves the Project_State unchanged', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'auto');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');

    // A provider error / unhandled exception that is NOT a timeout/abort.
    mockRunOpenRouter.mockRejectedValue(new Error('upstream provider failure'));

    const before = structuredClone(scaffoldPlanController.getScaffoldPlan());

    const response = await POST(
      chatRequest({ messages: [userMessage], sessionId: 'sess-error' }),
    );

    // Req 10.2: an error indication is returned, distinct from a timeout.
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.timedOut).toBeUndefined();
    expect(body.reply).toBeUndefined();

    // Req 10.2: the Project_State is preserved on a provider error.
    expect(scaffoldPlanController.getScaffoldPlan()).toEqual(before);
  });
});
