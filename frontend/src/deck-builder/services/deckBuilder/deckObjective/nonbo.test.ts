// @vitest-environment node
//
// Graded symmetric-wipe cost over real cards (terms/nonbo.ts).
import { describe, expect, it } from 'vitest';
import { nonboTerm, ownBoard, wipeExposure, WIPE_SELF_SCALE } from './terms/nonbo';
import { BASELINE, MEREN, card, cards, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
const GOBLINS = [
  'Goblin Instigator',
  'Beetleback Chief',
  'Mogg War Marshal',
  'Siege-Gang Commander',
  'Goblin Rabblemaster',
  'Impact Tremors',
  'Skirk Prospector',
];
const krenko = (extra: string[]) => ({
  commanders: [card('Krenko, Mob Boss')],
  cards: cards(...GOBLINS, ...extra),
});
const costOf = (deck: ReturnType<typeof krenko>, name: string) =>
  nonboTerm(deck, ctx).cards.find((c) => c.name === name)?.value ?? 0;

describe('graded symmetric wipes', () => {
  it('costs a wipe by the share of its own board it hits, token makers counting extra', () => {
    const wide = costOf(krenko(['Blasphemous Act']), 'Blasphemous Act');
    // Most of Krenko's board is creatures that make tokens: close to the scale.
    expect(wide).toBeLessThan(-0.8 * WIPE_SELF_SCALE);
    // The same wipe beside mostly non-creature permanents costs little.
    const tall = costOf(
      {
        commanders: [card('Krenko, Mob Boss')],
        cards: cards(
          'Sol Ring',
          'Arcane Signet',
          'Impact Tremors',
          'Blasphemous Act',
          'The One Ring'
        ),
      },
      'Blasphemous Act'
    );
    expect(tall).toBeLessThan(0);
    expect(tall).toBeGreaterThan(wide);
  });

  it('has no cliff: one more token maker moves the cost a little, not by a whole tension', () => {
    const before = costOf(krenko(['Blasphemous Act']), 'Blasphemous Act');
    const after = costOf(krenko(['Blasphemous Act', 'Pitiless Plunderer']), 'Blasphemous Act');
    expect(Math.abs(after - before)).toBeLessThan(0.15);
  });

  it('reads a modal wipe at its kindest mode and a Living Death as free', () => {
    const own = ownBoard(cards('Sol Ring', 'Arcane Signet', 'Gilded Lotus', 'Skullclamp'), ctx);
    // Farewell may exile only creatures: this board of artifacts need not lose a card.
    const farewell = card('Farewell');
    expect(wipeExposure(farewell, ctx.factsOf(farewell), own)).toBe(0);
    const ld = card('Living Death');
    expect(wipeExposure(ld, ctx.factsOf(ld), ownBoard(BASELINE.cards, ctx))).toBe(0);
  });

  it('does not charge a one-sided wipe or a spot answer', () => {
    const own = ownBoard(BASELINE.cards, ctx);
    for (const name of ['Cyclonic Rift', 'Massacre Wurm', 'Path to Exile']) {
      const c = card(name);
      expect(wipeExposure(c, ctx.factsOf(c), own), name).toBeNull();
    }
  });

  it('names the wipe and the share in the note', () => {
    const v = nonboTerm(
      { commanders: [MEREN], cards: [...BASELINE.cards, card('Wrath of God')] },
      ctx
    );
    const wrath = v.cards.find((c) => c.name === 'Wrath of God')!;
    expect(wrath.value).toBeLessThan(0);
    expect(wrath.note).toMatch(/hits \d+(\.\d)?% of the deck's own board/);
  });
});

describe('what a wipe actually reaches (the first optimizer gate)', () => {
  it('reads "the color of your choice" as the colour the caster would name', () => {
    // Talrand's own deck is mono-blue: Wash Out names another colour.
    const talrand = {
      commanders: [card('Talrand, Sky Summoner')],
      cards: cards('Wash Out', 'Sol Ring', 'Rhystic Study'),
    };
    const own = ownBoard([...talrand.commanders, ...talrand.cards], ctx);
    const wash = card('Wash Out');
    expect(wipeExposure(wash, ctx.factsOf(wash), own)).toBe(0);
  });

  it('lets a charm cast a mode that wipes nothing', () => {
    const own = ownBoard(BASELINE.cards, ctx);
    const charm = card('Golgari Charm');
    expect(wipeExposure(charm, ctx.factsOf(charm), own)).toBe(0);
  });

  it('kills only what a -N/-N reaches', () => {
    // Drown in Sorrow's -2/-2 spares a 3-toughness board and kills a 1-toughness one.
    const small = ownBoard(cards('Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise'), ctx);
    const big = ownBoard(
      cards('Mikaeus, the Unhallowed', 'Craterhoof Behemoth', 'Grave Pact'),
      ctx
    );
    const drown = card('Drown in Sorrow');
    expect(wipeExposure(drown, ctx.factsOf(drown), small)).toBeGreaterThan(0.9);
    expect(wipeExposure(drown, ctx.factsOf(drown), big)).toBe(0);
  });

  it('spares the creature type a "non-Elf" wipe names (Eyeblight Massacre in an elf deck)', () => {
    const massacre = card('Eyeblight Massacre');
    const elves = ownBoard(cards('Llanowar Elves', 'Elvish Mystic', 'Priest of Titania'), ctx);
    const birds = ownBoard(cards('Birds of Paradise', 'Llanowar Elves'), ctx);
    expect(wipeExposure(massacre, ctx.factsOf(massacre), elves)).toBe(0);
    expect(wipeExposure(massacre, ctx.factsOf(massacre), birds)).toBeGreaterThan(0);
  });

  it('never charges a transforming card for its back face', () => {
    const norn = card('Elesh Norn // The Argent Etchings');
    expect(wipeExposure(norn, ctx.factsOf(norn), ownBoard(BASELINE.cards, ctx))).toBeNull();
  });
});
