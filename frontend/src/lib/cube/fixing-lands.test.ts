// E581: a fixing land's pairs come from the mana it can count on. Scryfall's
// produced_mana also lists what a paid, sacrifice or spend-restricted ability
// makes, and all five colors for a Thriving land, so these real lands read as
// fixing every color pair. Real Oracle text: the mana sim's fixture for the same
// misread (#2676) plus the cube pool's own lands.
import { describe, expect, it } from 'vitest';
import simFixture from '@/lib/mana-sim/__fixtures__/land-abilities.fixture.json';
import cubeFixture from './__fixtures__/fixing-lands.fixture.json';
import { COLOR_PAIRS, pairsFixedBy } from './core';
import { namesToCubePool } from './pool';
import type { OracleFacts } from './oracle';

const facts = new Map(
  [...simFixture.cards, ...cubeFixture.cards].map((c) => [c.name, c as unknown as OracleFacts])
);
const pairs = (name: string) => {
  const [card] = namesToCubePool([name], [], facts);
  return [...pairsFixedBy(card)].sort();
};

describe('cube fixing lands read the mana their free abilities make', () => {
  it.each([
    'Power Depot',
    'Springjack Pasture',
    'Daily Bugle Building',
    'Captivating Cave',
    'Cavern of Souls',
    'Phyrexian Tower',
    'Faceless Haven',
    'Unknown Shores',
  ])('%s fixes no pair', (name) => {
    expect(facts.get(name)?.produced_mana?.length).toBeGreaterThan(0);
    expect(pairs(name)).toEqual([]);
  });

  it('a land that sacrifices itself for any color fixes nothing', () => {
    expect(pairs('Abandoned Outpost')).toEqual([]);
  });

  it('a true rainbow land still fixes every pair', () => {
    expect(pairs('City of Brass')).toEqual([...COLOR_PAIRS].sort());
  });

  it('a shock land fixes its own pair', () => {
    expect(pairs('Hallowed Fountain')).toEqual(['WU']);
  });

  it('an Odyssey filter land nets a mana in two colors, so it fixes its pair', () => {
    expect(pairs('Sunscorched Divide')).toEqual(['RW']);
    expect(pairs('Viridescent Bog')).toEqual(['BG']);
  });

  it('a Thriving land fixes the four pairs holding its own color', () => {
    expect(pairs('Thriving Heath')).toEqual(['GW', 'RW', 'WB', 'WU']);
    expect(pairs('Thriving Grove')).toEqual(['BG', 'GU', 'GW', 'RG']);
  });
});
