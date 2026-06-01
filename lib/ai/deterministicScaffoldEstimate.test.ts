import { describe, expect, it } from 'vitest';

import { extractAddressForScaffoldEstimate } from './deterministicScaffoldEstimate';

describe('extractAddressForScaffoldEstimate', () => {
  it('extracts the house address from a Spanish scaffold quantity request', () => {
    expect(
      extractAddressForScaffoldEstimate(
        'CUANTOS ANDAMIOS NECESITO PARA LA CASA Sydneskleiven 19',
      ),
    ).toBe('Sydneskleiven 19');
  });
});
