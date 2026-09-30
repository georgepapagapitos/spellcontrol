// @vitest-environment node
//
// The whole-deck search over real cards: the E510 Meren pair (the treatment
// cut Skullclamp and Sheoldred), Meren's real page and combo set.
import { describe, expect, it } from 'vitest';
import { checkConstraints, scoreDeck } from './index';
import { cardIneligibility } from './constraints';
import { MAX_SWAPS, MIN_GAIN, STAPLE_ROCKS, judgeSwap, optimizeDeck } from './optimizer';
import { reasonProblem } from './reasonCheck';
import { STAPLE_ROCK_NAMES } from '../deckGeneration/phaseStapleManaRocks';
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
      // Every kept swap pays its margin in the FINAL deck, not just when made.
      expect(s.delta).toBeGreaterThanOrEqual(MIN_GAIN);
      expect(s.in.length).toBe(s.out.length);
      expect(s.reasons.some((r) => s.in.includes(r.name))).toBe(true);
      expect(s.summary).toContain(s.in[0]);
    }
  });

  it('states only reasons the final deck and the cards bear out', () => {
    for (const s of result.swaps) {
      for (const r of s.reasons.filter((x) => s.in.includes(x.name))) {
        expect(reasonProblem(r, result.deck, ctx), `${r.name}: ${r.note}`).toBeNull();
      }
    }
  });

  it('makes a few swaps by default, not a rebuild', () => {
    const r = optimizeDeck(TREATMENT, pool(), ctx, { maxEvaluations: 60, shortlist: 12 });
    expect(r.swaps.length).toBeLessThanOrEqual(MAX_SWAPS);
  });

  it("refuses a swap outside the trust region, which the first gate's rule took", () => {
    // Meren's Mikaeus combos: Vampiric Tutor finds a piece, so it stays.
    const legacy = judgeSwap(BASELINE, ['Vampiric Tutor'], [card('Grave Pact')], ctx, {
      trust: false,
      minGain: 0.1,
    });
    const now = judgeSwap(BASELINE, ['Vampiric Tutor'], [card('Grave Pact')], ctx);
    expect(now.accepted).toBe(false);
    expect(now.refusal).toMatch(/tutor that finds/);
    expect(legacy.accepted).toBe(true);
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
    // The two cards it made room with were ones the trust region lets go.
    for (const n of r.swaps[0].out) expect(['Vampiric Tutor', 'Worldly Tutor']).not.toContain(n);
  });

  it('never adds a card it cannot price under a budget', () => {
    const budget = merenCtx({
      customization: { deckFormat: 99, currency: 'USD', deckBudget: 100 },
    });
    const unpriced = { ...card('Grave Pact'), prices: { usd: null, eur: null } };
    expect(cardIneligibility(unpriced, budget)).toBe('no price under a budget');
    expect(cardIneligibility(card('Grave Pact'), budget)).toBeNull();
    expect(cardIneligibility(unpriced, merenCtx())).toBeNull();
  });

  it("protects the generator's staple rocks, and its list is the generator's", () => {
    expect([...STAPLE_ROCK_NAMES].sort()).toEqual([...STAPLE_ROCKS].sort());
    for (const s of result.swaps) expect(s.out).not.toContain('Sol Ring');
  });

  it('repairs a broken constraint first: an unowned card leaves an owned-only build', () => {
    const owned = new Set([
      ...BASELINE.cards.map((c) => c.name).filter((n) => n !== 'Skullclamp'),
      'Grave Pact',
      'Pitiless Plunderer',
    ]);
    const c = merenCtx({
      customization: {
        deckFormat: 99,
        currency: 'USD',
        collectionMode: true,
        collectionStrategy: 'full',
      },
      ownedNames: owned,
    });
    expect(checkConstraints(BASELINE, c).map((v) => v.check)).toEqual(['collection']);
    const r = optimizeDeck(BASELINE, cards('Grave Pact', 'Pitiless Plunderer', 'Counterspell'), c, {
      ...SMALL,
      maxSwaps: 1,
    });
    expect(r.swaps[0]).toMatchObject({ out: ['Skullclamp'], kind: 'repair' });
    expect(r.score.violations).toEqual([]);
  });

  it('repairs an owned share with a spell, since lands do not count toward it', () => {
    // Everything owned but Skullclamp and one land; a 100% owned share.
    const land = BASELINE.cards.find(
      (c) => /Land/.test(c.type_line) && !/Basic/.test(c.type_line)
    )!;
    const owned = new Set([
      ...BASELINE.cards.map((c) => c.name).filter((n) => n !== 'Skullclamp' && n !== land.name),
      'Grave Pact',
      'Command Tower',
    ]);
    const c = merenCtx({
      customization: {
        deckFormat: 99,
        currency: 'USD',
        collectionMode: true,
        collectionStrategy: 'partial',
        collectionOwnedPercent: 100,
      },
      ownedNames: owned,
    });
    expect(checkConstraints(BASELINE, c).map((v) => v.check)).toEqual(['owned-share']);
    const r = optimizeDeck(BASELINE, cards('Grave Pact', 'Command Tower'), c, {
      ...SMALL,
      maxSwaps: 1,
    });
    expect(r.swaps[0]).toMatchObject({ out: ['Skullclamp'], in: ['Grave Pact'], kind: 'repair' });
  });

  it('repairs a broken constraint however many swaps it takes, beyond the swap cap', () => {
    const extras = TREATMENT.cards.filter(
      (c) => !BASELINE.cards.some((b) => b.name === c.name) && !/Land/.test(c.type_line)
    );
    const unowned = BASELINE.cards
      .filter((c) => !/Land/.test(c.type_line) && !['Sol Ring', 'Arcane Signet'].includes(c.name))
      .slice(0, 6)
      .map((c) => c.name);
    const owned = new Set([
      ...BASELINE.cards.map((c) => c.name).filter((n) => !unowned.includes(n)),
      ...extras.map((c) => c.name),
    ]);
    const c = merenCtx({
      customization: {
        deckFormat: 99,
        currency: 'USD',
        collectionMode: true,
        collectionStrategy: 'full',
      },
      ownedNames: owned,
    });
    expect(extras.length).toBeGreaterThanOrEqual(6);
    const r = optimizeDeck(BASELINE, extras, c, { ...SMALL, maxSwaps: 1, maxEvaluations: 60 });
    expect(r.swaps.filter((s) => s.kind === 'repair').length).toBe(6);
    expect(r.score.violations).toEqual([]);
  });

  it('fills the slot a repair empties, with the least damaging card of that slot', () => {
    // Swiftfoot Boots is not owned in an owned-only build. Soul Net and Grave
    // Pact could take the slot; the owned protection pieces are judged first.
    const inDeck = new Set(BASELINE.cards.map((c) => c.name));
    const protection = ['Heroic Intervention', 'Lightning Greaves'].filter((n) => !inDeck.has(n));
    const others = ['Soul Net', 'Grave Pact'];
    expect(protection.length).toBeGreaterThan(0);
    const owned = new Set([
      ...BASELINE.cards.map((c) => c.name).filter((n) => n !== 'Swiftfoot Boots'),
      ...protection,
      ...others,
    ]);
    const c = merenCtx({
      customization: {
        deckFormat: 99,
        currency: 'USD',
        collectionMode: true,
        collectionStrategy: 'full',
      },
      ownedNames: owned,
    });
    const r = optimizeDeck(BASELINE, cards(...others, ...protection), c, {
      ...SMALL,
      maxSwaps: 0,
      maxEvaluations: 40,
    });
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.out).toEqual(['Swiftfoot Boots']);
    expect(protection).toContain(repair.in[0]);
    // Among the cards of that slot, none scores better than the one taken.
    const i = BASELINE.cards.findIndex((x) => x.name === 'Swiftfoot Boots');
    const slots = { ...c, slotOrder: BASELINE.cards.map((x) => x.name) };
    const scoreWith = (name: string) =>
      scoreDeck(
        {
          commanders: BASELINE.commanders,
          cards: BASELINE.cards.map((x, j) => (j === i ? card(name) : x)),
        },
        slots
      ).total;
    const taken = scoreWith(repair.in[0]);
    for (const alt of protection) expect(taken, alt).toBeGreaterThanOrEqual(scoreWith(alt) - 1e-9);
  });

  it('lets the role match pick the replacement, never the card that leaves', () => {
    // A share one card short, with Sakura-Tribe Elder and Carrion Feeder
    // unowned. An owned mana rock matches the Elder's role; the repair still
    // takes out the card whose loss hurts least, not the Elder for a weaker rock.
    const unowned = ['Sakura-Tribe Elder', 'Carrion Feeder'];
    const spells = BASELINE.cards.filter((c) => !/Land/.test(c.type_line)).length;
    const owned = new Set([
      ...BASELINE.cards.map((c) => c.name).filter((n) => !unowned.includes(n)),
      'Springleaf Drum',
      'Soul Net',
    ]);
    const c = merenCtx({
      customization: {
        deckFormat: 99,
        currency: 'USD',
        collectionMode: true,
        collectionStrategy: 'partial',
        collectionOwnedPercent: ((spells - 1) / spells) * 100,
      },
      ownedNames: owned,
    });
    expect(checkConstraints(BASELINE, c).map((v) => v.check)).toEqual(['owned-share']);
    const r = optimizeDeck(BASELINE, cards('Springleaf Drum', 'Soul Net'), c, {
      ...SMALL,
      maxSwaps: 0,
    });
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.out).toEqual(['Carrion Feeder']);
    expect(r.score.violations).toEqual([]);
  });

  it('brings a repair-only card in to repair, never to improve', () => {
    // The first card the search brings in to improve the deck, marked repair-only.
    const first = result.swaps.find((s) => s.kind === 'improve')!.in[0];
    const r = optimizeDeck(TREATMENT, pool(), ctx, { ...SMALL, repairOnly: new Set([first]) });
    for (const s of r.swaps) expect(s.in).not.toContain(first);
  });
});
