// @vitest-environment node

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  startCodexChatGptSignIn: vi.fn(),
}));

vi.mock('@/lib/ai/codexBackendClient', () => ({
  startCodexBackendSignIn: vi.fn(),
}));

import { POST } from './route';
import { startCodexBackendSignIn } from '@/lib/ai/codexBackendClient';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import {
  AI_CODEX_BACKEND_SESSION_COOKIE,
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
} from '@/lib/server/aiUserSession';

const mockStartLocalSignIn = startCodexChatGptSignIn as unknown as Mock;
const mockStartBackendSignIn = startCodexBackendSignIn as unknown as Mock;

function request(): Request {
  return new Request('http://localhost/api/ai/auth/sign-in', {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('STILLAS_AI_PROVIDER', 'openai-account');
  mockStartLocalSignIn.mockResolvedValue({
    ok: false,
    message: 'Could not start OpenAI account sign-in through Codex.',
    error: 'Codex CLI is not available.',
  });
  mockStartBackendSignIn.mockResolvedValue({
    ok: false,
    message: 'Could not start ChatGPT sign-in.',
    error: 'Codex backend unavailable.',
  });
});

describe('POST /api/ai/auth/sign-in', () => {
  it('does not start ChatGPT sign-in when the hosted API key provider is configured', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'openrouter-api');
    vi.stubEnv('OPENROUTER_API_KEY', 'or-test');

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.message).toContain('API provider');
    expect(mockStartLocalSignIn).not.toHaveBeenCalled();
    expect(mockStartBackendSignIn).not.toHaveBeenCalled();
  });

  it('starts ChatGPT device auth through the persistent Codex backend in account mode', async () => {
    mockStartBackendSignIn.mockResolvedValue({
      ok: true,
      alreadyConnected: false,
      message: 'Open the ChatGPT sign-in link and enter the one-time code shown in the app.',
      expiresAt: 86_400_000,
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'WXYZ-98765',
        expiresAt: 2_000,
      },
    });

    const response = await POST(request());
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deviceAuth).toEqual({
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'WXYZ-98765',
      expiresAt: 2_000,
    });
    expect(mockStartBackendSignIn).toHaveBeenCalledTimes(1);
    expect(mockStartLocalSignIn).not.toHaveBeenCalled();
    expect(setCookie).toContain(AI_CODEX_BACKEND_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_PENDING_COOKIE);
  });

  it('creates an app session when the backend already has ChatGPT auth', async () => {
    mockStartBackendSignIn.mockResolvedValue({
      ok: true,
      alreadyConnected: true,
      message: 'Your ChatGPT account is connected.',
      expiresAt: 86_400_000,
    });

    const response = await POST(request());
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.alreadyConnected).toBe(true);
    expect(setCookie).toContain(AI_CODEX_BACKEND_SESSION_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_SESSION_COOKIE);
  });

  it('maps backend startup failures to a service error without falling back to private auth endpoints', async () => {
    mockStartBackendSignIn.mockResolvedValue({
      ok: false,
      message: 'Could not start ChatGPT sign-in.',
      error: 'Device code login is not enabled.',
      deviceCodeRequired: true,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Device code login is not enabled.');
    expect(mockStartLocalSignIn).not.toHaveBeenCalled();
  });

  it('keeps local Codex CLI sign-in for codex-cli mode', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockStartLocalSignIn.mockResolvedValue({
      ok: true,
      alreadyConnected: false,
      message: 'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-12345',
        expiresAt: 1_000,
      },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deviceAuth).toEqual({
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-12345',
      expiresAt: 1_000,
    });
    expect(mockStartBackendSignIn).not.toHaveBeenCalled();
  });

  it('does not use hosted direct auth as a fallback when local Codex CLI is unavailable', async () => {
    vi.stubEnv('STILLAS_AI_PROVIDER', 'codex-cli');
    mockStartLocalSignIn.mockResolvedValue({
      ok: false,
      message: 'Could not start OpenAI account sign-in through Codex.',
      error: 'Codex CLI is not available.',
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Codex CLI is not available.');
    expect(mockStartBackendSignIn).not.toHaveBeenCalled();
  });
});
