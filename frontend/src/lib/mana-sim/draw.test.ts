import { describe, expect, it } from 'vitest';
import { classifyManaCard } from './classify';
import type { DrawEffect } from './types';
import { drawCard } from './__fixtures__/draw-cards';

const read = (name: string): DrawEffect | null => classifyManaCard(drawCard(name), 0).draw;
const fx = (over: Partial<DrawEffect>): DrawEffect => ({
  draw: 0,
  putBack: 0,
  discard: 0,
  look: 0,
  take: 0,
  scry: 0,
  scryFirst: false,
  perTurn: 0,
  ...over,
});

// Every card below is a real Scryfall record (draw.fixture.json).
describe('draw and selection, read from Oracle text', () => {
  it.each([
    ['Divination', fx({ draw: 2 })],
    ['Sign in Blood', fx({ draw: 2 })],
    ["Night's Whisper", fx({ draw: 2 })],
    ['Harmonize', fx({ draw: 3 })],
    ['Treasure Cruise', fx({ draw: 3 })],
    ['Mulldrifter', fx({ draw: 2 })],
    ['Gitaxian Probe', fx({ draw: 1 })],
  ])('%s is a plain draw', (name, expected) => {
    expect(read(name)).toEqual(expected);
  });

  it('reads the cost after the draw: Brainstorm puts two back, Faithless Looting discards two', () => {
    expect(read('Brainstorm')).toEqual(fx({ draw: 3, putBack: 2 }));
    expect(read('Faithless Looting')).toEqual(fx({ draw: 2, discard: 2 }));
  });

  it('reads looking at the top of the library', () => {
    expect(read('Impulse')).toEqual(fx({ look: 4, take: 1 }));
    expect(read('Dig Through Time')).toEqual(fx({ look: 7, take: 2 }));
    // Ponder draws the best of the top three: a look with a draw and no take.
    expect(read('Ponder')).toEqual(fx({ look: 3, draw: 1 }));
  });

  it('reads scry, before the draw when the card says so', () => {
    expect(read('Preordain')).toEqual(fx({ scry: 2, scryFirst: true, draw: 1 }));
    expect(read('Opt')).toEqual(fx({ scry: 1, scryFirst: true, draw: 1 }));
    expect(read('Read the Bones')).toEqual(fx({ scry: 2, scryFirst: true, draw: 2 }));
    expect(read('Serum Visions')).toEqual(fx({ draw: 1, scry: 2 }));
  });

  it('reads a draw every turn from the permanent', () => {
    expect(read('Phyrexian Arena')).toEqual(fx({ perTurn: 1 }));
  });

  it("reads the caster's draw out of a line that also hits opponents", () => {
    // "You draw two cards and you lose 2 life. Each opponent gets a poison counter."
    expect(read('Infectious Inquiry')).toEqual(fx({ draw: 2 }));
  });

  it('reads a reveal that takes only lands, and an upkeep exile-and-play', () => {
    expect(read('Satyr Wayfinder')).toEqual(fx({ look: 4, take: 1, landOnly: true }));
    // Charred Foyer: exile the top card each upkeep, you may play it this turn.
    expect(read('Charred Foyer // Warped Space')).toEqual(fx({ perTurn: 1 }));
    expect(read('Bonehoard Dracosaur')).toEqual(fx({ perTurn: 2 }));
  });

  it.each([
    'Skullclamp', // draws when the equipped creature dies
    'Tatyova, Benthic Druid', // landfall
    'Welcoming Vampire', // a creature entering, with a power limit
    'Eternal Witness', // returns, does not draw
    'Grisly Salvage', // takes creatures or lands: kinds the simulator cannot tell apart
    'Goblin Ringleader', // takes every Goblin
    'Kaalia, Zenith Seeker',
    'Dark Deal', // every player
    'Plea for Power', // a vote
    'Hex Magic', // as many as the hand held
    'Staff of Domination', // activated, paid
    'Idol of Oblivion',
    "Sensei's Divining Top",
    'The One Ring', // draws a growing number
    'Laelia, the Blade Reforged', // when it attacks
    'Etali, Primal Storm',
    'Commune with Lava', // X
  ])('does not read %s (real oracle text)', (name) => {
    expect(read(name)).toBeNull();
  });

  it.each([
    'Rhystic Study', // opponent-triggered
    'Mystic Remora',
    'Esper Sentinel',
    'Consecrated Sphinx', // "whenever an opponent draws"
    'Beast Whisperer', // "whenever you cast a creature spell"
    'Mind Stone', // an activated ability, not the cast
    'Wheel of Fortune', // every player draws
    'Windfall',
    'Fact or Fiction', // piles, not a count
    'Sylvan Library', // draws two and pays 4 life each or puts them back
    'Font of Mythos', // each player's draw step
    'Lightning Bolt',
    'Swords to Plowshares',
    'Counterspell',
    'Demonic Tutor',
    'Sol Ring',
    'Cultivate',
  ])('does not read %s as drawing', (name) => {
    expect(read(name)).toBeNull();
  });

  it('never reads a land', () => {
    expect(read('Island')).toBeNull();
  });
});
