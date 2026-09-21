import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { producedManaColors, isManaSourceType, deckColorIdentity } from './mana-sources';

/** Minimal ScryfallCard factory — only the fields these helpers read matter. */
function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'x',
    oracle_id: 'x',
    name: 'Test',
    cmc: 0,
    type_line: 'Land',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 's',
    set_name: 'Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const sorted = (xs: string[]) => [...xs].sort();
const WU = new Set(['W', 'U']);

describe('producedManaColors', () => {
  it('reads produced_mana for a basic land', () => {
    const plains = card({ name: 'Plains', type_line: 'Basic Land — Plains', produced_mana: ['W'] });
    expect(producedManaColors(plains, WU)).toEqual(['W']);
  });

  it('reads produced_mana for a dual land', () => {
    const dual = card({
      name: 'Hallowed Fountain',
      type_line: 'Land — Plains Island',
      produced_mana: ['W', 'U'],
    });
    expect(sorted(producedManaColors(dual, WU))).toEqual(['U', 'W']);
  });

  it('falls back to every color symbol in each "Add" clause when produced_mana is absent', () => {
    // Collection rows / deck cards mapped from EnrichedCard never carry
    // produced_mana, so this fallback is the live path for owned lands. A
    // painland's "Add {B} or {R}" used to read as black only, which made a
    // basic-fetch look like it "adds red" over Sulfurous Springs.
    const springs = card({
      name: 'Sulfurous Springs',
      oracle_text: '{T}: Add {C}.\n{T}: Add {B} or {R}. This land deals 1 damage to you.',
    });
    const triLand = card({
      name: 'Arcane Sanctum',
      oracle_text: 'This land enters tapped.\n{T}: Add {W}, {U}, or {B}.',
    });
    const filter = card({
      name: 'Mystic Gate',
      oracle_text: '{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.',
    });
    const all = new Set(['W', 'U', 'B', 'R', 'G']);
    // ⚠️ The {C} in each of these is NOT noise to be filtered out — Scryfall's
    // own produced_mana is ["B","C","R"] for Sulfurous Springs and ["C","U","W"]
    // for Mystic Gate. These two expectations used to omit it, which encoded
    // the bug rather than the card: the fallback read only WUBRG, so a
    // painland lost its colorless half and a Sol Ring produced nothing at all.
    // A hydrated card and an unhydrated one have to agree, and the hydrated one
    // says C. Do not "fix" a failure here by dropping the C back out.
    expect(sorted(producedManaColors(springs, all))).toEqual(['B', 'C', 'R']);
    expect(sorted(producedManaColors(triLand, all))).toEqual(['B', 'U', 'W']);
    expect(sorted(producedManaColors(filter, all))).toEqual(['C', 'U', 'W']);
  });

  it('fallback still reads basic land types and ignores a basic-fetch with no "Add"', () => {
    const tundra = card({ name: 'Tundra', type_line: 'Land — Plains Island' });
    const wilds = card({
      name: 'Evolving Wilds',
      oracle_text:
        '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    expect(sorted(producedManaColors(tundra, WU))).toEqual(['U', 'W']);
    expect(producedManaColors(wilds, WU)).toEqual([]);
  });

  it('fallback reads {C}, so a colorless source is not invisible', () => {
    // The whole colorless column was unreachable from the fallback: its "Add …"
    // scan matched only {W}{U}{B}{R}{G}. Measured on five live public decks,
    // every one reported ZERO colorless sources — and a colorless deck reported
    // no mana sources at all, 0 where it had 49. Real Scryfall text.
    const solRing = card({
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    });
    const wastes = card({ name: 'Wastes', type_line: 'Basic Land', oracle_text: '{T}: Add {C}.' });
    expect(producedManaColors(solRing, WU)).toEqual(['C']);
    expect(producedManaColors(wastes, WU)).toEqual(['C']);
  });

  it('fallback reads "adds" as well as "add"', () => {
    // Wild Growth grants the mana in the third person, so a bare `add` never
    // matched it and a real ramp source counted for nothing. Real Scryfall text.
    const wildGrowth = card({
      name: 'Wild Growth',
      type_line: 'Enchantment — Aura',
      oracle_text:
        'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
    });
    expect(producedManaColors(wildGrowth, new Set(['G']))).toEqual(['G']);
  });

  it('still ignores an "Add" that is not this card making mana', () => {
    // The scan is deliberately clause-scoped (stops at the sentence end), so a
    // card that merely mentions adding counters keeps producing nothing.
    const counters = card({
      name: 'Not A Mana Source',
      type_line: 'Enchantment',
      oracle_text: 'At the beginning of your upkeep, add a charge counter to this enchantment.',
    });
    expect(producedManaColors(counters, WU)).toEqual([]);
  });

  it('counts colorless (C) producers like Sol Ring', () => {
    const solRing = card({
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      produced_mana: ['C'],
    });
    expect(producedManaColors(solRing, WU)).toEqual(['C']);
  });

  it('detects mana dorks via produced_mana', () => {
    const birds = card({
      name: 'Birds of Paradise',
      type_line: 'Creature — Bird',
      oracle_text: '{T}: Add one mana of any color.',
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(birds, WU))).toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it('keeps all five colors for a genuine rainbow source (City of Brass)', () => {
    const city = card({
      name: 'City of Brass',
      type_line: 'Land',
      oracle_text: '{T}: Add one mana of any color.',
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(city, WU))).toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it("clamps Command Tower to the commander's color identity", () => {
    const tower = card({
      name: 'Command Tower',
      type_line: 'Land',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
      // Scryfall reports the full rainbow here:
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(tower, WU))).toEqual(['U', 'W']);
  });

  it("clamps Arcane Signet (a rock) to the commander's identity", () => {
    const signet = card({
      name: 'Arcane Signet',
      type_line: 'Artifact',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(signet, WU))).toEqual(['U', 'W']);
  });

  it('clamps "could produce" reflect-fixers (Reflecting Pool, Fellwar Stone) to identity', () => {
    const pool = card({
      name: 'Reflecting Pool',
      type_line: 'Land',
      oracle_text: '{T}: Add one mana of any type that a land you control could produce.',
      produced_mana: ['W', 'U', 'B', 'R', 'G', 'C'],
    });
    const fellwar = card({
      name: 'Fellwar Stone',
      type_line: 'Artifact',
      oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(pool, WU))).toEqual(['U', 'W']);
    expect(sorted(producedManaColors(fellwar, WU))).toEqual(['U', 'W']);
  });

  it('falls back to reported colors when a reflect-fixer has no deck identity', () => {
    const fellwar = card({
      name: 'Fellwar Stone',
      type_line: 'Artifact',
      oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    expect(sorted(producedManaColors(fellwar, new Set<string>()))).toEqual([
      'B',
      'G',
      'R',
      'U',
      'W',
    ]);
  });

  it('keeps specific guild-signet colors as-is (not contextual)', () => {
    const izzet = card({
      name: 'Izzet Signet',
      type_line: 'Artifact',
      oracle_text: '{1}, {T}: Add {U}{R}.',
      produced_mana: ['U', 'R'],
    });
    expect(sorted(producedManaColors(izzet, WU))).toEqual(['R', 'U']);
  });

  it('falls back to land name when produced_mana is missing', () => {
    const forest = card({ name: 'Forest', type_line: 'Basic Land — Forest' });
    expect(producedManaColors(forest, WU)).toEqual(['G']);
  });

  it('falls back to first-face type line when produced_mana and top-level type line are missing', () => {
    const bloodCrypt = card({
      name: 'Blood Crypt // Blood Crypt',
      layout: 'reversible_card',
      type_line: undefined as unknown as string,
      card_faces: [
        { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
        { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
      ] as ScryfallCard['card_faces'],
    });
    expect(sorted(producedManaColors(bloodCrypt, WU))).toEqual(['B', 'R']);
  });

  it('clamps a contextual card even when produced_mana is missing from cache', () => {
    const tower = card({
      name: 'Command Tower',
      type_line: 'Land',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    });
    expect(sorted(producedManaColors(tower, new Set(['B', 'G'])))).toEqual(['B', 'G']);
  });

  it('returns [] for a non-producer', () => {
    const bear = card({ name: 'Grizzly Bears', type_line: 'Creature — Bear' });
    expect(producedManaColors(bear, WU)).toEqual([]);
  });
});

describe('isManaSourceType', () => {
  it('excludes one-shot rituals (instants/sorceries)', () => {
    const darkRitual = card({
      name: 'Dark Ritual',
      type_line: 'Instant',
      produced_mana: ['B'],
    });
    expect(isManaSourceType(darkRitual)).toBe(false);
  });

  it('includes lands, rocks, and dorks', () => {
    expect(isManaSourceType(card({ type_line: 'Land' }))).toBe(true);
    expect(isManaSourceType(card({ type_line: 'Artifact' }))).toBe(true);
    expect(isManaSourceType(card({ type_line: 'Creature — Elf Druid' }))).toBe(true);
  });

  it('uses the first-face type line when top-level type line is missing', () => {
    expect(
      isManaSourceType(
        card({
          layout: 'reversible_card',
          type_line: undefined as unknown as string,
          card_faces: [
            { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
            { name: 'Blood Crypt', type_line: 'Land — Swamp Mountain' },
          ] as ScryfallCard['card_faces'],
        })
      )
    ).toBe(true);
  });

  it('keeps an MDFC/adventure permanent whose back face is a spell', () => {
    // front face is a permanent; only the back is an Instant.
    expect(isManaSourceType(card({ type_line: 'Creature — Giant // Instant — Adventure' }))).toBe(
      true
    );
  });
});

describe('deckColorIdentity', () => {
  it("uses the commanders' identity when present", () => {
    const cmdr = card({ name: 'Cmdr', color_identity: ['W', 'U'] });
    const deck = [card({ color_identity: ['B'] }), card({ color_identity: ['R'] })];
    expect(sorted([...deckColorIdentity(deck, [cmdr])])).toEqual(['U', 'W']);
  });

  it('unions partner commanders', () => {
    const a = card({ color_identity: ['W'] });
    const b = card({ color_identity: ['B'] });
    expect(sorted([...deckColorIdentity([], [a, b])])).toEqual(['B', 'W']);
  });

  it('falls back to the union of all cards when there is no commander', () => {
    const deck = [card({ color_identity: ['G'] }), card({ color_identity: ['U'] })];
    expect(sorted([...deckColorIdentity(deck, [null, undefined])])).toEqual(['G', 'U']);
  });
});
