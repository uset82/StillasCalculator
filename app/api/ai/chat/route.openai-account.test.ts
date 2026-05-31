// @vitest-environment node

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/ai/codexBackendClient', () => ({
  sendCodexBackendChatRequest: vi.fn(),
}));

import { POST } from './route';
import { sendCodexBackendChatRequest } from '@/lib/ai/codexBackendClient';
import {
  AI_CODEX_BACKEND_SESSION_COOKIE,
  setCodexBackendSessionCookie,
} from '@/lib/server/aiUserSession';

const mockBackendChat = sendCodexBackendChatRequest as unknown as Mock;

function getSetCookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookie);
  if (!match) throw new Error(`Missing ${name} in Set-Cookie header.`);
  return match[1];
}

function requestWithBackendSession(): Request {
  const response = NextResponse.json({});
  setCodexBackendSessionCookie(
    response,
    'backend-session',
    Date.now() + 24 * 60 * 60_000,
  );
  const value = getSetCookieValue(
    response.headers.get('set-cookie') ?? '',
    AI_CODEX_BACKEND_SESSION_COOKIE,
  );
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${AI_CODEX_BACKEND_SESSION_COOKIE}=${value}`,
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
      projectState: { scaffoldLengthMeters: 12 },
    }),
  });
}

describe('POST /api/ai/chat — Codex backend account auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('STILLAS_AI_PROVIDER', 'openai-account');
    mockBackendChat.mockResolvedValue({
      ok: true,
      reply: 'Account-backed reply',
      toolResults: [{ tool: 'getScaffoldPlan', ok: true, data: { ok: true } }],
      scaffoldPlan: { scaffoldLengthMeters: 12 },
    });
  });

  it('proxies account-mode chat requests to the Codex backend session', async () => {
    const response = await POST(requestWithBackendSession());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reply).toBe('Account-backed reply');
    expect(body.toolResults).toHaveLength(1);
    expect(mockBackendChat).toHaveBeenCalledWith(
      'backend-session',
      expect.objectContaining({
        sessionId: 'chat-session',
        messages: expect.any(Array),
        projectState: expect.objectContaining({ scaffoldLengthMeters: 12 }),
      }),
    );
  });

  it('returns unavailable when account mode has no backend session cookie', async () => {
    const response = await POST(
      new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    expect(mockBackendChat).not.toHaveBeenCalled();
  });

  it('maps backend chat failures to route errors', async () => {
    mockBackendChat.mockResolvedValue({
      ok: false,
      error: 'The Codex backend request failed.',
    });

    const response = await POST(requestWithBackendSession());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('The Codex backend request failed.');
  });
});
