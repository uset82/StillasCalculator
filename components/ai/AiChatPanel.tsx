"use client";

import type { ChatMessage } from "@/lib/types";
import type { AiToolResult } from "@/app/api/ai/chat/route";
import type { AiAuthStatusResponse } from "@/lib/ai/authStatus";
import { AiMessageList } from "./AiMessageList";
import { AiInputBox } from "./AiInputBox";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function getAuthStatusLabel(status: AiAuthStatusResponse | null | undefined): string {
  if (!status) return "Checking AI connection";
  if (status.openAiAccountSession.pending) return "Waiting for OpenAI sign-in";
  if (status.activeProvider === "openai-account") {
    return "OpenAI account + app tools connected";
  }
  if (
    status.activeProvider === "openai-api" &&
    status.openAiAccountSession.authenticated
  ) {
    return "OpenAI account + app tools connected";
  }
  if (status.activeProvider === "openai-api") return "OpenAI API + app tools connected";
  if (
    status.codexCli.loggedIn &&
    status.codexCli.method === "chatgpt" &&
    !status.openAiAccountSession.authenticated
  ) {
    return "Sign in with OpenAI to use Codex";
  }
  if (status.codexCli.loggedIn && status.codexCli.method !== "chatgpt") {
    return "OpenAI account sign-in required";
  }
  if (status.codexCli.method === "chatgpt" && !status.mcp.connected) {
    return "MCP tools disconnected";
  }
  if (status.activeProvider === "codex-cli") {
    return status.codexCli.method === "chatgpt"
      ? "OpenAI account + MCP tools connected"
      : "Codex CLI connected";
  }
  if (status.activeProvider === "off") return "AI disabled";
  return "AI not connected";
}

function getAuthDotClass(status: AiAuthStatusResponse | null | undefined): string {
  if (!status) return "bg-gray-300";
  if (status.canUseAssistant) return "bg-emerald-500";
  if (status.activeProvider === "off") return "bg-gray-400";
  return "bg-amber-500";
}

function canStartChatGptSignIn(
  status: AiAuthStatusResponse | null | undefined,
): boolean {
  if (!status) return true;
  if (
    status.providerPreference === "off" ||
    status.activeProvider === "off" ||
    status.openAiAccountSession.authenticated ||
    status.openAiAccountSession.pending
  ) {
    return false;
  }
  if (
    status.activeProvider === "openai-api" ||
    status.activeProvider === "none" ||
    !status.canUseAssistant
  ) {
    return true;
  }
  return false;
}

export interface AiChatPanelProps {
  /**
   * The full conversation, rendered chronologically (Req 12.1). Typically
   * sourced from `Project_State.aiMessages` when wired in a later task.
   */
  messages: readonly ChatMessage[];
  /**
   * The deterministic tool-call results from the latest assistant turn,
   * rendered as calculation cards so engine-computed quantities are visible
   * (Req 13.1).
   */
  toolResults?: readonly AiToolResult[];
  /**
   * Invoked when the user sends a message. Wired by the container to the chat
   * client (`sendChatRequest`) and `Project_State`. Only invoked with content
   * within the 2000-character bound (Req 12.1).
   */
  onSendMessage: (content: string) => void;
  /**
   * Whether an AI request is in flight. Drives the progress indicator and
   * disables sending additional messages until the request settles (Req 12.3).
   */
  pending?: boolean;
  /**
   * Whether the assistant is unavailable because neither server-side OpenAI API
   * auth nor local Codex auth is configured (Req 12.7). When true, the
   * panel shows an "AI unavailable" notice and disables the composer while
   * every non-AI feature keeps working.
   */
  unavailable?: boolean;
  /** Server-reported OpenAI/Codex auth status for the assistant. */
  authStatus?: AiAuthStatusResponse | null;
  /** True while the UI is checking the server-side AI connection status. */
  authStatusPending?: boolean;
  /** Invoked when the user wants to re-check the server-side AI connection. */
  onRefreshAuthStatus?: () => void;
  /** True while the app is launching Codex's ChatGPT sign-in flow. */
  authActionPending?: boolean;
  /** Status message from the last sign-in action. */
  authActionMessage?: string | null;
  /** OpenAI account device-auth details returned by Codex sign-in. */
  authActionDeviceAuth?: {
    verificationUri: string;
    userCode: string;
    expiresAt: number;
  } | null;
  /** Invoked to start the local Codex ChatGPT sign-in flow. */
  onStartChatGptSignIn?: () => void;
  /**
   * An optional error message to surface (e.g. a failed or timed-out request,
   * Req 12.8). Shown without disabling the composer so the user can retry.
   */
  errorMessage?: string | null;
  /** Decimal places used when formatting quantities in tool-result cards. */
  decimalPlaces?: number;
  /** Extra classes for the outer container. */
  className?: string;
}

/**
 * `AiChatPanel` — the AI Assistant chat surface (Req 12). It composes the
 * chronological {@link AiMessageList} (Req 12.1), the engine-backed tool-result
 * cards (Req 13.1), and the {@link AiInputBox} composer bounded to 2000
 * characters (Req 12.1).
 *
 * The panel reflects request state: while a request is in flight it shows a
 * progress indicator and disables sending additional messages (Req 12.3). When
 * the assistant is unavailable because no server auth is configured, it shows
 * an "AI unavailable" notice and disables the composer, leaving every non-AI
 * feature unaffected (Req 12.7). A transient error (failure or timeout) is
 * surfaced without disabling the composer so the user can retry (Req 12.8).
 *
 * The component is presentational and fully controlled via props/callbacks, so
 * a container can wire it to `Project_State` and the chat client in a later
 * task.
 */
export function AiChatPanel({
  messages,
  toolResults = [],
  onSendMessage,
  pending = false,
  unavailable = false,
  authStatus = null,
  authStatusPending = false,
  onRefreshAuthStatus,
  authActionPending = false,
  authActionMessage = null,
  authActionDeviceAuth = null,
  onStartChatGptSignIn,
  errorMessage = null,
  decimalPlaces = 2,
  className,
}: AiChatPanelProps) {
  const showChatGptSignIn =
    onStartChatGptSignIn !== undefined && canStartChatGptSignIn(authStatus);

  return (
    <section
      data-testid="ai-chat-panel"
      aria-label="AI assistant"
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-800">AI assistant</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            role="status"
            data-testid="ai-auth-status"
            className="flex min-h-[32px] items-center gap-2 rounded-md border border-gray-200 px-2 text-xs text-gray-600"
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 rounded-full", getAuthDotClass(authStatus))}
            />
            {authStatusPending ? "Checking..." : getAuthStatusLabel(authStatus)}
          </span>
          {onRefreshAuthStatus ? (
            <button
              type="button"
              data-testid="ai-auth-refresh-button"
              onClick={onRefreshAuthStatus}
              disabled={authStatusPending}
              className={cn(
                "min-h-[32px] rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700",
                "hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400",
                "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400",
              )}
            >
              Check
            </button>
          ) : null}
          {showChatGptSignIn ? (
            <button
              type="button"
              data-testid="ai-auth-sign-in-button"
              onClick={onStartChatGptSignIn}
              disabled={authActionPending}
              className={cn(
                "min-h-[32px] rounded-md bg-gray-900 px-2 text-xs font-medium text-white",
                "hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400",
                "disabled:cursor-not-allowed disabled:bg-gray-300",
              )}
            >
              {authActionPending ? "Opening..." : "Sign in with OpenAI"}
            </button>
          ) : null}
          {/* In-flight progress indicator (Req 12.3). */}
          {pending ? (
            <span
              role="status"
              data-testid="ai-progress-indicator"
              className="flex items-center gap-2 text-xs text-gray-500"
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500"
              />
              Working...
            </span>
          ) : null}
        </div>
      </header>

      {/* AI unavailable notice (Req 12.7). Non-AI features are unaffected; the
          panel simply explains the assistant cannot be used right now. */}
      {unavailable ? (
        <p
          role="status"
          data-testid="ai-unavailable-message"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {authStatus?.openAiAccountSession.pending ? (
            <>
              Finish the OpenAI sign-in in your browser. After you enter the
              one-time code, the assistant will use your OpenAI account and app
              tools automatically.
            </>
          ) : authStatus?.codexCli.method === "chatgpt" &&
            !authStatus.openAiAccountSession.authenticated ? (
            <>
              Sign in with your OpenAI/ChatGPT account in this app before using
              the assistant.
            </>
          ) : authStatus?.codexCli.method === "chatgpt" && !authStatus.mcp.connected ? (
            <>
              Codex is signed in, but the Stillas MCP tool bridge is not connected.
              Check again to restart the bridge. All other features remain available.
            </>
          ) : (
            <>
              The AI assistant is not connected. Sign in with your OpenAI/ChatGPT
              account, then check the connection again.
            </>
          )}
        </p>
      ) : null}

      {authActionMessage ? (
        <p
          role="status"
          data-testid="ai-auth-action-message"
          className="rounded-md border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700"
        >
          {authActionMessage}
        </p>
      ) : null}

      {authActionDeviceAuth ? (
        <div
          role="status"
          data-testid="ai-auth-device-code"
          className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"
        >
          <div className="font-medium">OpenAI account sign-in</div>
          <a
            href={authActionDeviceAuth.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-blue-700 underline"
          >
            {authActionDeviceAuth.verificationUri}
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>Code</span>
            <code className="rounded border border-blue-200 bg-white px-2 py-1 font-mono text-base">
              {authActionDeviceAuth.userCode}
            </code>
          </div>
        </div>
      ) : null}

      <AiMessageList
        messages={messages}
        toolResults={toolResults}
        decimalPlaces={decimalPlaces}
        className="min-h-0 flex-1"
      />

      {/* Transient request error (failure/timeout), composer stays usable so the
          user can retry (Req 12.8). */}
      {errorMessage ? (
        <p
          role="alert"
          data-testid="ai-error-message"
          className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <AiInputBox
        onSend={onSendMessage}
        pending={pending}
        disabled={unavailable}
      />
    </section>
  );
}

export default AiChatPanel;
