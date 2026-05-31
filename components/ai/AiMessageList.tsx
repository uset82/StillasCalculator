"use client";

import { useEffect, useRef } from "react";

import type { ChatMessage } from "@/lib/types";
import type { AiToolResult } from "@/app/api/ai/chat/route";
import { sortMessagesChronologically } from "@/lib/ai/chatClient";
import { AiCalculationCard } from "./AiCalculationCard";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface AiMessageListProps {
  /**
   * The full conversation. Rendered in chronological order by `timestamp`
   * regardless of input order (Req 12.1); the array is sorted defensively here
   * using the same helper the chat client uses to append messages.
   */
  messages: readonly ChatMessage[];
  /**
   * The deterministic tool-call results from the most recent assistant turn,
   * rendered as {@link AiCalculationCard}s beneath the conversation so the user
   * sees the engine-computed quantities that back the reply (Req 13.1).
   */
  toolResults?: readonly AiToolResult[];
  /** Decimal places used when formatting quantities in tool-result cards. */
  decimalPlaces?: number;
  /** Extra classes for the scroll container. */
  className?: string;
}

/** Human-readable role label for a chat bubble. */
function roleLabel(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    default:
      return "System";
  }
}

/**
 * `AiMessageList` — the scrollable, chronological transcript of the AI
 * conversation (Req 12.1). User, assistant, and system messages are shown in
 * order of their `timestamp`, with user messages aligned to the right and
 * assistant/system messages to the left. The deterministic tool-call results
 * for the latest turn are rendered as calculation cards after the messages so
 * the engine-computed quantities are visible alongside the reply (Req 13.1).
 *
 * The list auto-scrolls to the newest message as the conversation grows. It is
 * purely presentational: it derives everything it shows from props.
 */
export function AiMessageList({
  messages,
  toolResults = [],
  decimalPlaces = 2,
  className,
}: AiMessageListProps) {
  const ordered = sortMessagesChronologically(messages);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, toolResults]);

  const isEmpty = ordered.length === 0 && toolResults.length === 0;

  return (
    <div
      data-testid="ai-message-list"
      aria-label="Assistant conversation"
      aria-live="polite"
      className={cn("flex flex-col gap-3 overflow-y-auto", className)}
    >
      {isEmpty ? (
        <p
          data-testid="ai-message-list-empty"
          className="text-sm text-gray-500"
        >
          No messages yet. Ask the assistant to help complete your scaffold
          plan.
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {ordered.map((message) => {
          const isUser = message.role === "user";
          return (
            <li
              key={message.id}
              data-testid={`ai-message-${message.id}`}
              data-role={message.role}
              className={cn(
                "flex flex-col",
                isUser ? "items-end" : "items-start",
              )}
            >
              <span className="px-1 text-xs text-gray-400">
                {roleLabel(message.role)}
              </span>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                  isUser
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-800",
                )}
              >
                {message.content}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Deterministic tool-call results for the latest turn (Req 13.1). */}
      {toolResults.length > 0 ? (
        <div
          data-testid="ai-tool-results"
          className="flex flex-col gap-2"
          aria-label="Calculation results"
        >
          {toolResults.map((result, index) => (
            <AiCalculationCard
              key={`${result.tool}-${index}`}
              result={result}
              decimalPlaces={decimalPlaces}
            />
          ))}
        </div>
      ) : null}

      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}

export default AiMessageList;
