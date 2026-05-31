import { NextResponse } from 'next/server';

import type { AiAuthSignInResponse } from '@/lib/ai/authStatus';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import { startOpenAiAccountDeviceAuth } from '@/lib/ai/openAiDeviceAuth';
import {
  clearOpenAiAccountDeviceCookie,
  clearPendingOpenAiAccountSessionCookie,
  clearOpenAiAccountTokenSessionCookie,
  setOpenAiAccountSessionCookie,
  setOpenAiAccountDeviceCookie,
  setPendingOpenAiAccountSessionCookie,
} from '@/lib/server/aiUserSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse<AiAuthSignInResponse>> {
  const now = Date.now();
  const result = await startCodexChatGptSignIn();

  if (result.ok) {
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
    }

    return response;
  }

  const hostedResult = await startOpenAiAccountDeviceAuth(now);
  if (hostedResult.ok) {
    const response = NextResponse.json({
      ok: true,
      alreadyConnected: false,
      message: hostedResult.message,
      deviceAuth: {
        verificationUri: hostedResult.deviceAuth.verificationUri,
        userCode: hostedResult.deviceAuth.userCode,
        expiresAt: hostedResult.deviceAuth.expiresAt,
      },
    });
    setPendingOpenAiAccountSessionCookie(
      response,
      hostedResult.deviceAuth.expiresAt,
      now,
    );
    setOpenAiAccountDeviceCookie(
      response,
      {
        verificationUri: hostedResult.deviceAuth.verificationUri,
        userCode: hostedResult.deviceAuth.userCode,
        deviceAuthId: hostedResult.deviceAuth.deviceAuthId,
        intervalSeconds: hostedResult.deviceAuth.intervalSeconds,
      },
      hostedResult.deviceAuth.expiresAt,
      now,
    );
    clearOpenAiAccountTokenSessionCookie(response);
    return response;
  }

  return NextResponse.json(
    {
      ok: false,
      error: hostedResult.error || result.error,
      message: hostedResult.message || result.message,
    },
    { status: 500 },
  );
}
