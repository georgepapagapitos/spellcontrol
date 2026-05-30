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

  it('treats "could produce" reflect-fixers (Reflecting Pool, Fellwar Stone) as all colors', () => {
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
    expect(sorted(producedManaColors(pool, WU))).toEqual(['B', 'C', 'G', 'R', 'U', 'W']);
    expect(sorted(producedManaColors(fellwar, WU))).toEqual(['B', 'G', 'R', 'U', 'W']);
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
