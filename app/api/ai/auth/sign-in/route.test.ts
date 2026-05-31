// @vitest-environment node

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  startCodexChatGptSignIn: vi.fn(),
}));

vi.mock('@/lib/ai/openAiDeviceAuth', () => ({
  startOpenAiAccountDeviceAuth: vi.fn(),
}));

import { POST } from './route';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import { startOpenAiAccountDeviceAuth } from '@/lib/ai/openAiDeviceAuth';
import {
  AI_OPENAI_ACCOUNT_DEVICE_COOKIE,
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
} from '@/lib/server/aiUserSession';

const mockStartSignIn = startCodexChatGptSignIn as unknown as Mock;
const mockStartHostedSignIn = startOpenAiAccountDeviceAuth as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockStartHostedSignIn.mockResolvedValue({
    ok: false,
    message: 'Could not start OpenAI account sign-in.',
    error: 'OpenAI device sign-in failed.',
  });
});

describe('POST /api/ai/auth/sign-in', () => {
  it('returns Codex OpenAI account device-auth details to the app', async () => {
    mockStartSignIn.mockResolvedValue({
      ok: true,
      alreadyConnected: false,
      message:
        'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-12345',
        expiresAt: 1_000,
      },
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deviceAuth).toEqual({
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-12345',
      expiresAt: 1_000,
    });
    expect(response.headers.get('set-cookie')).toContain(
      AI_OPENAI_ACCOUNT_PENDING_COOKIE,
    );
  });

  it('creates an app OpenAI account session when Codex is already ChatGPT-authenticated', async () => {
    mockStartSignIn.mockResolvedValue({
      ok: true,
      alreadyConnected: true,
      message: 'Your OpenAI account is already connected through Codex.',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.alreadyConnected).toBe(true);
    expect(response.headers.get('set-cookie')).toContain(
      AI_OPENAI_ACCOUNT_SESSION_COOKIE,
    );
  });

  it('falls back to hosted OpenAI account device-auth when the Codex CLI is unavailable', async () => {
    mockStartSignIn.mockResolvedValue({
      ok: false,
      message: 'Could not start OpenAI account sign-in through Codex.',
      error: 'Codex CLI is not available.',
    });
    mockStartHostedSignIn.mockResolvedValue({
      ok: true,
      message:
        'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
      deviceAuth: {
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'WXYZ-98765',
        deviceAuthId: 'device-auth-id',
        intervalSeconds: 5,
        expiresAt: 2_000,
      },
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deviceAuth).toEqual({
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'WXYZ-98765',
      expiresAt: 2_000,
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_PENDING_COOKIE);
    expect(setCookie).toContain(AI_OPENAI_ACCOUNT_DEVICE_COOKIE);
  });

  it('maps sign-in startup failures to a server error when no account flow can start', async () => {
    mockStartSignIn.mockResolvedValue({
      ok: false,
      message: 'Could not start OpenAI account sign-in through Codex.',
      error: 'Codex CLI is not available.',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('OpenAI device sign-in failed.');
  });
});
