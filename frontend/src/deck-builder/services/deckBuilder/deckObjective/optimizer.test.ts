// @vitest-environment node
//
// The whole-deck search over real cards: the E510 Meren pair (the treatment
// cut Skullclamp and Sheoldred), Meren's real page and combo set.
import { describe, expect, it } from 'vitest';
import { checkConstraints } from './index';
import { optimizeDeck } from './optimizer';
import { BASELINE, FIX, TREATMENT, card, cards, merenCtx } from './__fixtures__/objectiveFixture';

const SMALL = { maxSwaps: 3, maxEvaluations: 40, shortlist: 12, escapes: 0 };
const pool = () => [
  ...BASELINE.cards,
  ...cards('Counterspell', 'Swords to Plowshares', 'Grave Pact', 'Pitiless Plunderer'),
];

describe('optimizeDeck', () => {
  const ctx = merenCtx();
  const result = optimizeDeck(TREATMENT, pool(), ctx, SMALL);

  it('only ever improves the deck, and says why for every swap', () => {
    expect(result.score.total).toBeGreaterThan(result.seedScore.total);
    expect(result.swaps.length).toBeGreaterThan(0);
    for (const s of result.swaps) {
      expect(s.delta).toBeGreaterThan(0);
      expect(s.in.length).toBe(s.out.length);
      expect(s.reasons.some((r) => s.in.includes(r.name))).toBe(true);
      expect(s.summary).toContain(s.in[0]);
    }
  });

  it('puts back what the differ said was lost', () => {
    const names = result.deck.cards.map((c) => c.name);
    expect(names).toContain('Skullclamp');
  });

  it('never breaks a hard constraint: an off-colour or duplicate card never enters', () => {
    expect(checkConstraints(result.deck, ctx)).toEqual([]);
    const names = result.deck.cards.map((c) => c.name);
    expect(names).not.toContain('Counterspell');
    expect(names).not.toContain('Swords to Plowshares');
    expect(names.length).toBe(99);
  });

  it('holds a lock and a must-include', () => {
    const weakest = result.swaps[0].out[0];
    const locked = optimizeDeck(TREATMENT, pool(), ctx, { ...SMALL, locks: [weakest] });
    for (const s of locked.swaps) expect(s.out).not.toContain(weakest);
    const must = optimizeDeck(
      TREATMENT,
      pool(),
      merenCtx({ customization: { deckFormat: 99, currency: 'USD', mustIncludeCards: [weakest] } }),
      SMALL
    );
    for (const s of must.swaps) expect(s.out).not.toContain(weakest);
  });

  it('is deterministic', () => {
    const again = optimizeDeck(TREATMENT, pool(), merenCtx(), SMALL);
    expect(again.swaps.map((s) => s.summary)).toEqual(result.swaps.map((s) => s.summary));
  });

  it('seats both missing pieces of a two-card combo in one move', () => {
    const muldrotha = card('Muldrotha, the Gravetide');
    const seed = { commanders: [muldrotha], cards: BASELINE.cards };
    const c = merenCtx({ colorIdentity: ['B', 'G', 'U'], combos: [FIX.hermitDruidCombo] });
    const r = optimizeDeck(seed, cards('Hermit Druid', "Thassa's Oracle"), c, {
      ...SMALL,
      maxSwaps: 1,
    });
    expect(r.swaps[0]).toMatchObject({ kind: 'combo' });
    expect(r.swaps[0].in.sort()).toEqual(['Hermit Druid', "Thassa's Oracle"]);
  });
});
