import { describe, it, expect } from 'vitest';
import { materializeBinders } from './materialize';
import type { EnrichedCard, BinderDef } from '../types';

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

function makeBinder(overrides: Partial<BinderDef> = {}): BinderDef {
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    rules: [],
    sorts: ['color', 'cmc', 'name'],
    pocketSize: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const defaultOpts = { globalPocketSize: 9 as const, search: '' };

describe('materializeBinders', () => {
  it('puts all cards in unbinned when no binders are defined', () => {
    const cards = [makeCard(), makeCard()];
    const { binders, unbinned } = materializeBinders(cards, [], defaultOpts);
    expect(binders).toHaveLength(0);
    expect(unbinned.totalCards).toBe(2);
  });

  it('routes cards matching a binder rule into that binder', () => {
    const rareCard = makeCard({ rarity: 'rare' });
    const commonCard = makeCard({ rarity: 'common' });
    const binder = makeBinder({ rules: [{ rarities: ['rare'] }], position: 0 });

    const { binders, unbinned } = materializeBinders([rareCard, commonCard], [binder], defaultOpts);
    expect(binders[0].totalCards).toBe(1);
    expect(unbinned.totalCards).toBe(1);
  });

  it('routes card to the first matching binder (priority order)', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 10 });
    const highValueBinder = makeBinder({ id: 'high', position: 0, rules: [{ priceMin: 5 }] });
    const rareBinder = makeBinder({ id: 'rare', position: 1, rules: [{ rarities: ['rare'] }] });

    const { binders } = materializeBinders([card], [highValueBinder, rareBinder], defaultOpts);
    const highBinder = binders.find((b) => b.def.id === 'high')!;
    const rarB = binders.find((b) => b.def.id === 'rare')!;
    expect(highBinder.totalCards).toBe(1);
    expect(rarB.totalCards).toBe(0);
  });

  it('respects binder position order regardless of array order', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 10 });
    const rareBinder = makeBinder({ id: 'rare', position: 0, rules: [{ rarities: ['rare'] }] });
    const highValueBinder = makeBinder({ id: 'high', position: 1, rules: [{ priceMin: 5 }] });

    // Pass binders in reverse position order
    const { binders } = materializeBinders([card], [highValueBinder, rareBinder], defaultOpts);
    const rarB = binders.find((b) => b.def.id === 'rare')!;
    const highB = binders.find((b) => b.def.id === 'high')!;
    expect(rarB.totalCards).toBe(1);
    expect(highB.totalCards).toBe(0);
  });

  it('places cards in unbinned when they match no binder', () => {
    const card = makeCard({ rarity: 'common' });
    const binder = makeBinder({ rules: [{ rarities: ['rare'] }] });

    const { unbinned } = materializeBinders([card], [binder], defaultOpts);
    expect(unbinned.totalCards).toBe(1);
  });

  it('groups cards into pages using the pocket size', () => {
    // 10 cards into a 9-pocket binder = 2 pages (9 + 1)
    const cards = Array.from({ length: 10 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({ rules: [{}], sorts: ['none'] });

    const { binders } = materializeBinders(cards, [binder], {
      ...defaultOpts,
      globalPocketSize: 9,
    });
    const totalPages = binders[0].sections.reduce((s, sec) => s + sec.pages.length, 0);
    expect(totalPages).toBe(2);
  });

  it('uses binder pocketSize when set instead of globalPocketSize', () => {
    const cards = Array.from({ length: 5 }, () => makeCard({ colorIdentity: [] }));
    const binder = makeBinder({ rules: [{}], sorts: ['none'], pocketSize: 4 });

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
      const binder = makeBinder({ rules: [{}], sorts: ['none'] });

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
      const binder = makeBinder({ rules: [{}], sorts: ['none'] });

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
      const binder = makeBinder({ rules: [{}], sorts: ['none'] });

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
    const binder = makeBinder({ rules: [{}], sorts: ['color'] });

    const { binders } = materializeBinders([redCard, blueCard], [binder], defaultOpts);
    const colorKeys = binders[0].sections.map((s) => s.colorKey);
    expect(colorKeys).toContain('U');
    expect(colorKeys).toContain('R');
    expect(colorKeys.indexOf('U')).toBeLessThan(colorKeys.indexOf('R'));
  });

  it('produces one "ALL" section when primary sort is not color', () => {
    const cards = [makeCard({ colorIdentity: ['R'] }), makeCard({ colorIdentity: ['U'] })];
    const binder = makeBinder({ rules: [{}], sorts: ['name'] });

    const { binders } = materializeBinders(cards, [binder], defaultOpts);
    expect(binders[0].sections).toHaveLength(1);
    expect(binders[0].sections[0].colorKey).toBe('ALL');
  });
});
