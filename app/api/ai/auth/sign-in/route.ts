import { NextResponse } from 'next/server';

import type { AiAuthSignInResponse } from '@/lib/ai/authStatus';
import { startCodexBackendSignIn } from '@/lib/ai/codexBackendClient';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import { getAiProviderPreference } from '@/lib/server/aiAuth';
import { findAuthenticatedLocalCodexBackendSession } from '@/lib/server/localCodexBackendSessionRecovery';
import {
  clearCodexBackendSessionCookie,
  clearOpenAiAccountDeviceCookie,
  clearOpenAiAccountSessionCookie,
  clearPendingOpenAiAccountSessionCookie,
  clearOpenAiAccountTokenSessionCookie,
  getCodexBackendSessionCookie,
  newCodexBackendSessionId,
  OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS,
  setCodexBackendSessionCookie,
  setOpenAiAccountSessionCookie,
  setPendingOpenAiAccountSessionCookie,
} from '@/lib/server/aiUserSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
): Promise<NextResponse<AiAuthSignInResponse>> {
  const now = Date.now();
  const providerPreference = getAiProviderPreference();

  if (providerPreference === 'off' || providerPreference === 'openai-api') {
    return NextResponse.json(
      {
        ok: false,
        message:
          'OpenAI account sign-in is disabled while this deployment is configured for the API provider.',
        error: 'OpenAI account sign-in is disabled for this provider.',
      },
      { status: 409 },
    );
  }

  if (providerPreference === 'openai-account') {
    const existingBackendSession = getCodexBackendSessionCookie(request, now);
    const recoveredBackendSession =
      existingBackendSession.data?.sessionId === undefined
        ? await findAuthenticatedLocalCodexBackendSession()
        : null;
    const backendSession =
      existingBackendSession.data?.sessionId ??
      recoveredBackendSession ??
      newCodexBackendSessionId();
    const result = await startCodexBackendSignIn(backendSession);

    if (!result.ok) {
      const response = NextResponse.json(
        {
          ok: false,
          message: result.message,
          error: result.error,
        },
        { status: 503 },
      );
      clearOpenAiAccountSessionCookie(response);
      clearPendingOpenAiAccountSessionCookie(response);
      clearOpenAiAccountDeviceCookie(response);
      clearOpenAiAccountTokenSessionCookie(response);
      return response;
    }

    const response = NextResponse.json({
      ok: true,
      alreadyConnected: result.alreadyConnected,
      message: result.message,
      ...(result.deviceAuth ? { deviceAuth: result.deviceAuth } : {}),
    });
    const expiresAt =
      result.expiresAt ?? now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000;
    setCodexBackendSessionCookie(response, backendSession, expiresAt, now);
    clearOpenAiAccountTokenSessionCookie(response);

    if (result.deviceAuth) {
      setPendingOpenAiAccountSessionCookie(
        response,
        result.deviceAuth.expiresAt,
        now,
      );
      clearOpenAiAccountSessionCookie(response);
      clearOpenAiAccountDeviceCookie(response);
    } else if (result.alreadyConnected) {
      setOpenAiAccountSessionCookie(response, now);
      clearPendingOpenAiAccountSessionCookie(response);
      clearOpenAiAccountDeviceCookie(response);
    }

    return response;
  }

  const result =
    providerPreference === 'codex-cli' || providerPreference === 'auto'
      ? await startCodexChatGptSignIn()
      : null;

  if (result?.ok) {
    const response = NextResponse.json({
      ok: true,
      alreadyConnected: result.alreadyConnected,
      message: result.message,
      ...(result.deviceAuth ? { deviceAuth: result.deviceAuth } : {}),
    });

    if (result.deviceAuth) {
      setPendingOpenAiAccountSessionCookie(
        response,
        result.deviceAuth.expiresAt,
        now,
      );
      clearOpenAiAccountDeviceCookie(response);
    } else if (result.alreadyConnected) {
      setOpenAiAccountSessionCookie(response, now);
      clearPendingOpenAiAccountSessionCookie(response);
      clearOpenAiAccountDeviceCookie(response);
      clearOpenAiAccountTokenSessionCookie(response);
      clearCodexBackendSessionCookie(response);
    }

    return response;
  }

  return NextResponse.json(
    {
      ok: false,
      error: result?.error || 'OpenAI account sign-in failed.',
      message:
        result?.message ||
        'Could not start OpenAI account sign-in.',
    },
    { status: 500 },
  );
}
