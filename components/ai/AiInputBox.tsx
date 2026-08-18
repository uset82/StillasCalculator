"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

import {
  MAX_MESSAGE_LENGTH,
  isMessageWithinLimit,
} from "@/lib/ai/chatClient";

/**
 * Joins conditional class names, dropping falsy values.
 */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export interface AiInputBoxProps {
  /**
   * Sends the trimmed message content. Wired by the panel to the chat client.
   * Only ever invoked with content within the 2000-character bound (Req 12.1).
   */
  onSend: (content: string) => void;
  /**
   * Whether a request is in flight. When true the input and send control are
   * disabled so no additional message can be sent until the request settles
   * (Req 12.3).
   */
  pending?: boolean;
  /**
   * Whether the assistant is unavailable (no server auth, Req 12.7). When true
   * the composer is disabled since sending cannot succeed.
   */
  disabled?: boolean;
  /** Extra classes for the form container. */
  className?: string;
}

/**
 * `AiInputBox` — the message composer (Req 12.1, 12.3). It is a controlled
 * textarea bounded to 2000 characters: input beyond the limit cannot be typed
 * (via `maxLength`), and a send is additionally rejected if the content somehow
 * exceeds the bound, so an over-length message never leaves the browser
 * (Req 12.1). A live character counter shows progress toward the limit.
 */
export function AiInputBox({
  onSend,
  pending = false,
  disabled = false,
  className,
}: AiInputBoxProps) {
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const withinLimit = isMessageWithinLimit(value);
  const blocked = pending || disabled;
  const canSend = !blocked && trimmed.length > 0 && withinLimit;

  function submit(): void {
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setValue("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const counterId = "ai-input-counter";

  return (
    <form
      data-testid="ai-input-box"
      aria-label="Send a message to the assistant"
      className={cn("flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs", className)}
      onSubmit={handleSubmit}
    >
      <label htmlFor="ai-input-textarea" className="sr-only">
        Message the assistant
      </label>
      <textarea
        id="ai-input-textarea"
        data-testid="ai-input-textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={blocked}
        rows={2}
        placeholder={
          disabled
            ? "The assistant is unavailable."
            : "Ask the copilot: adjust height, add guardrails, check anchors..."
        }
        aria-describedby={counterId}
        className={cn(
          "min-h-[44px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-900 shadow-inner",
          "focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20",
          "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <span
          id={counterId}
          data-testid="ai-input-counter"
          className={cn(
            "text-[10px] font-mono",
            withinLimit ? "text-slate-400" : "text-red-600 font-bold",
          )}
        >
          {value.length} / {MAX_MESSAGE_LENGTH}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          data-testid="ai-send-button"
          className={cn(
            "flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs transition-all",
            "focus:outline-none focus:ring-2 focus:ring-brand-400",
            "disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
            "bg-brand-600 hover:bg-brand-700 active:scale-[0.98]",
          )}
        >
          <span>{pending ? "Sending…" : "Send"}</span>
          <span aria-hidden="true">➤</span>
        </button>
      </div>
    </form>
  );
}

export default AiInputBox;
