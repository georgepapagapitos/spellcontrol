import { describe, it, expect } from 'vitest';
import { buildCommanderProfile, whyCardMatches } from './commanderProfile';
import type { ScryfallCard } from '@/deck-builder/types';

// E568: the counter detectors keyed on the bare word "counter", so every
// counterspell read as a counters payoff for an Atraxa deck. Oracle text below
// is verbatim from Scryfall.

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Legendary Creature',
    oracle_text: '',
    color_identity: ['W', 'B'],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const atraxa = makeCard({
  name: "Atraxa, Praetors' Voice",
  type_line: 'Legendary Creature — Phyrexian Angel Horror',
  oracle_text:
    'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
});
const genericCounters = makeCard({
  name: 'Counters Commander',
  oracle_text:
    'Whenever a creature enters, put a +1/+1 counter on it. Remove counters from among them.',
});

const reasonsFor = (commander: ScryfallCard, name: string, type_line: string, oracle: string) =>
  whyCardMatches(
    makeCard({ name, type_line, oracle_text: oracle }),
    buildCommanderProfile(commander)
  );

describe('counterspells are not counters payoffs (E568)', () => {
  it.each([
    ['Counterspell', 'Instant', 'Counter target spell.'],
    ['Dispel', 'Instant', 'Counter target instant spell.'],
    ['Negate', 'Instant', 'Counter target noncreature spell.'],
    [
      'Swan Song',
      'Instant',
      'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.',
    ],
    ['Mana Leak', 'Instant', 'Counter target spell unless its controller pays {3}.'],
    [
      'Stifle',
      'Instant',
      "Counter target activated or triggered ability. (Mana abilities can't be targeted.)",
    ],
  ])('%s earns no reasons for a proliferate commander', (name, type, oracle) => {
    expect(reasonsFor(atraxa, name, type, oracle)).toEqual([]);
  });

  it('Counterspell earns no reasons for a generic counters commander', () => {
    expect(reasonsFor(genericCounters, 'Counterspell', 'Instant', 'Counter target spell.')).toEqual(
      []
    );
  });

  it.each([
    [
      'Evolution Sage',
      'Creature — Elf Druid',
      'Landfall — Whenever a land you control enters, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    ],
    [
      'Grim Affliction',
      'Instant',
      'Put a -1/-1 counter on target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    ],
  ])('%s still reads as a counters payoff for a proliferate commander', (name, type, oracle) => {
    expect(reasonsFor(atraxa, name, type, oracle).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'Hardened Scales',
      'Enchantment',
      'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
    ],
    [
      'Doubling Season',
      'Enchantment',
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
    ],
  ])('%s still reads as a counters payoff for a counters commander', (name, type, oracle) => {
    expect(reasonsFor(genericCounters, name, type, oracle).length).toBeGreaterThan(0);
  });

  it("Atraxa's own text still matches a proliferate commander", () => {
    expect(whyCardMatches(atraxa, buildCommanderProfile(atraxa))).toContain(
      'Places or scales counters'
    );
  });
});
