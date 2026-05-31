import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';

export const AI_OPENAI_ACCOUNT_SESSION_COOKIE = 'stillas_ai_openai_session';
export const AI_OPENAI_ACCOUNT_PENDING_COOKIE = 'stillas_ai_openai_pending';

export const OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const OPENAI_ACCOUNT_PENDING_MAX_AGE_SECONDS = 15 * 60;

const SESSION_PURPOSE = 'codex-chatgpt-session';
const PENDING_PURPOSE = 'codex-chatgpt-pending';

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

function getCookieSecret(): string {
  const configured =
    process.env.STILLAS_AI_AUTH_COOKIE_SECRET?.trim() ??
    process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;

  generatedCookieSecret ??= randomBytes(32).toString('hex');
  return generatedCookieSecret;
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
