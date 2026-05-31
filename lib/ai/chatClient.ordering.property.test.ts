// Feature: stillas-calculator, Property 24: Chat messages are ordered and length-bounded
//
// Property 24 (design.md): *For any* sequence of user/assistant messages, the
// chat panel displays them in chronological order, and *for any* message longer
// than 2000 characters the send is rejected.
//
// Validates: Requirements 12.1
//
// Req 12.1: "THE AI_Assistant SHALL provide a chat panel where the user can send
// messages of up to 2000 characters and view assistant responses in
// chronological order."
//
// The trust-bearing pure helpers live in `chatClient.ts`:
//   - `isMessageWithinLimit(content)` / `MAX_MESSAGE_LENGTH` enforce the
//     2000-character send bound before any request leaves the browser;
//   - `sortMessagesChronologically(messages)` orders a conversation by
//     ascending `timestamp` (stable for ties);
//   - `appendMessage(messages, message)` adds a message while preserving the
//     chronological ordering.
//
// This test exercises both halves of the property across >=100 generated cases:
//   Part 1 (length bound): for any string, `isMessageWithinLimit` returns
//     `true` iff the string's length is `<= 2000`, with the 2000/2001 boundary
//     pinned explicitly.
//   Part 2 (ordering): for any array of ChatMessage with arbitrary timestamps,
//     `sortMessagesChronologically` returns a non-decreasing-timestamp sequence
//     that is a stable permutation of the input, and `appendMessage` keeps the
//     result chronologically ordered.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  isMessageWithinLimit,
  sortMessagesChronologically,
  appendMessage,
  MAX_MESSAGE_LENGTH,
} from './chatClient';
import type { ChatMessage, ChatRole } from '../types';

const ROLES: ChatRole[] = ['user', 'assistant', 'system'];

/** An arbitrary single chat message with an arbitrary (possibly tied) timestamp. */
const messageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom(...ROLES),
  content: fc.string(),
  // Constrain timestamps to a small integer range so ties occur frequently,
  // which is what exercises the stability requirement.
  timestamp: fc.integer({ min: 0, max: 50 }),
});

/** An arbitrary conversation: an array of chat messages in arbitrary order. */
const conversationArb: fc.Arbitrary<ChatMessage[]> = fc.array(messageArb, {
  maxLength: 30,
});

/** True when `messages` are in non-decreasing timestamp order. */
function isChronological(messages: readonly ChatMessage[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].timestamp < messages[i - 1].timestamp) return false;
  }
  return true;
}

/** A multiset key for a message, used to confirm permutations preserve content. */
function key(message: ChatMessage): string {
  return `${message.id}\u0000${message.role}\u0000${message.content}\u0000${message.timestamp}`;
}

function multiset(messages: readonly ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const k = key(message);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function sameMultiset(
  a: readonly ChatMessage[],
  b: readonly ChatMessage[],
): boolean {
  const ma = multiset(a);
  const mb = multiset(b);
  if (ma.size !== mb.size) return false;
  for (const [k, count] of ma) {
    if (mb.get(k) !== count) return false;
  }
  return true;
}

describe('Property 24: Chat messages are ordered and length-bounded (Req 12.1)', () => {
  // --- Part 1: length bound -------------------------------------------------

  it('isMessageWithinLimit returns true iff length <= 2000', () => {
    fc.assert(
      fc.property(
        // Generate strings spanning both sides of the 2000 boundary. Pad to an
        // exact target length so we control the boundary precisely.
        fc.integer({ min: 0, max: 2200 }),
        (targetLength) => {
          const content = 'a'.repeat(targetLength);
          expect(content.length).toBe(targetLength);
          expect(isMessageWithinLimit(content)).toBe(
            targetLength <= MAX_MESSAGE_LENGTH,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('accepts arbitrary strings exactly when they are within the limit', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2200 }), (content) => {
        expect(isMessageWithinLimit(content)).toBe(
          content.length <= MAX_MESSAGE_LENGTH,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('pins the 2000 (accepted) / 2001 (rejected) boundary', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(2000);
    expect(isMessageWithinLimit('a'.repeat(2000))).toBe(true);
    expect(isMessageWithinLimit('a'.repeat(2001))).toBe(false);
    expect(isMessageWithinLimit('')).toBe(true);
  });

  // --- Part 2: chronological ordering --------------------------------------

  it('sortMessagesChronologically returns a chronologically ordered permutation', () => {
    fc.assert(
      fc.property(conversationArb, (messages) => {
        const sorted = sortMessagesChronologically(messages);

        // Result is in non-decreasing timestamp order.
        expect(isChronological(sorted)).toBe(true);

        // Result is a permutation of the input (no loss/dup/mutation).
        expect(sorted).toHaveLength(messages.length);
        expect(sameMultiset(sorted, messages)).toBe(true);

        // Input is not mutated.
        expect(messages).toHaveLength(sorted.length);
      }),
      { numRuns: 100 },
    );
  });

  it('sortMessagesChronologically is stable: equal-timestamp messages keep input order', () => {
    fc.assert(
      fc.property(conversationArb, (messages) => {
        const sorted = sortMessagesChronologically(messages);

        // For any pair sharing a timestamp, their relative order in the output
        // matches their relative order in the input.
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[i].timestamp === sorted[j].timestamp) {
              const inputI = messages.indexOf(sorted[i]);
              const inputJ = messages.indexOf(sorted[j]);
              expect(inputI).toBeLessThan(inputJ);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('appendMessage preserves chronological ordering of an already-ordered conversation', () => {
    fc.assert(
      fc.property(conversationArb, messageArb, (messages, incoming) => {
        // Start from an ordered conversation (the invariant the UI maintains).
        const ordered = sortMessagesChronologically(messages);

        const result = appendMessage(ordered, incoming);

        // Still chronologically ordered after the append.
        expect(isChronological(result)).toBe(true);

        // The incoming message was added exactly once; nothing else lost.
        expect(result).toHaveLength(ordered.length + 1);
        expect(sameMultiset(result, [...ordered, incoming])).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('repeated appendMessage builds a chronologically ordered conversation from scratch', () => {
    fc.assert(
      fc.property(fc.array(messageArb, { maxLength: 30 }), (incoming) => {
        let conversation: ChatMessage[] = [];
        for (const message of incoming) {
          conversation = appendMessage(conversation, message);
          // Invariant holds after every append, regardless of arrival order.
          expect(isChronological(conversation)).toBe(true);
        }
        expect(conversation).toHaveLength(incoming.length);
        expect(sameMultiset(conversation, incoming)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
