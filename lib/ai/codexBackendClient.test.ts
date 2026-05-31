// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendCodexBackendChatRequest } from './codexBackendClient';

describe('Codex backend proxy client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps the backend session id separate from the chat request session id', async () => {
    vi.stubEnv('STILLAS_CODEX_BACKEND_URL', 'https://backend.example.test');
    vi.stubEnv('STILLAS_CODEX_BACKEND_SECRET', 'secret');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, reply: 'ok', toolResults: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendCodexBackendChatRequest('backend-session', {
      sessionId: 'chat-session',
      messages: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://backend.example.test/api/ai/chat',
      expect.objectContaining({
        body: JSON.stringify({
          codexBackendSessionId: 'backend-session',
          request: { sessionId: 'chat-session', messages: [] },
        }),
      }),
    );
  });
});
