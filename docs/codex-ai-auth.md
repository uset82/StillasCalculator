# AI Auth

StillasCalculator's hosted assistant now uses OpenRouter server-side, so public visitors can try the app without a ChatGPT/OpenAI sign-in flow.

- `STILLAS_AI_PROVIDER=openrouter-api` plus `OPENROUTER_API_KEY`: public deployment mode. Netlify calls OpenRouter from the server route, using `OPENROUTER_MODEL=poolside/laguna-xs.2:free` by default for low-volume demos.
- `STILLAS_AI_PROVIDER=openai-account`: legacy account mode. Netlify proxies each browser session to a persistent Codex backend, and that backend owns ChatGPT device-code auth through `codex app-server`.
- `STILLAS_AI_PROVIDER=codex-cli`: local development mode. The local Codex CLI must be signed in with a ChatGPT/OpenAI account and MCP tools must be available.
- `STILLAS_AI_PROVIDER=off`: disable the assistant.

The browser never receives OpenRouter, OpenAI, ChatGPT, Codex, or refresh tokens. OpenRouter keys stay in Netlify/server environment variables.

Legacy account mode still cannot bypass ChatGPT's device-code security setting: personal users must enable device code login in ChatGPT Security Settings, and workspace users may need an admin to allow it.

## Public Routes

- `GET /api/ai/auth/status` checks the selected provider. In OpenRouter mode it reports whether `OPENROUTER_API_KEY` is configured. In account mode it reads the signed backend-session cookie and asks the Codex backend for auth state.
- `POST /api/ai/auth/sign-in` starts `account/login/start` with `type: "chatgptDeviceCode"` on the Codex backend and returns `{ verificationUri, userCode, expiresAt }`.
- `POST /api/ai/chat` calls OpenRouter through `@openrouter/agent` in hosted mode, proxies authenticated account-mode requests to the Codex backend, and keeps local CLI mode inside the Netlify function.

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
| `STILLAS_AI_PROVIDER` | `openrouter-api`, `auto`, `openai-account`, `codex-cli`, or `off` |
| `OPENROUTER_API_KEY` | Server-only OpenRouter key. Set in Netlify UI/CLI, not source control. |
| `OPENROUTER_MODEL` | OpenRouter model id. Defaults to `poolside/laguna-xs.2:free`. |
| `OPENROUTER_SITE_URL` | Optional OpenRouter referer/leaderboard URL. |
| `OPENROUTER_APP_TITLE` | Optional OpenRouter app title. Defaults to `StillasCalculator`. |
| `STILLAS_CODEX_BACKEND_URL` | Netlify-to-backend URL, for example `https://codex-backend.example.com` |
| `STILLAS_CODEX_BACKEND_SECRET` | Shared bearer secret for Netlify-to-backend requests. Set in Netlify UI/CLI, not in source control. |
| `STILLAS_AI_AUTH_COOKIE_SECRET` | Optional cookie-signing secret. If omitted, the backend secret signs auth cookies. Keep this stable across deploys/restarts. |
| `STILLAS_CODEX_DATA_DIR` | Backend-only persistent session root for per-user `CODEX_HOME` directories |
| `STILLAS_CODEX_SESSION_TTL_SECONDS` | Backend session lifetime, default `86400` |
| `STILLAS_CODEX_TIMEOUT_MS` | Codex turn timeout, default `45000` |
| `STILLAS_CODEX_MODEL` | Codex SDK model override |

## Mandatory Tools

Every calculation, drawing, CAD export, facade selection, scaffold update, and material list must go through deterministic app tools. The assistant cannot invent quantities.

- OpenRouter API path: `@openrouter/agent` tools -> `lib/ai/toolExecutor.ts`
- Codex account/local path: Stillas MCP server -> same tool executor

Workflow:

```text
User -> OpenRouter/Codex assistant -> app tool call -> ScaffoldPlan update -> map/CAD/material UI
```

Manual MCP smoke test:

```bash
set STILLAS_PLAN_FILE=.stillas-test-plan.json
set STILLAS_SESSION_ID=test
npx tsx scripts/stillas-mcp-server.ts
```
