import { describe, it, expect } from 'vitest';
import { __testing } from './use-deck-combos';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';

const { filterByIdentity } = __testing;

const match = (id: string, identity: string): ComboMatch => ({
  combo: {
    id,
    identity,
    produces: [],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 0,
    cardCount: 2,
    bracket: null,
    cards: [],
  },
  presentOracleIds: [],
  missingOracleIds: ['m1'],
});

const response = (): ComboMatchResponse => ({
  inDeck: [match('in-r', 'r')],
  oneAway: [match('ug', 'gu'), match('r', 'r'), match('c', 'c'), match('unknown', '')],
  almostInCollection: [match('wub', 'wub')],
});

describe('filterByIdentity', () => {
  it('passes everything through when no identity restriction (null)', () => {
    expect(filterByIdentity(response(), null)).toEqual(response());
  });

  it('drops suggestion combos whose identity escapes the deck, keeps in-identity ones', () => {
    const out = filterByIdentity(response(), 'GU');
    expect(out.oneAway.map((m) => m.combo.id)).toEqual(['ug', 'c', 'unknown']);
    expect(out.almostInCollection).toHaveLength(0);
  });

  it('never filters inDeck — assembled combos are facts, not suggestions', () => {
    expect(filterByIdentity(response(), 'GU').inDeck.map((m) => m.combo.id)).toEqual(['in-r']);
  });

  it('colorless commander ("") keeps only colorless/unknown combos', () => {
    const out = filterByIdentity(response(), '');
    expect(out.oneAway.map((m) => m.combo.id)).toEqual(['c', 'unknown']);
  });
});
