// @vitest-environment node
//
// E561: a combo line that runs through the commander is held whole too. Krenko
// budget50 (std panel): budget convergence cut Rising of the Day, the third
// piece of Skirk Prospector + Rising of the Day + Krenko, Mob Boss, because the
// keeper looked for the line among the categories alone and the commander sits
// in none.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { evictionKeeper } from './evictionKeeper';
import type { GenerationState } from './state';

function card(name: string, type_line: string, oracle_text: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line,
    oracle_text,
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

const KRENKO = card('Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior', '');
const SKIRK = card('Skirk Prospector', 'Creature — Goblin', 'Sacrifice a Goblin: Add {R}.');
const RISING = card('Rising of the Day', 'Enchantment', '');
const FILLER = card('Goblin War Paint', 'Enchantment — Aura', 'Enchant creature');

function stateWith(deck: ScryfallCard[], withCommander: boolean) {
  return {
    context: { commander: withCommander ? KRENKO : null, partnerCommander: null },
    edhrecData: { cardlists: { allNonLand: [] } },
    combos: [{ comboId: '38-659-x', cards: [SKIRK, RISING, KRENKO], results: [] }],
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: deck,
      utility: [],
    },
  } as unknown as GenerationState;
}

describe('evictionKeeper commander lines', () => {
  it('keeps a piece of a line that is whole with the commander', () => {
    const keeps = evictionKeeper(stateWith([SKIRK, RISING, FILLER], true));
    expect(keeps(RISING)).toBe(true);
    expect(keeps(SKIRK)).toBe(true);
    expect(keeps(FILLER)).toBe(false);
  });

  it('does not keep a piece of a line that is missing a card', () => {
    const keeps = evictionKeeper(stateWith([RISING, FILLER], true));
    expect(keeps(RISING)).toBe(false);
  });
});
