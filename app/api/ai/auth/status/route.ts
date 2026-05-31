import { NextResponse } from 'next/server';

import type { AiAuthStatusResponse } from '@/lib/ai/authStatus';
import {
  CODEX_DEVICE_CODE_SETTINGS_URL,
  getCodexBackendAuthStatus,
  type CodexBackendMcpStatus,
} from '@/lib/ai/codexBackendClient';
import { getCodexCliAuthStatus } from '@/lib/ai/codexSdkAdapter';
import { ensurePersistentMcpToolBridge } from '@/lib/ai/mcpBridge';
import {
  getAiProviderPreference,
  getOpenAiApiKey,
  resolveActiveAiProvider,
} from '@/lib/server/aiAuth';
import { findAuthenticatedLocalCodexBackendSession } from '@/lib/server/localCodexBackendSessionRecovery';
import {
  clearCodexBackendSessionCookie,
  clearOpenAiAccountDeviceCookie,
  clearOpenAiAccountSessionCookie,
  clearOpenAiAccountTokenSessionCookie,
  clearPendingOpenAiAccountSessionCookie,
  getCodexBackendSessionCookie,
  getOpenAiAccountSessionState,
  OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS,
  OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS,
  setCodexBackendSessionCookie,
  setOpenAiAccountSessionCookie,
  setPendingOpenAiAccountSessionCookie,
} from '@/lib/server/aiUserSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function disconnectedMcp(error?: string): CodexBackendMcpStatus {
  return {
    connected: false,
    persistent: false,
    toolCount: 0,
    missingTools: [],
    checkedAt: null,
    ...(error ? { error } : {}),
  };
}

export async function GET(
  request: Request,
): Promise<NextResponse<AiAuthStatusResponse>> {
  const now = Date.now();
  const providerPreference = getAiProviderPreference();
  const openAiApiKeyConfigured = Boolean(getOpenAiApiKey());
  const session = getOpenAiAccountSessionState(request, now);
  const backendSession = getCodexBackendSessionCookie(request, now);

  if (providerPreference === 'openai-account') {
    let authenticated = false;
    let pending = false;
    let expiresAt: number | null = null;
    let error: string | undefined;
    let deviceCodeRequired: boolean | undefined;
    let mcp = disconnectedMcp();
    let pendingExpiresAt: number | null = null;
    let backendSessionId = backendSession.data?.sessionId ?? null;
    let recoveredBackendSession = false;

    if (!backendSessionId) {
      backendSessionId = await findAuthenticatedLocalCodexBackendSession();
      recoveredBackendSession = backendSessionId !== null;
    }

    if (backendSessionId) {
      const backendStatus = await getCodexBackendAuthStatus(
        backendSessionId,
      );
      authenticated = backendStatus.authenticated;
      pending = backendStatus.pending;
      expiresAt = backendStatus.expiresAt;
      error = backendStatus.error;
      deviceCodeRequired = backendStatus.deviceCodeRequired;
      mcp = backendStatus.mcp ?? disconnectedMcp(error);
      pendingExpiresAt =
        backendStatus.ok && backendStatus.deviceAuth
          ? backendStatus.deviceAuth.expiresAt
          : pending
            ? Math.min(
                backendSession.data?.expiresAt ??
                  now + OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS * 1000,
                now + OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS * 1000,
              )
            : null;
    } else if (backendSession.clearCookie) {
      error = 'The ChatGPT sign-in session expired. Sign in again.';
    }

    const body: AiAuthStatusResponse = {
      providerPreference,
      activeProvider: authenticated ? 'openai-account' : 'none',
      canUseAssistant: authenticated,
      openAiApiKeyConfigured: false,
      codexCli: { loggedIn: false, method: null },
      openAiAccountSession: {
        authenticated,
        pending: !authenticated && pending,
        expiresAt,
        ...(error ? { error } : {}),
        ...(deviceCodeRequired ? { deviceCodeRequired } : {}),
      },
      mcp,
      setup: {
        chatGptSignInCommand: 'codex login',
        providerEnvValue: 'openai-codex',
        deviceCodeSettingsUrl: CODEX_DEVICE_CODE_SETTINGS_URL,
      },
    };

    const response = NextResponse.json(body);
    if (backendSession.clearCookie) {
      clearCodexBackendSessionCookie(response);
    }
    clearOpenAiAccountTokenSessionCookie(response);
    clearOpenAiAccountDeviceCookie(response);
    if (authenticated) {
      if (recoveredBackendSession && backendSessionId) {
        setCodexBackendSessionCookie(
          response,
          backendSessionId,
          expiresAt ?? now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000,
          now,
        );
      }
      setOpenAiAccountSessionCookie(response, now);
      clearPendingOpenAiAccountSessionCookie(response);
    } else {
      clearOpenAiAccountSessionCookie(response);
      if (pendingExpiresAt) {
        setPendingOpenAiAccountSessionCookie(response, pendingExpiresAt, now);
      } else {
        clearPendingOpenAiAccountSessionCookie(response);
      }
    }
    return response;
  }

  const codexCli = await getCodexCliAuthStatus();
  const hasCodexChatGptAuth =
    codexCli.loggedIn && codexCli.method === 'chatgpt';
  const shouldPromotePendingSession =
    providerPreference === 'codex-cli' && session.pending && hasCodexChatGptAuth;
  const localCodexSessionAuthenticated =
    hasCodexChatGptAuth &&
    (session.authenticated || shouldPromotePendingSession);
  const resolvedProvider = resolveActiveAiProvider(providerPreference, {
    hasOpenAiApiKey: openAiApiKeyConfigured,
    hasCodexChatGptAuth: localCodexSessionAuthenticated,
    hasOpenAiAccountAuth: false,
  });
  const mcp =
    resolvedProvider === 'codex-cli'
      ? await ensurePersistentMcpToolBridge()
      : disconnectedMcp();
  const activeProvider =
    resolvedProvider === 'codex-cli' && !mcp.connected ? 'none' : resolvedProvider;

  const body: AiAuthStatusResponse = {
    providerPreference,
    activeProvider,
    canUseAssistant:
      activeProvider === 'openai-api' || activeProvider === 'codex-cli',
    openAiApiKeyConfigured,
    codexCli,
    openAiAccountSession: {
      authenticated: localCodexSessionAuthenticated,
      pending:
        !localCodexSessionAuthenticated &&
        providerPreference === 'codex-cli' &&
        session.pending,
      expiresAt: localCodexSessionAuthenticated
        ? session.sessionExpiresAt ?? null
        : null,
    },
    mcp,
    setup: {
      chatGptSignInCommand: 'codex login',
      providerEnvValue: 'openai-codex',
      deviceCodeSettingsUrl: CODEX_DEVICE_CODE_SETTINGS_URL,
    },
  };

  const response = NextResponse.json(body);

  if (shouldPromotePendingSession) {
    setOpenAiAccountSessionCookie(response, now);
    clearPendingOpenAiAccountSessionCookie(response);
    clearOpenAiAccountDeviceCookie(response);
  } else {
    if (session.clearSessionCookie) {
      clearOpenAiAccountSessionCookie(response);
    }
    if (
      session.clearPendingCookie ||
      providerPreference === 'openai-api' ||
      providerPreference === 'off'
    ) {
      clearPendingOpenAiAccountSessionCookie(response);
    }
  }
  if (backendSession.data || backendSession.clearCookie) {
    clearCodexBackendSessionCookie(response);
  }
  clearOpenAiAccountTokenSessionCookie(response);

  return response;
}
