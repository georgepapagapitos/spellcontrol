// @vitest-environment node
//
// Guard (E578): `comboEndsGame` judged a Commander Spellbook line by its listed
// results alone, so Staff of Domination + a mana elf ("Infinite untap of
// creatures you control", infinite mana, draw, lifegain) read as non-winning in
// a Lathril, Blade of the Elves deck, where the untaps let Lathril's own tap
// ability (tap ten Elves: each opponent loses 10 life) repeat. The payoffs are
// read off the shipped card facts, so these are real cards, not author-written
// ones.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { comboEndsGame } from './detect';
import { deckComboPayoffs } from './comboPayoffs';

const STAFF_PRIEST = [
  'Infinite untap of creatures you control',
  'Infinite mana',
  'Infinite card draw',
  'Infinite lifegain',
];
const payoffsOf = (...names: string[]) => deckComboPayoffs(names.map((name) => ({ name })));

beforeAll(() => {
  setCardFactsSnapshot(
    JSON.parse(readFileSync(join(__dirname, '../../../../public/card-facts.json'), 'utf8'))
  );
});
afterAll(() => setCardFactsSnapshot(null));

describe('comboEndsGame with the deck in hand', () => {
  it('keeps the one-argument call: results alone, as before', () => {
    expect(comboEndsGame(STAFF_PRIEST)).toBe(false);
    expect(comboEndsGame(['Win the game'])).toBe(true);
  });

  it('Staff of Domination + Priest of Titania wins in a Lathril deck', () => {
    const lathril = payoffsOf('Lathril, Blade of the Elves', 'Staff of Domination');
    expect(comboEndsGame(STAFF_PRIEST, lathril)).toBe(true);
  });

  it('the same line stays non-winning in a deck with no tap payoff', () => {
    const none = payoffsOf('Sol Ring', 'Priest of Titania', 'Elvish Archdruid', 'Impact Tremors');
    expect(comboEndsGame(STAFF_PRIEST, none)).toBe(false);
  });

  it('an untap loop needs an untap payoff: Lathril does not convert a mana-only loop', () => {
    const lathril = payoffsOf('Lathril, Blade of the Elves');
    expect(comboEndsGame(['Infinite colorless mana'], lathril)).toBe(false);
  });

  it('infinite mana with no sink stays non-winning; with an X spell or Ballista it wins', () => {
    const loop = ['Infinite colorless mana'];
    expect(comboEndsGame(loop, payoffsOf('Sol Ring', 'Cultivate', 'Priest of Titania'))).toBe(
      false
    );
    expect(comboEndsGame(loop, payoffsOf('Banefire'))).toBe(true);
    expect(comboEndsGame(loop, payoffsOf('Walking Ballista'))).toBe(true);
  });

  it('infinite ETB wins with Impact Tremors or Purphoros, not with a mana elf', () => {
    const etb = ['Infinite creature ETB'];
    expect(comboEndsGame(etb, payoffsOf('Impact Tremors'))).toBe(true);
    expect(comboEndsGame(etb, payoffsOf('Purphoros, God of the Forge'))).toBe(true);
    expect(comboEndsGame(etb, payoffsOf('Priest of Titania'))).toBe(false);
  });

  it('infinite death triggers win with Blood Artist', () => {
    const dies = ['Infinite death triggers'];
    expect(comboEndsGame(dies, payoffsOf('Blood Artist'))).toBe(true);
    expect(comboEndsGame(dies, payoffsOf('Impact Tremors'))).toBe(false);
  });

  it("infinite draw is not converted here: Spellbook lists Thassa's Oracle lines itself", () => {
    expect(comboEndsGame(['Infinite card draw'], payoffsOf("Thassa's Oracle"))).toBe(false);
  });

  it('without the facts snapshot a deck holds no payoffs (the old behavior)', () => {
    setCardFactsSnapshot(null);
    expect(comboEndsGame(STAFF_PRIEST, payoffsOf('Lathril, Blade of the Elves'))).toBe(false);
  });
});
