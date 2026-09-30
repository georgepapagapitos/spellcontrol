// E511: a typal deck's tribe is its tribal fuel. Before, the tally counted
// only text-read producers (Banners, changelings), so a deck of Elves and Elf
// lords read producer-scarce and the scarce-side boost pushed Banners over
// staples (Lathril lost Lightning Greaves and Swiftfoot Boots on the panel).
import { beforeEach, describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import {
  clearPackageBoostCache,
  computePackageBoosts,
  packageFitAxes,
  tallyAxisInvestment,
} from './packageBoost';
import { tribeMembership } from '@/deck-builder/services/synergy/axes';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { TRIBAL_CARDS } from './__fixtures__/tribal-cards.fixture';

const card = (name: string): ScryfallCard => {
  const c = TRIBAL_CARDS.get(name);
  if (!c) throw new Error(`no fixture card ${name}`);
  return c;
};

const DECKS = {
  elves: {
    commander: 'Lathril, Blade of the Elves',
    tribe: 'Elf',
    lord: 'Elvish Archdruid',
    picked: [
      'Llanowar Elves',
      'Elvish Mystic',
      'Priest of Titania',
      'Heritage Druid',
      'Elvish Warmaster',
      'Imperious Perfect',
      'Marwyn, the Nurturer',
      'Elvish Visionary',
      'Fyndhorn Elves',
      'Allosaurus Shepherd',
    ],
  },
  goblins: {
    commander: 'Krenko, Mob Boss',
    tribe: 'Goblin',
    lord: 'Goblin King',
    picked: [
      'Goblin Chieftain',
      'Goblin Warchief',
      'Skirk Prospector',
      'Goblin Matron',
      'Beetleback Chief',
      'Legion Loyalist',
      'Goblin Lackey',
      'Mogg War Marshal',
      'Goblin Recruiter',
      'Conspicuous Snoop',
      'Muxus, Goblin Grandee',
    ],
  },
  dragons: {
    commander: 'The Ur-Dragon',
    tribe: 'Dragon',
    lord: 'Dragonspeaker Shaman',
    picked: [
      "Dragonlord's Servant",
      'Scourge of Valkas',
      'Old Gnawbone',
      'Lathliss, Dragon Queen',
      'Miirym, Sentinel Wyrm',
      'Goldspan Dragon',
      'Utvara Hellkite',
      'Dragon Tempest',
      'Terror of the Peaks',
      'Klauth, Unrivaled Ancient',
    ],
  },
} as const;

const TYPE_AGNOSTIC_SUPPORT = [
  "Vanquisher's Banner",
  'Banner of Kinship',
  'Patchwork Banner',
  'Changeling Outcast',
  'Realmwalker',
  'Metallic Mimic',
];

beforeEach(() => clearPackageBoostCache());

describe.each(Object.entries(DECKS))('tribal package boost: %s', (_, deck) => {
  const commander = card(deck.commander);
  const picked = deck.picked.map(card);

  it('read producer-scarce from card text alone (the bug)', () => {
    let producers = 0;
    let payoffs = 0;
    for (const c of [commander, commander, ...picked]) {
      const cs = classifyCard(c);
      producers += cs.producers.filter((p) => p.axis === 'tribal').length;
      payoffs += cs.payoffs.filter((p) => p.axis === 'tribal').length;
    }
    expect(producers).toBeLessThan(payoffs);
  });

  it('counts the tribe as fuel, so the deck is no longer producer-scarce', () => {
    const tribal = tallyAxisInvestment(picked, [commander]).get('tribal')!;
    expect(tribal.tribes).toContain(deck.tribe);
    expect(tribal.producers).toBeGreaterThanOrEqual(tribal.payoffs);
  });

  it('never boosts type-agnostic support on the tribal axis', () => {
    const investment = tallyAxisInvestment(picked, [commander]);
    for (const name of TYPE_AGNOSTIC_SUPPORT) {
      expect({
        name,
        tribal: packageFitAxes(card(name), investment).some((a) => a.axis === 'tribal'),
      }).toEqual({ name, tribal: false });
    }
    // The Banners and a bare changeling sit on no other axis, so nothing lifts
    // them over a staple. (Metallic Mimic can still earn a counters boost: its
    // +1/+1 counter clause is read by that axis, not by the tribe.)
    const bare = [
      "Vanquisher's Banner",
      'Banner of Kinship',
      'Patchwork Banner',
      'Changeling Outcast',
    ];
    const boosts = computePackageBoosts(bare, TRIBAL_CARDS, investment);
    for (const name of bare)
      expect({ name, boost: boosts.get(name) ?? 0 }).toEqual({ name, boost: 0 });
  });

  it('never boosts any card on the tribal axis, lords included', () => {
    // The Sivitri case: Sivitri's Dragon tutor plus capped members tipped the
    // axis payoff-scarce and Dragonstorm Globe displaced a combo piece.
    const investment = tallyAxisInvestment(picked, [commander]);
    for (const name of [deck.lord, 'Dragonstorm Globe', ...TYPE_AGNOSTIC_SUPPORT]) {
      expect({
        name,
        tribal: packageFitAxes(card(name), investment).some((a) => a.axis === 'tribal'),
      }).toEqual({ name, tribal: false });
    }
  });
});

describe('the members rule is one definition (E511)', () => {
  const zombies = [
    'Wilhelt, the Rotcleaver',
    'Varina, Lich Queen',
    'Death Baron',
    'Diregraf Captain',
    'Lord of the Accursed',
    'Cryptbreaker',
    'Gray Merchant of Asphodel',
    'Undead Warchief',
    'Cemetery Reaper',
    'Champion of the Perished',
    'Gravecrawler',
    'Relentless Dead',
    'Diregraf Colossus',
    'Headless Rider',
    'Tomb Tyrant',
    "Liliana's Mastery",
  ].map(card);

  it('a Zombie deck is not reported as short of producers', () => {
    const synergy = analyzeDeckSynergy(zombies);
    const tribal = synergy.axes.find((a) => a.axis === 'tribal')!;
    expect(tribal.producers.length).toBeGreaterThanOrEqual(tribal.payoffs.length);
    expect(synergy.warnings.filter((w) => w.startsWith('Tribal'))).toEqual([]);
    expect(tribal.producers.some((p) => p.reason === 'one of your Zombies')).toBe(true);
  });

  it('the deck page and the tally count the same members', () => {
    const synergy = analyzeDeckSynergy(zombies);
    const deck = synergy.axes.find((a) => a.axis === 'tribal')!;
    const tally = tallyAxisInvestment(zombies, []).get('tribal')!;
    expect(tally.producers).toBe(deck.producers.length);
    expect(tally.payoffs).toBe(deck.payoffs.length);
  });

  it('a stray payoff never turns a tribe into an engine', () => {
    // One Dragon payoff among eleven Dragons adds at most one member.
    const dragons = [
      "Dragonlord's Servant",
      'Goldspan Dragon',
      'Terror of the Peaks',
      'Old Gnawbone',
    ].map(card);
    const tribal = analyzeDeckSynergy(dragons).axes.find((a) => a.axis === 'tribal')!;
    expect(tribal.producers.length).toBeLessThanOrEqual(tribal.payoffs.length);
  });
});

describe('tribeMembership', () => {
  const elf = new Set(['Elf']);
  it('reads the front face type line and treats changelings as every type', () => {
    expect(tribeMembership(card('Llanowar Elves'), elf)).toBe('Elf');
    expect(tribeMembership(card('Changeling Outcast'), elf)).toBe('Elf');
    expect(tribeMembership(card('Goblin Lackey'), elf)).toBeUndefined();
    expect(tribeMembership(card("Vanquisher's Banner"), elf)).toBeUndefined();
    expect(tribeMembership(card('Llanowar Elves'), new Set())).toBeUndefined();
  });
});
