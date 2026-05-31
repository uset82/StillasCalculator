# Codex AI Auth

StillasCalculator supports three server-side AI auth modes:

- `STILLAS_AI_PROVIDER=openai-account`: public deployment mode. Netlify proxies each browser session to a persistent Codex backend, and that backend owns ChatGPT device-code auth through `codex app-server`.
- `STILLAS_AI_PROVIDER=openai-api` plus `OPENAI_API_KEY`: app-owner Platform API billing through the OpenAI SDK.
- `STILLAS_AI_PROVIDER=codex-cli`: local development mode. The local Codex CLI must be signed in with a ChatGPT/OpenAI account and MCP tools must be available.

Public browser users sign in with their personal ChatGPT account. The app cannot bypass ChatGPT's device-code security setting: personal users must enable device code login in ChatGPT Security Settings, and workspace users may need an admin to allow it.

The browser never receives OpenAI, ChatGPT, Codex, or refresh tokens. It only receives the verification URL and one-time user code returned by Codex app-server.

## Public Routes

- `GET /api/ai/auth/status` checks the selected provider. In account mode it reads the signed backend-session cookie and asks the Codex backend for auth state.
- `POST /api/ai/auth/sign-in` starts `account/login/start` with `type: "chatgptDeviceCode"` on the Codex backend and returns `{ verificationUri, userCode, expiresAt }`.
- `POST /api/ai/chat` proxies authenticated account-mode requests to the Codex backend. API-key and local CLI modes remain local to the Netlify function.

## Codex Backend

Run the backend as an always-on Node process:

```bash
npm run codex-backend
```

The backend:

1. Creates one persistent `CODEX_HOME` directory per signed browser session.
2. Starts `codex app-server --listen stdio://` for that session when auth state is needed.
3. Uses documented JSON-RPC methods: `account/read` and `account/login/start`.
4. Runs the existing Codex SDK + Stillas MCP tool flow with the same session `CODEX_HOME`.
5. Stores ChatGPT/Codex tokens only in that backend session directory.

## Environment

| Variable | Purpose |
|----------|---------|
| `STILLAS_AI_PROVIDER` | `openai-account`, `auto`, `openai-api`, `codex-cli`, or `off` |
| `STILLAS_CODEX_BACKEND_URL` | Netlify-to-backend URL, for example `https://codex-backend.example.com` |
| `STILLAS_CODEX_BACKEND_SECRET` | Shared bearer secret for Netlify-to-backend requests. Set in Netlify UI/CLI, not in source control. |
| `STILLAS_AI_AUTH_COOKIE_SECRET` | Optional cookie-signing secret. If omitted, the backend secret signs auth cookies. Keep this stable across deploys/restarts. |
| `STILLAS_CODEX_DATA_DIR` | Backend-only persistent session root for per-user `CODEX_HOME` directories |
| `STILLAS_CODEX_SESSION_TTL_SECONDS` | Backend session lifetime, default `86400` |
| `OPENAI_API_KEY` | Optional server-only Platform key for `openai-api`. Do not use for account-required public mode. |
| `STILLAS_CODEX_TIMEOUT_MS` | Codex turn timeout, default `45000` |
| `STILLAS_CODEX_MODEL` | Codex SDK model override |

## Mandatory Tools

Every calculation, drawing, CAD export, facade selection, scaffold update, and material list must go through deterministic app tools. The assistant cannot invent quantities.

- OpenAI API path: function tools via Responses API -> `lib/ai/toolExecutor.ts`
- Codex account/local path: Stillas MCP server -> same tool executor

Workflow:

```text
User -> Codex/OpenAI assistant -> app tool call -> ScaffoldPlan update -> map/CAD/material UI
```

Manual MCP smoke test:

```bash
set STILLAS_PLAN_FILE=.stillas-test-plan.json
set STILLAS_SESSION_ID=test
npx tsx scripts/stillas-mcp-server.ts
```
