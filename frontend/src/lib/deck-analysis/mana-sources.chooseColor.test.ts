// E631: "{2}, {T}: Choose a color. Add ..." is a paid mana ability like any
// other, so it must not make a land a free any-color source. Oracle text is the
// real Scryfall text (Nykthos from the card cache, Three Tree City from Scryfall).
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import fixture from '@/lib/mana-sim/__fixtures__/land-abilities.fixture.json';
import { alwaysProducedMana, unconditionalMana } from '@/lib/mana-sim/unconditional-mana';
import { producedManaColors } from './mana-sources';

const ALL = ['B', 'C', 'G', 'R', 'U', 'W'];
const land = (name: string, oracle_text: string): ScryfallCard =>
  ({
    name,
    type_line: 'Land',
    oracle_text,
    produced_mana: ALL,
    color_identity: [],
    colors: [],
  }) as unknown as ScryfallCard;

const THREE_TREE_CITY = land(
  'Three Tree City',
  'As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.'
);
const NYKTHOS = land(
  'Nykthos, Shrine to Nyx',
  '{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color. (Your devotion to a color is the number of mana symbols of that color in the mana costs of permanents you control.)'
);
const MESA = land(
  'Mirage Mesa',
  'This land enters tapped. As it enters, choose a color.\n{T}: Add one mana of the chosen color.'
);
const BLUFF = land(
  'Thriving Bluff',
  'This land enters tapped. As it enters, choose a color other than red.\n{T}: Add {R} or one mana of the chosen color.'
);

describe('a paid "Choose a color. Add ..." ability leaves the land colorless', () => {
  it.each([THREE_TREE_CITY, NYKTHOS])('$name', (card) => {
    const id = new Set(['B', 'G']);
    expect(producedManaColors(card, id)).toEqual(['C']);
    expect(unconditionalMana(card.oracle_text!, { fixing: true })?.colours).toEqual(['C']);
    expect(alwaysProducedMana(card.oracle_text, ALL)).toEqual(['C']);
  });
});

describe('readings that must not change', () => {
  it('a free chosen-color land is unchanged (no cost line is dropped)', () => {
    expect(unconditionalMana(MESA.oracle_text!, { fixing: true })).toBeNull();
    expect(unconditionalMana(BLUFF.oracle_text!, { fixing: true })).toBeNull();
  });
  const cards = new Map((fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c]));
  const all = new Set(['W', 'U', 'B', 'R', 'G']);
  it.each(['Springjack Pasture', 'Power Depot'])('%s stays {C}', (n) => {
    expect(producedManaColors(cards.get(n)!, all)).toEqual(['C']);
  });
  it('Command Tower and a shock land keep their colors', () => {
    expect(producedManaColors(cards.get('Command Tower')!, new Set(['W', 'G'])).sort()).toEqual([
      'G',
      'W',
    ]);
    expect(producedManaColors(cards.get('Hallowed Fountain')!, all).sort()).toEqual(['U', 'W']);
  });
});
