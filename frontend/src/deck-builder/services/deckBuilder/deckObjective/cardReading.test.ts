// @vitest-environment node
//
// The objective's reading of the cards the second optimizer gate caught it
// misreading (2026-09-29), over their real oracle text: tutors that find
// narrowly or into the graveyard, combo lines that don't work in the deck,
// protection that can't reach the commander, draw that isn't an engine,
// feeders that don't feed, and a sticker sheet that isn't a deck card.
import { describe, expect, it } from 'vitest';
import type { DetectedCombo } from '@/deck-builder/types';
import { cardIneligibility, viableCombos } from './constraints';
import { isSurvivalPiece } from './factsReading';
import { readTutors } from './terms/tutors';
import { enginesTerm } from './terms/engines';
import { synergyTerm } from './terms/synergy';
import { nonboTerm } from './terms/nonbo';
import { protectedCards } from './trustRegion';
import { BASELINE, FIX, MEREN, card, cards, merenCtx } from './__fixtures__/objectiveFixture';

const combo = (comboId: string, names: string[]): DetectedCombo => ({
  comboId,
  cards: names,
  results: ['Win the game'],
  isComplete: true,
  missingCards: [],
  deckCount: 100000,
  bracket: null,
  bracketTag: null,
  cardCount: names.length,
});
const ORACLE_CONSULT = combo('742-1295', ['Demonic Consultation', "Thassa's Oracle"]);
const ORACLE_PACT = combo('1295-3093', ['Tainted Pact', "Thassa's Oracle"]);
const SCEPTER_TEMPLATE = combo('11-5261--41', ["Narset's Reversal", 'Isochron Scepter']);

const YURIKO = card("Yuriko, the Tiger's Shadow");
const yuriko = (names: string[], basics: string[]) => ({
  commanders: [YURIKO],
  cards: [...cards(...names), ...basics.map((b) => card(b))],
});
const ctx = merenCtx({ combos: [ORACLE_CONSULT, ORACLE_PACT, SCEPTER_TEMPLATE] });

describe('which combo lines work in this deck', () => {
  it('counts a template line only once the deck is known to meet the template', () => {
    const deck = yuriko(["Narset's Reversal", 'Isochron Scepter'], ['Island']);
    expect(viableCombos(deck, ctx).map((c) => c.comboId)).not.toContain('11-5261--41');
    const met = merenCtx({ combos: [{ ...SCEPTER_TEMPLATE, templatesSatisfied: true }] });
    expect(viableCombos(deck, met).map((c) => c.comboId)).toEqual(['11-5261--41']);
  });

  it('needs a library with no repeated name for Tainted Pact', () => {
    const repeated = yuriko(['Tainted Pact', "Thassa's Oracle"], ['Island', 'Island']);
    const singleton = yuriko(
      ['Tainted Pact', "Thassa's Oracle"],
      ['Island', 'Snow-Covered Island']
    );
    expect(viableCombos(repeated, ctx).map((c) => c.comboId)).toEqual([]);
    expect(viableCombos(singleton, ctx).map((c) => c.comboId)).toEqual(['1295-3093']);
    // Demonic Consultation names its card: repeated basics don't matter.
    const consult = yuriko(['Demonic Consultation', "Thassa's Oracle"], ['Island', 'Island']);
    expect(viableCombos(consult, ctx).map((c) => c.comboId)).toEqual(['742-1295']);
  });
});

describe('tutors read narrowly', () => {
  const tutorsOf = (names: string[]) =>
    readTutors(
      { commanders: [MEREN], cards: [...BASELINE.cards.slice(0, 80), ...cards(...names)] },
      ctx
    );

  it('a search into the graveyard finds only what the deck brings back', () => {
    // Meren's deck reanimates (Reanimate, Victimize): Loremage finds a creature.
    const t = tutorsOf(['Oriq Loremage']).find((x) => x.name === 'Oriq Loremage')!;
    expect(t.why).toMatch(/into the graveyard to bring back/);
    expect(card(t.target).type_line).toMatch(/Creature/);
    // With no recursion at all, it finds nothing.
    const bare = readTutors(
      {
        commanders: [YURIKO],
        cards: cards('Oriq Loremage', 'Island', "Thassa's Oracle", 'Sol Ring'),
      },
      ctx
    );
    expect(bare.find((x) => x.name === 'Oriq Loremage')).toBeUndefined();
  });

  it('a Ninja or Goblin search finds only Ninjas or Goblins, and a combat-hit search only some games', () => {
    const find = (tutor: string, others: string[]) =>
      readTutors({ commanders: [YURIKO], cards: cards(tutor, ...others) }, ctx).find(
        (x) => x.name === tutor
      );
    // Nothing to find: Command Tower and Sol Ring are no Ninja and no Goblin.
    expect(find('Higure, the Still Wind', ['Command Tower', 'Sol Ring'])).toBeUndefined();
    expect(find('Goblin Matron', ['Command Tower', 'Sol Ring'])).toBeUndefined();
    // Yuriko's own Ninjas: Higure finds one, at half the worth of a sure search.
    const higure = find('Higure, the Still Wind', [
      'Command Tower',
      'Sol Ring',
      'Dokuchi Silencer',
    ]);
    expect(higure?.target).toBe('Dokuchi Silencer');
  });

  it('a sacrifice cost needs its fodder in the deck', () => {
    // Shadow-Rite Priest sacrifices another Cleric: Yuriko's list has none.
    const deck = {
      commanders: [YURIKO],
      cards: cards('Shadow-Rite Priest', "Thassa's Oracle", 'Island'),
    };
    expect(readTutors(deck, ctx).find((x) => x.name === 'Shadow-Rite Priest')).toBeUndefined();
  });

  it('keeps the tutor for a line the deck just completed', () => {
    const deck = yuriko(
      ['Scheming Symmetry', 'Demonic Consultation', "Thassa's Oracle"],
      ['Island']
    );
    expect(protectedCards(deck, ctx).get('Scheming Symmetry')).toMatchObject({
      cls: 'combo tutor',
    });
  });
});

describe('protection, engines and feeders the gate caught', () => {
  it('protects the commander only when it can reach it', () => {
    // "Target Spirit gains hexproof": Meren is a Human Shaman.
    const rattlechains = card('Rattlechains');
    expect(isSurvivalPiece(rattlechains, ctx.factsOf(rattlechains), [MEREN])).toBe(false);
    const greaves = card('Lightning Greaves');
    expect(isSurvivalPiece(greaves, ctx.factsOf(greaves), [MEREN])).toBe(true);
    // Skrelv's current Oracle text reaches "another target creature you
    // control" (no toxic/infect restriction any more): it is protection.
    const skrelv = card('Skrelv, Defector Mite');
    expect(isSurvivalPiece(skrelv, ctx.factsOf(skrelv), [MEREN])).toBe(true);
  });

  it('an empty-hand draw and an opponents-draw trigger are not engines', () => {
    const v = enginesTerm(
      { commanders: [MEREN], cards: cards('Asylum Visitor', 'Bounty Board', 'Sylvan Library') },
      ctx
    );
    expect(v.cards.map((c) => c.name)).toEqual(['Sylvan Library']);
  });

  it('a creature dying is fed by what makes a creature die', () => {
    const v = synergyTerm(
      {
        commanders: [MEREN],
        cards: cards('Soul Net', 'Viscera Seer', 'Sol Ring', 'Braidwood Sextant'),
      },
      ctx
    );
    const net = v.cards.find((c) => c.name === 'Soul Net');
    expect(net?.note).toMatch(/pays off creature-death/);
    expect(net?.note).toMatch(/Viscera Seer/);
    expect(net?.note).not.toMatch(/Braidwood Sextant|Sol Ring/);
  });

  it("a cast trigger is fed by cards of that kind: Sythis isn't fed by Enduring Ideal", () => {
    const sythis = card("Sythis, Harvest's Hand");
    const v = synergyTerm(
      { commanders: [sythis], cards: cards('Enduring Ideal', 'Argothian Enchantress') },
      ctx
    );
    const feeders = v.cards.filter((c) => /feeds Sythis/.test(c.note)).map((c) => c.name);
    expect(feeders).not.toContain('Enduring Ideal');
  });

  it('a card that makes its own Rats is not missing a Rat to trigger on', () => {
    const v = nonboTerm(
      { commanders: [MEREN], cards: cards('Lord Skitter, Sewer King', 'Sol Ring') },
      ctx
    );
    expect(v.cards.find((c) => c.name === 'Lord Skitter, Sewer King')).toBeUndefined();
  });

  it('a wipe that needs a blocking Wall is no wipe here (Glyph of Reincarnation)', () => {
    const glyph = ctx.factsOf(card('Glyph of Reincarnation'));
    expect(glyph.interaction.filter((f) => f.scope === 'mass')).toEqual([]);
    expect(glyph.roles.some((r) => r.role === 'boardwipe')).toBe(false);
  });

  it('a sticker sheet is not a card for the deck', () => {
    expect(cardIneligibility(card('Wild Ogre Bupkis'), merenCtx({ colorIdentity: ['R'] }))).toBe(
      'not a card for the deck'
    );
    expect(FIX.cards.length).toBeGreaterThan(0);
  });
});
