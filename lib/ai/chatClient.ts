// Client-side AI Assistant adapter for the `/api/ai/chat` server route.
//
// This module is the browser-facing counterpart to `app/api/ai/chat/route.ts`.
// The server route owns the trust boundary: it is the only place server-side
// OpenAI/Codex authentication is used, the only place the Responses API or
// local Codex SDK fallback is called, and the place where SDK tool calls are
// dispatched to the deterministic engine and Structured Output is
// schema-validated (Req 12.6, 13.x). This adapter is what the chat UI
// (AiChatPanel, task 16.1) talks to. Its job is to:
//
//   - reject sending any chat message longer than 2000 characters, so a request
//     that violates the length bound never leaves the browser (Req 12.1);
//   - keep the conversation in chronological order as messages are appended,
//     so the user always sees messages and tool-driven updates in the order
//     they occurred (Req 12.4, 12.1);
//   - POST the chronological conversation to the server route (Req 12.2);
//   - normalize the (untrusted) route response/errors into a single trusted
//     outcome the UI can render: the assistant `reply`, the deterministic
//     `toolResults`, any schema-validated `structuredOutput`, the `unavailable`
//     signal when no server-side auth is configured, and an `error`/`timedOut`
//     signal when the request failed or timed out (Req 12.7, 12.8, 13.4).
//
// The length-bound check and the chronological-ordering helpers are exported as
// small PURE functions so they can be property-tested in isolation (Property 24
// chat messages are ordered and length-bounded). The network call is provided
// by a sender that accepts an injectable `fetch` so it is testable too.

import type { ChatMessage, ProjectState, ScaffoldPlan } from '@/lib/types';
import {
  AI_AUTH_SIGN_IN_ENDPOINT,
  AI_AUTH_STATUS_ENDPOINT,
  type AiAuthSignInResponse,
  type AiAuthStatusResponse,
} from '@/lib/ai/authStatus';
import type {
  AiChatRequest,
  AiChatResponse,
  AiToolResult,
} from '@/app/api/ai/chat/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The server route this adapter talks to (Req 12.2). */
export const CHAT_ENDPOINT = '/api/ai/chat';

/** The server route used to report whether an AI auth provider is connected. */
export { AI_AUTH_SIGN_IN_ENDPOINT, AI_AUTH_STATUS_ENDPOINT };

/**
 * Maximum length, in characters, of a single chat message the user can send
 * (Req 12.1). Messages at exactly this length are allowed; anything longer is
 * rejected before any request is issued.
 */
export const MAX_MESSAGE_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Pure: outgoing message length bound (Req 12.1, Property 24)
// ---------------------------------------------------------------------------

/**
 * Whether a message `content` is within the 2000-character send limit (Req
 * 12.1). Returns `true` for any string of length `<= MAX_MESSAGE_LENGTH` and
 * `false` for anything longer.
 *
 * Property 24: any message longer than 2000 characters is rejected.
 */
export function isMessageWithinLimit(content: string): boolean {
  return content.length <= MAX_MESSAGE_LENGTH;
}

// ---------------------------------------------------------------------------
// Pure: chronological ordering (Req 12.1, 12.4, Property 24)
// ---------------------------------------------------------------------------

/**
 * Returns a new array of messages ordered chronologically by `timestamp`
 * (ascending). The sort is stable, so messages sharing a timestamp keep their
 * existing relative order. The input array is not mutated.
 */
export function sortMessagesChronologically(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  // `Array.prototype.sort` is stable in modern engines (ES2019+), so ties keep
  // their input order. We index the entries to make stability explicit and
  // robust regardless of engine.
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      if (a.message.timestamp !== b.message.timestamp) {
        return a.message.timestamp - b.message.timestamp;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.message);
}

/**
 * Appends `message` to `messages`, returning a new array that preserves
 * chronological ordering by `timestamp` (Req 12.4). When the new message is at
 * or after the last message's timestamp it is simply placed at the end; when it
 * is older (an out-of-order arrival) the whole list is re-sorted so the result
 * is always chronologically ordered. The input array is not mutated.
 */
export function appendMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last === undefined || message.timestamp >= last.timestamp) {
    // Fast path: the common case where messages arrive in order.
    return [...messages, message];
  }
  // Out-of-order arrival: re-establish chronological order.
  return sortMessagesChronologically([...messages, message]);
}

// ---------------------------------------------------------------------------
// Normalized send outcome
// ---------------------------------------------------------------------------

/**
 * The normalized result of a chat send. The discriminated `status` lets the UI
 * react precisely:
 *
 *   - `ok`           the assistant replied; `reply`/`toolResults` are populated
 *                    and `structuredOutput` is present when one was produced;
 *   - `rejected`     the outgoing message exceeded 2000 characters, so no
 *                    request was issued and Project_State is unchanged (Req 12.1);
 *   - `unavailable`  no OpenAI API key or local Codex login is configured
 *                    server-side; show the "AI unavailable" state and keep all
 *                    non-AI features (Req 12.7);
 *   - `error`        the request failed or timed out; surface an error while
 *                    Project_State is preserved (Req 12.8). `timedOut` is `true`
 *                    specifically for the 30 s timeout.
 *
 * `reply` and `toolResults` are always present (empty for non-`ok` statuses) so
 * callers can render them without branching.
 */
export type ChatSendStatus = 'ok' | 'rejected' | 'unavailable' | 'error';

export interface ChatOutcome {
  status: ChatSendStatus;
  reply: string;
  toolResults: AiToolResult[];
  /** Schema-validated Material_List or report summary, when produced (Req 13.3). */
  structuredOutput?: unknown;
  /** Updated ScaffoldPlan from server after tool execution. */
  scaffoldPlan?: ScaffoldPlan;
  /** True when an `error` outcome was caused by the 30 s server timeout (Req 12.8). */
  timedOut?: boolean;
  /** Human-readable detail for `rejected`/`error` statuses. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Pure: response normalization (Req 12.7, 12.8, 13.4)
// ---------------------------------------------------------------------------

function isToolResult(value: unknown): value is AiToolResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.tool === 'string' && typeof record.ok === 'boolean';
}

/** Extracts the array of well-formed tool results from an untrusted payload. */
function normalizeToolResults(value: unknown): AiToolResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isToolResult);
}

/**
 * Normalizes an untrusted route response body into a {@link ChatOutcome}. This
 * is the pure core of response/error handling, separated from the network call
 * so it can be unit-tested directly.
 *
 * - An `unavailable` flag becomes `unavailable` (Req 12.7).
 * - A `timedOut` flag, an `error` field, a non-success HTTP status, or an
 *   unparseable body becomes `error`; `timedOut` is propagated (Req 12.8).
 * - Otherwise the assistant `reply`, deterministic `toolResults`, and any
 *   `structuredOutput` are surfaced as `ok` (Req 13.1, 13.3).
 *
 * `httpOk`/`httpStatus` describe the transport result; `payload` is the parsed
 * JSON body (or `null`/`undefined` when parsing failed).
 */
export function normalizeChatResponse(
  httpOk: boolean,
  httpStatus: number,
  payload: unknown,
): ChatOutcome {
  const body =
    typeof payload === 'object' && payload !== null
      ? (payload as AiChatResponse & Record<string, unknown>)
      : null;

  // No server-side auth configured: AI unavailable, non-AI features unaffected
  // (Req 12.7). The route returns HTTP 200 with `{ unavailable: true }`.
  if (body?.unavailable === true) {
    return { status: 'unavailable', reply: '', toolResults: [] };
  }

  // Explicit failure/timeout signal from the route (Req 12.8), or any transport
  // error / unparseable body. State is preserved server-side either way.
  const timedOut = body?.timedOut === true;
  if (!httpOk || body === null || typeof body.error === 'string') {
    return {
      status: 'error',
      reply: '',
      toolResults: [],
      ...(timedOut ? { timedOut: true } : {}),
      message:
        typeof body?.error === 'string'
          ? body.error
          : `The AI request failed (status ${httpStatus}).`,
    };
  }

  // Success: present the assistant reply and the deterministic tool results
  // verbatim (Req 13.1, 13.6), plus any schema-validated structured output.
  return {
    status: 'ok',
    reply: typeof body.reply === 'string' ? body.reply : '',
    toolResults: normalizeToolResults(body.toolResults),
    ...(body.structuredOutput !== undefined
      ? { structuredOutput: body.structuredOutput }
      : {}),
    ...(typeof body.scaffoldPlan === 'object' && body.scaffoldPlan !== null
      ? { scaffoldPlan: body.scaffoldPlan as ScaffoldPlan }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Async sender
// ---------------------------------------------------------------------------

/**
 * Loose `fetch` shape so tests can inject a fake without DOM types. The real
 * `globalThis.fetch` is structurally compatible.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchLike = (input, init) =>
  (globalThis.fetch as unknown as FetchLike)(input, init);

/**
 * Sends the chronological conversation in `request` to the chat route and
 * returns a normalized outcome (Req 12.2).
 *
 * Before any network I/O, every message is checked against the 2000-character
 * bound; if any message is too long the send is rejected locally with a
 * `rejected` outcome and no request is issued, so an over-length message never
 * leaves the browser and Project_State is unchanged (Req 12.1). The messages
 * are also re-ordered chronologically before being sent so the server receives
 * them in order (Req 12.4).
 *
 * Never throws: transport/parse failures are surfaced as an `error` outcome so
 * the caller can preserve Project_State (Req 12.8).
 */
export async function sendChatRequest(
  request: AiChatRequest,
  fetchImpl: FetchLike = defaultFetch,
  signal?: AbortSignal,
): Promise<ChatOutcome> {
  const overLength = request.messages.find(
    (message) => !isMessageWithinLimit(message.content),
  );
  if (overLength) {
    return {
      status: 'rejected',
      reply: '',
      toolResults: [],
      message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    };
  }

  const orderedRequest: AiChatRequest = {
    ...request,
    messages: sortMessagesChronologically(request.messages),
  };

  try {
    const response = await fetchImpl(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderedRequest),
      signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return normalizeChatResponse(response.ok, response.status, payload);
  } catch {
    return {
      status: 'error',
      reply: '',
      toolResults: [],
      message: 'The AI request could not be completed. Your project data is unchanged.',
    };
  }
}

export async function fetchAiAuthStatus(
  fetchImpl: FetchLike = defaultFetch,
  signal?: AbortSignal,
): Promise<AiAuthStatusResponse | null> {
  try {
    const response = await fetchImpl(AI_AUTH_STATUS_ENDPOINT, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    return payload as AiAuthStatusResponse;
  } catch {
    return null;
  }
}

export async function startAiChatGptSignIn(
  fetchImpl: FetchLike = defaultFetch,
  signal?: AbortSignal,
): Promise<AiAuthSignInResponse> {
  try {
    const response = await fetchImpl(AI_AUTH_SIGN_IN_ENDPOINT, {
      method: 'POST',
      signal,
    });
    const payload = await response.json();
    if (typeof payload === 'object' && payload !== null) {
      return payload as AiAuthSignInResponse;
    }
    return {
      ok: false,
      message: 'Could not start ChatGPT sign-in through Codex.',
      error: `Unexpected response from AI auth route (status ${response.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Could not start ChatGPT sign-in through Codex.',
      error: error instanceof Error ? error.message : 'Unknown sign-in error.',
    };
  }
}

/**
 * Convenience builder for an {@link AiChatRequest} from the current
 * conversation and Project_State snapshot. The messages are ordered
 * chronologically (Req 12.4); the snapshot is accepted for completeness, while
 * the authoritative state lives in the single `projectStateController` server
 * side (Req 17.1).
 */
export function buildChatRequest(
  messages: readonly ChatMessage[],
  projectState: ProjectState | ScaffoldPlan,
  sessionId?: string,
): AiChatRequest {
  return {
    messages: sortMessagesChronologically(messages),
    projectState: projectState as ScaffoldPlan,
    ...(sessionId ? { sessionId } : {}),
  };
}
