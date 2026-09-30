import { describe, it, expect } from 'vitest';
import { MIN_SUGGESTION_COUNT, suggestBinders } from './binder-suggestions';
import { cleanFilter } from '@/lib/search/clean-filter';
import { materializeBinders } from './materialize';
import type { BinderDef, EnrichedCard } from '@/types/index';

// Real printings' Scryfall fields (type line, identity, rarity), so the rules
// under test read the data the collection actually carries.
let n = 0;
function card(
  name: string,
  typeLine: string,
  colorIdentity: string[],
  rarity: string,
  purchasePrice: number
): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o-${name}`,
    name,
    typeLine,
    colorIdentity,
    colors: colorIdentity,
    rarity,
    purchasePrice,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    quantity: 1,
  } as unknown as EnrichedCard;
}

const lands = [
  card('Forest', 'Basic Land — Forest', [], 'common', 0.1),
  card('Command Tower', 'Land', [], 'common', 0.3),
  card('Reliquary Tower', 'Land', [], 'uncommon', 0.5),
  card('Exotic Orchard', 'Land', [], 'rare', 0.4),
];
const greens = [
  card('Llanowar Elves', 'Creature — Elf Druid', ['G'], 'common', 0.3),
  card('Cultivate', 'Sorcery', ['G'], 'common', 0.5),
  card('Beast Within', 'Instant', ['G'], 'uncommon', 0.9),
];
const pricey = [
  card('Smothering Tithe', 'Enchantment', ['W'], 'rare', 18),
  card('Rhystic Study', 'Enchantment', ['U'], 'common', 35),
];
const pile = [...lands, ...greens, ...pricey];

describe('suggestBinders', () => {
  it('offers the biggest ideas first, one per kind', () => {
    const got = suggestBinders(pile);
    expect(got.map((s) => [s.name, s.count])).toEqual([
      ['Lands', 4],
      ['Green', 3],
    ]);
  });

  it('never offers two suggestions of the same kind', () => {
    const blues = [
      card('Counterspell', 'Instant', ['U'], 'common', 1.2),
      card('Ponder', 'Sorcery', ['U'], 'common', 1.5),
      card('Brainstorm', 'Instant', ['U'], 'common', 1.1),
    ];
    const kinds = suggestBinders([...pile, ...blues], 10).map((s) => s.id.split('-')[0]);
    expect(kinds.filter((k) => k === 'color')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'type')).toHaveLength(1);
  });

  it('caps the list and drops ideas too small to be a binder', () => {
    expect(suggestBinders(pile, 1)).toHaveLength(1);
    expect(suggestBinders(pile).every((s) => s.count >= MIN_SUGGESTION_COUNT)).toBe(true);
  });

  it('says nothing about a pile too small to split', () => {
    expect(suggestBinders(lands.slice(0, MIN_SUGGESTION_COUNT - 1))).toEqual([]);
  });

  it('every suggestion carries a real constraint', () => {
    for (const s of suggestBinders(pile, 10)) {
      expect(Object.keys(cleanFilter(s.filter)).length, s.id).toBeGreaterThan(0);
    }
  });

  // The promise the sheet makes: "Lands, 4 cards". A binder created from it
  // goes to the bottom of the list, so it must land exactly that many.
  it('counts what the binder will actually land once it is made', () => {
    const existing: BinderDef = {
      id: 'b-rares',
      name: 'Rares',
      position: 0,
      filterGroups: [
        { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
      ],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    const { uncategorized } = materializeBinders(pile, [existing], { search: '' });
    const unfiled = uncategorized.sections.flatMap((s) => s.cards);
    for (const s of suggestBinders(unfiled, 10)) {
      const made: BinderDef = {
        ...existing,
        id: 'b-new',
        name: s.name,
        position: 1,
        filterGroups: [{ filter: s.filter }],
      };
      const { binders } = materializeBinders(pile, [existing, made], { search: '' });
      expect(binders.find((b) => b.def.id === 'b-new')?.totalCards, s.name).toBe(s.count);
    }
  });
});
