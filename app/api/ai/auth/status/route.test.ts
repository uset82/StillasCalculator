// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(),
}));

vi.mock('@/lib/ai/mcpBridge', () => ({
  ensurePersistentMcpToolBridge: vi.fn(),
}));

import { GET } from './route';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import {
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
  createOpenAiAccountSessionCookieValue,
  createPendingOpenAiAccountSessionCookieValue,
} from '@/lib/server/aiUserSession';

const mockCodexAuth = getCodexCliAuthStatus as unknown as Mock;
const mockMcpBridge = ensurePersistentMcpToolBridge as unknown as Mock;

function requestWithCookie(name: string, value: string): Request {
  return new Request('http://localhost/api/ai/auth/status', {
    headers: { cookie: `${name}=${value}` },
  });
}

function requestWithOpenAiAccountSession(): Request {
  return requestWithCookie(
    AI_OPENAI_ACCOUNT_SESSION_COOKIE,
    createOpenAiAccountSessionCookieValue().value,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/ai/auth/status: Codex MCP bridge readiness', () => {
  it('reports Codex usable only when the persistent MCP bridge is connected', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'chatgpt' });
    mockMcpBridge.mockResolvedValue({
      connected: true,
      persistent: true,
      toolCount: 16,
      missingTools: [],
      checkedAt: 1_000,
    });

    const response = await GET(requestWithOpenAiAccountSession());
    const body = await response.json();

    expect(body.activeProvider).toBe('codex-cli');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(true);
    expect(body.mcp.connected).toBe(true);
    expect(mockMcpBridge).toHaveBeenCalledTimes(1);
  });

  it('requires an app OpenAI account session before exposing the Codex SDK path', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'chatgpt' });

    const response = await GET(new Request('http://localhost/api/ai/auth/status'));
    const body = await response.json();

    expect(body.activeProvider).toBe('none');
    expect(body.canUseAssistant).toBe(false);
    expect(body.openAiAccountSession).toEqual({
      authenticated: false,
      pending: false,
      expiresAt: null,
    });
    expect(mockMcpBridge).not.toHaveBeenCalled();
  });

  it('promotes a pending app sign-in after Codex reports ChatGPT auth', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'chatgpt' });
    mockMcpBridge.mockResolvedValue({
      connected: true,
      persistent: true,
      toolCount: 16,
      missingTools: [],
      checkedAt: 1_000,
    });
    const pending = createPendingOpenAiAccountSessionCookieValue(
      Date.now() + 15 * 60_000,
    );

    const response = await GET(
      requestWithCookie(AI_OPENAI_ACCOUNT_PENDING_COOKIE, pending.value),
    );
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(body.activeProvider).toBe('codex-cli');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(true);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_PENDING_COOKIE);
  });

  it('keeps the assistant unavailable when Codex is logged in but MCP tools are disconnected', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'chatgpt' });
    mockMcpBridge.mockResolvedValue({
      connected: false,
      persistent: true,
      toolCount: 0,
      missingTools: ['getScaffoldPlan'],
      checkedAt: 1_000,
      error: 'MCP bridge failed.',
    });

    const response = await GET(requestWithOpenAiAccountSession());
    const body = await response.json();

    expect(body.activeProvider).toBe('none');
    expect(body.canUseAssistant).toBe(false);
    expect(body.mcp.error).toBe('MCP bridge failed.');
  });

  it('requires Codex to be signed in with a ChatGPT/OpenAI account, not an API key', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'api-key' });

    const response = await GET(requestWithOpenAiAccountSession());
    const body = await response.json();

    expect(body.activeProvider).toBe('none');
    expect(body.canUseAssistant).toBe(false);
    expect(body.codexCli.method).toBe('api-key');
    expect(mockMcpBridge).not.toHaveBeenCalled();
  });

  it('does not start the MCP bridge when the active provider is the Platform API', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'openai-api');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mockCodexAuth.mockResolvedValue({ loggedIn: false, method: null });

    const response = await GET(new Request('http://localhost/api/ai/auth/status'));
    const body = await response.json();

    expect(body.activeProvider).toBe('openai-api');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(false);
    expect(body.mcp.connected).toBe(false);
    expect(mockMcpBridge).not.toHaveBeenCalled();
  });
});
