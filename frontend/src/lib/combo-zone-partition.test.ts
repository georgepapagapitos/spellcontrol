import { describe, it, expect } from 'vitest';
import { partitionCombosByZone, toMainboardComboData } from './combo-zone-partition';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';

function cardRef(oracleId: string, cardName: string) {
  return { oracleId, cardName, quantity: 1 };
}

function combo(id: string, cards: ReturnType<typeof cardRef>[]): ComboMatch['combo'] {
  return {
    id,
    identity: 'wb',
    produces: ['Infinite drain'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 10,
    cardCount: cards.length,
    bracket: 3,
    cards,
  };
}

function match(
  id: string,
  cards: ReturnType<typeof cardRef>[],
  presentOracleIds: string[]
): ComboMatch {
  return {
    combo: combo(id, cards),
    presentOracleIds,
    missingOracleIds: cards.map((c) => c.oracleId).filter((id) => !presentOracleIds.includes(id)),
  };
}

const response = (inDeck: ComboMatch[], oneAway: ComboMatch[] = []): ComboMatchResponse => ({
  inDeck,
  oneAway,
  almostInCollection: [],
  source: 'local',
  almostInCollectionTotal: 0,
});

describe('partitionCombosByZone', () => {
  it('returns empty buckets for null/undefined data', () => {
    expect(partitionCombosByZone(null, new Set())).toEqual({
      mainboardComplete: [],
      sideboardComplete: [],
      oneAway: [],
    });
    expect(partitionCombosByZone(undefined, new Set())).toEqual({
      mainboardComplete: [],
      sideboardComplete: [],
      oneAway: [],
    });
  });

  it('keeps a combo complete entirely within the mainboard set', () => {
    const cards = [cardRef('o1', 'Exquisite Blood'), cardRef('o2', 'Sanguine Bond')];
    const m = match('c1', cards, ['o1', 'o2']);
    const mainboardIds = new Set(['o1', 'o2', 'commander-id']);

    const result = partitionCombosByZone(response([m]), mainboardIds);

    expect(result.mainboardComplete).toEqual([m]);
    expect(result.sideboardComplete).toEqual([]);
  });

  it('buckets a combo completed only via a sideboard card, naming the card', () => {
    // Exquisite Blood in the 99, Sanguine Bond only in the sideboard.
    const cards = [cardRef('o1', 'Exquisite Blood'), cardRef('o2', 'Sanguine Bond')];
    const m = match('c1', cards, ['o1', 'o2']);
    // Only o1 is in the mainboard set — o2 is a sideboard card.
    const mainboardIds = new Set(['o1', 'commander-id']);

    const result = partitionCombosByZone(response([m]), mainboardIds);

    expect(result.mainboardComplete).toEqual([]);
    expect(result.sideboardComplete).toEqual([{ match: m, sideboardCardNames: ['Sanguine Bond'] }]);
  });

  it('names every sideboard card when a combo needs more than one', () => {
    const cards = [cardRef('o1', 'A'), cardRef('o2', 'B'), cardRef('o3', 'C')];
    const m = match('c1', cards, ['o1', 'o2', 'o3']);
    const mainboardIds = new Set(['o1']);

    const result = partitionCombosByZone(response([m]), mainboardIds);

    expect(result.sideboardComplete).toEqual([{ match: m, sideboardCardNames: ['B', 'C'] }]);
  });

  it('keeps a one-away combo whose present pieces are all in the mainboard', () => {
    const cards = [cardRef('o1', 'A'), cardRef('o2', 'B')];
    const m = match('c1', cards, ['o1']); // missing o2
    const mainboardIds = new Set(['o1']);

    const result = partitionCombosByZone(response([], [m]), mainboardIds);

    expect(result.oneAway).toEqual([m]);
  });

  it('drops a one-away combo whose present piece is only in the sideboard', () => {
    const cards = [cardRef('o1', 'A'), cardRef('o2', 'B')];
    // o1 is "present" but only lives in the sideboard — not one card away
    // from a mainboard-legal combo.
    const m = match('c1', cards, ['o1']);
    const mainboardIds = new Set<string>(); // o1 not in mainboard

    const result = partitionCombosByZone(response([], [m]), mainboardIds);

    expect(result.oneAway).toEqual([]);
  });
});

describe('toMainboardComboData', () => {
  it('returns null when the source data is null', () => {
    expect(
      toMainboardComboData(null, { mainboardComplete: [], sideboardComplete: [], oneAway: [] })
    ).toBeNull();
  });

  it('swaps in the mainboard-only buckets, keeping other fields intact', () => {
    const cards = [cardRef('o1', 'A'), cardRef('o2', 'B')];
    const inDeckMatch = match('c1', cards, ['o1', 'o2']);
    const data = response([inDeckMatch]);
    const partitioned = partitionCombosByZone(data, new Set(['o1', 'o2']));

    const out = toMainboardComboData(data, partitioned);

    expect(out?.inDeck).toEqual([inDeckMatch]);
    expect(out?.source).toBe('local');
    expect(out?.almostInCollection).toBe(data.almostInCollection);
  });
});
