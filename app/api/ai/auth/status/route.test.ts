// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(),
}));

vi.mock('@/lib/ai/mcpBridge', () => ({
  ensurePersistentMcpToolBridge: vi.fn(),
}));

vi.mock('@/lib/ai/openAiDeviceAuth', () => ({
  pollOpenAiAccountDeviceAuth: vi.fn(),
}));

vi.mock('@/lib/server/openAiAccountTokenStore', () => ({
  loadOpenAiAccountTokens: vi.fn(),
  newOpenAiAccountTokenSessionId: vi.fn(),
  openAiAccountTokenSessionExpiresAt: vi.fn(),
  saveOpenAiAccountTokens: vi.fn(),
}));

import { GET } from './route';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import { pollOpenAiAccountDeviceAuth } from '@/lib/ai/openAiDeviceAuth';
import {
  loadOpenAiAccountTokens,
  newOpenAiAccountTokenSessionId,
  openAiAccountTokenSessionExpiresAt,
  saveOpenAiAccountTokens,
} from '@/lib/server/openAiAccountTokenStore';
import {
  AI_OPENAI_ACCOUNT_DEVICE_COOKIE,
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
  AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  createOpenAiAccountSessionCookieValue,
  createPendingOpenAiAccountSessionCookieValue,
  setOpenAiAccountDeviceCookie,
  setOpenAiAccountTokenSessionCookie,
} from '@/lib/server/aiUserSession';

const mockCodexAuth = getCodexCliAuthStatus as unknown as Mock;
const mockMcpBridge = ensurePersistentMcpToolBridge as unknown as Mock;
const mockPollDeviceAuth = pollOpenAiAccountDeviceAuth as unknown as Mock;
const mockLoadOpenAiAccountTokens = loadOpenAiAccountTokens as unknown as Mock;
const mockNewTokenSessionId = newOpenAiAccountTokenSessionId as unknown as Mock;
const mockTokenSessionExpiresAt =
  openAiAccountTokenSessionExpiresAt as unknown as Mock;
const mockSaveOpenAiAccountTokens = saveOpenAiAccountTokens as unknown as Mock;

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

function getSetCookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookie);
  if (!match) throw new Error(`Missing ${name} in Set-Cookie header.`);
  return match[1];
}

function requestWithHostedDeviceSignIn(): Request {
  const expiresAt = Date.now() + 15 * 60_000;
  const pending = createPendingOpenAiAccountSessionCookieValue(expiresAt);
  const response = NextResponse.json({});
  setOpenAiAccountDeviceCookie(
    response,
    {
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-12345',
      deviceAuthId: 'device-auth-id',
      intervalSeconds: 5,
    },
    expiresAt,
  );
  const deviceValue = getSetCookieValue(
    response.headers.get('set-cookie') ?? '',
    AI_OPENAI_ACCOUNT_DEVICE_COOKIE,
  );
  return new Request('http://localhost/api/ai/auth/status', {
    headers: {
      cookie: `${AI_OPENAI_ACCOUNT_PENDING_COOKIE}=${pending.value}; ${AI_OPENAI_ACCOUNT_DEVICE_COOKIE}=${deviceValue}`,
    },
  });
}

function requestWithHostedTokenSession(sessionId = 'token-session'): Request {
  const response = NextResponse.json({});
  setOpenAiAccountTokenSessionCookie(
    response,
    sessionId,
    Date.now() + 24 * 60 * 60_000,
  );
  const value = getSetCookieValue(
    response.headers.get('set-cookie') ?? '',
    AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  );
  return requestWithCookie(AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockLoadOpenAiAccountTokens.mockResolvedValue(null);
  mockNewTokenSessionId.mockReturnValue('hosted-token-session');
  mockTokenSessionExpiresAt.mockReturnValue(50_000);
  mockSaveOpenAiAccountTokens.mockResolvedValue(undefined);
  mockPollDeviceAuth.mockResolvedValue({ status: 'pending' });
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

  it('completes hosted OpenAI account device sign-in and activates the account-backed assistant', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'auto');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mockCodexAuth.mockResolvedValue({ loggedIn: false, method: null });
    const tokens = {
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'account-123',
      email: 'user@example.com',
      planType: 'plus',
      accessTokenExpiresAt: Date.now() + 60_000,
      idTokenExpiresAt: Date.now() + 60_000,
    };
    mockPollDeviceAuth.mockResolvedValue({ status: 'completed', tokens });

    const response = await GET(requestWithHostedDeviceSignIn());
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(body.activeProvider).toBe('openai-account');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(true);
    expect(mockSaveOpenAiAccountTokens).toHaveBeenCalledWith(
      'hosted-token-session',
      tokens,
      50_000,
    );
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_PENDING_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_DEVICE_COOKIE);
    expect(mockMcpBridge).not.toHaveBeenCalled();
  });

  it('prefers an existing hosted OpenAI account token session over the Platform API in auto mode', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'auto');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mockCodexAuth.mockResolvedValue({ loggedIn: false, method: null });
    mockLoadOpenAiAccountTokens.mockResolvedValue({
      expiresAt: 90_000,
      tokens: {
        idToken: 'id-token',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'account-123',
        email: null,
        planType: null,
        accessTokenExpiresAt: Date.now() + 60_000,
        idTokenExpiresAt: Date.now() + 60_000,
      },
    });

    const response = await GET(requestWithHostedTokenSession());
    const body = await response.json();

    expect(body.activeProvider).toBe('openai-account');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession).toEqual({
      authenticated: true,
      pending: false,
      expiresAt: 90_000,
    });
    expect(mockMcpBridge).not.toHaveBeenCalled();
  });
});
