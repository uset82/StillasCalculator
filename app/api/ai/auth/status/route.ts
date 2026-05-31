import { NextResponse } from 'next/server';

import type { AiAuthStatusResponse } from '@/lib/ai/authStatus';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import { pollOpenAiAccountDeviceAuth } from '@/lib/ai/openAiDeviceAuth';
import {
  getAiProviderPreference,
  getOpenAiApiKey,
  resolveActiveAiProvider,
} from '@/lib/server/aiAuth';
import {
  loadOpenAiAccountTokens,
  newOpenAiAccountTokenSessionId,
  openAiAccountTokenSessionExpiresAt,
  saveOpenAiAccountTokens,
} from '@/lib/server/openAiAccountTokenStore';
import {
  clearOpenAiAccountDeviceCookie,
  clearOpenAiAccountSessionCookie,
  clearOpenAiAccountTokenSessionCookie,
  clearPendingOpenAiAccountSessionCookie,
  getOpenAiAccountDeviceCookie,
  getOpenAiAccountSessionState,
  getOpenAiAccountTokenSessionCookie,
  OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS,
  setOpenAiAccountTokenSessionCookie,
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
  const deviceCookie = getOpenAiAccountDeviceCookie(request, now);
  const tokenSessionCookie = getOpenAiAccountTokenSessionCookie(request, now);
  const storedTokenSession = await loadOpenAiAccountTokens(
    tokenSessionCookie.data?.sessionId,
    now,
  );
  let hostedOpenAiAccountAuth = Boolean(storedTokenSession);
  let hostedOpenAiAccountExpiresAt = storedTokenSession?.expiresAt ?? null;
  let completedHostedTokenSession:
    | { sessionId: string; expiresAt: number }
    | null = null;
  let clearDeviceCookie = deviceCookie.clearCookie;
  let clearTokenSessionCookie =
    tokenSessionCookie.clearCookie ||
    (tokenSessionCookie.data !== null && storedTokenSession === null);
  let clearPendingCookie = session.clearPendingCookie;
  const shouldPromotePendingSession = session.pending && hasCodexChatGptAuth;
  let pendingHostedAccountSignIn = false;

  if (session.pending && deviceCookie.data && !shouldPromotePendingSession) {
    const pollResult = await pollOpenAiAccountDeviceAuth(deviceCookie.data, now);

    if (pollResult.status === 'pending') {
      pendingHostedAccountSignIn = true;
    } else if (pollResult.status === 'completed') {
      const tokenSessionId = newOpenAiAccountTokenSessionId();
      const tokenSessionExpiresAt = openAiAccountTokenSessionExpiresAt(now);
      await saveOpenAiAccountTokens(
        tokenSessionId,
        pollResult.tokens,
        tokenSessionExpiresAt,
      );
      hostedOpenAiAccountAuth = true;
      hostedOpenAiAccountExpiresAt = tokenSessionExpiresAt;
      completedHostedTokenSession = {
        sessionId: tokenSessionId,
        expiresAt: tokenSessionExpiresAt,
      };
      pendingHostedAccountSignIn = false;
      clearPendingCookie = true;
      clearDeviceCookie = true;
      clearTokenSessionCookie = false;
    } else {
      pendingHostedAccountSignIn = false;
      clearPendingCookie = true;
      clearDeviceCookie = true;
    }
  }

  const localCodexSessionAuthenticated =
    hasCodexChatGptAuth && (session.authenticated || shouldPromotePendingSession);
  const openAiAccountSessionAuthenticated =
    hostedOpenAiAccountAuth || localCodexSessionAuthenticated;
  const openAiAccountSessionExpiresAt = hostedOpenAiAccountAuth
    ? hostedOpenAiAccountExpiresAt
    : localCodexSessionAuthenticated
      ? session.sessionExpiresAt ??
        now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000
      : null;
  const hasUserCodexChatGptAuth = localCodexSessionAuthenticated;
  const resolvedProvider = resolveActiveAiProvider(providerPreference, {
    hasOpenAiApiKey: openAiApiKeyConfigured,
    hasCodexChatGptAuth: hasUserCodexChatGptAuth,
    hasOpenAiAccountAuth: hostedOpenAiAccountAuth,
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
    canUseAssistant:
      activeProvider === 'openai-account' ||
      activeProvider === 'openai-api' ||
      activeProvider === 'codex-cli',
    openAiApiKeyConfigured,
    codexCli,
    openAiAccountSession: {
      authenticated: openAiAccountSessionAuthenticated,
      pending:
        !openAiAccountSessionAuthenticated &&
        (pendingHostedAccountSignIn || (session.pending && !clearPendingCookie)),
      expiresAt: openAiAccountSessionExpiresAt,
    },
    mcp,
    setup: {
      chatGptSignInCommand: 'codex login',
      providerEnvValue: 'openai-codex',
    },
  };

  const response = NextResponse.json(body);

  if (completedHostedTokenSession) {
    setOpenAiAccountSessionCookie(response, now);
    setOpenAiAccountTokenSessionCookie(
      response,
      completedHostedTokenSession.sessionId,
      completedHostedTokenSession.expiresAt,
      now,
    );
    clearPendingOpenAiAccountSessionCookie(response);
    clearOpenAiAccountDeviceCookie(response);
  } else if (shouldPromotePendingSession) {
    setOpenAiAccountSessionCookie(response, now);
    clearPendingOpenAiAccountSessionCookie(response);
    clearOpenAiAccountDeviceCookie(response);
  } else {
    if (session.clearSessionCookie) {
      clearOpenAiAccountSessionCookie(response);
    }
    if (clearPendingCookie) {
      clearPendingOpenAiAccountSessionCookie(response);
    }
  }
  if (clearDeviceCookie) {
    clearOpenAiAccountDeviceCookie(response);
  }
  if (clearTokenSessionCookie) {
    clearOpenAiAccountTokenSessionCookie(response);
  }

  return response;
}
