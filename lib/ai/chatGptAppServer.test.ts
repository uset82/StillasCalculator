import { describe, expect, it } from 'vitest';

import { buildEstimateFromLengthInput } from '@/lib/ai/chatGptAppServer';

describe('ChatGPT app scaffold estimates', () => {
  it('builds a deterministic material estimate from an explicit scaffold length', () => {
    const result = buildEstimateFromLengthInput({
      scaffoldLengthMeters: 24,
      workingHeightMeters: 6,
      scaffoldSystemId: 'generic-frame',
      bayLengthMeters: null,
      liftHeightMeters: null,
      scaffoldWidthMeters: null,
      wasteFactorPercent: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.estimate.source).toBe('length');
    expect(result.output.estimate.scaffoldLengthMeters).toBe(24);
    expect(result.output.estimate.numberOfBays).toBeGreaterThan(0);
    expect(result.output.estimate.numberOfLevels).toBeGreaterThan(0);
    expect(result.output.estimate.materialList.length).toBeGreaterThan(0);
    expect(result.output.estimate.disclaimer).toContain('professional verification');
  });
});
