// @vitest-environment node
//
// E513 round 2: the second blind gate's regressions, each over the real cards
// it happened with (Scryfall records from the same bulk file as the gate).
import { describe, expect, it } from 'vitest';
import { extractCardFacts } from '@/deck-builder/services/cardFacts/extract';
import { classCounts } from './classFloors';
import { readFacts } from './factsReading';
import { judgeSwap } from './optimizer';
import { countRoles, factsRoleOf, protectedCards, trustVerdict } from './trustRegion';
import { BASELINE, card, cards, merenCtx, swap } from './__fixtures__/objectiveFixture';

const facts = (name: string) => {
  const c = card(name);
  return extractCardFacts({ ...c, oracle_id: c.name });
};

describe('the last answer of a class (Atraxa partial50 lost its only counterspell)', () => {
  it('refuses a swap that takes the deck only stack answer, and accepts one that leaves another', () => {
    const deck = swap(BASELINE, 'Dread Return', 'Counterspell');
    const ctx = merenCtx({ colorIdentity: ['W', 'U', 'B', 'G'] });
    expect(classCounts(deck, ctx).stack).toBe(1);
    const lone = judgeSwap(deck, ['Counterspell'], [card('Path to Exile')], ctx);
    expect(lone.refusal).toMatch(/last stack answer/);
    // A second counterspell in the deck: the first may go.
    const two = swap(deck, 'Cauldron of Essence', 'Mana Drain');
    expect(classCounts(two, ctx).stack).toBe(2);
    expect(judgeSwap(two, ['Counterspell'], [card('Path to Exile')], ctx).refusal).not.toMatch(
      /last stack/
    );
  });

  it('never takes protection below its count', () => {
    const ctx = merenCtx();
    const now = classCounts(BASELINE, ctx).protection;
    expect(now).toBeGreaterThan(0);
    // Played as often as the Boots, so the staple rule lets them go: the floor doesn't.
    const v = judgeSwap(BASELINE, ['Swiftfoot Boots'], [card('Grave Pact')], ctx);
    expect(v.refusal).toMatch(/protection pieces/);
  });
});

describe('a Game Changer leaves only for another (Fierce Guardianship went for Metastatic Evangel)', () => {
  it('holds even where the card is also a protection piece', () => {
    const ctx = merenCtx({
      colorIdentity: ['W', 'U', 'B', 'G'],
      gameChangerNames: new Set(['Fierce Guardianship']),
    });
    const deck = swap(BASELINE, 'Dread Return', 'Fierce Guardianship');
    const now = protectedCards(deck, ctx);
    expect(now.get('Fierce Guardianship')?.cls).toBe('protection');
    const v = trustVerdict(
      countRoles(deck, factsRoleOf(ctx)),
      cards('Fierce Guardianship'),
      cards('Sol Ring'),
      ctx,
      now,
      0.3,
      { roleOf: factsRoleOf(ctx) }
    );
    expect(v.blocked).toMatch(/is a Game Changer/);
  });
});

describe('a piece of a line the deck assembles (Umbral Mantle in Lathril)', () => {
  it('is protected even where the line is a template the score does not credit', () => {
    const priest = card('Priest of Titania');
    const deck = swap(
      swap(BASELINE, 'Dread Return', 'Umbral Mantle'),
      'Cauldron of Essence',
      priest.name
    );
    const combo = {
      comboId: '1376-2816--41',
      cards: ['Umbral Mantle', 'Priest of Titania'],
      results: ['Infinite green mana'],
      isComplete: true,
      missingCards: [],
      deckCount: 21826,
      bracket: null,
      bracketTag: null,
      cardCount: 2,
    };
    const ctx = merenCtx({ combos: [combo] });
    expect(protectedCards(deck, ctx).get('Umbral Mantle')?.cls).toBe('combo piece');
  });
});

describe('an opponent discarding (Waste Not read as a self-discard payoff)', () => {
  it('is its own resource: your loot does not feed it, a forced discard does', () => {
    expect(facts('Waste Not').payoffs.map((p) => p.r)).toEqual(['opp-discard']);
    expect(facts('Teferi, Master of Time').produces.map((p) => p.r)).toContain('discard');
    expect(facts('Teferi, Master of Time').produces.map((p) => p.r)).not.toContain('opp-discard');
    expect(facts('Reckless Scholar').produces.map((p) => p.r)).toContain('opp-discard');
  });

  it('reads no ramp or draw engine in an ability an opponent has to set off', () => {
    const waste = card('Waste Not');
    expect(facts('Waste Not').roles.map((r) => r.role)).toContain('ramp');
    expect(readFacts(waste, facts('Waste Not')).roles.map((r) => r.role)).toEqual([]);
  });

  it('reads Leyline of Abundance as no token payoff', () => {
    const leyline = card('Leyline of Abundance');
    const f = readFacts(leyline, facts('Leyline of Abundance'));
    expect(f.payoffs.map((p) => p.r)).not.toContain('creature-token');
  });
});

describe('role caps (Ur-Dragon ramp went to 22 of cap 21)', () => {
  const ctx = merenCtx({ roleTargets: { ramp: 17, removal: 6, boardwipe: 3, cardDraw: 9 } });
  const roleOf = factsRoleOf(ctx);
  const verdict = (ramp: number, opts: { roleCeilings?: Record<string, number> } = {}) =>
    trustVerdict(
      { ramp, removal: 6 },
      cards('Dread Return'),
      cards('Mox Jasper'),
      ctx,
      new Map(),
      0.3,
      {
        roleOf,
        ...opts,
      }
    );

  it('takes no role past the report cap', () => {
    expect(roleOf(card('Mox Jasper'))).toBe('ramp');
    expect(verdict(21)).toMatchObject({ bound: 'role cap' });
    expect(verdict(20).blocked).toBeNull();
  });

  it('keeps a role the rebalance trimmed where it left it', () => {
    expect(verdict(20, { roleCeilings: { ramp: 20 } })).toMatchObject({ bound: 'role cap' });
  });
});
