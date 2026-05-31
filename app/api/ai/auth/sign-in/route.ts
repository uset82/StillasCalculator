import { NextResponse } from 'next/server';

import type { AiAuthSignInResponse } from '@/lib/ai/authStatus';
import { startCodexChatGptSignIn } from '@/lib/ai/codexSdkAdapter';
import {
  clearPendingOpenAiAccountSessionCookie,
  setOpenAiAccountSessionCookie,
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
    } else if (result.alreadyConnected) {
      setOpenAiAccountSessionCookie(response, now);
      clearPendingOpenAiAccountSessionCookie(response);
    }

    return response;
  }

  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      message: result.message,
    },
    { status: 500 },
  );
}
