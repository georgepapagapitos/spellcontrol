// E585: the deck-analysis mana tally reads a land's colors from the abilities
// that always work, not from Scryfall's produced_mana (which also lists what a
// paid, sacrifice or spend-restricted ability makes). Real Oracle text.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import fixture from '@/lib/mana-sim/__fixtures__/land-abilities.fixture.json';
import { producedManaColors } from './mana-sources';

const CARDS = new Map((fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c]));
const colours = (name: string, identity: string[] = ['W', 'U', 'B', 'R', 'G']) => {
  const card = CARDS.get(name);
  if (!card) throw new Error(`no fixture card ${name}`);
  return producedManaColors(card, new Set(identity)).sort();
};

describe('a land that makes color only by paying or by restriction counts as {C}', () => {
  it.each([
    'Daily Bugle Building',
    'Captivating Cave',
    'Springjack Pasture',
    'Power Depot',
    'Cavern of Souls',
    'Faceless Haven',
    'Phyrexian Tower',
  ])('%s', (name) => {
    expect(colours(name)).toEqual(['C']);
  });
});

describe('lands that tap for color unconditionally keep it', () => {
  it('Command Tower clamps to the identity', () => {
    expect(colours('Command Tower', ['W', 'G'])).toEqual(['G', 'W']);
  });
  it('City of Brass keeps all five', () => {
    expect(colours('City of Brass')).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
  it('Exotic Orchard and Cactus Preserve clamp to the identity', () => {
    expect(colours('Exotic Orchard', ['B', 'G'])).toEqual(['B', 'G']);
    expect(colours('Cactus Preserve', ['B', 'G'])).toEqual(['B', 'G']);
  });
  it('a shock land keeps both colors', () => {
    expect(colours('Hallowed Fountain')).toEqual(['U', 'W']);
  });
});

describe('allAbilities keeps Scryfall reading for staple slot priority', () => {
  it('Phyrexian Tower reads B and C with it, C alone without', () => {
    const tower = CARDS.get('Phyrexian Tower')!;
    const all = new Set(['W', 'U', 'B', 'R', 'G']);
    expect(producedManaColors(tower, all, { allAbilities: true }).sort()).toEqual(['B', 'C']);
    expect(producedManaColors(tower, all)).toEqual(['C']);
  });
});
