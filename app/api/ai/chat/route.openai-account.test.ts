// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  openAiConstructorOptions: [] as unknown[],
  runOpenAiAgentWithTools: vi.fn(),
  loadOpenAiAccountTokens: vi.fn(),
  saveOpenAiAccountTokens: vi.fn(),
  deleteOpenAiAccountTokens: vi.fn(),
  refreshOpenAiAccountTokens: vi.fn(),
  shouldRefreshOpenAiAccountTokens: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(options?: unknown) {
      mocks.openAiConstructorOptions.push(options);
    }
  },
}));

vi.mock('@/lib/ai/openAiAgentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openAiAgentLoop')>();
  return {
    ...actual,
    runOpenAiAgentWithTools: mocks.runOpenAiAgentWithTools,
  };
});

vi.mock('@/lib/server/openAiAccountTokenStore', () => ({
  loadOpenAiAccountTokens: mocks.loadOpenAiAccountTokens,
  saveOpenAiAccountTokens: mocks.saveOpenAiAccountTokens,
  deleteOpenAiAccountTokens: mocks.deleteOpenAiAccountTokens,
}));

vi.mock('@/lib/ai/openAiDeviceAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openAiDeviceAuth')>();
  return {
    ...actual,
    refreshOpenAiAccountTokens: mocks.refreshOpenAiAccountTokens,
    shouldRefreshOpenAiAccountTokens: mocks.shouldRefreshOpenAiAccountTokens,
  };
});

import { POST } from './route';
import {
  AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  setOpenAiAccountTokenSessionCookie,
} from '@/lib/server/aiUserSession';

function getSetCookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookie);
  if (!match) throw new Error(`Missing ${name} in Set-Cookie header.`);
  return match[1];
}

function requestWithHostedTokenSession(): Request {
  const response = NextResponse.json({});
  setOpenAiAccountTokenSessionCookie(
    response,
    'hosted-token-session',
    Date.now() + 24 * 60 * 60_000,
  );
  const value = getSetCookieValue(
    response.headers.get('set-cookie') ?? '',
    AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  );
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE}=${value}`,
    },
    body: JSON.stringify({
      sessionId: 'chat-session',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Hello',
          timestamp: 1_000,
        },
      ],
    }),
  });
}

describe('POST /api/ai/chat — hosted OpenAI account auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.openAiConstructorOptions.length = 0;
    mocks.shouldRefreshOpenAiAccountTokens.mockReturnValue(false);
    mocks.runOpenAiAgentWithTools.mockResolvedValue({
      reply: 'Account-backed reply',
      toolResults: [],
    });
    mocks.loadOpenAiAccountTokens.mockResolvedValue({
      expiresAt: Date.now() + 24 * 60 * 60_000,
      tokens: {
        idToken: 'id-token',
        accessToken: 'chatgpt-access-token',
        refreshToken: 'refresh-token',
        accountId: 'account-123',
        email: 'user@example.com',
        planType: 'plus',
        accessTokenExpiresAt: Date.now() + 60_000,
        idTokenExpiresAt: Date.now() + 60_000,
      },
    });
  });

  it('prefers the signed-in OpenAI account over the Platform API in auto mode and keeps app tools enabled', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'auto');
    vi.stubEnv('OPENAI_API_KEY', 'platform-api-key');

    const response = await POST(requestWithHostedTokenSession());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reply).toBe('Account-backed reply');
    expect(mocks.runOpenAiAgentWithTools).toHaveBeenCalledTimes(1);
    expect(mocks.runOpenAiAgentWithTools.mock.calls[0][5]).toBe('gpt-5.3-codex');
    expect(mocks.openAiConstructorOptions[0]).toMatchObject({
      apiKey: 'chatgpt-access-token',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultHeaders: {
        originator: 'codex_cli_rs',
        'ChatGPT-Account-ID': 'account-123',
      },
    });
  });
});
