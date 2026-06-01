import { describe, expect, it } from 'vitest';

import { stripChatRoleTags } from './chatFormatting';

describe('stripChatRoleTags', () => {
  it('removes model-emitted assistant wrappers without touching markdown', () => {
    expect(
      stripChatRoleTags(
        '<assistant>\n**Estimate:** 14 bays\n</assistant>\n<|im_end|>',
      ),
    ).toBe('**Estimate:** 14 bays');
  });
});
