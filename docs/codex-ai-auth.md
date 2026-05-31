# Codex AI Auth

StillasCalculator supports two server-side AI auth modes:

- `OPENAI_API_KEY`: the hosted/API-key path uses the OpenAI SDK and Platform billing.
- `STILLAS_AI_PROVIDER=codex-cli` (or `auto` without API key): the Codex SDK path requires the local `codex login` ChatGPT/OpenAI-account session **with mandatory MCP tools**. API-key or access-token Codex auth does not count for this path.

The browser never receives OpenAI, ChatGPT, or Codex tokens. The AI panel calls local server routes:

- `GET /api/ai/auth/status` checks whether Codex is logged in.
- `POST /api/ai/auth/sign-in` starts `codex login --device-auth` and returns the OpenAI sign-in URL plus one-time code for the app to display.
- `POST /api/ai/chat` runs the assistant through the OpenAI SDK or Codex SDK depending on configured auth.

## Mandatory tools (ScaffoldPlan)

Every calculation, drawing, CAD export, facade selection, scaffold update, and material list **must** go through deterministic app tools. The assistant cannot invent quantities.

- **OpenAI API path**: function tools via Responses API → `lib/ai/toolExecutor.ts`
- **Codex path**: MCP server `scripts/stillas-mcp-server.ts` → same tool executor

Workflow:

```
User → Codex/OpenAI assistant → tool call → ScaffoldPlan update → map/CAD/material UI
```

### MCP server (Codex)

On each chat request the server:

1. Writes the current `ScaffoldPlan` to a temp file (`STILLAS_PLAN_FILE`).
2. Verifies the Stillas MCP server can start and exposes every app tool.
3. Starts Codex with MCP config pointing at the project-local `tsx` runtime and `scripts/stillas-mcp-server.ts`.
4. Collects `mcp_tool_call` results from the streamed turn.
5. Merges the updated plan back into `scaffoldPlanController`.

Manual smoke test:

```bash
set STILLAS_PLAN_FILE=.stillas-test-plan.json
set STILLAS_SESSION_ID=test
npx tsx scripts/stillas-mcp-server.ts
```

### Environment

| Variable | Purpose |
|----------|---------|
| `STILLAS_AI_PROVIDER` | `auto`, `openai-api`, `codex-cli`, or `off` |
| `STILLAS_CODEX_TIMEOUT_MS` | Codex turn timeout (default 45000) |
| `STILLAS_CODEX_MODEL` | Model for Codex SDK turns |

For managed Business/Enterprise environments, admins can enforce ChatGPT login outside this app with Codex managed configuration.

StillasCalculator's Codex SDK path runs with `sandboxMode: "read-only"`, `approvalPolicy: "never"`, network disabled, and web search disabled. App tools run in the MCP server process with access to the session plan file only.
