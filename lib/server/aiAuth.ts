export type AiProviderPreference = 'auto' | 'openai-api' | 'codex-cli' | 'off';

export type AiActiveProvider = 'openai-api' | 'codex-cli' | 'none' | 'off';

type EnvLike = Record<string, string | undefined>;

export function getAiProviderPreference(
  env: EnvLike = process.env,
): AiProviderPreference {
  const raw = (env.STILLAS_AI_PROVIDER ?? env.AI_PROVIDER ?? 'auto')
    .trim()
    .toLowerCase();

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

export function resolveActiveAiProvider(
  preference: AiProviderPreference,
  options: { hasOpenAiApiKey: boolean; hasCodexChatGptAuth: boolean },
): AiActiveProvider {
  if (preference === 'off') return 'off';
  if (preference === 'openai-api') {
    return options.hasOpenAiApiKey ? 'openai-api' : 'none';
  }
  if (preference === 'codex-cli') {
    return options.hasCodexChatGptAuth ? 'codex-cli' : 'none';
  }
  if (options.hasCodexChatGptAuth) return 'codex-cli';
  if (options.hasOpenAiApiKey) return 'openai-api';
  return 'none';
}
