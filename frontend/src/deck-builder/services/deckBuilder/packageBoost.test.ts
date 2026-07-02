import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  clearPackageBoostCache,
  computePackageBoosts,
  PACKAGE_BOOST_MAX,
  tallyAxisInvestment,
} from './packageBoost';

/** Real cards, real oracle text — the classifier reads the actual words. */
function card(name: string, oracle: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature — Vampire',
    oracle_text: oracle,
    color_identity: ['B'],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const visceraSeer = card('Viscera Seer', 'Sacrifice a creature: Scry 1.');
const carrionFeeder = card(
  'Carrion Feeder',
  'Carrion Feeder can’t block.\nSacrifice a creature: Put a +1/+1 counter on Carrion Feeder.'
);
const yawgmoth = card(
  'Yawgmoth, Thran Physician',
  'Protection from Humans\n{B}, Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.'
);
const bloodArtist = card(
  'Blood Artist',
  'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.'
);
const zulaport = card(
  'Zulaport Cutthroat',
  'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.'
);
const divination = card('Divination', 'Draw two cards.', {
  type_line: 'Sorcery',
  color_identity: ['U'],
});
const vanillaCommander = card('Isamaru, Hound of Konda', '', {
  type_line: 'Legendary Creature — Dog',
  color_identity: ['W'],
});

const cardMap = new Map(
  [visceraSeer, carrionFeeder, yawgmoth, bloodArtist, zulaport, divination].map((c) => [c.name, c])
);

beforeEach(() => clearPackageBoostCache());

describe('tallyAxisInvestment', () => {
  it('tallies sac outlets as sacrifice producers and weighs the commander double', () => {
    const outlets = tallyAxisInvestment([visceraSeer, carrionFeeder, yawgmoth], [vanillaCommander]);
    const sac = outlets.get('sacrifice');
    expect(sac?.producers).toBe(3);
    expect(sac?.payoffs ?? 0).toBe(0);

    const withCommander = tallyAxisInvestment([visceraSeer], [bloodArtist]);
    expect(withCommander.get('sacrifice')?.payoffs).toBe(2); // commander × 2
  });
});

describe('computePackageBoosts', () => {
  it('boosts the starved payoff side of a live aristocrats engine, never the majority side', () => {
    // Three sac outlets picked, zero payoffs → the engine begs for Blood Artist.
    const investment = tallyAxisInvestment(
      [visceraSeer, carrionFeeder, yawgmoth],
      [vanillaCommander]
    );
    const boosts = computePackageBoosts(
      ['Blood Artist', 'Zulaport Cutthroat', 'Divination', 'Viscera Seer'],
      cardMap,
      investment
    );
    // 10 × (3 − 0) / (0 + 1) = 30 → per-axis cap 20 binds (the +30 total cap
    // is reserved for genuinely multi-axis completions).
    expect(boosts.get('Blood Artist')).toBe(20);
    expect(boosts.get('Zulaport Cutthroat')).toBe(20);
    // Goodstuff filler gets nothing; a 4th outlet (majority side) gets nothing.
    expect(boosts.has('Divination')).toBe(false);
    expect(boosts.has('Viscera Seer')).toBe(false);
  });

  it('boosts fuel when payoffs outnumber outlets (the mirror direction)', () => {
    const investment = tallyAxisInvestment([bloodArtist, zulaport, bloodArtist], []);
    const boosts = computePackageBoosts(['Viscera Seer', 'Blood Artist'], cardMap, investment);
    expect(boosts.get('Viscera Seer')).toBeGreaterThan(0);
    expect(boosts.has('Blood Artist')).toBe(false);
  });

  it('stays silent below the live threshold and shrinks as the engine balances', () => {
    // Two outlets only → not a live engine yet.
    const budding = tallyAxisInvestment([visceraSeer, carrionFeeder], [vanillaCommander]);
    expect(computePackageBoosts(['Blood Artist'], cardMap, budding).size).toBe(0);

    // 3 outlets + 2 payoffs → live but nearly balanced: small boost, not the cap.
    const nearlyBalanced = tallyAxisInvestment(
      [visceraSeer, carrionFeeder, yawgmoth, bloodArtist, zulaport],
      [vanillaCommander]
    );
    const boosts = computePackageBoosts(['Blood Artist'], cardMap, nearlyBalanced);
    const b = boosts.get('Blood Artist') ?? 0;
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(PACKAGE_BOOST_MAX / 2);
  });

  it('skips candidates missing from the card map and balanced engines entirely', () => {
    const balanced = tallyAxisInvestment([visceraSeer, bloodArtist, carrionFeeder, zulaport], []);
    // producers 2 vs payoffs 2 → nothing to complete.
    expect(computePackageBoosts(['Blood Artist', 'Viscera Seer'], cardMap, balanced).size).toBe(0);
    expect(computePackageBoosts(['Not A Card'], cardMap, balanced).size).toBe(0);
  });
});
