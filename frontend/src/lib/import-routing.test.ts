import { describe, it, expect } from 'vitest';
import type { SetMap } from '@spellcontrol/binder-routing';
import { formatBinderPages, summarizeImportRouting } from './import-routing';
import { materializeBinders } from './materialize';
import type { BinderLayoutInputs } from './use-binder-layout-inputs';
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

/** A `useBinderLayoutInputs()` result, for a test that doesn't render a
 *  component. Defaults to no allocations / no set map, like a fresh session. */
function makeLayout(
  cards: EnrichedCard[],
  binders: BinderDef[],
  overrides: Partial<Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'>> = {}
): BinderLayoutInputs {
  return {
    cards,
    binders,
    allocatedCopyIds: new Set(),
    setMap: undefined,
    ...overrides,
  };
}

/** Walks a materializeBinders() result the way `summarizeImportRouting` does,
 *  for cross-checking a summary against the real layout directly. */
function importIdLocations(
  binder: ReturnType<typeof materializeBinders>['binders'][number],
  importId: string
): { count: number; pages: number[] } {
  let count = 0;
  const pages = new Set<number>();
  for (const section of binder.sections) {
    for (const page of section.pages) {
      for (const c of page.slots) {
        if (c?.importId === importId) {
          count++;
          pages.add(page.pageNum);
        }
      }
    }
  }
  return { count, pages: [...pages].sort((a, b) => a - b) };
}

describe('summarizeImportRouting', () => {
  it('returns empty summary when no importIds are given', () => {
    const result = summarizeImportRouting(new Set(), makeLayout([makeCard()], []));
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

    const result = summarizeImportRouting(
      new Set(['imp-1']),
      makeLayout(cards, [expensiveBinder, rareBinder])
    );

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

    const result = summarizeImportRouting(
      new Set(['imp-1']),
      makeLayout([inScope, outOfScope], [binder])
    );

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

    const result = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, [a, b]));
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

    const result = summarizeImportRouting(new Set(['imp-1']), makeLayout([card], [a, b]));
    expect(result.entries.map((e) => e.binderName)).toEqual(['Alpha']);
  });

  it('reports every card as unrouted when there are no binders at all', () => {
    const cards = [makeCard({ importId: 'imp-1' }), makeCard({ importId: 'imp-1' })];
    const result = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, []));
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
      makeLayout([matched, fellThrough], [priceyBinder])
    );
    expect(result.entries.map((e) => e.binderName)).toEqual(['Pricey']);
    expect(result.entries.every((e) => typeof e.binderId === 'string')).toBe(true);
    expect(result.totalRouted).toBe(1);
    expect(result.unroutedCount).toBe(1);
  });

  describe('agrees with BinderPage (E457 guard — one shared layout, not three ad hoc subsets)', () => {
    it('a tag-rule binder claims the card once it carries .tags — the exact bug an undecorated caller had', () => {
      const tagBinder = makeBinder({
        id: 'tags',
        name: 'Mana Rocks',
        filter: { oracleTagChips: { chips: [{ value: 'mana-rock', negate: false }], joiners: [] } },
      });
      const tagged = makeCard({ importId: 'imp-1', tags: ['mana-rock'] });
      const untagged = makeCard({ importId: 'imp-1', tags: [] });
      const cards = [tagged, untagged];

      const result = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, [tagBinder]));

      const direct = materializeBinders(cards, [tagBinder], { search: '' });
      const expected = importIdLocations(
        direct.binders.find((mb) => mb.def.id === 'tags')!,
        'imp-1'
      );
      expect(result.entries.find((e) => e.binderId === 'tags')?.count).toBe(expected.count);
      expect(expected.count).toBe(1); // sanity: only the tagged card matched
      expect(result.unroutedCount).toBe(1); // the untagged card fell through
    });

    it('a release-date-sorted binder pages the import identically to a direct materializeBinders call', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        sorts: [{ field: 'setReleaseDate', dir: 'asc' }],
      });
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
      const setMap: SetMap = {
        AAA: { code: 'AAA', name: 'AAA Set', iconSvgUri: '', releasedAt: '2020-01-01' },
        ZZZ: { code: 'ZZZ', name: 'ZZZ Set', iconSvgUri: '', releasedAt: '2000-01-01' },
      };

      const result = summarizeImportRouting(
        new Set(['imp-1']),
        makeLayout(cards, [binder], { setMap })
      );
      const direct = materializeBinders(cards, [binder], { search: '', setMap });
      const expected = importIdLocations(
        direct.binders.find((mb) => mb.def.id === 'b')!,
        'imp-1'
      );
      expect(result.entries[0].pages).toEqual(expected.pages);
      // Sanity: the earlier real release date (ZZZ, 2000) actually moved the
      // import to lead the binder, landing it on page 1 rather than page 2.
      expect(expected.pages).toEqual([1]);
    });

    it('without setMap the same binder still agrees with materializeBinders (both fall back to unknown-dated, alphabetical order)', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        sorts: [{ field: 'setReleaseDate', dir: 'asc' }],
      });
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

      const result = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, [binder]));
      const direct = materializeBinders(cards, [binder], { search: '' });
      const expected = importIdLocations(
        direct.binders.find((mb) => mb.def.id === 'b')!,
        'imp-1'
      );
      expect(result.entries[0].pages).toEqual(expected.pages);
      expect(expected.pages).toEqual([2]);
    });

    it('a hideDeckAllocated:false binder swallows an allocated copy — agrees with materializeBinders either way', () => {
      const binder = makeBinder({
        id: 'b',
        name: 'Binder',
        filter: {},
        hideDeckAllocated: false,
      });
      const allocated = makeCard({ importId: 'imp-1', copyId: 'allocated-copy' });
      const owned = makeCard({ importId: 'imp-1', copyId: 'owned-copy' });
      const cards = [allocated, owned];

      // Without allocatedCopyIds (a caller that can't source the allocation
      // map), the summary and a same-inputs materializeBinders call still
      // agree — just both wrongly include the allocated copy, since neither
      // was told about it. This is the case that no longer happens: every
      // caller now reads the shared hook, which always supplies it.
      const withoutAlloc = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, [binder]));
      const directWithout = materializeBinders(cards, [binder], { search: '' });
      expect(withoutAlloc.entries[0].count).toBe(
        importIdLocations(directWithout.binders[0], 'imp-1').count
      );
      expect(withoutAlloc.entries[0].count).toBe(2);

      // With it (what every real caller now does via useBinderLayoutInputs),
      // the allocated copy is swallowed — matching BinderPage.
      const allocatedCopyIds = new Set(['allocated-copy']);
      const withAlloc = summarizeImportRouting(
        new Set(['imp-1']),
        makeLayout(cards, [binder], { allocatedCopyIds })
      );
      const directWith = materializeBinders(cards, [binder], { search: '', allocatedCopyIds });
      expect(withAlloc.entries[0].count).toBe(
        importIdLocations(directWith.binders[0], 'imp-1').count
      );
      expect(withAlloc.entries[0].count).toBe(1);
    });
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

    const result = summarizeImportRouting(new Set(['imp-1']), makeLayout(cards, [binder]));
    // Ungrouped: both copies occupy their own pocket on page 1.
    expect(result.entries[0].count).toBe(2);
    expect(result.entries[0].pages).toEqual([1]);
  });
});

describe('formatBinderPages', () => {
  it('formats a single page', () => {
    expect(formatBinderPages([3])).toBe('p. 3');
  });

  it('formats a few non-adjacent pages', () => {
    expect(formatBinderPages([7, 3])).toBe('pp. 3, 7');
  });

  it('collapses a run of adjacent pages into a range with an en dash', () => {
    expect(formatBinderPages([3, 4, 5])).toBe('pp. 3–5');
  });

  it('mixes a range with loose pages', () => {
    expect(formatBinderPages([1, 2, 3, 9])).toBe('pp. 1–3, 9');
  });

  it('dedupes and sorts before formatting', () => {
    expect(formatBinderPages([5, 3, 5, 3])).toBe('pp. 3, 5');
  });

  it('returns empty string for an empty list', () => {
    expect(formatBinderPages([])).toBe('');
  });
});
