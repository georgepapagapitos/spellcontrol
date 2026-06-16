import { describe, it, expect } from 'vitest';
import { materializeBinders } from './materialize.js';
import type { EnrichedCard, BinderDef, BinderFilter, BinderFilterGroup } from './types.js';

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
    sorts: [
      { field: 'color', dir: 'asc' },
      { field: 'cmc', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
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
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
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
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
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
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
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
    const binder = makeBinder({
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });

    const { uncategorized } = materializeBinders([card], [binder], defaultOpts);
    expect(uncategorized.totalCards).toBe(1);
  });

  it('groups cards into pages using the pocket size', () => {
    // 10 cards into a 9-pocket binder = 2 pages (9 + 1)
    const cards = Array.from({ length: 10 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({ filter: {}, sorts: [{ field: 'none', dir: 'asc' }] });

    const { binders } = materializeBinders(cards, [binder], {
      ...defaultOpts,
      globalPocketSize: 9,
    });
    const totalPages = binders[0].sections.reduce((s, sec) => s + sec.pages.length, 0);
    expect(totalPages).toBe(2);
  });

  it('uses binder pocketSize when set instead of globalPocketSize', () => {
    const cards = Array.from({ length: 5 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({
      filter: {},
      sorts: [{ field: 'none', dir: 'asc' }],
      pocketSize: 4,
    });

    const { binders } = materializeBinders(cards, [binder], {
      ...defaultOpts,
      globalPocketSize: 9,
    });
    expect(binders[0].effectivePocketSize).toBe(4);
    const totalPages = binders[0].sections.reduce((s, sec) => s + sec.pages.length, 0);
    expect(totalPages).toBe(2); // 4+1
  });

  it('chunks into pages of 12 for 12-pocket binders', () => {
    const cards = Array.from({ length: 25 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({
      filter: {},
      sorts: [{ field: 'none', dir: 'asc' }],
      pocketSize: 12,
    });
    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].effectivePocketSize).toBe(12);
    expect(binders[0].totalPages).toBe(3); // ceil(25 / 12)
  });

  it('treats double-sided sheets as twice as many pages', () => {
    // 9-pocket double-sided binder: each sheet has 2 pages (front + back).
    // For chunking purposes that means cards still divide by pocketSize (9),
    // but one sheet of "real" capacity = 18 cards.
    const cards = Array.from({ length: 50 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({
      filter: {},
      sorts: [{ field: 'none', dir: 'asc' }],
      pocketSize: 9,
      doubleSided: true,
    });
    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].effectivePocketSize).toBe(9);
    expect(binders[0].totalPages).toBe(6); // ceil(50 / 9)
    expect(binders[0].sections[0].pages[0].slots).toHaveLength(9);
  });

  describe('search filtering', () => {
    it('filters cards by name search — non-matching slots become null, page is kept', () => {
      const bolt = makeCard({ name: 'Lightning Bolt', colorIdentity: [], typeLine: 'Instant' });
      const ring = makeCard({ name: 'Sol Ring', colorIdentity: [], typeLine: 'Artifact' });
      const binder = makeBinder({ filter: {}, sorts: [{ field: 'none', dir: 'asc' }] });

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
      const binder = makeBinder({ filter: {}, sorts: [{ field: 'none', dir: 'asc' }] });

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
      const binder = makeBinder({ filter: {}, sorts: [{ field: 'none', dir: 'asc' }] });

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
    const binder = makeBinder({ filter: {}, sorts: [{ field: 'color', dir: 'asc' }] });

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
    const binder = makeBinder({ filter: {}, sorts: [{ field: 'type', dir: 'asc' }] });

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
    const binder = makeBinder({ filter: {}, sorts: [{ field: 'cmc', dir: 'asc' }] });

    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].sections.map((s) => s.key)).toEqual(['cmc-1', 'cmc-3', 'cmc-7+']);
    expect(binders[0].sections[2].label).toBe('CMC 7+');
  });

  it('produces one "ALL" section when primary sort is "none"', () => {
    const cards = [makeCard({ colorIdentity: ['R'] }), makeCard({ colorIdentity: ['U'] })];
    const binder = makeBinder({ filter: {}, sorts: [{ field: 'none', dir: 'asc' }] });

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
        sorts: [{ field: 'none', dir: 'asc' }],
        filterGroups: [
          {
            name: 'Commons over $0.70',
            filter: {
              rarities: {
                chips: [
                  { value: 'common', negate: false },
                  { value: 'uncommon', negate: false },
                ],
                joiners: ['OR'],
              },
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
        sorts: [{ field: 'none', dir: 'asc' }],
        filterGroups: [{ filter: {} }],
      });
      const { binders } = materializeBinders([makeCard(), makeCard()], [binder], defaultOpts);
      expect(binders[0].totalCards).toBe(2);
    });
  });

  describe('manual mode', () => {
    it('manual binder only shows pinned cards', () => {
      const rareCard = makeCard({ rarity: 'rare', name: 'Pinned Rare' });
      const commonCard = makeCard({ rarity: 'rare', name: 'Unpinned Rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        mode: 'manual',
        pinnedCopyIds: [rareCard.copyId],
      });
      const { binders, uncategorized } = materializeBinders(
        [rareCard, commonCard],
        [binder],
        defaultOpts
      );
      expect(binders[0].totalCards).toBe(1);
      expect(uncategorized.totalCards).toBe(1);
    });

    it('manual binder does not steal rule matches from downstream binders', () => {
      const card = makeCard({ rarity: 'rare' });
      const manualBinder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        mode: 'manual',
        position: 0,
      });
      const rulesBinder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        position: 1,
      });
      const { binders } = materializeBinders([card], [manualBinder, rulesBinder], defaultOpts);
      expect(binders[0].totalCards).toBe(0);
      expect(binders[1].totalCards).toBe(1);
    });

    it('excludedCopyIds still apply in manual mode', () => {
      const card = makeCard({ name: 'Excluded Pin' });
      const binder = makeBinder({
        mode: 'manual',
        pinnedCopyIds: [card.copyId],
        excludedCopyIds: [card.copyId],
      });
      const { binders, uncategorized } = materializeBinders([card], [binder], defaultOpts);
      expect(binders[0].totalCards).toBe(0);
      expect(uncategorized.totalCards).toBe(0);
    });

    it('switching back to rules restores normal routing', () => {
      const card = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        mode: 'rules',
      });
      const { binders } = materializeBinders([card], [binder], defaultOpts);
      expect(binders[0].totalCards).toBe(1);
    });

    it('undefined mode defaults to rules behavior', () => {
      const card = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      });
      expect(binder.mode).toBeUndefined();
      const { binders } = materializeBinders([card], [binder], defaultOpts);
      expect(binders[0].totalCards).toBe(1);
    });
  });

  describe('hideDeckAllocated', () => {
    it('keeps allocated cards visible when hideDeckAllocated is undefined (default)', () => {
      const card = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      });
      const { binders, uncategorized } = materializeBinders([card], [binder], {
        ...defaultOpts,
        allocatedCopyIds: new Set([card.copyId]),
      });
      expect(binders[0].totalCards).toBe(1);
      expect(uncategorized.totalCards).toBe(0);
    });

    it('drops allocated rule-matched cards entirely when hideDeckAllocated is false', () => {
      const card = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        hideDeckAllocated: false,
      });
      const { binders, uncategorized } = materializeBinders([card], [binder], {
        ...defaultOpts,
        allocatedCopyIds: new Set([card.copyId]),
      });
      expect(binders[0].totalCards).toBe(0);
      expect(uncategorized.totalCards).toBe(0);
    });

    it('drops allocated pinned cards but preserves pin metadata', () => {
      const card = makeCard({ rarity: 'common' });
      const binder = makeBinder({
        filter: {},
        mode: 'manual',
        pinnedCopyIds: [card.copyId],
        hideDeckAllocated: false,
      });
      const { binders, uncategorized } = materializeBinders([card], [binder], {
        ...defaultOpts,
        allocatedCopyIds: new Set([card.copyId]),
      });
      expect(binders[0].totalCards).toBe(0);
      expect(uncategorized.totalCards).toBe(0);
      expect(binders[0].def.pinnedCopyIds).toEqual([card.copyId]);
    });

    it('allocated card returns once un-allocated', () => {
      const card = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        hideDeckAllocated: false,
      });
      const { binders } = materializeBinders([card], [binder], {
        ...defaultOpts,
        allocatedCopyIds: new Set(),
      });
      expect(binders[0].totalCards).toBe(1);
    });

    it('hide-mode binder swallows the card even if a later binder would match', () => {
      const card = makeCard({ rarity: 'rare' });
      const hideBinder = makeBinder({
        id: 'hide',
        position: 0,
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        hideDeckAllocated: false,
      });
      const fallback = makeBinder({
        id: 'fallback',
        position: 1,
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      });
      const { binders, uncategorized } = materializeBinders([card], [hideBinder, fallback], {
        ...defaultOpts,
        allocatedCopyIds: new Set([card.copyId]),
      });
      expect(binders.find((b) => b.def.id === 'hide')!.totalCards).toBe(0);
      expect(binders.find((b) => b.def.id === 'fallback')!.totalCards).toBe(0);
      expect(uncategorized.totalCards).toBe(0);
    });

    it('does not affect non-allocated cards in a hide-mode binder', () => {
      const allocatedCard = makeCard({ rarity: 'rare' });
      const freeCard = makeCard({ rarity: 'rare' });
      const binder = makeBinder({
        filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
        hideDeckAllocated: false,
      });
      const { binders } = materializeBinders([allocatedCard, freeCard], [binder], {
        ...defaultOpts,
        allocatedCopyIds: new Set([allocatedCard.copyId]),
      });
      expect(binders[0].totalCards).toBe(1);
    });
  });
});

describe('keepPrintingsTogether', () => {
  const copyIds = (b: { sections: { cards: EnrichedCard[] }[] }) =>
    b.sections.flatMap((s) => s.cards.map((c) => c.copyId)).sort();

  // A legendary creature owned in two printings: a pricey one and a bulk one.
  const pricey = () =>
    makeCard({
      copyId: 'pricey',
      name: 'Atraxa',
      oracleId: 'atx',
      scryfallId: 'atx-set1',
      purchasePrice: 3,
    });
  const bulk = () =>
    makeCard({
      copyId: 'bulk',
      name: 'Atraxa',
      oracleId: 'atx',
      scryfallId: 'atx-set2',
      purchasePrice: 0.1,
    });

  it('flag off: only the matching printing lands in the binder (unchanged)', () => {
    const binder = makeBinder({ filter: { priceMin: 0.5 } });
    const { binders, uncategorized } = materializeBinders(
      [pricey(), bulk()],
      [binder],
      defaultOpts
    );
    expect(copyIds(binders[0])).toEqual(['pricey']);
    expect(uncategorized.sections.flatMap((s) => s.cards.map((c) => c.copyId))).toEqual(['bulk']);
  });

  it('flag on: a matching printing pulls in all owned copies; none left uncategorized', () => {
    const binder = makeBinder({ filter: { priceMin: 0.5 }, keepPrintingsTogether: true });
    const { binders, uncategorized } = materializeBinders(
      [pricey(), bulk()],
      [binder],
      defaultOpts
    );
    expect(copyIds(binders[0])).toEqual(['bulk', 'pricey']);
    expect(uncategorized.totalCards).toBe(0);
  });

  it('does not steal a copy already routed to an earlier binder (no duplication)', () => {
    const cheapBinder = makeBinder({ id: 'cheap', position: 0, filter: { priceMax: 0.5 } });
    const cmdrBinder = makeBinder({
      id: 'cmdr',
      position: 1,
      filter: { priceMin: 0.5 },
      keepPrintingsTogether: true,
    });
    const { binders } = materializeBinders(
      [pricey(), bulk()],
      [cheapBinder, cmdrBinder],
      defaultOpts
    );
    const byId = Object.fromEntries(binders.map((b) => [b.def.id, copyIds(b)]));
    expect(byId.cheap).toEqual(['bulk']); // bulk stays where it first matched
    expect(byId.cmdr).toEqual(['pricey']); // not promoted — precedence preserved
  });

  it('does not promote copies that lack an oracleId', () => {
    const a = makeCard({ copyId: 'a', name: 'X', purchasePrice: 3 }); // no oracleId
    const b = makeCard({ copyId: 'b', name: 'X', purchasePrice: 0.1 }); // no oracleId
    const binder = makeBinder({ filter: { priceMin: 0.5 }, keepPrintingsTogether: true });
    const { binders, uncategorized } = materializeBinders([a, b], [binder], defaultOpts);
    expect(copyIds(binders[0])).toEqual(['a']);
    expect(uncategorized.sections.flatMap((s) => s.cards.map((c) => c.copyId))).toEqual(['b']);
  });

  it('swallows a promoted copy that is deck-allocated when hideDeckAllocated=false', () => {
    const binder = makeBinder({
      filter: { priceMin: 0.5 },
      keepPrintingsTogether: true,
      hideDeckAllocated: false,
    });
    const { binders, uncategorized } = materializeBinders([pricey(), bulk()], [binder], {
      ...defaultOpts,
      allocatedCopyIds: new Set(['bulk']),
    });
    expect(copyIds(binders[0])).toEqual(['pricey']); // bulk not shown
    expect(uncategorized.totalCards).toBe(0); // bulk swallowed, not dumped to uncategorized
  });

  it('two flagged binders: earlier (by position) reclaims; later does not double-claim', () => {
    const b1 = makeBinder({
      id: 'b1',
      position: 0,
      filter: { priceMin: 0.5 },
      keepPrintingsTogether: true,
    });
    const b2 = makeBinder({
      id: 'b2',
      position: 1,
      filter: { priceMin: 0.5 },
      keepPrintingsTogether: true,
    });
    const { binders } = materializeBinders([pricey(), bulk()], [b1, b2], defaultOpts);
    const byId = Object.fromEntries(binders.map((b) => [b.def.id, copyIds(b)]));
    expect(byId.b1).toEqual(['bulk', 'pricey']);
    expect(byId.b2).toEqual([]);
  });

  it('manual-mode binders do not promote (no rules)', () => {
    const binder = makeBinder({
      mode: 'manual',
      keepPrintingsTogether: true,
      pinnedCopyIds: ['pricey'],
    });
    const { binders, uncategorized } = materializeBinders(
      [pricey(), bulk()],
      [binder],
      defaultOpts
    );
    expect(copyIds(binders[0])).toEqual(['pricey']); // only the pin
    expect(uncategorized.sections.flatMap((s) => s.cards.map((c) => c.copyId))).toEqual(['bulk']);
  });

  it('lists are inert: list associations on cards/opts never change binder membership', () => {
    const rareFilter = {
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    };
    const rareBinder = makeBinder(rareFilter);

    // Baseline: pure rule routing with no list data anywhere.
    const baseline = materializeBinders(
      [makeCard({ rarity: 'rare' }), makeCard({ rarity: 'rare' })],
      [rareBinder],
      defaultOpts
    );
    expect(baseline.binders[0].totalCards).toBe(2);

    // Same two rare cards, but now each carries list-like associations a future
    // list↔card link could plausibly attach, and opts carries list-shaped extra
    // keys. Cast through unknown because none of these fields exist on the public
    // types today — that absence is exactly the contract under guard.
    const linkedRare = makeCard({
      rarity: 'rare',
      ...({ listIds: ['wishlist-1', 'buylist-2'], listEntryId: 'entry-9' } as object),
    } as Partial<EnrichedCard>);
    const unlinkedRare = makeCard({ rarity: 'rare' });
    const optsWithListData = {
      ...defaultOpts,
      ...({
        lists: [
          {
            id: 'wishlist-1',
            name: 'Wants',
            entries: [{ id: 'entry-9', name: linkedRare.name, scryfallId: linkedRare.scryfallId }],
          },
        ],
      } as object),
    } as typeof defaultOpts;

    const withListData = materializeBinders(
      [linkedRare, unlinkedRare],
      [rareBinder],
      optsWithListData
    );

    // Membership is identical to the baseline: both rares are still routed purely
    // by the rarity rule. The list link on a card and the list payload in opts
    // changed nothing — neither suppressed nor re-routed a card.
    expect(withListData.binders[0].totalCards).toBe(baseline.binders[0].totalCards);
    expect(withListData.binders[0].totalCards).toBe(2);
    expect(withListData.uncategorized.totalCards).toBe(0);
  });
});

describe('pageBreakDepth', () => {
  const allSectionPageNums = (b: { sections: { pages: { pageNum: number }[] }[] }) =>
    b.sections.flatMap((sec) => sec.pages.map((p) => p.pageNum));
  const totalPagesOf = (b: { sections: { pages: unknown[] }[] }) =>
    b.sections.reduce((s: number, sec) => s + sec.pages.length, 0);

  it('N=1 (default): each primary-sort section starts its own page', () => {
    // 2 red + 2 blue, 9-pocket. depth=1 = existing behavior:
    // each color section starts a fresh page.
    const cards = [
      makeCard({ name: 'R1', colorIdentity: ['R'], cmc: 1, typeLine: 'Instant' }),
      makeCard({ name: 'R2', colorIdentity: ['R'], cmc: 2, typeLine: 'Instant' }),
      makeCard({ name: 'U1', colorIdentity: ['U'], cmc: 1, typeLine: 'Instant' }),
      makeCard({ name: 'U2', colorIdentity: ['U'], cmc: 2, typeLine: 'Instant' }),
    ];
    const binder = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 1,
    });
    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    const result = binders[0];
    // 2 sections (U then R in asc order), each on its own page
    expect(result.sections).toHaveLength(2);
    expect(totalPagesOf(result)).toBe(2);
    expect(result.sections[0].pages[0].pageNum).toBe(1);
    expect(result.sections[1].pages[0].pageNum).toBe(2);
  });

  it('N=1: page numbers run continuously across sections with no gaps', () => {
    // 10 red + 10 blue, 9-pocket.
    // Blue: ceil(10/9)=2 pages (1,2). Red: ceil(10/9)=2 pages (3,4).
    const reds = Array.from({ length: 10 }, (_, i) =>
      makeCard({ name: 'R' + i, colorIdentity: ['R'], cmc: (i % 5) + 1, typeLine: 'Instant' })
    );
    const blues = Array.from({ length: 10 }, (_, i) =>
      makeCard({ name: 'U' + i, colorIdentity: ['U'], cmc: (i % 5) + 1, typeLine: 'Instant' })
    );
    const binder = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 1,
    });
    const { binders } = materializeBinders([...reds, ...blues], [binder], defaultOpts);
    const result = binders[0];
    expect(result.sections).toHaveLength(2);
    // 20 cards: each section 10 cards → 2 pages each → 4 pages total
    expect(totalPagesOf(result)).toBe(4);
    const nums = allSectionPageNums(result).sort((a: number, b: number) => a - b);
    // Contiguous: no gaps between consecutive page numbers
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i] - nums[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('N=2: secondary sort groups each start their own page', () => {
    // 9-pocket. Red CMC-1 = 5 cards, Red CMC-2 = 5 cards.
    // depth=1: 1 section (red), 10 cards → 2 pages packed together.
    // depth=2: 2 sub-sections (CMC-1 and CMC-2), each starting its own page.
    const redCmc1 = Array.from({ length: 5 }, (_, i) =>
      makeCard({ name: 'R1-' + i, colorIdentity: ['R'], cmc: 1, typeLine: 'Instant' })
    );
    const redCmc2 = Array.from({ length: 5 }, (_, i) =>
      makeCard({ name: 'R2-' + i, colorIdentity: ['R'], cmc: 2, typeLine: 'Instant' })
    );
    const binderD2 = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 2,
    });
    const binderD1 = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 1,
    });
    const cards = [...redCmc1, ...redCmc2];
    const { binders: d2 } = materializeBinders(cards, [binderD2], defaultOpts);
    const { binders: d1 } = materializeBinders(cards, [binderD1], defaultOpts);

    // depth=1: 1 red section, 10 cards packed into 2 pages
    expect(d1[0].sections).toHaveLength(1);
    expect(totalPagesOf(d1[0])).toBe(2);
    expect(d1[0].sections[0].pages[0].pageNum).toBe(1);
    expect(d1[0].sections[0].pages[1].pageNum).toBe(2);

    // depth=2: 2 sub-sections (cmc-1 and cmc-2), each starting its own page
    expect(d2[0].sections).toHaveLength(2);
    expect(totalPagesOf(d2[0])).toBe(2);
    expect(d2[0].sections[0].pages[0].pageNum).toBe(1);
    expect(d2[0].sections[1].pages[0].pageNum).toBe(2);
  });

  it('leaf-never-breaks invariant: depth=2 with only 1 sort = same as depth=1', () => {
    // With only 1 sort, there is no secondary to break on — depth=2 behaves like depth=1.
    const cards = [
      makeCard({ name: 'R1', colorIdentity: ['R'], typeLine: 'Instant' }),
      makeCard({ name: 'R2', colorIdentity: ['R'], typeLine: 'Instant' }),
      makeCard({ name: 'U1', colorIdentity: ['U'], typeLine: 'Instant' }),
    ];
    const b1 = makeBinder({
      filter: {},
      sorts: [{ field: 'color', dir: 'asc' }],
      pocketSize: 9,
      pageBreakDepth: 1,
    });
    const b2 = makeBinder({
      filter: {},
      sorts: [{ field: 'color', dir: 'asc' }],
      pocketSize: 9,
      pageBreakDepth: 2,
    });

    const { binders: res1 } = materializeBinders(cards, [b1], defaultOpts);
    const { binders: res2 } = materializeBinders(cards, [b2], defaultOpts);

    expect(res1[0].sections).toHaveLength(res2[0].sections.length);
    expect(totalPagesOf(res1[0])).toBe(totalPagesOf(res2[0]));
    expect(allSectionPageNums(res1[0])).toEqual(allSectionPageNums(res2[0]));
  });

  it('undefined pageBreakDepth behaves like depth=1', () => {
    const cards = [
      makeCard({ name: 'R1', colorIdentity: ['R'], cmc: 1, typeLine: 'Instant' }),
      makeCard({ name: 'U1', colorIdentity: ['U'], cmc: 1, typeLine: 'Instant' }),
    ];
    const bUndef = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
    });
    const b1 = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 1,
    });

    const { binders: rUndef } = materializeBinders(cards, [bUndef], defaultOpts);
    const { binders: r1 } = materializeBinders(cards, [b1], defaultOpts);

    expect(rUndef[0].sections).toHaveLength(r1[0].sections.length);
    expect(totalPagesOf(rUndef[0])).toBe(totalPagesOf(r1[0]));
    expect(allSectionPageNums(rUndef[0])).toEqual(allSectionPageNums(r1[0]));
  });

  it('pageBreakDepth=0 behaves like depth=1', () => {
    const cards = [
      makeCard({ name: 'R1', colorIdentity: ['R'], cmc: 1, typeLine: 'Instant' }),
      makeCard({ name: 'U1', colorIdentity: ['U'], cmc: 1, typeLine: 'Instant' }),
    ];
    const b0 = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 0,
    });
    const b1 = makeBinder({
      filter: {},
      sorts: [
        { field: 'color', dir: 'asc' },
        { field: 'cmc', dir: 'asc' },
      ],
      pocketSize: 9,
      pageBreakDepth: 1,
    });

    const { binders: r0 } = materializeBinders(cards, [b0], defaultOpts);
    const { binders: r1 } = materializeBinders(cards, [b1], defaultOpts);

    expect(r0[0].sections).toHaveLength(r1[0].sections.length);
    expect(totalPagesOf(r0[0])).toBe(totalPagesOf(r1[0]));
    expect(allSectionPageNums(r0[0])).toEqual(allSectionPageNums(r1[0]));
  });
});
