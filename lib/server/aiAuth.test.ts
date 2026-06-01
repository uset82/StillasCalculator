import { describe, expect, it } from 'vitest';

import {
  getAiProviderPreference,
  getOpenAiApiKey,
  getOpenRouterApiKey,
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

  it('accepts openrouter-api aliases as the hosted provider', () => {
    expect(
      getAiProviderPreference({ STILLAS_AI_PROVIDER: 'openrouter-api' }),
    ).toBe('openrouter-api');
    expect(getAiProviderPreference({ STILLAS_AI_PROVIDER: 'openrouter' })).toBe(
      'openrouter-api',
    );
  });

  it('prefers OpenRouter API auth in auto mode before account or Codex auth', () => {
    expect(
      resolveActiveAiProvider('auto', {
        hasOpenRouterApiKey: true,
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
        hasOpenAiAccountAuth: true,
      }),
    ).toBe('openrouter-api');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenRouterApiKey: false,
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
        hasOpenAiAccountAuth: true,
      }),
    ).toBe('openai-account');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenRouterApiKey: false,
        hasOpenAiApiKey: false,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('codex-cli');

    expect(
      resolveActiveAiProvider('auto', {
        hasOpenRouterApiKey: false,
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: false,
      }),
    ).toBe('none');
  });

  it('requires an OpenRouter key for explicit openrouter-api mode', () => {
    expect(
      resolveActiveAiProvider('openrouter-api', {
        hasOpenRouterApiKey: false,
        hasOpenAiApiKey: true,
        hasCodexChatGptAuth: true,
      }),
    ).toBe('none');

    expect(
      resolveActiveAiProvider('openrouter-api', {
        hasOpenRouterApiKey: true,
        hasOpenAiApiKey: false,
        hasCodexChatGptAuth: false,
      }),
    ).toBe('openrouter-api');
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
    expect(getOpenRouterApiKey({ OPENROUTER_API_KEY: '   ' })).toBeUndefined();
    expect(getOpenRouterApiKey({ OPENROUTER_API_KEY: 'or-test' })).toBe('or-test');
    expect(getOpenAiApiKey({ OPENAI_API_KEY: '   ' })).toBeUndefined();
    expect(getOpenAiApiKey({ OPENAI_API_KEY: 'sk-test' })).toBe('sk-test');
  });
});
