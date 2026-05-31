import { randomBytes } from 'node:crypto';

import type { OpenAiAccountTokens } from '@/lib/ai/openAiDeviceAuth';
import { OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS } from '@/lib/server/aiUserSession';

const STORE_NAME = 'stillas-ai-openai-auth';
const SESSION_KEY_PREFIX = 'sessions/';

interface StoredOpenAiAccountTokens {
  expiresAt: number;
  tokens: OpenAiAccountTokens;
}

interface BlobStore {
  setJSON(key: string, value: unknown): Promise<unknown>;
  get(key: string, options: { type: 'json' }): Promise<unknown | null>;
  delete(key: string): Promise<void>;
}

const memoryStore = new Map<string, StoredOpenAiAccountTokens>();

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`;
}

async function getBlobStore(): Promise<BlobStore | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: STORE_NAME, consistency: 'strong' }) as BlobStore;
  } catch {
    return null;
  }
}

function isStoredTokens(value: unknown): value is StoredOpenAiAccountTokens {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const tokens = record.tokens as Record<string, unknown> | undefined;
  return (
    typeof record.expiresAt === 'number' &&
    typeof tokens?.accessToken === 'string' &&
    typeof tokens?.refreshToken === 'string' &&
    typeof tokens?.idToken === 'string'
  );
}

export function newOpenAiAccountTokenSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function openAiAccountTokenSessionExpiresAt(now = Date.now()): number {
  return now + OPENAI_ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000;
}

export async function saveOpenAiAccountTokens(
  sessionId: string,
  tokens: OpenAiAccountTokens,
  expiresAt = openAiAccountTokenSessionExpiresAt(),
): Promise<void> {
  const record: StoredOpenAiAccountTokens = { expiresAt, tokens };
  const key = sessionKey(sessionId);
  const blobStore = await getBlobStore();
  if (blobStore) {
    try {
      await blobStore.setJSON(key, record);
      memoryStore.set(key, record);
      return;
    } catch {
      // Local Next.js dev without Netlify Blobs falls back to process memory.
    }
  }
  memoryStore.set(key, record);
}

export async function loadOpenAiAccountTokens(
  sessionId: string | null | undefined,
  now = Date.now(),
): Promise<StoredOpenAiAccountTokens | null> {
  if (!sessionId) return null;
  const key = sessionKey(sessionId);
  const blobStore = await getBlobStore();

  let record: StoredOpenAiAccountTokens | null = null;
  if (blobStore) {
    try {
      const stored = await blobStore.get(key, { type: 'json' });
      record = isStoredTokens(stored) ? stored : null;
    } catch {
      record = null;
    }
  }
  record ??= memoryStore.get(key) ?? null;

  if (!record) return null;
  if (record.expiresAt <= now) {
    await deleteOpenAiAccountTokens(sessionId);
    return null;
  }
  return record;
}

export async function deleteOpenAiAccountTokens(
  sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId) return;
  const key = sessionKey(sessionId);
  memoryStore.delete(key);
  const blobStore = await getBlobStore();
  if (!blobStore) return;
  try {
    await blobStore.delete(key);
  } catch {
    // Deleting an already-missing blob is harmless for auth cleanup.
  }
}
