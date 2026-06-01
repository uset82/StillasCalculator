// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/types';

// Integration test for AI provider availability signalling (task 11.4).
//
// **Property N: Availability signalling (Req 11.1, 11.2).** When no provider is
// usable, the chat route returns the `{ unavailable: true }` signal (status 200,
// distinct from the error/timeout outcomes of Req 10) so the rest of the
// calculator keeps working; when a provider IS available the route proceeds.
//
// The provider-selection inputs are mocked at the boundary so no real AI backend
// is contacted:
//   - `getAiProviderPreference()` / `getOpenRouterApiKey()` (provider preference and
//     the server-only OpenRouter key) are mocked on `@/lib/server/aiAuth`.
//   - `getCodexCliAuthStatus()` is mocked on `@/lib/ai/codexSdkAdapter`; the REAL
//     `runCodexAgentWithTools` then short-circuits to its unavailable result on a
//     not-logged-in status WITHOUT spawning a Codex thread or MCP server.
//   - `runOpenRouterAgentWithTools` is mocked so the "a provider is available, it
//     proceeds" case returns a canned result without an OpenRouter network call.
//
// Req 11.4 (no credential leakage) is asserted by serializing the response body
// and checking the server-only OpenRouter key never appears in it.
//
// Requirements: 11.1, 11.2 (with 11.4 credential-non-leakage cross-check).

const mocks = vi.hoisted(() => ({
  getAiProviderPreference: vi.fn(),
  getOpenAiApiKey: vi.fn(),
  getOpenRouterApiKey: vi.fn(),
  getCodexCliAuthStatus: vi.fn(),
  runOpenRouterAgentWithTools: vi.fn(),
}));

vi.mock('@/lib/server/aiAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/aiAuth')>();
  return {
    ...actual,
    getAiProviderPreference: mocks.getAiProviderPreference,
    getOpenAiApiKey: mocks.getOpenAiApiKey,
    getOpenRouterApiKey: mocks.getOpenRouterApiKey,
  };
});

// `runCodexAgentWithTools` (the REAL implementation) reads its auth from
// `getCodexCliAuthStatus`; mocking it here drives the Codex unavailable branch
// deterministically without spawning anything.
vi.mock('@/lib/ai/codexSdkAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/codexSdkAdapter')>();
  return {
    ...actual,
    getCodexCliAuthStatus: mocks.getCodexCliAuthStatus,
  };
});

// Keep the real `newAiSessionId` and `StructuredOutputError` (the route uses the
// latter in `instanceof` checks); only stub the network-bound agent loop.
vi.mock('@/lib/ai/openRouterAgentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openRouterAgentLoop')>();
  return {
    ...actual,
    runOpenRouterAgentWithTools: mocks.runOpenRouterAgentWithTools,
  };
});

import { POST } from './route';

const SECRET_OPENROUTER_KEY = 'or-secret-LEAK-CANARY-0123456789';

function userMessage(content: string): ChatMessage {
  return { id: 'u1', role: 'user', content, timestamp: 1_000 };
}

function chatRequest(content = 'Hello there'): Request {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [userMessage(content)], sessionId: 'test-session' }),
  });
}

describe('POST /api/ai/chat — Property N: availability signalling (Req 11.1, 11.2)', () => {
  beforeEach(() => {
    // Safe defaults: no provider usable. Individual tests override as needed.
    mocks.getAiProviderPreference.mockReturnValue('auto');
    mocks.getOpenAiApiKey.mockReturnValue(undefined);
    mocks.getOpenRouterApiKey.mockReturnValue(undefined);
    mocks.getCodexCliAuthStatus.mockResolvedValue({ loggedIn: false, method: null });
    mocks.runOpenRouterAgentWithTools.mockResolvedValue({ reply: 'ok', toolResults: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Req 11.1: preference 'off' disables every provider ----------------
  it('returns { unavailable: true } (200) when the provider preference is "off"', async () => {
    mocks.getAiProviderPreference.mockReturnValue('off');
    mocks.getOpenRouterApiKey.mockReturnValue(SECRET_OPENROUTER_KEY); // even with a key, "off" wins

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    // Unavailable is distinct from the error/timeout outcomes of Req 10.
    expect(body.error).toBeUndefined();
    expect(body.timedOut).toBeUndefined();
  });

  // --- Req 11.1: openrouter-api preference with the required credential missing
  it('returns { unavailable: true } (200) when preference is "openrouter-api" and no key is configured', async () => {
    mocks.getAiProviderPreference.mockReturnValue('openrouter-api');
    mocks.getOpenRouterApiKey.mockReturnValue(undefined);

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.timedOut).toBeUndefined();
    // The OpenRouter agent loop must never run when the credential is missing.
    expect(mocks.runOpenRouterAgentWithTools).not.toHaveBeenCalled();
  });

  // --- Req 11.2: codex-cli preference with no authenticated login --------
  it('returns { unavailable: true } (200) when preference is "codex-cli" and Codex is not logged in', async () => {
    mocks.getAiProviderPreference.mockReturnValue('codex-cli');
    mocks.getOpenAiApiKey.mockReturnValue(undefined);
    mocks.getCodexCliAuthStatus.mockResolvedValue({ loggedIn: false, method: null });

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    // Req 11.2: distinct from an error/timeout outcome.
    expect(body.error).toBeUndefined();
    expect(body.timedOut).toBeUndefined();
  });

  it('returns { unavailable: true } (200) when Codex is logged in but the app user has not signed in', async () => {
    mocks.getAiProviderPreference.mockReturnValue('codex-cli');
    mocks.getOpenAiApiKey.mockReturnValue(undefined);
    mocks.getCodexCliAuthStatus.mockResolvedValue({
      loggedIn: true,
      method: 'chatgpt',
    });

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.timedOut).toBeUndefined();
  });

  // --- Req 11.1: auto preference with neither credential available -------
  it('returns { unavailable: true } (200) for "auto" when no key and Codex is not logged in', async () => {
    mocks.getAiProviderPreference.mockReturnValue('auto');
    mocks.getOpenAiApiKey.mockReturnValue(undefined);
    mocks.getCodexCliAuthStatus.mockResolvedValue({ loggedIn: false, method: null });

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.timedOut).toBeUndefined();
  });

  // --- Req 11.2 / "proceeds" + Req 11.4 non-leakage ----------------------
  it('proceeds through the available OpenRouter provider (not unavailable) and never leaks the credential', async () => {
    mocks.getAiProviderPreference.mockReturnValue('openrouter-api');
    mocks.getOpenRouterApiKey.mockReturnValue(SECRET_OPENROUTER_KEY);
    mocks.runOpenRouterAgentWithTools.mockResolvedValue({
      reply: 'Here is your answer.',
      toolResults: [],
    });

    // A benign (no tool-keyword) message so the mandatory-tool guard is not hit.
    const response = await POST(chatRequest('Hello, can you introduce yourself?'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBeUndefined();
    expect(body.reply).toBe('Here is your answer.');
    expect(mocks.runOpenRouterAgentWithTools).toHaveBeenCalledTimes(1);

    // Req 11.4: no AI provider credential is ever serialized to the client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET_OPENROUTER_KEY);
    expect(serialized.toLowerCase()).not.toContain('apikey');
    expect(serialized).not.toContain('OPENROUTER_API_KEY');
  });

  // --- Req 11.4: unavailable responses also carry no credential ----------
  it('does not expose the credential in the response body even when present but preference is "off"', async () => {
    mocks.getAiProviderPreference.mockReturnValue('off');
    mocks.getOpenRouterApiKey.mockReturnValue(SECRET_OPENROUTER_KEY);

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(body.unavailable).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET_OPENROUTER_KEY);
  });
});
