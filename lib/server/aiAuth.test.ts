import { describe, expect, it } from 'vitest';

import {
  getAiProviderPreference,
  getOpenAiApiKey,
  resolveActiveAiProvider,
} from './aiAuth';

describe('AI auth provider selection', () => {
  it('accepts openai-codex as the Codex CLI provider alias', () => {
    expect(getAiProviderPreference({ STILLAS_AI_PROVIDER: 'openai-codex' })).toBe(
      'codex-cli',
    );
  });

  it('prefers a Platform API key in auto mode and falls back to Codex CLI login', () => {
    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('openai-api');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: false,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('codex-cli');
  });

  it('does not treat non-ChatGPT Codex auth as an active Codex provider', () => {
    expect(
      resolveActiveAiProvider('codex-cli', {
        hasOpenAiApiKey: false,
        hasCodexChatGptAuth: false,
      }),
    ).toBe('none');
  });

  it('trims empty API keys to undefined', () => {
    expect(getOpenAiApiKey({ OPENAI_API_KEY: '   ' })).toBeUndefined();
    expect(getOpenAiApiKey({ OPENAI_API_KEY: 'sk-test' })).toBe('sk-test');
  });
});
