import { describe, it, expect } from 'vitest';
import {
  sortCards,
  cardSortValue,
  colorSortRank,
  releaseDateOf,
  CANONICAL_MULTICOLOR,
  UNKNOWN_VALUE,
} from './sorting.js';
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

  it('cmc: reports a missing cmc as unknown, not as a huge number', () => {
    const noCmc = makeCard({ cmc: undefined });
    expect(cardSortValue(noCmc, 'cmc')).toBe(UNKNOWN_VALUE);
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

  // A set present in the map but carrying a BLANK date. `SetSummary.releasedAt`
  // is `''` (not optional) when Scryfall gave no date, and `''` is a truthy
  // sort value that sorts FIRST ascending — while the matching section header
  // reads it as falsy and takes UNKNOWN_ORDER, i.e. LAST. The test above covers
  // only a set ABSENT from the map, which was never the broken case.
  it('setReleaseDate: a set with a blank release date sorts to the end, not the front', () => {
    const known = makeCard({ setCode: 'CMM', setName: 'Commander Masters' });
    const blank = makeCard({ setCode: 'ZZZ', setName: 'Undated Set' });
    const ctx = {
      setMap: {
        CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
        ZZZ: { code: 'ZZZ', name: 'Undated Set', iconSvgUri: '', releasedAt: '' },
      },
    };
    expect(cardSortValue(blank, 'setReleaseDate', ctx)).toBe(UNKNOWN_VALUE);
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortCards([blank, known], [{ field: 'setReleaseDate', dir }], ctx);
      expect(sorted.map((c) => c.setCode)).toEqual(['CMM', 'ZZZ']);
    }
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

  it('edhrec: reports a card without a rank as unknown', () => {
    expect(cardSortValue(redInstant, 'edhrec')).toBe(UNKNOWN_VALUE);
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

// A card with no value for the sort field must never be promoted to the top by
// flipping the direction — "newest first" / "highest mana value first" leading
// with the cards nobody has data for is the bug this whole block pins shut.
describe('sortCards: unknown values trail in BOTH directions', () => {
  const ctx = {
    setMap: {
      CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
      BLB: { code: 'BLB', name: 'Bloomburrow', iconSvgUri: '', releasedAt: '2024-08-02' },
    },
  };

  it.each(['asc', 'desc'] as const)('release date (%s) keeps undated sets last', (dir) => {
    const undated = makeCard({ name: 'Undated', setCode: 'ZZZ', setName: 'Mystery Set' });
    const old = makeCard({ name: 'Old', setCode: 'CMM', setName: 'Commander Masters' });
    const recent = makeCard({ name: 'Recent', setCode: 'BLB', setName: 'Bloomburrow' });
    const sorted = sortCards([undated, recent, old], [{ field: 'setReleaseDate', dir }], ctx);
    expect(sorted[sorted.length - 1].name).toBe('Undated');
  });

  it.each(['asc', 'desc'] as const)('mana value (%s) keeps unknown cmc last', (dir) => {
    const unknown = makeCard({ name: 'Unknown', cmc: undefined });
    const cheap = makeCard({ name: 'Cheap', cmc: 1 });
    const pricey = makeCard({ name: 'Pricey', cmc: 8 });
    const sorted = sortCards([unknown, pricey, cheap], [{ field: 'cmc', dir }]);
    expect(sorted[sorted.length - 1].name).toBe('Unknown');
  });

  it.each(['asc', 'desc'] as const)('edhrec (%s) keeps unranked cards last', (dir) => {
    const unranked = makeCard({ name: 'Unranked', edhrecRank: undefined });
    const top = makeCard({ name: 'Top', edhrecRank: 5 });
    const deep = makeCard({ name: 'Deep', edhrecRank: 20000 });
    const sorted = sortCards([unranked, deep, top], [{ field: 'edhrec', dir }]);
    expect(sorted[sorted.length - 1].name).toBe('Unranked');
  });

  it('two unknowns fall through to the next sort field instead of freezing', () => {
    const zed = makeCard({ name: 'Zed', cmc: undefined });
    const abe = makeCard({ name: 'Abe', cmc: undefined });
    const sorted = sortCards(
      [zed, abe],
      [
        { field: 'cmc', dir: 'desc' },
        { field: 'name', dir: 'asc' },
      ]
    );
    expect(sorted.map((c) => c.name)).toEqual(['Abe', 'Zed']);
  });
});

describe('releaseDateOf — a Secret Lair dates from its drop, never the flat set', () => {
  const ctx = {
    SLD: { code: 'SLD', name: 'Secret Lair Drop', iconSvgUri: '', releasedAt: '2019-12-02' },
    CMM: { code: 'CMM', name: 'Commander Masters', iconSvgUri: '', releasedAt: '2023-08-04' },
  };

  it('uses the drop date for a mapped Secret Lair', () => {
    const card = makeCard({
      setCode: 'SLD',
      sldDrop: 'Goblin Storm',
      sldDropReleasedAt: '2026-05-22',
    });
    expect(releaseDateOf(card, ctx)).toBe('2026-05-22');
  });

  it('reports NO date for an unmapped Secret Lair rather than the 2019 set date', () => {
    // The SLD set's own date is the day the first drop ever shipped; inheriting
    // it anchors unattributed bonus cards to 2019 and floats them to the front
    // of a chronological binder.
    const card = makeCard({ setCode: 'SLD', setName: 'Secret Lair Drop' });
    expect(releaseDateOf(card, ctx)).toBeUndefined();
  });

  it('falls back to the set date for an ordinary set', () => {
    expect(releaseDateOf(makeCard({ setCode: 'CMM' }), ctx)).toBe('2023-08-04');
  });

  // The printing's OWN date is the truth; the drop map and the set date are
  // only fallbacks for a card the per-printing lookup hasn't reached yet.
  describe('a printing that carries its own date', () => {
    it('beats the flat set date', () => {
      const card = makeCard({ setCode: 'CMM', releasedAt: '2023-09-01' });
      expect(releaseDateOf(card, ctx)).toBe('2023-09-01');
    });

    it('beats the Secret Lair drop date', () => {
      const card = makeCard({
        setCode: 'SLD',
        sldDrop: 'Goblin Storm',
        sldDropReleasedAt: '2026-05-22',
        releasedAt: '2026-05-25',
      });
      expect(releaseDateOf(card, ctx)).toBe('2026-05-25');
    });

    it('dates an unmapped Secret Lair that would otherwise have no date', () => {
      const card = makeCard({ setCode: 'SLD', releasedAt: '2024-07-29' });
      expect(releaseDateOf(card, ctx)).toBe('2024-07-29');
    });

    // The reason this field exists. SLP/SLC/PLST/PRM are rolling containers:
    // Scryfall dates the SET from its first card, so every later printing in it
    // inherits a date that can be years early. SLP alone spans 2023→2026 under
    // a 2023-02-17 set date.
    it('separates printings that share one rolling container set', () => {
      const slp = {
        SLP: { code: 'SLP', name: 'Secret Lair Promo', iconSvgUri: '', releasedAt: '2023-02-17' },
      };
      const early = makeCard({ name: 'Early', setCode: 'SLP', releasedAt: '2023-02-19' });
      const late = makeCard({ name: 'Late', setCode: 'SLP', releasedAt: '2026-09-11' });
      const sorted = sortCards([late, early], [{ field: 'setReleaseDate', dir: 'asc' }], {
        setMap: slp,
      });
      expect(sorted.map((c) => c.name)).toEqual(['Early', 'Late']);
      // Without the per-printing date both collapse onto the set date and the
      // sort can't tell them apart at all.
      const undecorated = [
        makeCard({ name: 'Early', setCode: 'SLP' }),
        makeCard({ name: 'Late', setCode: 'SLP' }),
      ];
      expect(undecorated.map((c) => releaseDateOf(c, slp))).toEqual(['2023-02-17', '2023-02-17']);
    });
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
    expect(extras.map((e) => e.field)).toEqual(['finish', 'name', 'setName', 'collectorNumber']);
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

describe('collector numbers sort naturally, and unknown ones trail', () => {
  const byNumber = (numbers: string[], dir: 'asc' | 'desc' = 'asc') =>
    sortCards(
      numbers.map((n) => makeCard({ collectorNumber: n, name: n })),
      [{ field: 'collectorNumber', dir }]
    ).map((c) => c.collectorNumber);

  it('orders 2 < 10 < 123 < 123a < 123★ and puts The List prefixes after plain numbers', () => {
    expect(byNumber(['123★', 'MMA-90', '10', '123a', '2XM-114', '2', '123'])).toEqual([
      '2',
      '10',
      '123',
      '123a',
      '123★',
      '2XM-114',
      'MMA-90',
    ]);
  });

  it('keeps a missing number last in both directions', () => {
    expect(byNumber(['', '5', '3'])).toEqual(['3', '5', '']);
    expect(byNumber(['', '5', '3'], 'desc')).toEqual(['5', '3', '']);
  });
});

describe('sortCards is deterministic and crash-proof', () => {
  it('lands the same order whatever order the cards arrive in', () => {
    const cards = ['A', 'B', 'C', 'D'].flatMap((set, i) =>
      [1, 2, 3].map((n) =>
        makeCard({
          name: 'Sol Ring',
          setCode: set,
          setName: `Set ${set}`,
          collectorNumber: String(n),
          scryfallId: `${set}-${n}`,
          copyId: `${set}-${n}-${i}`,
        })
      )
    );
    const sorts = [{ field: 'color' as const, dir: 'asc' as const }];
    const forward = sortCards(cards, sorts).map((c) => c.copyId);
    const reversed = sortCards([...cards].reverse(), sorts).map((c) => c.copyId);
    expect(reversed).toEqual(forward);
  });

  it('does not throw on a row missing name, rarity or collector number', () => {
    const broken = {
      ...makeCard(),
      name: undefined,
      rarity: undefined,
      collectorNumber: undefined,
    } as unknown as EnrichedCard;
    for (const field of ['name', 'rarity', 'collectorNumber', 'color', 'setName'] as const) {
      expect(() => sortCards([broken, makeCard()], [{ field, dir: 'asc' }])).not.toThrow();
    }
  });

  it('a blank rarity sorts as common, where its section header sits', () => {
    expect(cardSortValue(makeCard({ rarity: '' }), 'rarity')).toBe(
      cardSortValue(makeCard({ rarity: 'common' }), 'rarity')
    );
  });
});

describe('setName sort value is the section label, lowercased', () => {
  it('a card with no set sorts as "unknown set", not as the empty string', async () => {
    const { setMeta } = await import('./sorting');
    const nameless = makeCard({ setCode: '', setName: '' });
    expect(cardSortValue(nameless, 'setName')).toBe(setMeta(nameless).label.toLowerCase());
    // "Unknown set" lands after "Unglued" both as a header and as a card.
    expect(
      sortCards(
        [nameless, makeCard({ setName: 'Unglued' })],
        [{ field: 'setName', dir: 'asc' }]
      ).map((c) => c.setName)
    ).toEqual(['Unglued', '']);
  });
});

describe('withImplicitTiebreakers', () => {
  it('closes a Release-date chain on collector number, ahead of the generic tie-breakers', async () => {
    const { withImplicitTiebreakers } = await import('./sorting');
    expect(
      withImplicitTiebreakers([
        { field: 'setReleaseDate', dir: 'desc' },
        { field: 'color', dir: 'asc' },
      ]).map((s) => s.field)
    ).toEqual([
      'setReleaseDate',
      'setGroup',
      'color',
      'collectorNumber',
      'treatment',
      'finish',
      'name',
    ]);
  });

  // Real printings, both Scryfall-dated 2024-06-24: Soul Warden is SLD #1708
  // (drop "Featuring Julie Bell"), Frilled Mystic SLD #786 (a bonus card with
  // no drop). Same day, same set: printed order, not drop name A → Z.
  it('orders same-day cards of one set by collector number, not by drop name', async () => {
    const { sortCards, withImplicitTiebreakers } = await import('./sorting');
    const sld = (name: string, collectorNumber: string, sldDrop?: string) =>
      makeCard({
        name,
        setCode: 'SLD',
        setName: 'Secret Lair Drop',
        collectorNumber,
        releasedAt: '2024-06-24',
        sldDrop,
      });
    const sorted = sortCards(
      [sld('Soul Warden', '1708', 'Featuring Julie Bell'), sld('Frilled Mystic', '786')],
      withImplicitTiebreakers([{ field: 'setReleaseDate', dir: 'asc' }])
    );
    expect(sorted.map((c) => c.name)).toEqual(['Frilled Mystic', 'Soul Warden']);
  });

  it('still keeps same-day SETS together, A → Z, whatever their numbers', async () => {
    const { sortCards, withImplicitTiebreakers } = await import('./sorting');
    const on = (setName: string, collectorNumber: string) =>
      makeCard({
        name: `${setName} ${collectorNumber}`,
        setCode: setName.slice(0, 3).toUpperCase(),
        setName,
        collectorNumber,
        releasedAt: '2026-02-16',
      });
    const sorted = sortCards(
      [on('Zeta', '1'), on('Alpha', '9'), on('Zeta', '2'), on('Alpha', '3')],
      withImplicitTiebreakers([{ field: 'setReleaseDate', dir: 'desc' }])
    );
    expect(sorted.map((c) => c.name)).toEqual(['Alpha 3', 'Alpha 9', 'Zeta 1', 'Zeta 2']);
  });

  it('labels Rarity by what it does: ascending is mythic first', async () => {
    const { sortCards, sortDirectionLabel } = await import('./sorting');
    const cards = ['common', 'mythic', 'uncommon', 'rare'].map((rarity) =>
      makeCard({ name: rarity, rarity })
    );
    for (const dir of ['asc', 'desc'] as const) {
      const first = sortCards(cards, [{ field: 'rarity', dir }])[0].rarity;
      expect(sortDirectionLabel('rarity', dir)).toBe(
        first === 'mythic' ? 'Mythic first' : 'Common first'
      );
    }
  });

  it('leaves a chain that already sorts by Set alone', async () => {
    const { withImplicitTiebreakers } = await import('./sorting');
    const chain = withImplicitTiebreakers([
      { field: 'setReleaseDate', dir: 'desc' },
      { field: 'setName', dir: 'desc' },
    ]);
    expect(chain.slice(0, 2).map((s) => `${s.field}:${s.dir}`)).toEqual([
      'setReleaseDate:desc',
      'setName:desc',
    ]);
  });
});

describe('normalizeSorts drops a field repeated in a stored chain', () => {
  it('keeps the first occurrence only', async () => {
    const { normalizeSorts } = await import('./sorting');
    const out = normalizeSorts([
      { field: 'name', dir: 'asc' },
      { field: 'name', dir: 'desc' },
      { field: 'cmc', dir: 'asc' },
    ]);
    expect(out.map((s) => `${s.field}:${s.dir}`)).toEqual(['name:asc', 'cmc:asc']);
  });

  it('returns the same array when there is nothing to fix', async () => {
    const { normalizeSorts } = await import('./sorting');
    const sorts = [{ field: 'name' as const, dir: 'asc' as const }];
    expect(normalizeSorts(sorts)).toBe(sorts);
  });
});
