import type {
  AiActiveProvider,
  AiProviderPreference,
} from '@/lib/server/aiAuth';
import type { CodexCliLoginMethod } from '@/lib/ai/codexSdkAdapter';

export const AI_AUTH_STATUS_ENDPOINT = '/api/ai/auth/status';
export const AI_AUTH_SIGN_IN_ENDPOINT = '/api/ai/auth/sign-in';

export interface AiAuthStatusResponse {
  providerPreference: AiProviderPreference;
  activeProvider: AiActiveProvider;
  canUseAssistant: boolean;
  openAiApiKeyConfigured: boolean;
  codexCli: {
    loggedIn: boolean;
    method: CodexCliLoginMethod | null;
  };
  openAiAccountSession: {
    authenticated: boolean;
    pending: boolean;
    expiresAt: number | null;
    error?: string;
    deviceCodeRequired?: boolean;
  };
  mcp: {
    connected: boolean;
    persistent: boolean;
    toolCount: number;
    missingTools: string[];
    checkedAt: number | null;
    error?: string;
  };
  setup: {
    chatGptSignInCommand: 'codex login';
    providerEnvValue: 'openai-codex';
    deviceCodeSettingsUrl?: string;
  };
}

export interface AiAuthSignInResponse {
  ok: boolean;
  alreadyConnected?: boolean;
  message: string;
  error?: string;
  deviceAuth?: {
    verificationUri: string;
    userCode: string;
    expiresAt: number;
  };
}
