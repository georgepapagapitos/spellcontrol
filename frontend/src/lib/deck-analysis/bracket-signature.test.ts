import { describe, expect, it } from 'vitest';
import { COMBOS_UNCHECKED, signatureMissesCombos } from './bracket-signature';

describe('signatureMissesCombos', () => {
  it('is true only when the second-to-last segment is the unchecked marker', () => {
    expect(signatureMissesCombos(`a,b|v9|${COMBOS_UNCHECKED}|3`)).toBe(true);
    expect(signatureMissesCombos('a,b|v9|c1,c2|3')).toBe(false);
    expect(signatureMissesCombos('a,b|v9||3')).toBe(false);
  });

  it('is false when there is no signature', () => {
    expect(signatureMissesCombos(undefined)).toBe(false);
    expect(signatureMissesCombos(null)).toBe(false);
    expect(signatureMissesCombos('')).toBe(false);
  });
});
