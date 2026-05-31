const DEFAULT_OPENAI_AUTH_BASE_URL = 'https://auth.openai.com';
const DEFAULT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_AUTH_EXPIRES_MS = 15 * 60_000;
const DEFAULT_DEVICE_AUTH_POLL_INTERVAL_SECONDS = 5;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60_000;

export interface OpenAiAccountDeviceAuth {
  verificationUri: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
  expiresAt: number;
}

export interface OpenAiAccountTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
  email: string | null;
  planType: string | null;
  accessTokenExpiresAt: number | null;
  idTokenExpiresAt: number | null;
}

export type OpenAiDeviceAuthStartResult =
  | {
      ok: true;
      message: string;
      deviceAuth: OpenAiAccountDeviceAuth;
    }
  | {
      ok: false;
      message: string;
      error: string;
    };

export type OpenAiDeviceAuthPollResult =
  | { status: 'pending' }
  | { status: 'completed'; tokens: OpenAiAccountTokens }
  | { status: 'expired'; message: string; error: string }
  | { status: 'failed'; message: string; error: string };

export type OpenAiAccountTokenRefreshResult =
  | { ok: true; tokens: OpenAiAccountTokens }
  | { ok: false; permanent: boolean; error: string };

interface UserCodeResponse {
  device_auth_id?: unknown;
  user_code?: unknown;
  usercode?: unknown;
  interval?: unknown;
}

interface DeviceTokenResponse {
  authorization_code?: unknown;
  code_challenge?: unknown;
  code_verifier?: unknown;
}

interface OAuthTokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}

interface JwtAuthClaims {
  chatgpt_account_id?: unknown;
  chatgpt_plan_type?: unknown;
  chatgpt_user_id?: unknown;
  user_id?: unknown;
  chatgpt_account_is_fedramp?: unknown;
}

interface JwtProfileClaims {
  email?: unknown;
}

interface JwtClaims {
  exp?: unknown;
  email?: unknown;
  'https://api.openai.com/profile'?: JwtProfileClaims;
  'https://api.openai.com/auth'?: JwtAuthClaims;
}

function authBaseUrl(): string {
  return (
    process.env.OPENAI_AUTH_BASE_URL?.trim() || DEFAULT_OPENAI_AUTH_BASE_URL
  ).replace(/\/+$/, '');
}

function codexClientId(): string {
  return process.env.OPENAI_CODEX_CLIENT_ID?.trim() || DEFAULT_CODEX_CLIENT_ID;
}

function parseIntervalSeconds(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DEVICE_AUTH_POLL_INTERVAL_SECONDS;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFromPayload(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const record = payload as Record<string, unknown>;
  for (const key of ['error_description', 'error_message', 'message', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function decodeJwtPayload(jwt: string): JwtClaims | null {
  const [, payload] = jwt.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
}

function jwtExpiresAt(jwt: string): number | null {
  const exp = decodeJwtPayload(jwt)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function tokensFromOAuthResponse(payload: unknown): OpenAiAccountTokens | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const response = payload as OAuthTokenResponse;
  const idToken = stringOrNull(response.id_token);
  const accessToken = stringOrNull(response.access_token);
  const refreshToken = stringOrNull(response.refresh_token);
  if (!idToken || !accessToken || !refreshToken) return null;

  const claims = decodeJwtPayload(idToken);
  const authClaims = claims?.['https://api.openai.com/auth'];
  const profileClaims = claims?.['https://api.openai.com/profile'];
  const email = stringOrNull(claims?.email) ?? stringOrNull(profileClaims?.email);
  const accountId =
    stringOrNull(authClaims?.chatgpt_account_id) ??
    stringOrNull(authClaims?.chatgpt_user_id) ??
    stringOrNull(authClaims?.user_id);

  return {
    idToken,
    accessToken,
    refreshToken,
    accountId,
    email,
    planType: stringOrNull(authClaims?.chatgpt_plan_type),
    accessTokenExpiresAt: jwtExpiresAt(accessToken),
    idTokenExpiresAt: jwtExpiresAt(idToken),
  };
}

function tokensFromRefreshResponse(
  payload: unknown,
  currentTokens: OpenAiAccountTokens,
): OpenAiAccountTokens | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const response = payload as OAuthTokenResponse;
  return tokensFromOAuthResponse({
    id_token: stringOrNull(response.id_token) ?? currentTokens.idToken,
    access_token: stringOrNull(response.access_token) ?? currentTokens.accessToken,
    refresh_token:
      stringOrNull(response.refresh_token) ?? currentTokens.refreshToken,
  });
}

export function shouldRefreshOpenAiAccountTokens(
  tokens: OpenAiAccountTokens,
  now = Date.now(),
): boolean {
  return (
    tokens.accessTokenExpiresAt !== null &&
    tokens.accessTokenExpiresAt <= now + ACCESS_TOKEN_REFRESH_WINDOW_MS
  );
}

export async function startOpenAiAccountDeviceAuth(
  now = Date.now(),
): Promise<OpenAiDeviceAuthStartResult> {
  const baseUrl = authBaseUrl();
  const response = await fetch(`${baseUrl}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: codexClientId() }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      message: 'Could not start OpenAI account sign-in.',
      error: errorFromPayload(
        payload,
        `OpenAI device sign-in failed with status ${response.status}.`,
      ),
    };
  }

  const body = payload as UserCodeResponse;
  const deviceAuthId = stringOrNull(body.device_auth_id);
  const userCode = stringOrNull(body.user_code) ?? stringOrNull(body.usercode);
  if (!deviceAuthId || !userCode) {
    return {
      ok: false,
      message: 'Could not start OpenAI account sign-in.',
      error: 'OpenAI did not return a device code.',
    };
  }

  return {
    ok: true,
    message: 'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
    deviceAuth: {
      verificationUri: `${baseUrl}/codex/device`,
      userCode,
      deviceAuthId,
      intervalSeconds: parseIntervalSeconds(body.interval),
      expiresAt: now + DEVICE_AUTH_EXPIRES_MS,
    },
  };
}

async function exchangeAuthorizationCodeForTokens(
  codeResponse: DeviceTokenResponse,
): Promise<OpenAiDeviceAuthPollResult> {
  const authorizationCode = stringOrNull(codeResponse.authorization_code);
  const codeVerifier = stringOrNull(codeResponse.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    return {
      status: 'failed',
      message: 'OpenAI sign-in could not be completed.',
      error: 'OpenAI did not return the expected authorization code.',
    };
  }

  const baseUrl = authBaseUrl();
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: `${baseUrl}/deviceauth/callback`,
    client_id: codexClientId(),
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      status: 'failed',
      message: 'OpenAI sign-in could not be completed.',
      error: errorFromPayload(
        payload,
        `OpenAI token exchange failed with status ${response.status}.`,
      ),
    };
  }

  const tokens = tokensFromOAuthResponse(payload);
  if (!tokens) {
    return {
      status: 'failed',
      message: 'OpenAI sign-in could not be completed.',
      error: 'OpenAI did not return usable account tokens.',
    };
  }

  return { status: 'completed', tokens };
}

export async function pollOpenAiAccountDeviceAuth(
  deviceAuth: OpenAiAccountDeviceAuth,
  now = Date.now(),
): Promise<OpenAiDeviceAuthPollResult> {
  if (deviceAuth.expiresAt <= now) {
    return {
      status: 'expired',
      message: 'The OpenAI sign-in code expired. Start sign-in again.',
      error: 'OpenAI device code expired.',
    };
  }

  const baseUrl = authBaseUrl();
  const response = await fetch(`${baseUrl}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_auth_id: deviceAuth.deviceAuthId,
      user_code: deviceAuth.userCode,
    }),
  });

  if (response.status === 403 || response.status === 404) {
    return { status: 'pending' };
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      status: 'failed',
      message: 'OpenAI sign-in could not be completed.',
      error: errorFromPayload(
        payload,
        `OpenAI device sign-in polling failed with status ${response.status}.`,
      ),
    };
  }

  return exchangeAuthorizationCodeForTokens(payload as DeviceTokenResponse);
}

export async function refreshOpenAiAccountTokens(
  tokens: OpenAiAccountTokens,
): Promise<OpenAiAccountTokenRefreshResult> {
  const response = await fetch(`${authBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: codexClientId(),
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      permanent: response.status === 401,
      error: errorFromPayload(
        payload,
        `OpenAI token refresh failed with status ${response.status}.`,
      ),
    };
  }

  const refreshed = tokensFromRefreshResponse(payload, tokens);
  if (!refreshed) {
    return {
      ok: false,
      permanent: false,
      error: 'OpenAI token refresh did not return usable account tokens.',
    };
  }

  return { ok: true, tokens: refreshed };
}
