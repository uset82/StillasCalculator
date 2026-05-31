import { NextResponse } from 'next/server';

import type { AiAuthStatusResponse } from '@/lib/ai/authStatus';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import {
  getAiProviderPreference,
  getOpenAiApiKey,
  resolveActiveAiProvider,
} from '@/lib/server/aiAuth';
import {
  clearOpenAiAccountSessionCookie,
  clearPendingOpenAiAccountSessionCookie,
  getOpenAiAccountSessionState,
  OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS,
  setOpenAiAccountSessionCookie,
} from '@/lib/server/aiUserSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
): Promise<NextResponse<AiAuthStatusResponse>> {
  const now = Date.now();
  const providerPreference = getAiProviderPreference();
  const openAiApiKeyConfigured = Boolean(getOpenAiApiKey());
  const codexCli = await getCodexCliAuthStatus();
  const hasCodexChatGptAuth =
    codexCli.loggedIn && codexCli.method === 'chatgpt';
  const session = getOpenAiAccountSessionState(request, now);
  const shouldPromotePendingSession = session.pending && hasCodexChatGptAuth;
  const openAiAccountSessionAuthenticated =
    session.authenticated || shouldPromotePendingSession;
  const openAiAccountSessionExpiresAt = session.authenticated
    ? session.sessionExpiresAt
    : shouldPromotePendingSession
      ? now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000
      : null;
  const hasUserCodexChatGptAuth =
    hasCodexChatGptAuth && openAiAccountSessionAuthenticated;
  const resolvedProvider = resolveActiveAiProvider(providerPreference, {
    hasOpenAiApiKey: openAiApiKeyConfigured,
    hasCodexChatGptAuth: hasUserCodexChatGptAuth,
  });
  const mcp =
    resolvedProvider === 'codex-cli'
      ? await ensurePersistentMcpToolBridge()
      : {
          connected: false,
          persistent: false,
          toolCount: 0,
          missingTools: [],
          checkedAt: null,
        };
  const activeProvider =
    resolvedProvider === 'codex-cli' && !mcp.connected ? 'none' : resolvedProvider;

  const body: AiAuthStatusResponse = {
    providerPreference,
    activeProvider,
    canUseAssistant: activeProvider === 'openai-api' || activeProvider === 'codex-cli',
    openAiApiKeyConfigured,
    codexCli,
    openAiAccountSession: {
      authenticated: openAiAccountSessionAuthenticated,
      pending: !openAiAccountSessionAuthenticated && session.pending,
      expiresAt: openAiAccountSessionExpiresAt,
    },
    mcp,
    setup: {
      chatGptSignInCommand: 'codex login',
      providerEnvValue: 'openai-codex',
    },
  };

  const response = NextResponse.json(body);

  if (shouldPromotePendingSession) {
    setOpenAiAccountSessionCookie(response, now);
    clearPendingOpenAiAccountSessionCookie(response);
  } else {
    if (session.clearSessionCookie) {
      clearOpenAiAccountSessionCookie(response);
    }
    if (session.clearPendingCookie) {
      clearPendingOpenAiAccountSessionCookie(response);
    }
  }

  return response;
}
