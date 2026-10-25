import { describe, expect, it } from 'vitest';
import { deckVersionOf, versionCardCount } from './deck-version';

type Card = { oracle_id?: string; name: string };
const row = (card: Card) => ({ card }) as never;
const deck = (names: string[], commander: Card | null = null) =>
  ({
    commander,
    partnerCommander: null,
    cards: names.map((n) => row({ oracle_id: `o-${n}`, name: n })),
  }) as never;

describe('deckVersionOf', () => {
  it('reads <count>:<8 hex>, counting the commander and every copy', () => {
    const v = deckVersionOf(deck(['A', 'B', 'B'], { oracle_id: 'o-C', name: 'C' }));
    expect(v).toMatch(/^4:[0-9a-f]{8}$/);
    expect(versionCardCount(v)).toBe(4);
  });

  it('does not depend on the order cards were added', () => {
    expect(deckVersionOf(deck(['A', 'B', 'C']))).toBe(deckVersionOf(deck(['C', 'A', 'B'])));
  });

  it('is the same card across printings (oracle id), and moves when a card changes', () => {
    const a = deck(['A', 'B']);
    const reprint = {
      commander: null,
      partnerCommander: null,
      cards: [row({ oracle_id: 'o-A', name: 'A' }), row({ oracle_id: 'o-B', name: 'B (alt art)' })],
    } as never;
    expect(deckVersionOf(reprint)).toBe(deckVersionOf(a));
    expect(deckVersionOf(deck(['A', 'C']))).not.toBe(deckVersionOf(a));
  });

  it('tells one copy from two', () => {
    expect(deckVersionOf(deck(['A', 'B']))).not.toBe(deckVersionOf(deck(['A', 'A', 'B'])));
  });
});

describe('versionCardCount', () => {
  it('is null for anything that is not a version', () => {
    expect(versionCardCount(null)).toBeNull();
    expect(versionCardCount('abc')).toBeNull();
    expect(versionCardCount('99:xyz')).toBeNull();
  });
});
