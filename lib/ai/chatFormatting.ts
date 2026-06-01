const CHAT_ROLE_TAG_PATTERN =
  /<\/?(?:assistant|user|system)\s*>|<\|(?:assistant|user|system|im_start|im_end|end)\|>/gi;

/**
 * Removes model-emitted chat role wrappers such as `</assistant>` while
 * leaving ordinary markdown and prose intact.
 */
export function stripChatRoleTags(content: string): string {
  return content
    .replace(CHAT_ROLE_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
