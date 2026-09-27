import { describe, it, expect } from 'vitest';
import type { SetMap } from '@spellcontrol/binder-routing';
import { formatBinderPages, summarizeImportRouting } from './import-routing';
import { materializeBinders } from './materialize';
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
    expect(result.unroutedCount).toBe(0);
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

    // The uncategorized card (importedUncat) is never an ENTRY (it has no binder
    // to open) but it is counted, so the panel can tell the user it escaped.
    expect(result.totalRouted).toBe(2);
    expect(result.unroutedCount).toBe(1);
    const byBinder = Object.fromEntries(result.entries.map((e) => [e.binderName, e.count]));
    expect(byBinder).toEqual({ Expensive: 1, Rares: 1 });
  });

  it('ignores cards from imports not in the importIds set', () => {
    const binder = makeBinder({ filter: { priceMin: 5 } });
    const inScope = makeCard({ importId: 'imp-1', purchasePrice: 10 });
    const outOfScope = makeCard({ importId: 'imp-other', purchasePrice: 10 });

    const result = summarizeImportRouting(new Set(['imp-1']), [inScope, outOfScope], [binder]);

    expect(result.totalRouted).toBe(1);
    // outOfScope matched the binder, so it is not unrouted either — it is simply
    // not part of this import and must not appear in any bucket.
    expect(result.unroutedCount).toBe(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].count).toBe(1);
  });

  it('sorts binder entries by count desc and keeps the remainder out of entries', () => {
    const a = makeBinder({ id: 'a', name: 'Alpha', position: 0, filter: { priceMin: 100 } });
    const b = makeBinder({ id: 'b', name: 'Bravo', position: 1, filter: { priceMin: 5 } });

    const cards: EnrichedCard[] = [
      // 1 card routes to Alpha (price 200)
      makeCard({ importId: 'imp-1', purchasePrice: 200 }),
      // 3 cards route to Bravo (price 10 each)
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      makeCard({ importId: 'imp-1', purchasePrice: 10 }),
      // 2 cards uncategorized (price 1 each): counted, never an entry
      makeCard({ importId: 'imp-1', purchasePrice: 1 }),
      makeCard({ importId: 'imp-1', purchasePrice: 1 }),
    ];

    const result = summarizeImportRouting(new Set(['imp-1']), cards, [a, b]);
    expect(result.entries.map((e) => e.binderName)).toEqual(['Bravo', 'Alpha']);
    expect(result.entries.map((e) => e.count)).toEqual([3, 1]);
    // The 2 uncategorized cards are excluded from the routed total and reported
    // separately (E296) — the count the user acts on to write a missing rule.
    expect(result.totalRouted).toBe(4);
    expect(result.unroutedCount).toBe(2);
  });

  it('omits binders that received no cards from the import', () => {
    const a = makeBinder({ id: 'a', name: 'Alpha', filter: { priceMin: 5 } });
    const b = makeBinder({ id: 'b', name: 'Bravo', filter: { priceMin: 100 } });
    const card = makeCard({ importId: 'imp-1', purchasePrice: 10 });

    const result = summarizeImportRouting(new Set(['imp-1']), [card], [a, b]);
    expect(result.entries.map((e) => e.binderName)).toEqual(['Alpha']);
  });

  it('reports every card as unrouted when there are no binders at all', () => {
    const cards = [makeCard({ importId: 'imp-1' }), makeCard({ importId: 'imp-1' })];
    const result = summarizeImportRouting(new Set(['imp-1']), cards, []);
    expect(result.entries).toEqual([]);
    expect(result.totalRouted).toBe(0);
    // Before E296 this case rendered nothing at all: a user with no binders
    // imported 500 cards and the panel simply had no routing story to tell.
    expect(result.unroutedCount).toBe(2);
  });

  it('keeps the remainder out of entries while counting it, when some cards match', () => {
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
    expect(result.unroutedCount).toBe(1);
  });

  describe('page numbers (E457)', () => {
    it('agrees with a direct materializeBinders call — the same layout BinderPage renders', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        sorts: [{ field: 'name', dir: 'asc' }],
      });
      // 9 filler cards fill page 1 exactly (default pocket size); the imported
      // card sorts after all of them by name, landing alone on page 2.
      const filler = Array.from({ length: 9 }, (_, i) => makeCard({ name: `Filler ${i}` }));
      const imported = makeCard({ importId: 'imp-1', name: 'Zzzz Imported' });
      const cards = [...filler, imported];

      const result = summarizeImportRouting(new Set(['imp-1']), cards, [binder]);

      const direct = materializeBinders(cards, [binder], { search: '' });
      const directBinder = direct.binders.find((mb) => mb.def.id === 'b')!;
      const expectedPages = new Set<number>();
      for (const section of directBinder.sections) {
        for (const page of section.pages) {
          for (const c of page.slots) {
            if (c?.importId === 'imp-1') expectedPages.add(page.pageNum);
          }
        }
      }
      expect(result.entries[0].pages).toEqual([...expectedPages].sort((a, b) => a - b));
      expect(result.entries[0].pages).toEqual([2]);
    });

    it('a hideDeckAllocated:false binder swallows an allocated copy only when allocatedCopyIds is passed', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        hideDeckAllocated: false,
      });
      const allocated = makeCard({ importId: 'imp-1', copyId: 'allocated-copy' });
      const owned = makeCard({ importId: 'imp-1', copyId: 'owned-copy' });
      const cards = [allocated, owned];

      // Without allocatedCopyIds, both cards route normally — this would
      // DISAGREE with BinderPage, which always passes its live allocation map.
      const withoutOpt = summarizeImportRouting(new Set(['imp-1']), cards, [binder]);
      expect(withoutOpt.entries[0].count).toBe(2);

      // With it, the allocated copy is swallowed (routed nowhere), matching
      // what BinderPage actually shows.
      const withOpt = summarizeImportRouting(new Set(['imp-1']), cards, [binder], {
        allocatedCopyIds: new Set(['allocated-copy']),
      });
      expect(withOpt.entries[0].count).toBe(1);
    });

    it('a setReleaseDate-sorted binder pages differently once setMap resolves each printing’s date', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        sorts: [{ field: 'setReleaseDate', dir: 'asc' }],
      });
      // 9 filler cards from an OLD-looking set name fill one page; the import
      // is a lone card from a differently-named set.
      const filler = Array.from({ length: 9 }, (_, i) =>
        makeCard({ name: `Filler ${i}`, setCode: 'AAA', setName: 'AAA Set' })
      );
      const imported = makeCard({
        importId: 'imp-1',
        name: 'Imported',
        setCode: 'ZZZ',
        setName: 'ZZZ Set',
      });
      const cards = [...filler, imported];

      // No setMap: both sets are release-date UNKNOWN, so sections tie and
      // fall back to alphabetical — AAA's full page goes first, ZZZ (the
      // import) lands alone on page 2.
      const noSetMap = summarizeImportRouting(new Set(['imp-1']), cards, [binder]);
      expect(noSetMap.entries[0].pages).toEqual([2]);

      // With setMap giving ZZZ a much earlier real release date than AAA, the
      // chronological sort reorders the sections: ZZZ (the import) now leads,
      // landing alone on page 1 instead.
      const setMap: SetMap = {
        AAA: { code: 'AAA', name: 'AAA Set', iconSvgUri: '', releasedAt: '2020-01-01' },
        ZZZ: { code: 'ZZZ', name: 'ZZZ Set', iconSvgUri: '', releasedAt: '2000-01-01' },
      };
      const withSetMap = summarizeImportRouting(new Set(['imp-1']), cards, [binder], { setMap });
      expect(withSetMap.entries[0].pages).toEqual([1]);

      // And this agrees with calling materializeBinders directly the same way
      // BinderPage does, with the same setMap.
      const direct = materializeBinders(cards, [binder], { search: '', setMap });
      const directBinder = direct.binders.find((mb) => mb.def.id === 'b')!;
      const directPages = new Set<number>();
      for (const section of directBinder.sections) {
        for (const page of section.pages) {
          for (const c of page.slots) {
            if (c?.importId === 'imp-1') directPages.add(page.pageNum);
          }
        }
      }
      expect(withSetMap.entries[0].pages).toEqual([...directPages]);
    });

    it("reports the binder's default (group-printings off) page layout, not the grouped one", () => {
      // BinderPage's "group printings" toggle collapses duplicate printings
      // before materializing, which changes page numbers — but it defaults to
      // OFF and isn't observable from here, so the summary always answers for
      // the OFF state (the layout the binder actually opens in).
      const binder = makeBinder({ id: 'b', name: 'Binder', filter: {} });
      const dupe1 = makeCard({ importId: 'imp-1', scryfallId: 'dupe', finish: 'nonfoil' });
      const dupe2 = makeCard({ importId: 'imp-1', scryfallId: 'dupe', finish: 'nonfoil' });
      const cards = [dupe1, dupe2];

      const result = summarizeImportRouting(new Set(['imp-1']), cards, [binder]);
      // Ungrouped: both copies occupy their own pocket on page 1.
      expect(result.entries[0].count).toBe(2);
      expect(result.entries[0].pages).toEqual([1]);
    });
  });
});

describe('formatBinderPages', () => {
  it('formats a single page', () => {
    expect(formatBinderPages([3])).toBe('p. 3');
  });

  it('formats a few non-adjacent pages', () => {
    expect(formatBinderPages([7, 3])).toBe('pp. 3, 7');
  });

  it('collapses a run of adjacent pages into a range', () => {
    expect(formatBinderPages([3, 4, 5])).toBe('pp. 3-5');
  });

  it('mixes a range with loose pages', () => {
    expect(formatBinderPages([1, 2, 3, 9])).toBe('pp. 1-3, 9');
  });

  it('dedupes and sorts before formatting', () => {
    expect(formatBinderPages([5, 3, 5, 3])).toBe('pp. 3, 5');
  });

  it('returns empty string for an empty list', () => {
    expect(formatBinderPages([])).toBe('');
  });
});
