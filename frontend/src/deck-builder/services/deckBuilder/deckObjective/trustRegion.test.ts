// @vitest-environment node
//
// The search's trust region (trustRegion.ts) and the combo floor
// (constraints.ts), over Meren's real deck, page and combo set.
import { describe, expect, it } from 'vitest';
import { checkConstraints } from './index';
import { DRIFT, countRoles, factsRoleOf, protectedCards, trustVerdict } from './trustRegion';
import { BASELINE, FIX, MEREN, card, cards, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
const roleOf = factsRoleOf(ctx);
const protectedNow = protectedCards(BASELINE, ctx);
const rolesNow = countRoles(BASELINE, roleOf);
const verdict = (outs: string[], ins: string[], repair = false) =>
  trustVerdict(rolesNow, cards(...outs), cards(...ins), ctx, protectedNow, 0.3, {
    roleOf,
    repair,
  });

describe('protected cards', () => {
  it('names each class on the real deck', () => {
    const cls = (n: string) => protectedNow.get(n)?.cls;
    expect(cls('Mikaeus, the Unhallowed')).toBe('combo piece');
    expect(cls('Vampiric Tutor')).toBe('combo tutor');
    expect(cls('Lightning Greaves')).toBe('protection');
    expect(cls('Boseiju, Who Endures')).toBe('interaction land');
    expect(cls('Orcish Bowmasters')).toBe('Game Changer');
    expect(cls('Eternal Witness')).toBe('staple');
    // A basic is never a staple: its page row says nothing about a slot.
    expect(cls('Swamp')).toBeUndefined();
  });

  it('never lets a combo piece or its tutor go, however popular the card coming in', () => {
    expect(verdict(['Mikaeus, the Unhallowed'], ['Sol Ring'])).toMatchObject({
      bound: 'combo piece',
    });
    expect(verdict(['Vampiric Tutor'], ['Sol Ring'])).toMatchObject({ bound: 'combo tutor' });
  });

  it('trades a Game Changer only for a Game Changer played at least as often', () => {
    expect(verdict(['Orcish Bowmasters'], ['Grave Pact'])).toMatchObject({
      bound: 'Game Changer',
    });
    expect(verdict(['Orcish Bowmasters'], ['Vampiric Tutor']).blocked).toBeNull();
  });

  it('lets a staple go only for a card played at least as often', () => {
    expect(verdict(['Eternal Witness'], ['Aetherjacket'])).toMatchObject({ bound: 'staple' });
    expect(verdict(['Eternal Witness'], ['Sol Ring']).blocked).toBeNull();
  });

  it("steps aside for a repair: a constraint is the user's", () => {
    const v = verdict(['Mikaeus, the Unhallowed'], ['Aetherjacket'], true);
    expect(v).toMatchObject({ blocked: null, required: 0.3 });
  });
});

describe('role floors and the drift margin', () => {
  it('never takes a role below its target, or further below it', () => {
    // Meren's draw is already under target (8 of 10): no swap may take one more.
    const draw = BASELINE.cards.find((c) => roleOf(c) === 'cardDraw' && !protectedNow.has(c.name))!;
    expect(rolesNow.cardDraw).toBeLessThan(ctx.roleTargets.cardDraw!);
    expect(verdict([draw.name], ['Aetherjacket'])).toMatchObject({ bound: 'role floor' });
  });

  it('asks more of a swap the less played its incoming card is', () => {
    const out = BASELINE.cards.find(
      (c) => !protectedNow.has(c.name) && !roleOf(c) && ctx.qualityOf(c).q > 0.25
    )!;
    const gap = ctx.qualityOf(out).q - ctx.qualityOf(card('Aetherjacket')).q;
    expect(gap).toBeGreaterThan(0);
    const v = verdict([out.name], ['Aetherjacket']);
    expect(v.blocked).toBeNull();
    expect(v.required).toBeCloseTo(0.3 + DRIFT * gap, 6);
  });
});

describe('the combo floor', () => {
  it('holds a bracket 2 or 3 target against a complete two-card combo', () => {
    const deck = {
      commanders: [MEREN],
      cards: [...BASELINE.cards.slice(2), ...cards('Hermit Druid', "Thassa's Oracle")],
    };
    const c = (targetBracket: 2 | 'all') =>
      merenCtx({
        combos: [FIX.hermitDruidCombo],
        customization: { deckFormat: 99, currency: 'USD', targetBracket },
      });
    const floor = checkConstraints(deck, c(2)).find((v) => v.check === 'bracket-floor');
    expect(floor?.cards).toEqual(expect.arrayContaining(['Hermit Druid', "Thassa's Oracle"]));
    expect(checkConstraints(deck, c('all')).map((v) => v.check)).not.toContain('bracket-floor');
  });
});
