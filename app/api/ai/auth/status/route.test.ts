// @vitest-environment node

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/ai/codexBackendClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/codexBackendClient')>();
  return {
    ...actual,
    getCodexBackendAuthStatus: vi.fn(),
  };
});

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(),
}));

vi.mock('@/lib/ai/mcpBridge', () => ({
  ensurePersistentMcpToolBridge: vi.fn(),
}));

import { GET } from './route';
import { getCodexBackendAuthStatus } from '@/lib/ai/codexBackendClient';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import {
  AI_CODEX_BACKEND_SESSION_COOKIE,
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
  AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  createOpenAiAccountSessionCookieValue,
  createPendingOpenAiAccountSessionCookieValue,
  setCodexBackendSessionCookie,
} from '@/lib/server/aiUserSession';

const mockBackendStatus = getCodexBackendAuthStatus as unknown as Mock;
const mockCodexAuth = getCodexCliAuthStatus as unknown as Mock;
const mockMcpBridge = ensurePersistentMcpToolBridge as unknown as Mock;

function requestWithCookie(name: string, value: string): Request {
  return new Request('http://localhost/api/ai/auth/status', {
    headers: { cookie: `${name}=${value}` },
  });
}

function getSetCookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookie);
  if (!match) throw new Error(`Missing ${name} in Set-Cookie header.`);
  return match[1];
}

function requestWithBackendSession(sessionId = 'backend-session'): Request {
  const response = NextResponse.json({});
  setCodexBackendSessionCookie(response, sessionId, Date.now() + 86_400_000);
  const value = getSetCookieValue(
    response.headers.get('set-cookie') ?? '',
    AI_CODEX_BACKEND_SESSION_COOKIE,
  );
  return requestWithCookie(AI_CODEX_BACKEND_SESSION_COOKIE, value);
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
  vi.stubEnv('STILLAS_AI_PROVIDER', 'openai-account');
  mockBackendStatus.mockResolvedValue({
    ok: false,
    authenticated: false,
    pending: false,
    expiresAt: null,
    error: 'Codex backend unavailable.',
  });
  mockCodexAuth.mockResolvedValue({ loggedIn: false, method: null });
  mockMcpBridge.mockResolvedValue({
    connected: true,
    persistent: true,
    toolCount: 16,
    missingTools: [],
    checkedAt: 1_000,
  });
});

describe('GET /api/ai/auth/status', () => {
  it('reports account mode as unauthenticated before a backend session exists', async () => {
    const response = await GET(new Request('http://localhost/api/ai/auth/status'));
    const body = await response.json();

    expect(body.providerPreference).toBe('openai-account');
    expect(body.activeProvider).toBe('none');
    expect(body.canUseAssistant).toBe(false);
    expect(body.openAiAccountSession.authenticated).toBe(false);
    expect(mockBackendStatus).not.toHaveBeenCalled();
  });

  it('reports pending ChatGPT device-code auth from the backend', async () => {
    mockBackendStatus.mockResolvedValue({
      ok: true,
      authenticated: false,
      pending: true,
      expiresAt: 86_400_000,
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-12345',
        expiresAt: Date.now() + 15 * 60_000,
      },
    });

    const response = await GET(requestWithBackendSession());
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(body.activeProvider).toBe('none');
    expect(body.openAiAccountSession.pending).toBe(true);
    expect(body.setup.deviceCodeSettingsUrl).toContain('chatgpt.com');
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_PENDING_COOKIE);
  });

  it('activates account mode when the Codex backend is authenticated', async () => {
    mockBackendStatus.mockResolvedValue({
      ok: true,
      authenticated: true,
      pending: false,
      expiresAt: 86_400_000,
    });

    const response = await GET(requestWithBackendSession());
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(body.activeProvider).toBe('openai-account');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(true);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE);
  });

  it('surfaces backend unavailability separately from API-key setup', async () => {
    mockBackendStatus.mockResolvedValue({
      ok: false,
      authenticated: false,
      pending: false,
      expiresAt: null,
      error: 'The Codex backend is unavailable.',
    });

    const response = await GET(requestWithBackendSession());
    const body = await response.json();

    expect(body.activeProvider).toBe('none');
    expect(body.canUseAssistant).toBe(false);
    expect(body.openAiAccountSession.error).toBe(
      'The Codex backend is unavailable.',
    );
  });

  it('reports device-code settings guidance when the backend returns that error', async () => {
    mockBackendStatus.mockResolvedValue({
      ok: false,
      authenticated: false,
      pending: false,
      expiresAt: null,
      error: 'Device code login is not enabled in ChatGPT Security Settings.',
      deviceCodeRequired: true,
    });

    const response = await GET(requestWithBackendSession());
    const body = await response.json();

    expect(body.openAiAccountSession.deviceCodeRequired).toBe(true);
    expect(body.setup.deviceCodeSettingsUrl).toContain('Security');
  });

  it('does not start the MCP bridge when the active provider is the Platform API', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'openai-api');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const response = await GET(new Request('http://localhost/api/ai/auth/status'));
    const body = await response.json();

    expect(body.activeProvider).toBe('openai-api');
    expect(body.canUseAssistant).toBe(true);
    expect(body.openAiAccountSession.authenticated).toBe(false);
    expect(mockMcpBridge).not.toHaveBeenCalled();
    expect(mockBackendStatus).not.toHaveBeenCalled();
  });

  it('reports local Codex usable only when the app session and MCP bridge are connected', async () => {
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
    expect(mockMcpBridge).toHaveBeenCalledTimes(1);
  });

  it('keeps local Codex unavailable when MCP tools are disconnected', async () => {
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

  it('promotes a pending local app sign-in after Codex reports ChatGPT auth', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockCodexAuth.mockResolvedValue({ loggedIn: true, method: 'chatgpt' });
    const pending = createPendingOpenAiAccountSessionCookieValue(
      Date.now() + 15 * 60_000,
    );

    const response = await GET(
      requestWithCookie(AI_OPENAI_ACCOUNT_PENDING_COOKIE, pending.value),
    );
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(body.activeProvider).toBe('codex-cli');
    expect(body.openAiAccountSession.authenticated).toBe(true);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_SESSION_COOKIE);
  });
});
