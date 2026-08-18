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
  if (status.openAiAccountSession.error) return "Codex backend needs attention";
  if (status.activeProvider === "openai-account") {
    return "ChatGPT account + app tools connected";
  }
  if (status.activeProvider === "openrouter-api") {
    return "OpenRouter free model + app tools connected";
  }
  if (status.activeProvider === "openai-api") return "OpenAI API + app tools connected";
  if (status.openAiAccountSession.pending) return "Waiting for OpenAI sign-in";
  if (status.providerPreference === "openai-account") {
    return "ChatGPT sign-in required";
  }
  if (
    status.codexCli.loggedIn &&
    status.codexCli.method === "chatgpt" &&
    !status.openAiAccountSession.authenticated
  ) {
    return "Sign in with ChatGPT to use Codex";
  }
  if (status.codexCli.loggedIn && status.codexCli.method !== "chatgpt") {
    return "ChatGPT sign-in required";
  }
  if (status.codexCli.method === "chatgpt" && !status.mcp.connected) {
    return "MCP tools disconnected";
  }
  if (status.activeProvider === "codex-cli") {
    return status.codexCli.method === "chatgpt"
      ? "ChatGPT account + MCP tools connected"
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
  if (!status) return false;
  const supportsAccountSignIn =
    status.providerPreference === "openai-account" ||
    status.providerPreference === "codex-cli" ||
    status.providerPreference === "auto";
  if (
    !supportsAccountSignIn ||
    status.activeProvider === "off" ||
    status.activeProvider === "openrouter-api" ||
    status.activeProvider === "openai-api" ||
    status.openAiAccountSession.authenticated ||
    status.openAiAccountSession.pending
  ) {
    return false;
  }
  if (
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
 * Whether the assistant is unavailable because server-side OpenRouter API auth
 * or an optional local Codex auth path is not configured (Req 12.7). When true, the
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
  const hasActiveDeviceAuth =
    authActionDeviceAuth !== null &&
    authActionDeviceAuth.expiresAt > Date.now() &&
    !authStatus?.openAiAccountSession.authenticated;
  const showChatGptSignIn =
    onStartChatGptSignIn !== undefined &&
    !hasActiveDeviceAuth &&
    canStartChatGptSignIn(authStatus);
  const authStatusLabel = hasActiveDeviceAuth
    ? "Waiting for OpenAI sign-in"
    : getAuthStatusLabel(authStatus);

  const promptSuggestions = [
    "Estimate facade at 6m height with Layher system",
    "Add double guardrails, toeboards and ladder bays",
    "Check anchoring requirements for heavy wind load",
  ];

  return (
    <section
      data-testid="ai-chat-panel"
      aria-label="AI assistant"
      className={cn(
        "flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 shadow-xs",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs text-white">
            🤖
          </span>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
              Scaffolding AI Copilot
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span
            role="status"
            data-testid="ai-auth-status"
            className="flex min-h-[30px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-mono text-slate-600 shadow-xs"
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 rounded-full", getAuthDotClass(authStatus))}
            />
            {authStatusPending ? "Checking..." : authStatusLabel}
          </span>
          {onRefreshAuthStatus ? (
            <button
              type="button"
              data-testid="ai-auth-refresh-button"
              onClick={onRefreshAuthStatus}
              disabled={authStatusPending}
              className={cn(
                "min-h-[30px] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-mono font-medium text-slate-700 shadow-xs",
                "hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-400",
                "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
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
                "min-h-[30px] rounded-lg bg-slate-900 px-2.5 text-[11px] font-mono font-medium text-white shadow-xs",
                "hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-400",
                "disabled:cursor-not-allowed disabled:bg-slate-300",
              )}
            >
              {authActionPending ? "Opening..." : "Sign in with ChatGPT"}
            </button>
          ) : null}
          {pending ? (
            <span
              role="status"
              data-testid="ai-progress-indicator"
              className="flex items-center gap-1.5 text-xs font-mono text-brand-600"
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
              />
              Working...
            </span>
          ) : null}
        </div>
      </header>

      {/* Suggested prompt chips */}
      {messages.length === 0 && !unavailable && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
            Suggested Scaffolding Prompts
          </span>
          <div className="flex flex-col gap-1">
            {promptSuggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSendMessage(prompt)}
                disabled={pending || unavailable}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50/50 shadow-xs"
              >
                💡 {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI unavailable notice (Req 12.7). */}
      {unavailable ? (
        <div
          role="status"
          data-testid="ai-unavailable-message"
          className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900 shadow-xs"
        >
          <div className="flex items-start gap-2">
            <span className="text-sm">⚠️</span>
            <div className="flex-1 font-medium leading-relaxed">
              {authStatus?.openAiAccountSession.error ? (
                <>
                  {authStatus.openAiAccountSession.error}{" "}
                  {authStatus.openAiAccountSession.deviceCodeRequired &&
                  authStatus.setup.deviceCodeSettingsUrl ? (
                    <a
                      href={authStatus.setup.deviceCodeSettingsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline text-brand-700"
                    >
                      Enable device code login in ChatGPT Security Settings.
                    </a>
                  ) : null}
                </>
              ) : authStatus?.openAiAccountSession.pending ? (
                <>
                  Finish the ChatGPT sign-in in your browser. After you enter the
                  one-time code, the assistant will use your ChatGPT account and app
                  tools automatically.
                </>
              ) : authStatus?.codexCli.method === "chatgpt" &&
                !authStatus.openAiAccountSession.authenticated ? (
                <>
                  Sign in with your ChatGPT account in this app before using
                  the assistant.
                </>
              ) : authStatus?.codexCli.method === "chatgpt" && !authStatus.mcp.connected ? (
                <>
                  Codex is signed in, but the Stillas MCP tool bridge is not connected.
                  Check again to restart the bridge. All other features remain available.
                </>
              ) : !authStatus || authStatus.providerPreference === "openrouter-api" ? (
                <>
                  The AI assistant is not connected. The app owner needs to configure
                  server-side OpenRouter API access.
                </>
              ) : authStatus?.providerPreference !== "openai-api" ? (
                <>
                  Sign in with your ChatGPT account in this app before using
                  the assistant.
                </>
              ) : (
                <>
                  The AI assistant is not connected. The app owner needs to configure
                  server-side OpenAI API access.
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {authActionMessage ? (
        <p
          role="status"
          data-testid="ai-auth-action-message"
          className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 font-mono"
        >
          {authActionMessage}
        </p>
      ) : null}

      {authActionDeviceAuth ? (
        <div
          role="status"
          data-testid="ai-auth-device-code"
          className="rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-xs text-brand-950 shadow-xs"
        >
          <div className="font-bold uppercase tracking-wider font-mono">ChatGPT account sign-in</div>
          <a
            href={authActionDeviceAuth.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-brand-700 font-semibold underline"
          >
            {authActionDeviceAuth.verificationUri}
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-slate-600">Verification Code:</span>
            <code className="rounded border border-brand-300 bg-white px-2.5 py-1 font-mono text-sm font-bold text-brand-900 shadow-xs">
              {authActionDeviceAuth.userCode}
            </code>
          </div>
          <p className="mt-2 text-[11px] text-brand-900">
            Use the same sign-in method you used when you registered your
            ChatGPT account. If Continue is disabled, enable device code login
            in ChatGPT Security Settings, then start sign-in again.
          </p>
          <p className="mt-1 text-[11px] font-mono text-brand-700">
            Code expires at{" "}
            {new Date(authActionDeviceAuth.expiresAt).toLocaleTimeString()}.
          </p>
        </div>
      ) : null}

      <AiMessageList
        messages={messages}
        toolResults={toolResults}
        decimalPlaces={decimalPlaces}
        className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xs"
      />

      {errorMessage ? (
        <p
          role="alert"
          data-testid="ai-error-message"
          className="rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs font-medium text-red-700 shadow-xs"
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
