// E509: a land's coloured output comes from the abilities that always work, not
// from Scryfall's produced_mana, which also lists what a paid or restricted
// ability makes. Real Oracle text, from the lands the collection gate seated for
// a basic on that misreading.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyManaCard } from './classify';
import fixture from './__fixtures__/land-abilities.fixture.json';
import { ANY_COLOR, MANA_B, MANA_C, MANA_G, MANA_W } from './types';

const CARDS = new Map((fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c]));
const units = (name: string, identity = ANY_COLOR) => {
  const card = CARDS.get(name);
  if (!card) throw new Error(`no fixture card ${name}`);
  return classifyManaCard(card, identity).land?.units;
};

describe('a land that makes colour only by paying or by restriction taps for {C}', () => {
  it.each([
    ['Daily Bugle Building', '{1}, {T}: Add one mana of any color'],
    ['Captivating Cave', '{1}, {T}: Add one mana of any color'],
    ['Springjack Pasture', 'sacrifice Goats for any one color'],
    ['Power Depot', 'any color, only to cast artifact spells'],
    ['Cavern of Souls', 'any color, only to cast a creature of the chosen type'],
    ['Faceless Haven', 'colourless only'],
  ])('%s (%s)', (name) => {
    expect(units(name)).toEqual([MANA_C]);
  });

  it('leaves the sacrifice-for-{B}{B} out of Phyrexian Tower: it taps for {C}', () => {
    expect(units('Phyrexian Tower')).toEqual([MANA_C]);
  });
});

describe('lands that tap for colour unconditionally keep it', () => {
  it('Command Tower clamps to the identity', () => {
    expect(units('Command Tower', MANA_W | MANA_G)).toEqual([MANA_W | MANA_G]);
  });
  it('a shock land, City of Brass and Exotic Orchard', () => {
    expect(units('Hallowed Fountain')).toHaveLength(1);
    expect(units('City of Brass')).toEqual([ANY_COLOR]);
    expect(units('Exotic Orchard', MANA_B | MANA_G)).toEqual([MANA_B | MANA_G]);
  });
  it('Cactus Preserve still taps for the types a land could make, clamped to the identity', () => {
    expect(units('Cactus Preserve', MANA_B | MANA_G)).toEqual([MANA_B | MANA_G]);
  });
});
