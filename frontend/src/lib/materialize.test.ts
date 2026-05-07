import { describe, it, expect } from 'vitest';
import { materializeBinders } from './materialize';
import type { EnrichedCard, BinderDef, BinderFilter, BinderFilterGroup } from '../types';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
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
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    ...overrides,
  };
}

/**
 * Test helper: accepts either `filter` (legacy single-filter shorthand, wrapped
 * into a one-element `filterGroups`) or `filterGroups` directly.
 */
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
    sorts: ['color', 'cmc', 'name'],
    pocketSize: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...rest,
  };
}

const defaultOpts = { globalPocketSize: 9 as const, search: '' };

describe('materializeBinders', () => {
  it('puts all cards in uncategorized when no binders are defined', () => {
    const cards = [makeCard(), makeCard()];
    const { binders, uncategorized } = materializeBinders(cards, [], defaultOpts);
    expect(binders).toHaveLength(0);
    expect(uncategorized.totalCards).toBe(2);
  });

  it('routes cards matching a binder rule into that binder', () => {
    const rareCard = makeCard({ rarity: 'rare' });
    const commonCard = makeCard({ rarity: 'common' });
    const binder = makeBinder({
      filter: { rarities: [{ value: 'rare', negate: false }] },
      position: 0,
    });

    const { binders, uncategorized } = materializeBinders(
      [rareCard, commonCard],
      [binder],
      defaultOpts
    );
    expect(binders[0].totalCards).toBe(1);
    expect(uncategorized.totalCards).toBe(1);
  });

  it('routes card to the first matching binder (priority order)', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 10 });
    const highValueBinder = makeBinder({ id: 'high', position: 0, filter: { priceMin: 5 } });
    const rareBinder = makeBinder({
      id: 'rare',
      position: 1,
      filter: { rarities: [{ value: 'rare', negate: false }] },
    });

    const { binders } = materializeBinders([card], [highValueBinder, rareBinder], defaultOpts);
    const highBinder = binders.find((b) => b.def.id === 'high')!;
    const rarB = binders.find((b) => b.def.id === 'rare')!;
    expect(highBinder.totalCards).toBe(1);
    expect(rarB.totalCards).toBe(0);
  });

  it('respects binder position order regardless of array order', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 10 });
    const rareBinder = makeBinder({
      id: 'rare',
      position: 0,
      filter: { rarities: [{ value: 'rare', negate: false }] },
    });
    const highValueBinder = makeBinder({ id: 'high', position: 1, filter: { priceMin: 5 } });

    // Pass binders in reverse position order
    const { binders } = materializeBinders([card], [highValueBinder, rareBinder], defaultOpts);
    const rarB = binders.find((b) => b.def.id === 'rare')!;
    const highB = binders.find((b) => b.def.id === 'high')!;
    expect(rarB.totalCards).toBe(1);
    expect(highB.totalCards).toBe(0);
  });

  it('places cards in uncategorized when they match no binder', () => {
    const card = makeCard({ rarity: 'common' });
    const binder = makeBinder({ filter: { rarities: [{ value: 'rare', negate: false }] } });

    const { uncategorized } = materializeBinders([card], [binder], defaultOpts);
    expect(uncategorized.totalCards).toBe(1);
  });

  it('groups cards into pages using the pocket size', () => {
    // 10 cards into a 9-pocket binder = 2 pages (9 + 1)
    const cards = Array.from({ length: 10 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({ filter: {}, sorts: ['none'] });

    const { binders } = materializeBinders(cards, [binder], {
      ...defaultOpts,
      globalPocketSize: 9,
    });
    const totalPages = binders[0].sections.reduce((s, sec) => s + sec.pages.length, 0);
    expect(totalPages).toBe(2);
  });

  it('uses binder pocketSize when set instead of globalPocketSize', () => {
    const cards = Array.from({ length: 5 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({ filter: {}, sorts: ['none'], pocketSize: 4 });

    const { binders } = materializeBinders(cards, [binder], {
      ...defaultOpts,
      globalPocketSize: 9,
    });
    expect(binders[0].effectivePocketSize).toBe(4);
    const totalPages = binders[0].sections.reduce((s, sec) => s + sec.pages.length, 0);
    expect(totalPages).toBe(2); // 4+1
  });

  describe('search filtering', () => {
    it('filters cards by name search — non-matching slots become null, page is kept', () => {
      const bolt = makeCard({ name: 'Lightning Bolt', colorIdentity: [], typeLine: 'Instant' });
      const ring = makeCard({ name: 'Sol Ring', colorIdentity: [], typeLine: 'Artifact' });
      const binder = makeBinder({ filter: {}, sorts: ['none'] });

      const { binders } = materializeBinders([bolt, ring], [binder], {
        ...defaultOpts,
        search: 'bolt',
      });
      const section = binders[0].sections[0];
      expect(section.cards).toHaveLength(1);
      expect(section.cards[0].name).toBe('Lightning Bolt');
    });

    it('drops pages with zero search matches', () => {
      // 10 cards, only one matches — the non-matching page should be dropped
      const matching = makeCard({ name: 'Lightning Bolt', colorIdentity: [] });
      const nonMatching = Array.from({ length: 9 }, () =>
        makeCard({ name: 'Sol Ring', colorIdentity: [] })
      );
      const binder = makeBinder({ filter: {}, sorts: ['none'] });

      const { binders } = materializeBinders([matching, ...nonMatching], [binder], {
        ...defaultOpts,
        search: 'bolt',
      });
      const pages = binders[0].sections.flatMap((s) => s.pages);
      expect(pages).toHaveLength(1);
    });

    it('preserves original page number when filtering', () => {
      // Put matching card on page 2 (index 9 in a 9-pocket binder)
      const filler = Array.from({ length: 9 }, () =>
        makeCard({ name: 'Filler', colorIdentity: [] })
      );
      const target = makeCard({ name: 'Target Card', colorIdentity: [] });
      const binder = makeBinder({ filter: {}, sorts: ['none'] });

      const { binders } = materializeBinders([...filler, target], [binder], {
        ...defaultOpts,
        search: 'target',
      });
      const pages = binders[0].sections.flatMap((s) => s.pages);
      expect(pages).toHaveLength(1);
      expect(pages[0].pageNum).toBe(2);
    });
  });

  it('groups by color when primary sort is "color"', () => {
    const redCard = makeCard({ name: 'Red', colorIdentity: ['R'], typeLine: 'Instant', cmc: 1 });
    const blueCard = makeCard({ name: 'Blue', colorIdentity: ['U'], typeLine: 'Instant', cmc: 1 });
    const binder = makeBinder({ filter: {}, sorts: ['color'] });

    const { binders } = materializeBinders([redCard, blueCard], [binder], defaultOpts);
    const keys = binders[0].sections.map((s) => s.key);
    expect(keys).toContain('U');
    expect(keys).toContain('R');
    expect(keys.indexOf('U')).toBeLessThan(keys.indexOf('R'));
  });

  it('groups by type when primary sort is "type"', () => {
    const cards = [
      makeCard({ name: 'Bolt', typeLine: 'Instant', colorIdentity: ['R'] }),
      makeCard({ name: 'Bear', typeLine: 'Creature — Bear', colorIdentity: ['G'] }),
    ];
    const binder = makeBinder({ filter: {}, sorts: ['type'] });

    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    const keys = binders[0].sections.map((s) => s.key);
    expect(keys).toEqual(['creature', 'instant']);
    expect(binders[0].sections[0].label).toBe('Creature');
  });

  it('groups by cmc when primary sort is "cmc"', () => {
    const cards = [
      makeCard({ name: 'Three', cmc: 3, typeLine: 'Instant' }),
      makeCard({ name: 'One', cmc: 1, typeLine: 'Instant' }),
      makeCard({ name: 'Big', cmc: 9, typeLine: 'Sorcery' }),
    ];
    const binder = makeBinder({ filter: {}, sorts: ['cmc'] });

    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].sections.map((s) => s.key)).toEqual(['cmc-1', 'cmc-3', 'cmc-7+']);
    expect(binders[0].sections[2].label).toBe('CMC 7+');
  });

  it('produces one "ALL" section when primary sort is "none"', () => {
    const cards = [makeCard({ colorIdentity: ['R'] }), makeCard({ colorIdentity: ['U'] })];
    const binder = makeBinder({ filter: {}, sorts: ['none'] });

    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].sections).toHaveLength(1);
    expect(binders[0].sections[0].key).toBe('ALL');
    expect(binders[0].sections[0].label).toBe('All cards');
  });

  describe('OR-groups (filterGroups)', () => {
    it('matches a card if it satisfies ANY group', () => {
      // Group A: commons/uncommons priced ≥ $0.70
      // Group B: top-100 EDH regardless of price
      const cheapCommon = makeCard({ rarity: 'common', purchasePrice: 0.05 }); // matches neither
      const dollarUncommon = makeCard({ rarity: 'uncommon', purchasePrice: 1.5 }); // matches A
      const popularRare = makeCard({ rarity: 'rare', purchasePrice: 0.1, edhrecRank: 42 }); // matches B
      const both = makeCard({ rarity: 'common', purchasePrice: 5, edhrecRank: 50 }); // matches A and B

      const binder = makeBinder({
        sorts: ['none'],
        filterGroups: [
          {
            name: 'Commons over $0.70',
            filter: {
              rarities: [
                { value: 'common', negate: false },
                { value: 'uncommon', negate: false },
              ],
              priceMin: 0.7,
            },
          },
          {
            name: 'Top 100 EDH',
            filter: { edhrecRankMax: 100 },
          },
        ],
      });

      const { binders, uncategorized } = materializeBinders(
        [cheapCommon, dollarUncommon, popularRare, both],
        [binder],
        defaultOpts
      );
      // Three cards match at least one group; deduplicated.
      expect(binders[0].totalCards).toBe(3);
      expect(uncategorized.totalCards).toBe(1);
    });

    it('a single empty group still matches every card', () => {
      const binder = makeBinder({
        sorts: ['none'],
        filterGroups: [{ filter: {} }],
      });
      const { binders } = materializeBinders([makeCard(), makeCard()], [binder], defaultOpts);
      expect(binders[0].totalCards).toBe(2);
    });
  });
});
