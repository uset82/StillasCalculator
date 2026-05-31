import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { AiChatRequest } from '@/app/api/ai/chat/route';
import { runCodexAgentWithTools } from '@/lib/ai/codexAgentRunner';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { ScaffoldPlan } from '@/lib/types';
import {
  applyAccountNotification,
  CodexAppServerClient,
  isDeviceCodeSettingsError,
  type CodexDeviceLogin,
  type CodexLoginNotificationState,
} from './appServerClient';

const DEFAULT_PORT = 8787;
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface BackendSession {
  id: string;
  dir: string;
  expiresAt: number;
  lastAccessAt: number;
  client: CodexAppServerClient;
  pendingDeviceAuth: CodexDeviceLogin | null;
  authNotifications: CodexLoginNotificationState;
}

interface BackendChatRequest extends AiChatRequest {
  sessionId?: string;
}

function sessionTtlMs(): number {
  const configured = Number(process.env.STILLAS_CODEX_SESSION_TTL_SECONDS);
  return (
    (Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SESSION_TTL_SECONDS) * 1000
  );
}

function dataDir(): string {
  return resolve(
    process.env.STILLAS_CODEX_DATA_DIR?.trim() ||
      join(tmpdir(), 'stillas-codex-backend'),
  );
}

function port(): number {
  const configured = Number(process.env.PORT ?? process.env.STILLAS_CODEX_BACKEND_PORT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PORT;
}

function backendSecret(): string | null {
  return process.env.STILLAS_CODEX_BACKEND_SECRET?.trim() || null;
}

function sanitizeSessionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function requireAuth(request: IncomingMessage): boolean {
  const secret = backendSecret();
  if (!secret && process.env.NODE_ENV !== 'production') return true;
  return request.headers.authorization === `Bearer ${secret}`;
}

class SessionManager {
  private sessions = new Map<string, BackendSession>();
  private readonly root = dataDir();

  async get(sessionId: string, now = Date.now()): Promise<BackendSession> {
    await mkdir(this.root, { recursive: true });
    const id = sanitizeSessionId(sessionId);
    const existing = this.sessions.get(id);
    if (existing && existing.expiresAt > now) {
      existing.lastAccessAt = now;
      return existing;
    }
    if (existing) {
      await this.close(id);
    }

    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true });
    const session: BackendSession = {
      id,
      dir,
      expiresAt: now + sessionTtlMs(),
      lastAccessAt: now,
      pendingDeviceAuth: null,
      authNotifications: {
        authenticated: false,
        pending: false,
        error: null,
        deviceCodeRequired: false,
        planType: null,
      },
      client: new CodexAppServerClient({
        codexHome: dir,
        cwd: process.cwd(),
        onNotification: (message) => {
          session.authNotifications = applyAccountNotification(
            session.authNotifications,
            message,
          );
          if (session.authNotifications.authenticated) {
            session.pendingDeviceAuth = null;
          }
        },
      }),
    };
    this.sessions.set(id, session);
    return session;
  }

  async close(sessionId: string): Promise<void> {
    const id = sanitizeSessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await session.client.close();
  }

  async cleanup(now = Date.now()): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        await this.close(session.id);
      }
    }
  }

  async clearAll(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      await this.close(session.id);
    }
    await rm(this.root, { recursive: true, force: true }).catch(() => undefined);
  }
}

const sessions = new SessionManager();

async function handleStatus(body: unknown): Promise<{ status: number; body: unknown }> {
  const sessionId = stringOrNull(isRecord(body) ? body.sessionId : null);
  if (!sessionId) {
    return {
      status: 400,
      body: { error: 'Missing Codex backend session id.' },
    };
  }

  const session = await sessions.get(sessionId);
  try {
    const account = await session.client.accountRead();
    const pending =
      !account.authenticated &&
      session.pendingDeviceAuth !== null &&
      session.pendingDeviceAuth.expiresAt > Date.now() &&
      session.authNotifications.error === null;
    return {
      status: 200,
      body: {
        ok: true,
        authenticated: account.authenticated,
        pending,
        expiresAt: session.expiresAt,
        ...(pending && session.pendingDeviceAuth
          ? { deviceAuth: session.pendingDeviceAuth }
          : {}),
        ...(session.authNotifications.error
          ? { error: session.authNotifications.error }
          : {}),
        ...(session.authNotifications.deviceCodeRequired
          ? { deviceCodeRequired: true }
          : {}),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not read Codex auth status.';
    return {
      status: 503,
      body: {
        ok: false,
        authenticated: false,
        pending: false,
        expiresAt: null,
        error: message,
        ...(isDeviceCodeSettingsError(message) ? { deviceCodeRequired: true } : {}),
      },
    };
  }
}

async function handleSignIn(body: unknown): Promise<{ status: number; body: unknown }> {
  const sessionId = stringOrNull(isRecord(body) ? body.sessionId : null);
  if (!sessionId) {
    return {
      status: 400,
      body: { ok: false, message: 'Could not start ChatGPT sign-in.', error: 'Missing Codex backend session id.' },
    };
  }

  const session = await sessions.get(sessionId);
  try {
    const account = await session.client.accountRead();
    if (account.authenticated) {
      session.pendingDeviceAuth = null;
      return {
        status: 200,
        body: {
          ok: true,
          alreadyConnected: true,
          message: 'Your ChatGPT account is connected.',
          expiresAt: session.expiresAt,
        },
      };
    }

    const deviceAuth = await session.client.startDeviceLogin();
    session.pendingDeviceAuth = deviceAuth;
    session.authNotifications = {
      ...session.authNotifications,
      pending: true,
      error: null,
      deviceCodeRequired: false,
    };
    return {
      status: 200,
      body: {
        ok: true,
        alreadyConnected: false,
        message:
          'Open the ChatGPT sign-in link and enter the one-time code shown in the app.',
        expiresAt: session.expiresAt,
        deviceAuth,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not start ChatGPT sign-in.';
    return {
      status: 503,
      body: {
        ok: false,
        message: 'Could not start ChatGPT sign-in.',
        error: message,
        ...(isDeviceCodeSettingsError(message) ? { deviceCodeRequired: true } : {}),
      },
    };
  }
}

async function handleChat(body: unknown): Promise<{ status: number; body: unknown }> {
  const record = isRecord(body) ? body : {};
  const sessionId =
    stringOrNull(record.codexBackendSessionId) ?? stringOrNull(record.sessionId);
  if (!sessionId) {
    return { status: 400, body: { ok: false, error: 'Missing Codex backend session id.' } };
  }
  const session = await sessions.get(sessionId);
  const account = await session.client.accountRead();
  if (!account.authenticated) {
    return {
      status: 401,
      body: { ok: false, unavailable: true, error: 'ChatGPT sign-in is required.' },
    };
  }

  const request = (
    isRecord(record.request) ? record.request : record
  ) as unknown as BackendChatRequest;
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const initialPlan = request.projectState as ScaffoldPlan | undefined;
  const result = await runCodexAgentWithTools(
    messages,
    initialPlan ?? createScaffoldPlan(),
    session.id,
    { codexHome: session.dir },
  );
  if (!result.ok) {
    return {
      status: result.timedOut ? 504 : result.unavailable ? 503 : 502,
      body: {
        ok: false,
        error: result.error,
        ...(result.unavailable ? { unavailable: true } : {}),
        ...(result.timedOut ? { timedOut: true } : {}),
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      reply: result.reply,
      toolResults: result.toolResults,
      scaffoldPlan: result.scaffoldPlan,
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/healthz') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!requireAuth(request)) {
    sendJson(response, 401, { error: 'Unauthorized.' });
    return;
  }

  try {
    const body = await readBody(request);
    const path = request.url?.split('?')[0];
    if (path === '/api/ai/auth/status') {
      const result = await handleStatus(body);
      sendJson(response, result.status, result.body);
      return;
    }
    if (path === '/api/ai/auth/sign-in') {
      const result = await handleSignIn(body);
      sendJson(response, result.status, result.body);
      return;
    }
    if (path === '/api/ai/chat') {
      const result = await handleChat(body);
      sendJson(response, result.status, result.body);
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Codex backend failed.',
    });
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

const cleanupInterval = setInterval(() => {
  void sessions.cleanup();
}, 60_000);

process.once('SIGTERM', () => {
  clearInterval(cleanupInterval);
  void sessions.clearAll().finally(() => server.close());
});
process.once('SIGINT', () => {
  clearInterval(cleanupInterval);
  void sessions.clearAll().finally(() => server.close());
});

server.listen(port(), () => {
  // eslint-disable-next-line no-console
  console.log(`Stillas Codex backend listening on :${port()}`);
});
