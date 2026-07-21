import { describe, expect, it } from 'vitest';
import { computeOwnershipLens } from './ownership-lens';
import type { PublicDeckCard } from './shared-types';
import type { BinderDef, EnrichedCard } from '../types';

function deckCard(name: string, oracleId?: string): PublicDeckCard {
  return { card: oracleId ? { name, oracle_id: oracleId } : { name } };
}

function owned(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: over.copyId ?? `copy-${Math.random().toString(36).slice(2)}`,
    name: over.name ?? 'Sol Ring',
    setCode: over.setCode ?? 'lea',
    setName: over.setName ?? 'Limited Edition Alpha',
    collectorNumber: over.collectorNumber ?? '1',
    rarity: over.rarity ?? 'uncommon',
    scryfallId: over.scryfallId ?? `sf-${Math.random().toString(36).slice(2)}`,
    purchasePrice: over.purchasePrice ?? 0,
    sourceCategory: over.sourceCategory ?? '',
    sourceFormat: over.sourceFormat ?? 'manual',
    finish: over.finish ?? 'nonfoil',
    foil: over.foil ?? false,
    ...over,
  };
}

function binder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: over.id ?? 'binder-1',
    name: over.name ?? 'Sacrifice',
    position: over.position ?? 0,
    filterGroups: over.filterGroups ?? [],
    sorts: over.sorts ?? [],
    pocketSize: over.pocketSize ?? null,
    doubleSided: over.doubleSided ?? false,
    fixedCapacity: over.fixedCapacity ?? null,
    color: over.color ?? '#ff0000',
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
    ...over,
  };
}

describe('computeOwnershipLens', () => {
  it('a fully-owned deck: percentOwned=100, missingCardNames=[]', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol'), deckCard('Arcane Signet', 'oracle-signet')];
    const cards = [
      owned({ name: 'Sol Ring', oracleId: 'oracle-sol' }),
      owned({ name: 'Arcane Signet', oracleId: 'oracle-signet' }),
    ];
    const lens = computeOwnershipLens(deck, cards, []);
    expect(lens.percentOwned).toBe(100);
    expect(lens.missingCardNames).toEqual([]);
    expect(lens.ownedCount).toBe(2);
    expect(lens.totalCount).toBe(2);
  });

  it('a fully-unowned deck: percentOwned=0, missing list = every card name', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol'), deckCard('Arcane Signet', 'oracle-signet')];
    const lens = computeOwnershipLens(deck, [], []);
    expect(lens.percentOwned).toBe(0);
    expect(lens.missingCardNames).toEqual(['Sol Ring', 'Arcane Signet']);
    expect(lens.ownedCount).toBe(0);
  });

  it('a different owned printing (same oracleId) still counts as owned', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol')];
    // Owned copy is a different printing entirely (different scryfallId/set).
    const cards = [
      owned({ name: 'Sol Ring', oracleId: 'oracle-sol', scryfallId: 'sf-cmr', setCode: 'cmr' }),
    ];
    const lens = computeOwnershipLens(deck, cards, []);
    expect(lens.perCard.get('Sol Ring')).toEqual({ owned: true, binders: [] });
  });

  it('a card owned in Uncategorized (no binder rule matches): owned:true, binders:[]', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol')];
    const cards = [owned({ name: 'Sol Ring', oracleId: 'oracle-sol' })];
    const b = binder({ filterGroups: [{ filter: { nameContains: 'zzz-no-match' } }] });
    const lens = computeOwnershipLens(deck, cards, [b]);
    expect(lens.perCard.get('Sol Ring')).toEqual({ owned: true, binders: [] });
  });

  it('a card owned in one matching binder: binders carries it', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol')];
    const cards = [owned({ name: 'Sol Ring', oracleId: 'oracle-sol' })];
    const b = binder({
      id: 'b-sac',
      name: 'Sacrifice',
      color: '#123456',
      filterGroups: [{ filter: { nameContains: 'Sol Ring' } }],
    });
    const lens = computeOwnershipLens(deck, cards, [b]);
    expect(lens.perCard.get('Sol Ring')).toEqual({
      owned: true,
      binders: [{ id: 'b-sac', name: 'Sacrifice', color: '#123456' }],
    });
  });

  it('a card owned as two copies in two different binders: both present', () => {
    const deck = [deckCard('Sol Ring', 'oracle-sol')];
    const cards = [
      owned({
        copyId: 'c1',
        name: 'Sol Ring',
        oracleId: 'oracle-sol',
        scryfallId: 'sf-1',
        setCode: 'lea',
      }),
      owned({
        copyId: 'c2',
        name: 'Sol Ring',
        oracleId: 'oracle-sol',
        scryfallId: 'sf-2',
        setCode: 'cmr',
      }),
    ];
    // First-match-wins by position: binderA only claims the LEA printing
    // (setCodes rule); the CMR printing falls through to binderB (name rule).
    const binderA = binder({
      id: 'b-a',
      name: 'Alpha',
      position: 0,
      filterGroups: [{ filter: { setCodes: ['lea'] } }],
    });
    const binderB = binder({
      id: 'b-b',
      name: 'Beta',
      position: 1,
      filterGroups: [{ filter: { nameContains: 'Sol Ring' } }],
    });
    const lens = computeOwnershipLens(deck, cards, [binderA, binderB]);
    const entry = lens.perCard.get('Sol Ring')!;
    expect(entry.owned).toBe(true);
    expect(entry.binders.map((b) => b.id).sort()).toEqual(['b-a', 'b-b']);
  });

  it('a deck card missing oracle_id falls back to a case-insensitive name match', () => {
    const deck = [deckCard('sol ring')]; // no oracle_id, lowercase name
    const cards = [owned({ name: 'Sol Ring', oracleId: 'oracle-sol' })];
    const lens = computeOwnershipLens(deck, cards, []);
    expect(lens.perCard.get('sol ring')).toEqual({ owned: true, binders: [] });
  });

  it('a basic land (near-zero price) does not break the missing list', () => {
    const deck = [
      deckCard('Forest', 'oracle-forest'),
      deckCard('Forest', 'oracle-forest'),
      deckCard('Forest', 'oracle-forest'),
    ];
    const lens = computeOwnershipLens(deck, [], []);
    // Duplicate stack entries collapse to one distinct missing name.
    expect(lens.missingCardNames).toEqual(['Forest']);
    expect(lens.totalCount).toBe(1);
  });

  it('an empty deck: percentOwned=0 rather than NaN', () => {
    const lens = computeOwnershipLens([], [], []);
    expect(lens.percentOwned).toBe(0);
    expect(lens.totalCount).toBe(0);
  });
});
