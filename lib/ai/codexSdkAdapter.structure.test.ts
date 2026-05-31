// Structural test for the single tool-enabled Codex path (task 10.2).
//
// Property O: Single tool-enabled Codex path
//   After retiring the legacy tool-less `runCodexSdkChat`, the ONLY Codex
//   chat entry point is the tool-enabled `runCodexAgentWithTools`. There is
//   no dormant tool-less Codex chat path that could silently regress the
//   "tool access is non-optional" guarantee, while the still-used
//   `getCodexCliAuthStatus` / `startCodexChatGptSignIn` exports of the
//   adapter module are preserved. (Req 2.7)
//
// This is a STRUCTURAL test: it inspects the public module surface of
// `lib/ai/codexSdkAdapter.ts` and reads `app/api/ai/chat/route.ts` from disk
// with Node's `fs`, so the assertions reflect what actually ships rather than
// a re-export a test could accidentally satisfy.
//
// **Validates: Requirements 2.7**

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as adapter from './codexSdkAdapter';

// Repo root, derived from this file's location (lib/ai/codexSdkAdapter.structure.test.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reads a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const ADAPTER_RELATIVE_PATH = 'lib/ai/codexSdkAdapter.ts';
const CHAT_ROUTE_RELATIVE_PATH = 'app/api/ai/chat/route.ts';

// ---------------------------------------------------------------------------
// Property O — the adapter module no longer exports the tool-less chat path
// ---------------------------------------------------------------------------

describe('codexSdkAdapter module surface (Property O, Req 2.7)', () => {
  it('no longer exports runCodexSdkChat', () => {
    expect(Object.keys(adapter)).not.toContain('runCodexSdkChat');
    expect((adapter as Record<string, unknown>).runCodexSdkChat).toBeUndefined();
  });

  it('still exports getCodexCliAuthStatus as a function', () => {
    expect(Object.keys(adapter)).toContain('getCodexCliAuthStatus');
    expect(typeof adapter.getCodexCliAuthStatus).toBe('function');
  });

  it('still exports startCodexChatGptSignIn as a function', () => {
    expect(Object.keys(adapter)).toContain('startCodexChatGptSignIn');
    expect(typeof adapter.startCodexChatGptSignIn).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Property O — the adapter source on disk no longer mentions the retired path
// ---------------------------------------------------------------------------

describe('codexSdkAdapter source on disk (Property O, Req 2.7)', () => {
  it('does not contain the string "runCodexSdkChat"', () => {
    const source = readRepoFile(ADAPTER_RELATIVE_PATH);
    expect(source).not.toContain('runCodexSdkChat');
  });
});

// ---------------------------------------------------------------------------
// Property O — the chat route uses ONLY runCodexAgentWithTools for Codex
// ---------------------------------------------------------------------------

describe('chat route Codex entry point (Property O, Req 2.7)', () => {
  it('references runCodexAgentWithTools as the Codex entry point', () => {
    const source = readRepoFile(CHAT_ROUTE_RELATIVE_PATH);
    expect(source).toContain('runCodexAgentWithTools');
  });

  it('does not reference the retired runCodexSdkChat path', () => {
    const source = readRepoFile(CHAT_ROUTE_RELATIVE_PATH);
    expect(source).not.toContain('runCodexSdkChat');
  });
});
