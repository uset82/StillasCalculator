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

  it('accepts openai-account and ChatGPT aliases as the account provider', () => {
    expect(
      getAiProviderPreference({ STILLAS_AI_PROVIDER: 'openai-account' }),
    ).toBe('openai-account');
    expect(getAiProviderPreference({ STILLAS_AI_PROVIDER: 'chatgpt' })).toBe(
      'openai-account',
    );
  });

  it('prefers signed-in OpenAI account auth in auto mode before API-key auth', () => {
    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
        hasOpenAiAccountAuth: true,
      }),
    ).toBe('openai-account');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('codex-cli');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: false,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('codex-cli');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: false,
      }),
    ).toBe('openai-api');
  });

  it('requires a user account session for explicit openai-account mode', () => {
    expect(
      resolveActiveAiProvider('openai-account', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
        hasOpenAiAccountAuth: false,
      }),
    ).toBe('none');

    expect(
      resolveActiveAiProvider('openai-account', {
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: false,
        hasOpenAiAccountAuth: true,
      }),
    ).toBe('openai-account');
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
