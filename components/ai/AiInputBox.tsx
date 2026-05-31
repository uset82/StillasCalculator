"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

import {
  MAX_MESSAGE_LENGTH,
  isMessageWithinLimit,
} from "@/lib/ai/chatClient";

/**
 * Joins conditional class names, dropping falsy values. Kept local to avoid a
 * dependency, mirroring the other presentation components.
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
 *
 * While a request is in flight the textarea and send button are disabled so the
 * user cannot send another message until the current one settles (Req 12.3);
 * the same applies when the assistant is unavailable (Req 12.7). Pressing Enter
 * (without Shift) sends; Shift+Enter inserts a newline.
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
    // Guard against sending while blocked, empty, or over the bound (Req 12.1,
    // 12.3). The bound check is defensive — `maxLength` already prevents typing
    // past the limit.
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
    // Enter sends; Shift+Enter inserts a newline.
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
      className={cn("flex flex-col gap-2", className)}
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
        // Hard cap typed input at the 2000-character bound (Req 12.1).
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={blocked}
        rows={2}
        placeholder={
          disabled
            ? "The assistant is unavailable."
            : "Ask the assistant to help with your scaffold plan..."
        }
        aria-describedby={counterId}
        className={cn(
          "min-h-[44px] w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm",
          "focus:outline-none focus:ring-2 focus:ring-blue-400",
          "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400",
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <span
          id={counterId}
          data-testid="ai-input-counter"
          className={cn(
            "text-xs",
            withinLimit ? "text-gray-400" : "text-red-600",
          )}
        >
          {value.length} / {MAX_MESSAGE_LENGTH}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          data-testid="ai-send-button"
          className={cn(
            "min-h-[44px] rounded-lg px-4 py-2 text-base font-semibold text-white shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-blue-400",
            "disabled:cursor-not-allowed disabled:bg-gray-300",
            "bg-blue-600 hover:bg-blue-700",
          )}
        >
          {pending ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}

export default AiInputBox;
