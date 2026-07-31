import { describe, expect, it } from 'vitest';
import { buildCardLocationIndex } from './card-locations';
import type { BinderDef, EnrichedCard } from '../types';

function card(name: string, oracleId: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    name,
    oracleId,
    quantity: 1,
    purchasePrice: 0,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: oracleId,
    typeLine: 'Creature — Human',
    colorIdentity: ['U'],
    ...over,
  } as EnrichedCard;
}

function binder(id: string, name: string, position: number, rarity?: string): BinderDef {
  return {
    id,
    name,
    position,
    filterGroups: rarity
      ? [{ filter: { rarities: { chips: [{ value: rarity, negate: false }], joiners: [] } } }]
      : [],
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
  } as unknown as BinderDef;
}

describe('buildCardLocationIndex', () => {
  it('is empty when there are no cards or no binders', () => {
    expect(buildCardLocationIndex([], [binder('b1', 'Staples', 0)]).size).toBe(0);
    expect(buildCardLocationIndex([card('Sol Ring', 'o1')], []).size).toBe(0);
  });

  it('reports the binder and page a card sits on', () => {
    const index = buildCardLocationIndex(
      [card('Sol Ring', 'o1', { rarity: 'rare' })],
      [binder('b1', 'Rares', 0, 'rare')]
    );

    const at = index.get('o1');
    expect(at?.binderName).toBe('Rares');
    expect(at?.binderId).toBe('b1');
    // Page numbers are 1-based, matching the binder view.
    expect(at?.pageNum).toBeGreaterThanOrEqual(1);
  });

  it('reports the first binder by position when several could claim a card', () => {
    const index = buildCardLocationIndex(
      [card('Sol Ring', 'o1', { rarity: 'rare' })],
      [binder('b2', 'Second', 1, 'rare'), binder('b1', 'First', 0, 'rare')]
    );
    expect(index.get('o1')?.binderName).toBe('First');
  });

  it('omits cards that no binder claims', () => {
    const index = buildCardLocationIndex(
      [card('Sol Ring', 'o1', { rarity: 'common' })],
      [binder('b1', 'Rares', 0, 'rare')]
    );
    expect(index.has('o1')).toBe(false);
  });
});
