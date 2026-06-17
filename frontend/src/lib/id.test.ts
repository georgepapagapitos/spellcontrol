import { describe, expect, it } from 'vitest';
import { genId } from './id';

describe('genId', () => {
  it('prefixes the id and uses an underscore separator', () => {
    const id = genId('deck');
    expect(id.startsWith('deck_')).toBe(true);
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => genId('slot')));
    expect(ids.size).toBe(1000);
  });

  it('keeps each prefix distinct', () => {
    expect(genId('a').startsWith('a_')).toBe(true);
    expect(genId('toast').startsWith('toast_')).toBe(true);
  });
});
