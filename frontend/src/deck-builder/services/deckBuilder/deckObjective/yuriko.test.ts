// @vitest-environment node
//
// E513's final gate, on Yuriko, the Tiger's Shadow's real page and real cards:
// the search took Satoru Umezawa (35%, a piece of four lines one card from
// complete) out for a two-card combo, and added Grave Researcher // Reanimate
// beside the sorcery Reanimate (a face-name collision the generator never ships).
import { describe, expect, it } from 'vitest';
import { checkConstraints, createObjectiveContext, scoreDeck } from './index';
import {
  SIGNATURE_COUNT,
  SIGNATURE_MIN_PCT,
  countRoles,
  factsRoleOf,
  protectedCards,
  trustVerdict,
} from './trustRegion';
import { YURIKO, card, cards } from './__fixtures__/objectiveFixture';

const yuriko = card("Yuriko, the Tiger's Shadow");
const ctx = createObjectiveContext({
  colorIdentity: ['U', 'B'],
  customization: { deckFormat: 99, currency: 'USD' },
  edhrec: new Map(Object.entries(YURIKO.page)),
  roleTargets: { ramp: 10, cardDraw: 10, removal: 8, boardwipe: 2 },
  combos: YURIKO.combos,
  manaSim: { games: 50 },
});
const roleOf = factsRoleOf(ctx);
const deckOf = (...names: string[]) => ({ commanders: [yuriko], cards: cards(...names) });
const verdict = (
  deck: ReturnType<typeof deckOf>,
  outs: string[],
  ins: string[],
  stapleBar?: number
) =>
  trustVerdict(
    countRoles(deck, roleOf),
    cards(...outs),
    cards(...ins),
    ctx,
    protectedCards(deck, ctx, stapleBar),
    0.3,
    { roleOf }
  );

describe('a piece of a line one card from complete', () => {
  const deck = deckOf('Satoru Umezawa', 'Reanimate', 'Ornithopter', 'Thousand-Faced Shadow');

  it('is protected: Satoru and Yuriko need only Great Whale or Palinchron', () => {
    expect(protectedCards(deck, ctx).get('Satoru Umezawa')).toMatchObject({
      cls: 'near combo piece',
    });
  });

  it('never leaves for the two-card combo a seating brings in', () => {
    expect(
      verdict(deck, ['Satoru Umezawa', 'Reanimate'], ['Demonic Consultation', "Thassa's Oracle"])
    ).toMatchObject({ bound: 'near combo piece' });
  });

  it('is an ordinary piece once the line is complete, and free once no line is near', () => {
    const whole = deckOf('Satoru Umezawa', 'Great Whale', 'Reanimate');
    expect(protectedCards(whole, ctx).get('Satoru Umezawa')?.cls).toBe('combo piece');
    const far = deckOf('Reanimate', 'Ornithopter');
    expect(protectedCards(far, ctx).get('Reanimate')?.cls).not.toBe('near combo piece');
  });
});

describe("the page's signature cards", () => {
  const top = Object.entries(YURIKO.page)
    .filter(([, r]) => r.inclusion >= SIGNATURE_MIN_PCT)
    .sort(([, a], [, b]) => (b.synergy ?? 0) - (a.synergy ?? 0))
    .slice(0, SIGNATURE_COUNT)
    .map(([n]) => n);
  const deck = deckOf(...top, 'Reanimate');

  it('are the page top few by its own synergy, whatever their names', () => {
    // A bar above 100 takes the staple class out of the way.
    const prot = protectedCards(deck, ctx, 101);
    // (A piece of a line one card from complete is held as that, a stricter class.)
    for (const n of top) expect(['signature', 'near combo piece']).toContain(prot.get(n)?.cls);
    expect(top.filter((n) => prot.get(n)?.cls === 'signature').length).toBeGreaterThanOrEqual(4);
    expect(prot.get('Reanimate')).toBeUndefined();
  });

  it('leave only for a card at least as commander-specific, or as played', () => {
    const top1 = top[0];
    // Neither more synergy nor more play: held.
    expect(verdict(deck, [top1], ['Reanimate'], 101)).toMatchObject({ bound: 'signature' });
    // A card both more commander-specific and more played goes in.
    const better = Object.entries(YURIKO.page).find(
      ([n, r]) =>
        !top.includes(n) && r.inclusion > YURIKO.page[top1].inclusion + 10 && n !== 'Reanimate'
    );
    if (better) expect(verdict(deck, [top1], [better[0]], 101).bound).not.toBe('signature');
  });
});

describe('a face name on two cards', () => {
  it('breaks the search’s legality, as the invariant reports it', () => {
    const clash = deckOf('Reanimate', 'Grave Researcher // Reanimate');
    const checks = checkConstraints(clash, ctx).map((v) => v.check);
    expect(checks).toContain('face-name-collision');
    expect(scoreDeck(clash, ctx).feasible).toBe(false);
    expect(
      checkConstraints(deckOf('Reanimate', 'Ornithopter'), ctx).map((v) => v.check)
    ).not.toContain('face-name-collision');
  });
});
