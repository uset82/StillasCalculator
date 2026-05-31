"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

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

type MessageBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "unordered"; items: string[] };

function parseMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MessageBlock, { type: "ordered" | "unordered" }> | null =
    null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ordered") {
        flushList();
        list = { type: "ordered", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    if (unordered) {
      flushParagraph();
      if (!list || list.type !== "unordered") {
        flushList();
        list = { type: "unordered", items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMessageBlocks(content);
  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return (
            <p key={blockIndex} className="leading-relaxed">
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  {renderInlineMarkdown(line)}
                </span>
              ))}
            </p>
          );
        }

        const ListTag = block.type === "ordered" ? "ol" : "ul";
        return (
          <ListTag
            key={blockIndex}
            className={cn(
              "space-y-1 pl-5 leading-relaxed",
              block.type === "ordered" ? "list-decimal" : "list-disc",
            )}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
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
                  "max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm",
                  isUser
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-800",
                )}
              >
                <MarkdownMessage content={message.content} />
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
