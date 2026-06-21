import { describe, it, expect } from 'vitest';
import { sortCards, cardSortValue, colorSortRank, CANONICAL_MULTICOLOR } from './sorting.js';
import type { EnrichedCard } from './types.js';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Alpha',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
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

const redInstant = makeCard({
  name: 'Lightning Bolt',
  colorIdentity: ['R'],
  typeLine: 'Instant',
  cmc: 1,
  rarity: 'common',
  purchasePrice: 2,
});
const blueCreature = makeCard({
  name: 'Merfolk Wizard',
  colorIdentity: ['U'],
  typeLine: 'Creature — Merfolk Wizard',
  cmc: 2,
  rarity: 'uncommon',
  purchasePrice: 1,
});
const whiteEnchantment = makeCard({
  name: 'Ghostly Prison',
  colorIdentity: ['W'],
  typeLine: 'Enchantment',
  cmc: 2,
  rarity: 'uncommon',
  purchasePrice: 3,
});
const colorlessArtifact = makeCard({
  name: 'Sol Ring',
  colorIdentity: [],
  typeLine: 'Artifact',
  cmc: 1,
  rarity: 'uncommon',
  purchasePrice: 5,
  edhrecRank: 1,
});
const multiCreature = makeCard({
  name: 'Atraxa',
  colorIdentity: ['W', 'U', 'B', 'G'],
  typeLine: 'Legendary Creature — Phyrexian',
  cmc: 4,
  rarity: 'mythic',
  purchasePrice: 15,
  edhrecRank: 50,
});

describe('cardSortValue', () => {
  it('color: mono in WUBRG order, multicolor between green and colorless', () => {
    expect(cardSortValue(whiteEnchantment, 'color')).toBe(0); // W
    expect(cardSortValue(blueCreature, 'color')).toBe(1); // U
    expect(cardSortValue(redInstant, 'color')).toBe(3); // R
    expect(cardSortValue(colorlessArtifact, 'color')).toBe(6); // C
    // Multicolor fans out within the [5, 6) band: after mono green (4),
    // before colorless (6), so the Multicolor section stays contiguous.
    const m = cardSortValue(multiCreature, 'color') as number;
    expect(m).toBeGreaterThanOrEqual(5);
    expect(m).toBeLessThan(6);
  });

  it('rarity: mythic < rare < uncommon < common', () => {
    expect(cardSortValue(multiCreature, 'rarity') as number).toBeLessThan(
      cardSortValue(colorlessArtifact, 'rarity') as number
    );
    expect(cardSortValue(colorlessArtifact, 'rarity') as number).toBeLessThan(
      cardSortValue(redInstant, 'rarity') as number
    );
  });

  it('cmc: returns numeric CMC', () => {
    expect(cardSortValue(redInstant, 'cmc')).toBe(1);
    expect(cardSortValue(multiCreature, 'cmc')).toBe(4);
  });

  it('cmc: returns 999 for missing cmc', () => {
    const noCmc = makeCard({ cmc: undefined });
    expect(cardSortValue(noCmc, 'cmc')).toBe(999);
  });

  it('name: returns lowercase name string', () => {
    expect(cardSortValue(redInstant, 'name')).toBe('lightning bolt');
    expect(cardSortValue(blueCreature, 'name')).toBe('merfolk wizard');
  });

  it('setName: returns set name lowercase', () => {
    const setCard = makeCard({ setName: 'Commander Masters', setCode: 'CMM' });
    expect(cardSortValue(setCard, 'setName')).toBe('commander masters');
  });

  it('setReleaseDate: returns release date when set map provides one', () => {
    const setCard = makeCard({ setName: 'Commander Masters', setCode: 'CMM' });
    const ctx = {
      setMap: {
        CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
      },
    };
    expect(cardSortValue(setCard, 'setReleaseDate', ctx)).toBe('2023-08-04');
  });

  it('setReleaseDate: sets without a known release date sort to the end', () => {
    const known = makeCard({ setCode: 'CMM', setName: 'Commander Masters' });
    const unknown = makeCard({ setCode: 'ZZZ', setName: 'Mystery Set' });
    const ctx = {
      setMap: {
        CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
      },
    };
    const sorted = sortCards([unknown, known], [{ field: 'setReleaseDate', dir: 'asc' }], ctx);
    expect(sorted.map((c) => c.setCode)).toEqual(['CMM', 'ZZZ']);
  });

  it('setReleaseDate: sorts chronologically by release date', () => {
    const blb = makeCard({ setName: 'Bloomburrow', setCode: 'BLB' });
    const fin = makeCard({ setName: 'Final Fantasy', setCode: 'FIN' });
    const ecl = makeCard({ setName: 'Edge of Eternities', setCode: 'ECL' });
    const ctx = {
      setMap: {
        BLB: { code: 'BLB', name: 'Bloomburrow', iconSvgUri: '', releasedAt: '2024-08-02' },
        FIN: { code: 'FIN', name: 'Final Fantasy', iconSvgUri: '', releasedAt: '2025-06-13' },
        ECL: { code: 'ECL', name: 'Edge of Eternities', iconSvgUri: '', releasedAt: '2025-08-01' },
      },
    };
    const sorted = sortCards([fin, blb, ecl], [{ field: 'setReleaseDate', dir: 'asc' }], ctx);
    expect(sorted.map((c) => c.setCode)).toEqual(['BLB', 'FIN', 'ECL']);
  });

  it('dateAdded: returns the import addedAt for the card import', () => {
    const card = makeCard({ importId: 'imp-1' });
    const ctx = { addedAtByImportId: new Map([['imp-1', 1700000000000]]) };
    expect(cardSortValue(card, 'dateAdded', ctx)).toBe(1700000000000);
  });

  it('dateAdded: unknown/legacy cards (no importId or unmapped id) sort as oldest (0)', () => {
    const ctx = { addedAtByImportId: new Map([['imp-1', 1700000000000]]) };
    expect(cardSortValue(makeCard({ importId: undefined }), 'dateAdded', ctx)).toBe(0);
    expect(cardSortValue(makeCard({ importId: 'gone' }), 'dateAdded', ctx)).toBe(0);
    // No context at all (e.g. a binder view) → 0 for everyone, a stable no-op.
    expect(cardSortValue(makeCard({ importId: 'imp-1' }), 'dateAdded')).toBe(0);
  });

  it('dateAdded: sorts newest-first under desc, pinning undated cards last', () => {
    const old = makeCard({ name: 'Old', importId: 'imp-old' });
    const recent = makeCard({ name: 'Recent', importId: 'imp-new' });
    const legacy = makeCard({ name: 'Legacy', importId: undefined });
    const ctx = {
      addedAtByImportId: new Map([
        ['imp-old', 1000],
        ['imp-new', 2000],
      ]),
    };
    const sorted = sortCards([old, legacy, recent], [{ field: 'dateAdded', dir: 'desc' }], ctx);
    expect(sorted.map((c) => c.name)).toEqual(['Recent', 'Old', 'Legacy']);
  });

  it('dateEdited: uses card.updatedAt when present', () => {
    const card = makeCard({ updatedAt: 1700000000000 });
    expect(cardSortValue(card, 'dateEdited')).toBe(1700000000000);
  });

  it('dateEdited: falls back to import time for never-edited cards', () => {
    const ctx = { addedAtByImportId: new Map([['imp-1', 1500]]) };
    // No updatedAt → fall back to the card's import addedAt.
    expect(cardSortValue(makeCard({ importId: 'imp-1' }), 'dateEdited', ctx)).toBe(1500);
    // No updatedAt and no import mapping → oldest (0).
    expect(cardSortValue(makeCard({ importId: undefined }), 'dateEdited', ctx)).toBe(0);
  });

  it('dateEdited: edited cards sort ahead of untouched ones (newest-first desc)', () => {
    const edited = makeCard({ name: 'Edited', importId: 'imp-1', updatedAt: 3000 });
    const untouched = makeCard({ name: 'Untouched', importId: 'imp-1' });
    const ctx = { addedAtByImportId: new Map([['imp-1', 1000]]) };
    const sorted = sortCards([untouched, edited], [{ field: 'dateEdited', dir: 'desc' }], ctx);
    expect(sorted.map((c) => c.name)).toEqual(['Edited', 'Untouched']);
  });

  it('price: returns raw price (direction handled by sortCards)', () => {
    expect(cardSortValue(multiCreature, 'price')).toBe(15);
    expect(cardSortValue(redInstant, 'price')).toBe(2);
  });

  it('edhrec: returns rank (lower rank = more popular = sorts first)', () => {
    expect(cardSortValue(colorlessArtifact, 'edhrec')).toBe(1);
    expect(cardSortValue(multiCreature, 'edhrec')).toBe(50);
  });

  it('edhrec: returns MAX_SAFE_INTEGER for cards without a rank', () => {
    expect(cardSortValue(redInstant, 'edhrec')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('none: returns 0', () => {
    expect(cardSortValue(redInstant, 'none')).toBe(0);
  });

  it('type: returns index in TYPE_ORDER', () => {
    const instantVal = cardSortValue(redInstant, 'type') as number;
    const creatureVal = cardSortValue(blueCreature, 'type') as number;
    expect(creatureVal).toBeLessThan(instantVal);
  });
});

describe('sortCards', () => {
  const cards = [redInstant, blueCreature, whiteEnchantment, colorlessArtifact, multiCreature];

  it('returns a copy when no sort fields are provided', () => {
    const result = sortCards(cards, []);
    expect(result).toEqual(cards);
    expect(result).not.toBe(cards);
  });

  it('returns a copy when only "none" sort is provided', () => {
    const result = sortCards(cards, [{ field: 'none', dir: 'asc' }]);
    expect(result).toEqual(cards);
  });

  it('sorts by color in WUBRG order', () => {
    const result = sortCards(cards, [{ field: 'color', dir: 'asc' }]);
    const colorKeys = result.map((c) => {
      const ci = c.colorIdentity;
      if (!ci) return '?';
      if (ci.length === 0) return 'C';
      if (ci.length === 1) return ci[0];
      return 'M';
    });
    // W before U before R before M before C
    expect(colorKeys.indexOf('W')).toBeLessThan(colorKeys.indexOf('U'));
    expect(colorKeys.indexOf('U')).toBeLessThan(colorKeys.indexOf('R'));
    expect(colorKeys.indexOf('R')).toBeLessThan(colorKeys.indexOf('M'));
    expect(colorKeys.indexOf('M')).toBeLessThan(colorKeys.indexOf('C'));
  });

  it('sorts by name alphabetically', () => {
    const result = sortCards(cards, [{ field: 'name', dir: 'asc' }]);
    const names = result.map((c) => c.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    );
  });

  it('sorts by price descending (highest first)', () => {
    const result = sortCards(cards, [{ field: 'price', dir: 'desc' }]);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].purchasePrice).toBeGreaterThanOrEqual(result[i + 1].purchasePrice);
    }
  });

  it('applies multi-level sort: color then name', () => {
    const a = makeCard({ name: 'Zap', colorIdentity: ['R'], typeLine: 'Instant' });
    const b = makeCard({ name: 'Arc Lightning', colorIdentity: ['R'], typeLine: 'Instant' });
    const result = sortCards(
      [a, b],
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ]
    );
    expect(result[0].name).toBe('Arc Lightning');
    expect(result[1].name).toBe('Zap');
  });

  it('does not mutate the original array', () => {
    const original = [redInstant, blueCreature];
    const copy = [...original];
    sortCards(original, [{ field: 'name', dir: 'asc' }]);
    expect(original).toEqual(copy);
  });
});

describe('treatment + finish sorts', () => {
  const showcase = makeCard({ name: 'Aa', frameEffects: ['showcase'] });
  const extended = makeCard({ name: 'Bb', frameEffects: ['extendedart'] });
  const borderless = makeCard({ name: 'Cc', borderColor: 'borderless' });
  const promo = makeCard({ name: 'Dd', promoTypes: ['textured'] });
  const regular = makeCard({ name: 'Ee' });

  it('treatment default order: special → regular', () => {
    const cards = [regular, promo, borderless, extended, showcase];
    const out = sortCards(cards, [{ field: 'treatment', dir: 'asc' }]);
    expect(out.map((c) => c.name)).toEqual(['Aa', 'Bb', 'Cc', 'Dd', 'Ee']);
  });

  it('treatment desc reverses the order', () => {
    const cards = [showcase, extended, borderless, promo, regular];
    const out = sortCards(cards, [{ field: 'treatment', dir: 'desc' }]);
    expect(out.map((c) => c.name)).toEqual(['Ee', 'Dd', 'Cc', 'Bb', 'Aa']);
  });

  it('treatment respects custom value order from SortContext', () => {
    const cards = [showcase, regular, borderless];
    const out = sortCards(cards, [{ field: 'treatment', dir: 'asc' }], {
      valueOrders: { treatment: ['regular', 'borderless', 'showcase'] },
    });
    expect(out.map((c) => c.name)).toEqual(['Ee', 'Cc', 'Aa']);
  });

  it('finish default order: foil → nonfoil → etched', () => {
    const foil = makeCard({ name: 'F', finish: 'foil', foil: true });
    const nonfoil = makeCard({ name: 'N', finish: 'nonfoil' });
    const etched = makeCard({ name: 'E', finish: 'etched', foil: true });
    const out = sortCards([etched, nonfoil, foil], [{ field: 'finish', dir: 'asc' }]);
    expect(out.map((c) => c.name)).toEqual(['F', 'N', 'E']);
  });

  it('cardSortValue returns numeric rank for treatment/finish', () => {
    expect(cardSortValue(showcase, 'treatment')).toBe(0);
    expect(cardSortValue(regular, 'treatment')).toBe(4);
    const foilCard = makeCard({ finish: 'foil', foil: true });
    expect(cardSortValue(foilCard, 'finish')).toBe(0);
  });
});

describe('helpers around treatment/finish ordering', () => {
  it('describeSortOrder returns null for self-evident fields', async () => {
    const { describeSortOrder } = await import('./sorting');
    expect(describeSortOrder('name', 'asc')).toBeNull();
    expect(describeSortOrder('price', 'desc')).toBeNull();
  });

  it('describeSortOrder spells out treatment order, reversed for desc', async () => {
    const { describeSortOrder } = await import('./sorting');
    const asc = describeSortOrder('treatment', 'asc');
    expect(asc).toBe('Showcase → Extended art → Borderless → Promo → Regular');
    const desc = describeSortOrder('treatment', 'desc');
    expect(desc).toBe('Regular → Promo → Borderless → Extended art → Showcase');
  });

  it('describeSortOrder respects value-order overrides', async () => {
    const { describeSortOrder } = await import('./sorting');
    const out = describeSortOrder('finish', 'asc', { finish: ['etched', 'foil', 'nonfoil'] });
    expect(out).toBe('Etched → Foil → Non-foil');
  });

  it('isValueOrderCustomized: undefined and default both read as non-customized', async () => {
    const { isValueOrderCustomized } = await import('./sorting');
    expect(isValueOrderCustomized('treatment', undefined)).toBe(false);
    expect(isValueOrderCustomized('treatment', [])).toBe(false);
    expect(
      isValueOrderCustomized('treatment', [
        'showcase',
        'extendedart',
        'borderless',
        'promo',
        'regular',
      ])
    ).toBe(false);
  });

  it('isValueOrderCustomized: any reordering reads as customized', async () => {
    const { isValueOrderCustomized } = await import('./sorting');
    expect(isValueOrderCustomized('finish', ['nonfoil', 'foil', 'etched'])).toBe(true);
  });

  it('resolveValueOrder appends missing default keys at the end', async () => {
    const { resolveValueOrder } = await import('./sorting');
    expect(resolveValueOrder('finish', ['etched'])).toEqual(['etched', 'foil', 'nonfoil']);
  });

  it('getImplicitTiebreakers skips fields already in the chain', async () => {
    const { getImplicitTiebreakers } = await import('./sorting');
    const extras = getImplicitTiebreakers([{ field: 'treatment', dir: 'desc' }]);
    expect(extras.map((e) => e.field)).toEqual(['finish', 'name']);
  });

  it('getDisplaySorts hides default implicit tie-breakers but keeps customized ones', async () => {
    const { getDisplaySorts } = await import('./sorting');
    const effective = [
      { field: 'color' as const, dir: 'asc' as const },
      { field: 'treatment' as const, dir: 'asc' as const },
      { field: 'finish' as const, dir: 'asc' as const },
      { field: 'name' as const, dir: 'asc' as const },
    ];
    const explicit = [{ field: 'color' as const, dir: 'asc' as const }];

    expect(getDisplaySorts(effective, explicit).map((s) => s.field)).toEqual(['color']);
    expect(
      getDisplaySorts(effective, explicit, {
        treatment: ['regular', 'showcase', 'extendedart', 'borderless', 'promo'],
      }).map((s) => s.field)
    ).toEqual(['color', 'treatment']);
  });

  it('getDisplaySorts always keeps explicit user choices, including name', async () => {
    const { getDisplaySorts } = await import('./sorting');
    const explicit = [
      { field: 'name' as const, dir: 'desc' as const },
      { field: 'treatment' as const, dir: 'asc' as const },
    ];
    const effective = [...explicit, { field: 'finish' as const, dir: 'asc' as const }];
    const fields = getDisplaySorts(effective, explicit).map((s) => s.field);
    expect(fields).toContain('name');
    expect(fields).toContain('treatment');
    expect(fields).not.toContain('finish');
  });
});

describe('colorSortRank — canonical multicolor ordering', () => {
  const rank = (colors: string[]) =>
    colorSortRank(makeCard({ colors, colorIdentity: colors, typeLine: 'Creature' }));

  it('keeps mono colors in WUBRG order, all before any multicolor', () => {
    const mono = [rank(['W']), rank(['U']), rank(['B']), rank(['R']), rank(['G'])];
    expect(mono).toEqual([0, 1, 2, 3, 4]);
    expect(Math.max(...mono)).toBeLessThan(rank(['W', 'U']));
  });

  it('orders the ten guilds in canonical WUBRG-pair order', () => {
    const guilds = [
      ['W', 'U'],
      ['W', 'B'],
      ['W', 'R'],
      ['W', 'G'],
      ['U', 'B'],
      ['U', 'R'],
      ['U', 'G'],
      ['B', 'R'],
      ['B', 'G'],
      ['R', 'G'],
    ];
    const ranks = guilds.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(10); // all distinct
  });

  it('sorts by color count: 2c < 3c < 4c < 5c', () => {
    expect(rank(['R', 'G'])).toBeLessThan(rank(['B', 'R', 'G'])); // Gruul < Jund
    expect(rank(['B', 'R', 'G'])).toBeLessThan(rank(['U', 'B', 'R', 'G'])); // Jund < 4c
    expect(rank(['U', 'B', 'R', 'G'])).toBeLessThan(rank(['W', 'U', 'B', 'R', 'G'])); // 4c < WUBRG
  });

  it('keeps every multicolor rank inside the [5, 6) band (section stays intact)', () => {
    for (const combo of CANONICAL_MULTICOLOR) {
      const r = rank(combo.split(''));
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThan(6); // strictly before colorless (COLOR_INFO order 6)
    }
  });

  it('normalizes color order — input order does not matter', () => {
    expect(rank(['G', 'U'])).toBe(rank(['U', 'G'])); // Simic either way
    expect(rank(['R', 'W', 'U'])).toBe(rank(['U', 'R', 'W'])); // Jeskai either way
  });

  it('sortCards lays out a mixed pile mono → guilds → wedge → 5c → colorless', () => {
    const cards = [
      makeCard({ name: '5c', colors: ['W', 'U', 'B', 'R', 'G'], typeLine: 'Creature' }),
      makeCard({ name: 'colorless', colors: [], typeLine: 'Artifact' }),
      makeCard({ name: 'gruul', colors: ['R', 'G'], typeLine: 'Creature' }),
      makeCard({ name: 'mono-green', colors: ['G'], typeLine: 'Creature' }),
      makeCard({ name: 'azorius', colors: ['W', 'U'], typeLine: 'Creature' }),
      makeCard({ name: 'mono-white', colors: ['W'], typeLine: 'Creature' }),
      makeCard({ name: 'bant', colors: ['W', 'U', 'G'], typeLine: 'Creature' }),
    ];
    const sorted = sortCards(cards, [{ field: 'color', dir: 'asc' }]).map((c) => c.name);
    expect(sorted).toEqual([
      'mono-white',
      'mono-green',
      'azorius',
      'gruul',
      'bant',
      '5c',
      'colorless',
    ]);
  });
});
