import { describe, expect, it } from 'vitest';
import { frontFaceName, getByCardName } from './card-text';

describe('frontFaceName', () => {
  it('returns the front face of a double-faced name and a plain name unchanged', () => {
    expect(frontFaceName('Revitalizing Repast // Old-Growth Grove')).toBe('Revitalizing Repast');
    expect(frontFaceName('Sol Ring')).toBe('Sol Ring');
  });
});

describe('getByCardName', () => {
  const index = new Map([
    ['Revitalizing Repast', 18],
    ['Fire // Ice', 40],
    ['Sol Ring', 90],
  ]);

  it('finds a double-faced deck card under its front-face key (E490)', () => {
    expect(getByCardName(index, 'Revitalizing Repast // Old-Growth Grove')).toBe(18);
  });

  it('prefers an exact full-name key', () => {
    expect(getByCardName(index, 'Fire // Ice')).toBe(40);
  });

  it('finds a plain name and misses an unknown one', () => {
    expect(getByCardName(index, 'Sol Ring')).toBe(90);
    expect(getByCardName(index, 'Arcane Signet')).toBeUndefined();
    expect(getByCardName(index, 'Unknown // Card')).toBeUndefined();
  });
});
