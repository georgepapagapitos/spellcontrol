// E531: an enchantress deck's enchantments, a spellslinger deck's instants and
// sorceries and a landfall deck's lands are those engines' producers. Text
// never classifies them, so the axes read producer-scarce in every deck that
// runs the engine, and the scarce-side boost lifted type-agnostic support over
// staples. One capped rule by front-face type line (typeAxisMembership) feeds
// every reader.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import { typeAxisMembership } from '@/deck-builder/services/synergy/typeAxes';
import {
  clearPackageBoostCache,
  computePackageBoosts,
  packageFitAxes,
  tallyAxisInvestment,
} from './packageBoost';
import { unsupportedPayoffAxes } from './synergyDependency';
import { weightedAxisMass } from './roleTargets';
import { TYPE_AXIS_CARDS } from './__fixtures__/type-axis-cards.fixture';

const card = (name: string): ScryfallCard => {
  const c = TYPE_AXIS_CARDS.get(name);
  if (!c) throw new Error(`no fixture card ${name}`);
  return c;
};

const DECKS: Record<
  string,
  { axis: AxisKey; commander: string; picked: string[]; fuel: string[]; filler: string[] }
> = {
  sythis: {
    axis: 'enchantress',
    commander: "Sythis, Harvest's Hand",
    picked: [
      'Eidolon of Blossoms',
      "Enchantress's Presence",
      'Setessan Champion',
      'Zendikar Resurgent',
      'Rhystic Study',
      'Wild Growth',
      'Utopia Sprawl',
      'Ghostly Prison',
      'Sol Ring',
      'Arcane Signet',
    ],
    fuel: ['Rhystic Study', 'Ghostly Prison', 'Wild Growth', 'Zendikar Resurgent'],
    filler: ['Sterling Grove', 'Swiftfoot Boots', 'Lightning Greaves'],
  },
  talrand: {
    axis: 'spellslinger',
    commander: 'Talrand, Sky Summoner',
    picked: [
      'Archmage Emeritus',
      'Young Pyromancer',
      'Baral, Chief of Compliance',
      'Ponder',
      'Brainstorm',
      'Counterspell',
      'Fact or Fiction',
      'Lightning Bolt',
      'Swords to Plowshares',
      'Sol Ring',
    ],
    fuel: ['Ponder', 'Brainstorm', 'Counterspell', 'Fact or Fiction', 'Lightning Bolt'],
    filler: ['Swiftfoot Boots', 'Lightning Greaves', 'Arcane Signet'],
  },
  landfall: {
    axis: 'landfall',
    commander: 'Tatyova, Benthic Druid',
    picked: [
      'Lotus Cobra',
      'Avenger of Zendikar',
      'Field of the Dead',
      'Command Tower',
      'Forest',
      'Island',
      'Sol Ring',
      'Arcane Signet',
    ],
    fuel: ['Command Tower', 'Forest', 'Island', 'Field of the Dead'],
    filler: ['Swiftfoot Boots', 'Lightning Greaves'],
  },
};

beforeEach(() => clearPackageBoostCache());

describe.each(Object.entries(DECKS))('type-line producers: %s', (_, deck) => {
  const commander = card(deck.commander);
  const picked = deck.picked.map(card);

  it('read producer-scarce from card text alone (the bug)', () => {
    let producers = 0;
    let payoffs = 0;
    for (const c of [commander, commander, ...picked]) {
      const cs = classifyCard(c);
      producers += cs.producers.filter((p) => p.axis === deck.axis).length;
      payoffs += cs.payoffs.filter((p) => p.axis === deck.axis).length;
    }
    expect(producers).toBeLessThan(payoffs);
  });

  it('counts the deck cards of the axis type as producers in the tally', () => {
    const inv = tallyAxisInvestment(picked, [commander]).get(deck.axis)!;
    expect(inv.producers).toBeGreaterThanOrEqual(inv.payoffs);
  });

  it('counts them in the deck page synergy read, by the same rule as the tally', () => {
    const synergy = analyzeDeckSynergy(picked);
    const axis = synergy.axes.find((a) => a.axis === deck.axis)!;
    const inv = tallyAxisInvestment(picked, []).get(deck.axis)!;
    expect(axis.producers.length).toBe(inv.producers);
    expect(axis.payoffs.length).toBe(inv.payoffs);
    expect(axis.producers.some((p) => p.reason.startsWith('one of your'))).toBe(true);
  });

  it('counts them in the average-deck read at the same weight', () => {
    const mass = weightedAxisMass(picked.map((c) => ({ card: c, weight: 1 })));
    const inv = tallyAxisInvestment(picked, []).get(deck.axis)!;
    const axisMass = mass.find((m) => m.axis === deck.axis)!;
    expect(axisMass.producers).toBeCloseTo(inv.producers);
  });

  it('never boosts on the axis, so type-agnostic filler never jumps a staple', () => {
    const investment = tallyAxisInvestment(picked, [commander]);
    for (const name of [...deck.filler, ...deck.fuel]) {
      expect({
        name,
        onAxis: packageFitAxes(card(name), investment).some((a) => a.axis === deck.axis),
      }).toEqual({ name, onAxis: false });
    }
    // The filler sits on no other axis, so nothing lifts it over a staple.
    const boosts = computePackageBoosts(deck.filler, TYPE_AXIS_CARDS, investment);
    for (const name of deck.filler.filter((n) => n !== 'Sterling Grove'))
      expect({ name, boost: boosts.get(name) ?? 0 }).toEqual({ name, boost: 0 });
  });
});

describe('Sythis: a tutor is not lifted over a staple', () => {
  it('Sterling Grove gets no enchantress boost', () => {
    const deck = DECKS.sythis;
    const investment = tallyAxisInvestment(deck.picked.map(card), [card(deck.commander)]);
    const boosts = computePackageBoosts(['Sterling Grove'], TYPE_AXIS_CARDS, investment);
    expect(boosts.get('Sterling Grove') ?? 0).toBe(0);
  });
});

describe('the cap: a stray payoff never makes an engine', () => {
  it('one landfall payoff among many lands adds no more producers than payoffs', () => {
    const lands = ['Command Tower', 'Forest', 'Island', 'Field of the Dead'];
    const deck = ['Lotus Cobra', 'Avenger of Zendikar', ...lands].map(card);
    const landfall = analyzeDeckSynergy(deck).axes.find((a) => a.axis === 'landfall')!;
    expect(landfall.payoffs.length).toBe(2); // Lotus Cobra and Avenger of Zendikar
    expect(landfall.producers.length).toBeLessThanOrEqual(landfall.payoffs.length);
  });

  it('a deck with no payoff has no producers on the axis', () => {
    const deck = ['Command Tower', 'Forest', 'Island', 'Ponder', 'Rhystic Study'].map(card);
    const axes = analyzeDeckSynergy(deck).axes.map((a) => a.axis);
    expect(axes).not.toContain('enchantress');
    expect(axes).not.toContain('spellslinger');
    expect(axes).not.toContain('landfall');
  });

  it('reads the front face type line only', () => {
    const mdfc = {
      ...card('Ponder'),
      name: 'Spell Side // Land Side',
      type_line: 'Sorcery // Land',
      card_faces: [{ type_line: 'Sorcery' }, { type_line: 'Land' }],
    } as unknown as ScryfallCard;
    const members = typeAxisMembership([
      { card: card('Lotus Cobra'), weight: 5, ...classifyCard(card('Lotus Cobra')) },
      { card: mdfc, weight: 1, producers: [], payoffs: [] },
    ]);
    expect(members.filter((m) => m.axis === 'landfall')).toEqual([]);
  });
});

describe('synergyDependency reads the same producers', () => {
  const presence = card("Enchantress's Presence");

  it('an enchantress payoff is live once the deck holds enchantments', () => {
    const support = [
      card("Sythis, Harvest's Hand"),
      card('Rhystic Study'),
      card('Ghostly Prison'),
      card('Wild Growth'),
      card('Sol Ring'),
    ];
    expect(unsupportedPayoffAxes(presence, support, 1)).toEqual([]);
  });

  it('is still dead in a deck with no enchantments', () => {
    const support = [card('Talrand, Sky Summoner'), card('Sol Ring'), card('Ponder')];
    expect(unsupportedPayoffAxes(presence, support, 1)).toEqual(['enchantress']);
  });

  it('a spellslinger payoff is live in an instants and sorceries deck, dead without them', () => {
    const pyro = card('Young Pyromancer');
    const spells = [
      card('Talrand, Sky Summoner'),
      card('Ponder'),
      card('Brainstorm'),
      card('Counterspell'),
    ];
    expect(unsupportedPayoffAxes(pyro, spells, 1)).toEqual([]);
    expect(unsupportedPayoffAxes(pyro, [card('Sol Ring'), card('Command Tower')], 0)).toEqual([
      'spellslinger',
    ]);
  });

  it('a landfall payoff is live in a deck with lands', () => {
    const cobra = card('Lotus Cobra');
    const support = [
      card('Tatyova, Benthic Druid'),
      card('Command Tower'),
      card('Forest'),
      card('Island'),
    ];
    expect(unsupportedPayoffAxes(cobra, support, 1)).toEqual([]);
  });
});
