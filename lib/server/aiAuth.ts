export type AiProviderPreference =
  | 'auto'
  | 'openrouter-api'
  | 'openai-account'
  | 'openai-api'
  | 'codex-cli'
  | 'off';

export type AiActiveProvider =
  | 'openrouter-api'
  | 'openai-account'
  | 'openai-api'
  | 'codex-cli'
  | 'none'
  | 'off';

type EnvLike = Record<string, string | undefined>;

export function getAiProviderPreference(
  env: EnvLike = process.env,
): AiProviderPreference {
  const raw = (env.STILLAS_AI_PROVIDER ?? env.AI_PROVIDER ?? 'auto')
    .trim()
    .toLowerCase();

  if (
    raw === 'openrouter-api' ||
    raw === 'openrouter' ||
    raw === 'open-router'
  ) {
    return 'openrouter-api';
  }
  if (
    raw === 'openai-account' ||
    raw === 'chatgpt-account' ||
    raw === 'chatgpt' ||
    raw === 'account'
  ) {
    return 'openai-account';
  }
  if (raw === 'openai-api' || raw === 'api' || raw === 'openai') {
    return 'openai-api';
  }
  if (raw === 'codex-cli' || raw === 'codex' || raw === 'openai-codex') {
    return 'codex-cli';
  }
  if (raw === 'off' || raw === 'disabled' || raw === 'none') {
    return 'off';
  }
  return 'auto';
}

export function getOpenAiApiKey(
  env: EnvLike = process.env,
): string | undefined {
  return env.OPENAI_API_KEY?.trim() || undefined;
}

export function getOpenRouterApiKey(
  env: EnvLike = process.env,
): string | undefined {
  return env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function resolveActiveAiProvider(
  preference: AiProviderPreference,
  options: {
    hasOpenRouterApiKey?: boolean;
    hasOpenAiApiKey: boolean;
    hasCodexChatGptAuth: boolean;
    hasOpenAiAccountAuth?: boolean;
  },
): AiActiveProvider {
  if (preference === 'off') return 'off';
  if (preference === 'openrouter-api') {
    return options.hasOpenRouterApiKey ? 'openrouter-api' : 'none';
  }
  if (preference === 'openai-account') {
    return options.hasOpenAiAccountAuth ? 'openai-account' : 'none';
  }
  if (preference === 'openai-api') {
    return 'none';
  }
  if (preference === 'codex-cli') {
    if (options.hasCodexChatGptAuth) return 'codex-cli';
    return options.hasOpenAiAccountAuth ? 'openai-account' : 'none';
  }
  if (options.hasOpenRouterApiKey) return 'openrouter-api';
  if (options.hasOpenAiAccountAuth) return 'openai-account';
  if (options.hasCodexChatGptAuth) return 'codex-cli';
  return 'none';
}
