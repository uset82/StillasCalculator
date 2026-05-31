import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createScaffoldPlan } from '@/lib/scaffold/scaffoldPlan';
import type { ChatMessage } from '@/lib/types';

const codexBehavior = vi.hoisted(() => ({
  events: [] as unknown[],
  authStatus: { loggedIn: true, method: 'chatgpt' } as {
    loggedIn: boolean;
    method: 'chatgpt' | 'api-key' | 'access-token' | 'unknown' | null;
  },
}));

vi.mock('@openai/codex-sdk', () => {
  class Codex {
    startThread() {
      return {
        runStreamed: async () => ({
          events: (async function* () {
            for (const event of codexBehavior.events) {
              yield event;
            }
          })(),
        }),
      };
    }
  }

  return { Codex };
});

vi.mock('@/lib/ai/codexSdkAdapter', () => ({
  getCodexCliAuthStatus: vi.fn(async () => codexBehavior.authStatus),
}));

import {
  messageRequiresTools,
  runCodexAgentWithTools,
} from './codexAgentRunner';

function userMessage(content: string): ChatMessage {
  return { id: 'm1', role: 'user', content, timestamp: 1_000 };
}

beforeEach(() => {
  codexBehavior.authStatus = { loggedIn: true, method: 'chatgpt' };
  codexBehavior.events = [
    {
      type: 'item.completed',
      item: { id: 'a1', type: 'agent_message', text: 'Done.' },
    },
  ];
});

describe('runCodexAgentWithTools: MCP tool result handling', () => {
  it('rejects Codex auth that is not a ChatGPT/OpenAI account login', async () => {
    codexBehavior.authStatus = { loggedIn: true, method: 'api-key' };

    const result = await runCodexAgentWithTools(
      [userMessage('Calculate scaffold materials.')],
      createScaffoldPlan(),
      'api-key-auth-session',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unavailable).toBe(true);
    expect(result.error).toContain('ChatGPT/OpenAI account');
  });

  it('surfaces failed MCP tool calls to the chat route instead of dropping them', async () => {
    codexBehavior.events = [
      {
        type: 'item.completed',
        item: {
          id: 'tool-1',
          type: 'mcp_tool_call',
          server: 'stillas',
          tool: 'setBuildingPerimeter',
          arguments: {},
          status: 'failed',
          error: { message: 'Polygon validation failed.' },
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'a1',
          type: 'agent_message',
          text: 'I could not update the perimeter.',
        },
      },
    ];

    const result = await runCodexAgentWithTools(
      [userMessage('Draw the building perimeter.')],
      createScaffoldPlan(),
      'failed-tool-session',
    );

    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.toolResults).toEqual([
      {
        tool: 'setBuildingPerimeter',
        ok: false,
        error: 'Polygon validation failed.',
      },
    ]);
    expect(result.reply).toBe('I could not update the perimeter.');
  });
});

describe('messageRequiresTools', () => {
  it.each([
    'Calculate the scaffold materials.',
    'Can you recalculate this after I change the height?',
    'Show me the materials for this job.',
    'Make a drawing of the scaffold.',
    'The scaffolding estimate needs a report.',
    'Exporting CAD would help.',
    'Select these facades.',
    'How many BOMs can you generate?',
    'Calcula el perímetro y los materiales de andamio.',
    'Dibuja la casa seleccionada y calcula el área.',
    'Beregn stillas for valgt hus og tegn omkretsen.',
  ])('detects tool-required wording: %s', (content) => {
    expect(messageRequiresTools(content)).toBe(true);
  });

  it('does not force tools for plain conversation', () => {
    expect(messageRequiresTools('Hello, what can you help with?')).toBe(false);
  });
});
