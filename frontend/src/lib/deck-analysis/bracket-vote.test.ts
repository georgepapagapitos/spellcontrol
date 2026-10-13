import { describe, expect, it } from 'vitest';
import { deckFingerprint, deckListText } from './bracket-vote';

describe('deckListText / deckFingerprint', () => {
  it('is order-free and counts copies', async () => {
    const a = deckListText(['Atraxa'], ['Sol Ring', 'Island', 'Island']);
    const b = deckListText(['Atraxa'], ['Island', 'Sol Ring', 'Island']);
    expect(a).toBe(b);
    expect(a).toContain('2 Island');
    expect(await deckFingerprint(a)).toBe(await deckFingerprint(b));
  });

  it('changes when a card or a commander changes', async () => {
    const base = await deckFingerprint(deckListText(['Atraxa'], ['Sol Ring']));
    expect(await deckFingerprint(deckListText(['Atraxa'], ['Sol Ring', 'Island']))).not.toBe(base);
    expect(await deckFingerprint(deckListText(['Kenrith'], ['Sol Ring']))).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores an absent partner', () => {
    expect(deckListText(['Atraxa', undefined], [])).toBe('C Atraxa');
  });
});
