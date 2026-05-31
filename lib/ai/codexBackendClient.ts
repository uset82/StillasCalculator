import type { AiChatRequest, AiChatResponse } from '@/app/api/ai/chat/route';

export const CODEX_DEVICE_CODE_SETTINGS_URL =
  'https://chatgpt.com/#settings/Security';

export interface CodexBackendMcpStatus {
  connected: boolean;
  persistent: boolean;
  toolCount: number;
  missingTools: string[];
  checkedAt: number | null;
  error?: string;
}

export interface CodexBackendDeviceAuth {
  verificationUri: string;
  userCode: string;
  expiresAt: number;
}

export type CodexBackendAuthStatus =
  | {
      ok: true;
      authenticated: boolean;
      pending: boolean;
      expiresAt: number | null;
      deviceAuth?: CodexBackendDeviceAuth;
      deviceCodeRequired?: boolean;
      error?: string;
      mcp?: CodexBackendMcpStatus;
    }
  | {
      ok: false;
      authenticated: false;
      pending: false;
      expiresAt: null;
      error: string;
      deviceCodeRequired?: boolean;
      mcp?: CodexBackendMcpStatus;
    };

export type CodexBackendSignInResult =
  | {
      ok: true;
      alreadyConnected: boolean;
      message: string;
      expiresAt: number | null;
      deviceAuth?: CodexBackendDeviceAuth;
      deviceCodeRequired?: boolean;
    }
  | {
      ok: false;
      message: string;
      error: string;
      deviceCodeRequired?: boolean;
    };

export type CodexBackendChatResult =
  | ({ ok: true } & AiChatResponse)
  | {
      ok: false;
      unavailable?: boolean;
      timedOut?: boolean;
      error: string;
    };

interface BackendRequestOptions {
  signal?: AbortSignal;
}

interface BackendConfig {
  url: string;
  secret: string;
}

function getBackendConfig(): BackendConfig | null {
  const url = process.env.STILLAS_CODEX_BACKEND_URL?.trim();
  const secret = process.env.STILLAS_CODEX_BACKEND_SECRET?.trim();
  if (!url || !secret) return null;
  return { url: url.replace(/\/+$/, ''), secret };
}

function backendUnavailableError(): string {
  return 'The Codex backend is not configured. Set STILLAS_CODEX_BACKEND_URL and STILLAS_CODEX_BACKEND_SECRET for ChatGPT account sign-in.';
}

async function requestBackend<T>(
  path: string,
  body: unknown,
  { signal }: BackendRequestOptions = {},
): Promise<
  | { ok: true; payload: T }
  | { ok: false; error: string; status: number; payload?: unknown }
> {
  const config = getBackendConfig();
  if (!config) {
    return { ok: false, status: 503, error: backendUnavailableError() };
  }

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).error === 'string'
          ? String((payload as Record<string, unknown>).error)
          : `Codex backend request failed with status ${response.status}.`;
      return { ok: false, status: response.status, error, payload };
    }
    return { ok: true, payload: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error:
        error instanceof Error
          ? `The Codex backend is unavailable: ${error.message}`
          : 'The Codex backend is unavailable.',
    };
  }
}

export async function getCodexBackendAuthStatus(
  sessionId: string,
  options?: BackendRequestOptions,
): Promise<CodexBackendAuthStatus> {
  const result = await requestBackend<CodexBackendAuthStatus>(
    '/api/ai/auth/status',
    { sessionId },
    options,
  );
  if (!result.ok) {
    const payload =
      typeof result.payload === 'object' && result.payload !== null
        ? (result.payload as Record<string, unknown>)
        : null;
    return {
      ok: false,
      authenticated: false,
      pending: false,
      expiresAt: null,
      error:
        typeof payload?.error === 'string' ? payload.error : result.error,
      ...(payload?.deviceCodeRequired === true
        ? { deviceCodeRequired: true }
        : {}),
    };
  }
  return result.payload;
}

export async function startCodexBackendSignIn(
  sessionId: string,
  options?: BackendRequestOptions,
): Promise<CodexBackendSignInResult> {
  const result = await requestBackend<CodexBackendSignInResult>(
    '/api/ai/auth/sign-in',
    { sessionId },
    options,
  );
  if (!result.ok) {
    const payload =
      typeof result.payload === 'object' && result.payload !== null
        ? (result.payload as Record<string, unknown>)
        : null;
    return {
      ok: false,
      message:
        typeof payload?.message === 'string'
          ? payload.message
          : 'Could not start ChatGPT sign-in.',
      error:
        typeof payload?.error === 'string' ? payload.error : result.error,
      ...(payload?.deviceCodeRequired === true
        ? { deviceCodeRequired: true }
        : {}),
    };
  }
  return result.payload;
}

export async function sendCodexBackendChatRequest(
  sessionId: string,
  request: AiChatRequest,
  options?: BackendRequestOptions,
): Promise<CodexBackendChatResult> {
  const result = await requestBackend<CodexBackendChatResult>(
    '/api/ai/chat',
    { codexBackendSessionId: sessionId, request },
    options,
  );
  if (!result.ok) {
    return { ok: false, error: result.error, unavailable: result.status === 401 };
  }
  return result.payload;
}
