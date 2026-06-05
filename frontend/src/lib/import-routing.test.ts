import { describe, it, expect } from 'vitest';
import { summarizeImportRouting } from './import-routing';
import type { BinderDef, BinderFilter, BinderFilterGroup, EnrichedCard } from '../types';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `id-${Math.random()}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    ...overrides,
  };
}

type BinderOverrides = Omit<Partial<BinderDef>, 'filterGroups'> & {
  filter?: BinderFilter;
  filterGroups?: BinderFilterGroup[];
};

function makeBinder(overrides: BinderOverrides = {}): BinderDef {
  const { filter, filterGroups, ...rest } = overrides;
  const groups: BinderFilterGroup[] =
    filterGroups ?? (filter !== undefined ? [{ filter }] : [{ filter: {} }]);
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: groups,
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...rest,
  };
}

describe('summarizeImportRouting', () => {
  it('returns empty summary when no importIds are given', () => {
    const result = summarizeImportRouting(new Set(), [makeCard()], []);
    expect(result.entries).toEqual([]);
    expect(result.totalRouted).toBe(0);
  });

  it('counts cards routed into each matching binder', () => {
    const expensiveBinder = makeBinder({
      id: 'expensive',
      name: 'Expensive',
      filter: { priceMin: 5 },
      position: 0,
    });
    const rareBinder = makeBinder({
      id: 'rares',
      name: 'Rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      position: 1,
    });

    const importedExpensive = makeCard({
      importId: 'imp-1',
      purchasePrice: 10,
      rarity: 'common',
    });
    const importedRare = makeCard({ importId: 'imp-1', purchasePrice: 1, rarity: 'rare' });
    const importedUncat = makeCard({ importId: 'imp-1', purchasePrice: 1, rarity: 'common' });
    const olderCard = makeCard({ importId: 'imp-old', purchasePrice: 50 });

    const cards = [importedExpensive, importedRare, importedUncat, olderCard];

    const result = summarizeImportRouting(new Set(['imp-1']), cards, [expensiveBinder, rareBinder]);

    // The uncategorized card (importedUncat) is NOT reported (E11): only the two
    // cards that matched a real binder count toward totalRouted.
    expect(result.totalRouted).toBe(2);
    const byBinder = Object.fromEntries(result.entries.map((e) => [e.binderName, e.count]));
    expect(byBinder).toEqual({ Expensive: 1, Rares: 1 });
  });

  it('ignores cards from imports not in the importIds set', () => {
    const binder = makeBinder({ filter: { priceMin: 5 } });
    const inScope = makeCard({ importId: 'imp-1', purchasePrice: 10 });
    const outOfScope = makeCard({ importId: 'imp-other', purchasePrice: 10 });

    const result = summarizeImportRouting(new Set(['imp-1']), [inScope, outOfScope], [binder]);

    expect(result.totalRouted).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].count).toBe(1);
  });

  it('sorts binder entries by count desc and omits the uncategorized remainder', () => {
    const a = makeBinder({ id: 'a', name: 'Alpha', position: 0, filter: { priceMin: 100 } });
    const b = makeBinder({ id: 'b', name: 'Bravo', position: 1, filter: { priceMin: 5 } });

    const cards: EnrichedCard[] = [
      // 1 card routes to Alpha (price 200)
      makeCard({ importId: 'imp-1', purchasePrice: 200 }),
      // 3 cards route to Bravo (price 10 each)
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      // 2 cards uncategorized (price 1 each) — not reported
      makeCard({ importId: 'imp-1', purchasePrice: 1 }),
      makeCard({ importId: 'imp-1', purchasePrice: 1 }),
    ];

    const result = summarizeImportRouting(new Set(['imp-1']), cards, [a, b]);
    expect(result.entries.map((e) => e.binderName)).toEqual(['Bravo', 'Alpha']);
    expect(result.entries.map((e) => e.count)).toEqual([3, 1]);
    // The 2 uncategorized cards are excluded from the routed total.
    expect(result.totalRouted).toBe(4);
  });

  it('omits binders that received no cards from the import', () => {
    const a = makeBinder({ id: 'a', name: 'Alpha', filter: { priceMin: 5 } });
    const b = makeBinder({ id: 'b', name: 'Bravo', filter: { priceMin: 100 } });
    const card = makeCard({ importId: 'imp-1', purchasePrice: 10 });

    const result = summarizeImportRouting(new Set(['imp-1']), [card], [a, b]);
    expect(result.entries.map((e) => e.binderName)).toEqual(['Alpha']);
  });

  it('returns no entries when nothing matches a real binder (E11 — uncategorized is not surfaced)', () => {
    const cards = [makeCard({ importId: 'imp-1' }), makeCard({ importId: 'imp-1' })];
    const result = summarizeImportRouting(new Set(['imp-1']), cards, []);
    expect(result.entries).toEqual([]);
    expect(result.totalRouted).toBe(0);
  });

  it('omits the uncategorized remainder even when some cards do match a binder', () => {
    const priceyBinder = makeBinder({ id: 'pricey', name: 'Pricey', filter: { priceMin: 5 } });
    const matched = makeCard({ importId: 'imp-1', purchasePrice: 10 });
    const fellThrough = makeCard({ importId: 'imp-1', purchasePrice: 1 });

    const result = summarizeImportRouting(
      new Set(['imp-1']),
      [matched, fellThrough],
      [priceyBinder]
    );
    expect(result.entries.map((e) => e.binderName)).toEqual(['Pricey']);
    expect(result.entries.every((e) => typeof e.binderId === 'string')).toBe(true);
    expect(result.totalRouted).toBe(1);
  });
});
