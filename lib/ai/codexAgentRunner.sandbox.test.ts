// Integration test for the Codex sandbox flags (task 11.2).
//
// Property L: Codex sandbox flags
//   Every Codex thread is started with the four hardening flags exactly set —
//   sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled:
//   false, webSearchMode: 'disabled' — and external effects flow only through
//   the MCP server configured as `mcp_servers.stillas`. (Req 9.1, 9.2)
//
// The `@openai/codex-sdk` `Codex` class is mocked so the test can capture the
// options passed to the constructor (the MCP server config) and to
// `codex.startThread(...)` (the sandbox flags), without spawning a real Codex
// CLI or MCP server. `getCodexCliAuthStatus` is stubbed to report a logged-in
// session, and a fake streamed-event iterator drives the runner to completion.
//
// **Validates: Requirements 9.1, 9.2**

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { ThreadEvent } from '@openai/codex-sdk';
import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { ChatMessage } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mock the Codex SDK so we can capture how the thread is configured.
// `vi.hoisted` lets the capture buffers exist before the hoisted vi.mock runs.
// ---------------------------------------------------------------------------

const codexCapture = vi.hoisted(() => {
  const constructorCalls: unknown[] = [];
  const startThreadCalls: unknown[] = [];

  /** A fake streamed turn that yields a single agent_message and ends. */
  async function* fakeEvents(): AsyncGenerator<ThreadEvent> {
    yield {
      type: 'item.completed',
      item: { id: 'a1', type: 'agent_message', text: 'Done.' },
    } as ThreadEvent;
  }

  return { constructorCalls, startThreadCalls, fakeEvents };
});

vi.mock('@openai/codex-sdk', () => {
  class Codex {
    constructor(options?: unknown) {
      codexCapture.constructorCalls.push(options);
    }

    startThread(options?: unknown) {
      codexCapture.startThreadCalls.push(options);
      return {
        runStreamed: async () => ({ events: codexCapture.fakeEvents() }),
      };
    }
  }

  return { Codex };
});

// Report a logged-in Codex/ChatGPT session so the runner proceeds past its
// auth guard and reaches thread construction.
vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(async () => ({
    loggedIn: true,
    method: 'chatgpt',
  })),
}));

// Imported AFTER the mocks above so the runner binds to the mocked Codex SDK.
import { runCodexAgentWithTools } from './codexAgentRunner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMessage(content: string): ChatMessage {
  return { id: 'm1', role: 'user', content, timestamp: 1_000 };
}

interface CapturedThreadOptions {
  sandboxMode?: string;
  approvalPolicy?: string;
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  [key: string]: unknown;
}

interface CapturedCodexOptions {
  config?: {
    mcp_servers?: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  };
}

async function runAndCapture(sessionId = 'sandbox-session'): Promise<{
  threadOptions: CapturedThreadOptions;
  codexOptions: CapturedCodexOptions;
}> {
  const result = await runCodexAgentWithTools(
    [userMessage('Calculate the scaffold for my building.')],
    createScaffoldPlan(),
    sessionId,
  );

  // The runner completed the turn through the mocked stream.
  expect(result.ok).toBe(true);

  expect(codexCapture.startThreadCalls).toHaveLength(1);
  expect(codexCapture.constructorCalls).toHaveLength(1);

  return {
    threadOptions: codexCapture.startThreadCalls[0] as CapturedThreadOptions,
    codexOptions: codexCapture.constructorCalls[0] as CapturedCodexOptions,
  };
}

// ---------------------------------------------------------------------------
// Property L — the four sandbox flags are exactly set (Req 9.1)
// ---------------------------------------------------------------------------

describe('runCodexAgentWithTools: Codex sandbox flags (Property L, Req 9.1)', () => {
  beforeEach(() => {
    codexCapture.constructorCalls.length = 0;
    codexCapture.startThreadCalls.length = 0;
  });

  it('starts every thread with sandboxMode: read-only', async () => {
    const { threadOptions } = await runAndCapture();
    expect(threadOptions.sandboxMode).toBe('read-only');
  });

  it('starts every thread with approvalPolicy: never', async () => {
    const { threadOptions } = await runAndCapture();
    expect(threadOptions.approvalPolicy).toBe('never');
  });

  it('starts every thread with networkAccessEnabled: false', async () => {
    const { threadOptions } = await runAndCapture();
    expect(threadOptions.networkAccessEnabled).toBe(false);
  });

  it('starts every thread with webSearchMode: disabled', async () => {
    const { threadOptions } = await runAndCapture();
    expect(threadOptions.webSearchMode).toBe('disabled');
  });

  it('sets all four sandbox flags together (a config missing any one is non-compliant)', async () => {
    const { threadOptions } = await runAndCapture();
    expect(threadOptions).toMatchObject({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Property L — external effects flow only through the MCP server (Req 9.2)
// ---------------------------------------------------------------------------

describe('runCodexAgentWithTools: external effects mediated by mcp_servers.stillas (Property L, Req 9.2)', () => {
  beforeEach(() => {
    codexCapture.constructorCalls.length = 0;
    codexCapture.startThreadCalls.length = 0;
  });

  it('configures exactly the stillas MCP server pointing at the MCP server script', async () => {
    const sessionId = 'mcp-session-xyz';
    const { codexOptions } = await runAndCapture(sessionId);

    const mcpServers = codexOptions.config?.mcp_servers;
    expect(mcpServers).toBeDefined();
    // The ONLY external effect channel is the Stillas MCP server.
    expect(Object.keys(mcpServers ?? {})).toEqual(['stillas']);

    const stillas = mcpServers?.stillas;
    expect(stillas).toBeDefined();
    // Launched via the project-local tsx CLI, through the current Node binary,
    // so Codex's temp working directory cannot make npx fetch a separate tsx
    // or lose the app tsconfig path aliases.
    expect(stillas?.command).toBe(process.execPath);
    expect(stillas?.args?.[0]).toMatch(/node_modules[\\/]+tsx[\\/]+dist[\\/]+cli\.mjs$/);
    expect(stillas?.args?.[stillas.args.length - 1]).toMatch(
      /stillas-mcp-server\.ts$/,
    );
  });

  it('passes the per-request plan file and session id to the MCP server env', async () => {
    const sessionId = 'mcp-session-xyz';
    const { codexOptions } = await runAndCapture(sessionId);

    const env = codexOptions.config?.mcp_servers?.stillas?.env;
    expect(env).toBeDefined();
    expect(env?.STILLAS_SESSION_ID).toBe(sessionId);
    expect(env?.STILLAS_PLAN_FILE).toMatch(/scaffold-plan\.json$/);
    expect(env?.TSX_TSCONFIG_PATH).toMatch(/tsconfig\.json$/);
  });
});
