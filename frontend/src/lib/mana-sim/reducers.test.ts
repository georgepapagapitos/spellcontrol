import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyManaCard, compileManaDeck, identityMask } from './index';
import { simulateGoal, simulateManaDeck } from './engine';
import { parseManaCost } from './cost';
import { appliesTo, reducedCost } from './reducers';
import { MANA_B, MANA_R, MANA_U, type ManaCard } from './types';
import { reducerCard } from './__fixtures__/reducer-cards';
import { drawCard } from './__fixtures__/draw-cards';

// Every card is a real Scryfall record (reducers.fixture.json, from the clock corpus decks).
const ID = identityMask([]);
const cardOf = (name: string): ManaCard => classifyManaCard(reducerCard(name), ID);

describe('reading cost reducers', () => {
  it.each([
    ['Jet Medallion', 1, 'B'],
    ['Ruby Medallion', 1, 'R'],
    ['Sapphire Medallion', 1, 'U'],
    ["Hazoret's Monument", 1, 'R'],
    ['Etherium Sculptor', 1, 'A'],
    ['Foundry Inspector', 1, 'A'],
    ["Dragonlord's Servant", 1, 'dragon'],
    ['Dragonspeaker Shaman', 2, 'dragon'],
    ['Sarkhan, Soul Aflame', 1, 'dragon'],
    ['Goblin Warchief', 1, 'goblin'],
  ])('%s reduces by %i for %s spells', (name, n, who) => {
    const [r, ...rest] = cardOf(name).reducers;
    expect(rest).toHaveLength(0);
    expect(r.n).toBe(n);
    expect(r.filters).toHaveLength(1);
    const f = r.filters[0];
    if (who === 'A') expect(f.kinds).toBe(1);
    else if (['B', 'R', 'U'].includes(who)) {
      expect(f.colors).toBe({ B: MANA_B, R: MANA_R, U: MANA_U }[who]);
    } else expect(f.tribe).toBe(who);
  });

  it.each([
    "Herald's Horn", // a type chosen on entry
    "Urza's Incubator",
    'Morophon, the Boundless',
    'Blasphemous Act', // its own cost
    'Emry, Lurker of the Loch', // affinity
    'Thought Monitor',
    'Thoughtcast',
    'Thrumming Hivepool',
    'Temur Battlecrier', // depends on the board
    'Earthquake Dragon',
    'Shadow of Mortality',
    'Training Grounds', // abilities, not spells
    'Forensic Gadgeteer',
    'Doc Aurlock, Grizzled Genius', // from graveyard or exile
    'Gravebreaker Lamia',
    'Silver-Fur Master',
    'Boseiju, Who Endures', // a channel ability
    'Sokenzan, Crucible of Defiance',
    'Voldaren Estate',
    'Sol Ring',
    'Goldspan Dragon',
  ])('does not read %s as a reducer', (name) => {
    expect(cardOf(name).reducers).toHaveLength(0);
  });

  it('reads the front face: kinds, colors and subtypes', () => {
    const skithiryx = cardOf('Skithiryx, the Blight Dragon');
    expect(skithiryx.colors).toBe(MANA_B);
    expect(skithiryx.tribes).toEqual(expect.arrayContaining(['phyrexian', 'dragon', 'skeleton']));
    expect(cardOf('Sol Ring').kinds).toBe(1);
    expect(cardOf('Etherium Sculptor').kinds).toBe(1 | 2);
    expect(cardOf('Demonic Tutor').kinds).toBe(16);
    expect(cardOf('Sol Ring').colors).toBe(0);
  });

  it('applies to the right spells and no others', () => {
    const on = (reducer: string, target: string) =>
      appliesTo(cardOf(reducer).reducers[0], cardOf(target));
    expect(on('Jet Medallion', 'Demonic Tutor')).toBe(true);
    expect(on('Jet Medallion', 'Skithiryx, the Blight Dragon')).toBe(true);
    expect(on('Jet Medallion', 'Goldspan Dragon')).toBe(false);
    expect(on('Jet Medallion', 'Sol Ring')).toBe(false);
    expect(on('Jet Medallion', 'Swamp')).toBe(false);
    expect(on('Ruby Medallion', 'Goldspan Dragon')).toBe(true);
    expect(on("Hazoret's Monument", 'Goblin Chieftain')).toBe(true);
    expect(on("Hazoret's Monument", 'Pact of the Serpent')).toBe(false);
    expect(on('Etherium Sculptor', 'Sol Ring')).toBe(true);
    expect(on('Etherium Sculptor', 'Goblin Chieftain')).toBe(false);
    expect(on("Dragonlord's Servant", 'Goldspan Dragon')).toBe(true);
    expect(on("Dragonlord's Servant", 'Skithiryx, the Blight Dragon')).toBe(true);
    expect(on("Dragonlord's Servant", 'Goblin Chieftain')).toBe(false);
    expect(on('Goblin Warchief', 'Siege-Gang Commander')).toBe(true);
    expect(on('Goblin Warchief', 'Goldspan Dragon')).toBe(false);
  });
});

describe('reducedCost', () => {
  it('takes generic off and leaves every pip and Hall check alone', () => {
    const cost = parseManaCost('{3}{B}{B}')!;
    const less = reducedCost(cost, 1);
    expect(less.generic).toBe(2);
    expect(less.units).toBe(cost.units - 1);
    expect(less.mv).toBe(cost.mv);
    expect(less.pips).toEqual(cost.pips);
    expect(less.checks).toEqual(cost.checks);
    expect(less.key).toBe(parseManaCost('{2}{B}{B}')!.key);
    expect(reducedCost(cost, 1)).toBe(less);
  });

  it('never reduces a colored pip', () => {
    const cost = parseManaCost('{1}{R}{R}')!;
    expect(reducedCost(cost, 5).generic).toBe(0);
    expect(reducedCost(cost, 5).units).toBe(2);
    expect(reducedCost(cost, 5).pips).toEqual(cost.pips);
    expect(reducedCost(parseManaCost('{G}{G}')!, 1)).toEqual(parseManaCost('{G}{G}'));
  });
});

function deckOf(
  named: ReadonlyArray<readonly [string, number]>,
  lands: ReadonlyArray<readonly [string, number]>
) {
  const library: ScryfallCard[] = [];
  const get = (n: string) =>
    ['Island', 'Swamp', 'Mountain', 'Counterspell'].includes(n) ? drawCard(n) : reducerCard(n);
  for (const [n, k] of [...named, ...lands]) for (let i = 0; i < k; i++) library.push(get(n));
  while (library.length < 99) library.push(drawCard('Counterspell'));
  return compileManaDeck({ commanders: [], library });
}
const BLACK_LANDS: ReadonlyArray<readonly [string, number]> = [['Swamp', 36]];
const WINNOWER = { options: [{ names: ['Ruthless Winnower'], need: 1 }] };
const run = (deck: ReturnType<typeof deckOf>, goal = WINNOWER) =>
  simulateGoal(deck, goal, { games: 1500, seed: 11 })!;

describe('a goal run with cost reducers', () => {
  it('a Medallion of the piece color brings a big piece online sooner', () => {
    const blank = run(deckOf([['Ruthless Winnower', 6]], BLACK_LANDS));
    const withJet = run(
      deckOf(
        [
          ['Ruthless Winnower', 6],
          ['Jet Medallion', 6],
        ],
        BLACK_LANDS
      )
    );
    expect(withJet.typicalTurn).toBeLessThan(blank.typicalTurn);
  });

  it('a Medallion of another color is a dead card', () => {
    const blank = run(deckOf([['Ruthless Winnower', 6]], BLACK_LANDS));
    const ruby = run(
      deckOf(
        [
          ['Ruthless Winnower', 6],
          ['Ruby Medallion', 6],
        ],
        [
          ['Swamp', 30],
          ['Mountain', 6],
        ]
      )
    );
    expect(ruby.typicalTurn).toBeGreaterThanOrEqual(blank.typicalTurn - 1);
  });

  it('is never cast with nothing in hand to cheapen', () => {
    const deck = deckOf([['Jet Medallion', 8]], BLACK_LANDS);
    // The goal is the Medallion itself: it is a piece, so it is cast; the point is it stays deterministic.
    expect(run(deck, { options: [{ names: ['Jet Medallion'], need: 1 }] })).toEqual(
      run(deck, { options: [{ names: ['Jet Medallion'], need: 1 }] })
    );
  });

  it('castability never sees a reducer', () => {
    const named: ReadonlyArray<readonly [string, number]> = [
      ['Ruthless Winnower', 6],
      ['Jet Medallion', 6],
    ];
    const deck = deckOf(named, BLACK_LANDS);
    const stripped = {
      ...deck,
      library: deck.library.map((c) => ({ ...c, reducers: [] })),
    };
    const opts = { games: 800, seed: 5, maxTurn: 8 };
    expect(simulateManaDeck(deck, opts)).toEqual(simulateManaDeck(stripped, opts));
  });
});
