// @vitest-environment node

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  startCodexChatGptSignIn: vi.fn(),
}));

import { POST } from './route';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import {
  AI_OPENAI_ACCOUNT_PENDING_COOKIE,
  AI_OPENAI_ACCOUNT_SESSION_COOKIE,
} from '@/lib/server/aiUserSession';

const mockStartSignIn = startCodexChatGptSignIn as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
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

  it('maps Codex sign-in startup failures to a server error response', async () => {
    mockStartSignIn.mockResolvedValue({
      ok: false,
      message: 'Could not start OpenAI account sign-in through Codex.',
      error: 'Codex CLI is not available.',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Codex CLI is not available.');
  });
});
