import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CodexAppServerClient } from '@/server/codex-backend/appServerClient';

const MAX_RECOVERY_CANDIDATES = 5;

function isLocalBackendUrl(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1'
    );
  } catch {
    return false;
  }
}

function canRecoverLocalSession(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    isLocalBackendUrl(process.env.STILLAS_CODEX_BACKEND_URL)
  );
}

function dataDir(): string {
  return resolve(
    process.env.STILLAS_CODEX_DATA_DIR?.trim() ||
      join(tmpdir(), 'stillas-codex-backend'),
  );
}

export async function findAuthenticatedLocalCodexBackendSession(): Promise<
  string | null
> {
  if (!canRecoverLocalSession()) return null;

  let directories: Array<{ name: string; path: string; modifiedAt: number }>;
  try {
    directories = await Promise.all(
      (await readdir(dataDir(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(dataDir(), entry.name);
          const info = await stat(path);
          return { name: entry.name, path, modifiedAt: info.mtimeMs };
        }),
    );
  } catch {
    return null;
  }

  directories.sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const directory of directories.slice(0, MAX_RECOVERY_CANDIDATES)) {
    const client = new CodexAppServerClient({
      codexHome: directory.path,
      cwd: process.cwd(),
    });
    try {
      const account = await client.accountRead();
      if (account.authenticated) {
        return directory.name;
      }
    } catch {
      // Try the next recent session directory.
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  return null;
}
