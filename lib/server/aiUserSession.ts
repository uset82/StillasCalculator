import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';

export const AI_OPENAI_ACCOUNT_SESSION_COOKIE = 'stillas_ai_openai_session';
export const AI_OPENAI_ACCOUNT_PENDING_COOKIE = 'stillas_ai_openai_pending';
export const AI_OPENAI_ACCOUNT_DEVICE_COOKIE = 'stillas_ai_openai_device';
export const AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE =
  'stillas_ai_openai_token_session';
export const AI_CODEX_BACKEND_SESSION_COOKIE =
  'stillas_ai_codex_backend_session';

export const OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS = 15 * 60;

const SESSION_PURPOSE = 'codex-chatgpt-session';
const PENDING_PURPOSE = 'codex-chatgpt-pending';
const DEVICE_PURPOSE = 'codex-chatgpt-device';
const TOKEN_SESSION_PURPOSE = 'codex-chatgpt-token-session';
const BACKEND_SESSION_PURPOSE = 'codex-chatgpt-backend-session';
const PRODUCTION_FALLBACK_COOKIE_SECRET =
  'stillascalculator-openai-account-auth-v1';

let generatedCookieSecret: string | null = null;

export interface OpenAiAccountSessionState {
  authenticated: boolean;
  pending: boolean;
  sessionExpiresAt: number | null;
  pendingExpiresAt: number | null;
  clearSessionCookie: boolean;
  clearPendingCookie: boolean;
}

interface SignedCookie {
  value: string;
  expiresAt: number;
  maxAge: number;
}

interface SignedDataCookie<T> extends SignedCookie {
  data: T;
}

export interface OpenAiAccountDeviceCookieData {
  verificationUri: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
}

export interface OpenAiAccountTokenSessionCookieData {
  sessionId: string;
}

export interface CodexBackendSessionCookieData {
  sessionId: string;
}

export interface VerifiedOpenAiAccountDeviceCookie {
  data: (OpenAiAccountDeviceCookieData & { expiresAt: number }) | null;
  clearCookie: boolean;
}

export interface VerifiedOpenAiAccountTokenSessionCookie {
  data: (OpenAiAccountTokenSessionCookieData & { expiresAt: number }) | null;
  clearCookie: boolean;
}

export interface VerifiedCodexBackendSessionCookie {
  data: (CodexBackendSessionCookieData & { expiresAt: number }) | null;
  clearCookie: boolean;
}

function getCookieSecret(): string {
  const configured =
    process.env.STILLAS_AI_AUTH_COOKIE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === 'development') {
    generatedCookieSecret ??= randomBytes(32).toString('hex');
    return generatedCookieSecret;
  }

  return PRODUCTION_FALLBACK_COOKIE_SECRET;
}

function signPayload(payload: string): string {
  return createHmac('sha256', getCookieSecret()).update(payload).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readCookie(request: Request | undefined, name: string): string | null {
  const cookieHeader = request?.headers.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return rawValue.join('=') || null;
    }
  }
  return null;
}

function createSignedCookie(
  purpose: string,
  expiresAt: number,
  now: number,
): SignedCookie {
  const maxAge = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  const nonce = randomBytes(16).toString('hex');
  const payload = `${purpose}.${expiresAt}.${nonce}`;
  return {
    value: `${payload}.${signPayload(payload)}`,
    expiresAt,
    maxAge,
  };
}

function encodeData(data: unknown): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

function decodeData<T>(encoded: string): T | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function createSignedDataCookie<T>(
  purpose: string,
  data: T,
  expiresAt: number,
  now: number,
): SignedDataCookie<T> {
  const maxAge = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  const nonce = randomBytes(16).toString('hex');
  const encodedData = encodeData(data);
  const payload = `${purpose}.${expiresAt}.${nonce}.${encodedData}`;
  return {
    value: `${payload}.${signPayload(payload)}`,
    data,
    expiresAt,
    maxAge,
  };
}

function verifySignedCookie(
  value: string | null,
  purpose: string,
  now: number,
): { valid: boolean; expiresAt: number | null } {
  if (!value) {
    return { valid: false, expiresAt: null };
  }

  const parts = value.split('.');
  if (parts.length !== 4) {
    return { valid: false, expiresAt: null };
  }

  const [cookiePurpose, rawExpiresAt, nonce, signature] = parts;
  if (cookiePurpose !== purpose || !nonce || !signature) {
    return { valid: false, expiresAt: null };
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { valid: false, expiresAt: null };
  }

  const payload = `${cookiePurpose}.${rawExpiresAt}.${nonce}`;
  if (!safeEqual(signPayload(payload), signature)) {
    return { valid: false, expiresAt: null };
  }

  return { valid: true, expiresAt };
}

function verifySignedDataCookie<T>(
  value: string | null,
  purpose: string,
  now: number,
): { valid: boolean; expiresAt: number | null; data: T | null } {
  if (!value) {
    return { valid: false, expiresAt: null, data: null };
  }

  const parts = value.split('.');
  if (parts.length !== 5) {
    return { valid: false, expiresAt: null, data: null };
  }

  const [cookiePurpose, rawExpiresAt, nonce, encodedData, signature] = parts;
  if (cookiePurpose !== purpose || !nonce || !encodedData || !signature) {
    return { valid: false, expiresAt: null, data: null };
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { valid: false, expiresAt: null, data: null };
  }

  const payload = `${cookiePurpose}.${rawExpiresAt}.${nonce}.${encodedData}`;
  if (!safeEqual(signPayload(payload), signature)) {
    return { valid: false, expiresAt: null, data: null };
  }

  const data = decodeData<T>(encodedData);
  if (data === null) {
    return { valid: false, expiresAt: null, data: null };
  }

  return { valid: true, expiresAt, data };
}

export function getOpenAiAccountSessionState(
  request?: Request,
  now = Date.now(),
): OpenAiAccountSessionState {
  const rawSession = readCookie(request, AI_OPENAI_ACCOUNT_SESSION_COOKIE);
  const rawPending = readCookie(request, AI_OPENAI_ACCOUNT_PENDING_COOKIE);
  const session = verifySignedCookie(rawSession, SESSION_PURPOSE, now);
  const pending = verifySignedCookie(rawPending, PENDING_PURPOSE, now);

  return {
    authenticated: session.valid,
    pending: !session.valid && pending.valid,
    sessionExpiresAt: session.expiresAt,
    pendingExpiresAt: !session.valid ? pending.expiresAt : null,
    clearSessionCookie: rawSession !== null && !session.valid,
    clearPendingCookie: rawPending !== null && (!pending.valid || session.valid),
  };
}

export function createOpenAiAccountSessionCookieValue(
  now = Date.now(),
): SignedCookie {
  return createSignedCookie(
    SESSION_PURPOSE,
    now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000,
    now,
  );
}

export function createPendingOpenAiAccountSessionCookieValue(
  expiresAt: number,
  now = Date.now(),
): SignedCookie {
  const boundedExpiresAt = Math.min(
    expiresAt,
    now + OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS * 1000,
  );
  return createSignedCookie(PENDING_PURPOSE, boundedExpiresAt, now);
}

export function setOpenAiAccountSessionCookie(
  response: NextResponse<unknown>,
  now = Date.now(),
): number {
  const cookie = createOpenAiAccountSessionCookieValue(now);
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_SESSION_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return cookie.expiresAt;
}

export function setPendingOpenAiAccountSessionCookie(
  response: NextResponse<unknown>,
  expiresAt: number,
  now = Date.now(),
): number {
  const cookie = createPendingOpenAiAccountSessionCookieValue(expiresAt, now);
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_PENDING_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return cookie.expiresAt;
}

export function getOpenAiAccountDeviceCookie(
  request?: Request,
  now = Date.now(),
): VerifiedOpenAiAccountDeviceCookie {
  const rawDevice = readCookie(request, AI_OPENAI_ACCOUNT_DEVICE_COOKIE);
  const verified = verifySignedDataCookie<OpenAiAccountDeviceCookieData>(
    rawDevice,
    DEVICE_PURPOSE,
    now,
  );
  return {
    data:
      verified.valid && verified.data && verified.expiresAt !== null
        ? { ...verified.data, expiresAt: verified.expiresAt }
        : null,
    clearCookie: rawDevice !== null && !verified.valid,
  };
}

export function setOpenAiAccountDeviceCookie(
  response: NextResponse<unknown>,
  data: OpenAiAccountDeviceCookieData,
  expiresAt: number,
  now = Date.now(),
): number {
  const cookie = createSignedDataCookie(DEVICE_PURPOSE, data, expiresAt, now);
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_DEVICE_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return cookie.expiresAt;
}

export function getOpenAiAccountTokenSessionCookie(
  request?: Request,
  now = Date.now(),
): VerifiedOpenAiAccountTokenSessionCookie {
  const rawTokenSession = readCookie(
    request,
    AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
  );
  const verified = verifySignedDataCookie<OpenAiAccountTokenSessionCookieData>(
    rawTokenSession,
    TOKEN_SESSION_PURPOSE,
    now,
  );
  return {
    data:
      verified.valid && verified.data && verified.expiresAt !== null
        ? { ...verified.data, expiresAt: verified.expiresAt }
        : null,
    clearCookie: rawTokenSession !== null && !verified.valid,
  };
}

export function newCodexBackendSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function getCodexBackendSessionCookie(
  request?: Request,
  now = Date.now(),
): VerifiedCodexBackendSessionCookie {
  const rawBackendSession = readCookie(request, AI_CODEX_BACKEND_SESSION_COOKIE);
  const verified = verifySignedDataCookie<CodexBackendSessionCookieData>(
    rawBackendSession,
    BACKEND_SESSION_PURPOSE,
    now,
  );
  return {
    data:
      verified.valid && verified.data && verified.expiresAt !== null
        ? { ...verified.data, expiresAt: verified.expiresAt }
        : null,
    clearCookie: rawBackendSession !== null && !verified.valid,
  };
}

export function setCodexBackendSessionCookie(
  response: NextResponse<unknown>,
  sessionId: string,
  expiresAt: number,
  now = Date.now(),
): number {
  const cookie = createSignedDataCookie(
    BACKEND_SESSION_PURPOSE,
    { sessionId },
    expiresAt,
    now,
  );
  response.cookies.set({
    name: AI_CODEX_BACKEND_SESSION_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return cookie.expiresAt;
}

export function setOpenAiAccountTokenSessionCookie(
  response: NextResponse<unknown>,
  sessionId: string,
  expiresAt: number,
  now = Date.now(),
): number {
  const cookie = createSignedDataCookie(
    TOKEN_SESSION_PURPOSE,
    { sessionId },
    expiresAt,
    now,
  );
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return cookie.expiresAt;
}

export function clearOpenAiAccountSessionCookie(
  response: NextResponse<unknown>,
): void {
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_SESSION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
}

export function clearPendingOpenAiAccountSessionCookie(
  response: NextResponse<unknown>,
): void {
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_PENDING_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
}

export function clearOpenAiAccountDeviceCookie(
  response: NextResponse<unknown>,
): void {
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_DEVICE_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
}

export function clearOpenAiAccountTokenSessionCookie(
  response: NextResponse<unknown>,
): void {
  response.cookies.set({
    name: AI_OPENAI_ACCOUNT_TOKEN_SESSION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
}

export function clearCodexBackendSessionCookie(
  response: NextResponse<unknown>,
): void {
  response.cookies.set({
    name: AI_CODEX_BACKEND_SESSION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
}
