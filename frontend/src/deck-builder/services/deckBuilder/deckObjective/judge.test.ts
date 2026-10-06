// @vitest-environment node
//
// judgeMove (Coach's one-move judge) over real Meren and Yuriko cards, and the
// partial-deck mode it relies on.
import { describe, expect, it } from 'vitest';
import { TERM_KEYS, checkConstraints, createObjectiveContext, scoreDeck } from './index';
import { judgeMove } from './judge';
import { judgeSwap } from './optimizer';
import type { ObjectiveDeck } from './types';
import { BASELINE, FIX, YURIKO, card, merenCtx } from './__fixtures__/objectiveFixture';

const withCards = (deck: ObjectiveDeck, n: number): ObjectiveDeck => ({
  commanders: deck.commanders,
  cards: deck.cards.slice(0, n),
});

/** Per check, the summed magnitude of a deck's violations. */
function magnitudes(deck: ObjectiveDeck, ctx: ReturnType<typeof merenCtx>) {
  const m = new Map<string, number>();
  for (const v of checkConstraints(deck, ctx)) m.set(v.check, (m.get(v.check) ?? 0) + v.magnitude);
  return m;
}

describe('partial-deck mode', { timeout: 60_000 }, () => {
  const ctx = merenCtx({ allowPartial: true });

  it('reads a deck under its size as feasible, and a deck over it as not', () => {
    for (const n of [98, 80, 40, 10]) {
      expect(checkConstraints(withCards(BASELINE, n), ctx), `${n} cards`).toEqual([]);
    }
    const strict = merenCtx();
    expect(checkConstraints(withCards(BASELINE, 98), strict).map((v) => v.check)).toEqual(['size']);
    const over = { commanders: BASELINE.commanders, cards: [...BASELINE.cards, card('Cultivate')] };
    expect(checkConstraints(over, ctx).map((v) => v.check)).toContain('size');
  });

  it('scores every term on a deck of any size, with no term throwing or reading NaN', () => {
    for (const n of [0, 1, 7, 40, 98]) {
      const s = scoreDeck(withCards(BASELINE, n), ctx);
      expect(Number.isFinite(s.total), `${n} cards: total`).toBe(true);
      for (const k of TERM_KEYS) {
        expect(Number.isFinite(s.terms[k].contribution), `${n} cards: ${k}`).toBe(true);
        // A term that names cards names ones the deck holds.
        for (const c of s.terms[k].detail.cards) {
          if (c.name.startsWith('(')) continue;
          expect(
            withCards(BASELINE, n).cards.some((d) => d.name === c.name) ||
              BASELINE.commanders.some((d) => d.name === c.name) ||
              k === 'combos' ||
              k === 'winline' ||
              k === 'tutors' ||
              k === 'synergy' ||
              k === 'lift',
            `${n} cards: ${k} names ${c.name}`
          ).toBe(true);
        }
      }
    }
  });

  it('pays for a card that fills an open slot, the more the better the card', () => {
    const deck = withCards(BASELINE, 60);
    const base = scoreDeck(deck, ctx).total;
    const gain = (name: string) =>
      scoreDeck({ commanders: deck.commanders, cards: [...deck.cards, card(name)] }, ctx).total -
      base;
    // A 60-card deck with an open slot: any real card adds its quality.
    expect(gain('Cultivate')).toBeGreaterThan(0);
  });

  it('sizes a 60-card Brawl list by its own format', () => {
    const brawl = merenCtx({ allowPartial: true, customization: { deckFormat: 60 } });
    expect(checkConstraints(withCards(BASELINE, 58), brawl)).toEqual([]);
    expect(checkConstraints(withCards(BASELINE, 60), brawl).map((v) => v.check)).toContain('size');
  });
});

describe('judgeMove', { timeout: 120_000 }, () => {
  const ctx = merenCtx();

  it('is judgeSwap for a swap: the same delta, margin and verdict', () => {
    const outs = ['Vampiric Tutor'];
    const ins = [card('Grave Pact')];
    const a = judgeSwap(BASELINE, outs, ins, ctx);
    const b = judgeMove(BASELINE, { out: outs, in: ins }, ctx);
    expect(b.delta).toBeCloseTo(a.delta, 10);
    expect(b.required).toBe(a.required);
    expect(b.accepted).toBe(a.accepted);
    expect(b.refusal).toBe(a.refusal);
    expect(b.reasons).toEqual(a.reasons);
  });

  it('judges an add into an open slot of a deck being built, and says why', () => {
    const deck = withCards(BASELINE, 70);
    const j = judgeMove(deck, { out: [], in: [card('Cultivate')] }, ctx, {
      partial: true,
    });
    expect(j.feasibleAfter).toBe(true);
    expect(j.delta).toBeGreaterThan(0);
    expect(j.reasons.some((r) => r.name === 'Cultivate')).toBe(true);
    expect(Object.keys(j.terms).sort()).toEqual([...TERM_KEYS].sort());
  });

  it('refuses an add to a full deck: it would break the size', () => {
    const j = judgeMove(BASELINE, { out: [], in: [card('Cultivate')] }, ctx);
    expect(j.accepted).toBe(false);
    expect(j.refusal).toMatch(/size/);
    expect(j.worsened.map((v) => v.check)).toContain('size');
  });

  it('judges a cut: a protected card stays, whatever the deck being built', () => {
    // Meren's Mikaeus combos: Vampiric Tutor finds a piece, so it is protected.
    const j = judgeMove(BASELINE, { out: ['Vampiric Tutor'], in: [] }, ctx, { partial: true });
    expect(j.accepted).toBe(false);
    expect(j.refusal).toMatch(/tutor that finds/);
  });

  it('refuses a move that fixes one check by breaking another, where judgeSwap takes it', () => {
    // An off-colour card out, a second copy of a card the deck holds in: identity 1 → 0, singleton 0 → 1.
    const offColour = card('Path to Exile');
    const deck: ObjectiveDeck = {
      commanders: BASELINE.commanders,
      cards: [offColour, ...BASELINE.cards.slice(1)],
    };
    const dup = deck.cards.find(
      (c) => c.name !== offColour.name && !/\bLand\b/.test(c.type_line ?? '')
    )!;
    const loose = { trust: false as const, minGain: -100 };
    const outs = [offColour.name];
    expect(checkConstraints(deck, ctx).map((v) => v.check)).toContain('identity');
    expect(judgeSwap(deck, outs, [dup], ctx, loose).accepted).toBe(true);
    const j = judgeMove(deck, { out: outs, in: [dup] }, ctx, loose);
    expect(j.accepted).toBe(false);
    expect(j.refusal).toMatch(/singleton/);
  });

  it('takes a move that repairs a broken constraint without breaking another', () => {
    const offColour = card('Path to Exile');
    const deck: ObjectiveDeck = {
      commanders: BASELINE.commanders,
      cards: [offColour, ...BASELINE.cards.slice(1)],
    };
    const j = judgeMove(deck, { out: [offColour.name], in: [card('Cultivate')] }, ctx, {
      trust: false,
      minGain: -100,
    });
    expect(j.accepted).toBe(true);
    expect(j.feasibleAfter).toBe(true);
  });
});

// About 1,300 judged moves: under 20 s locally, over it with CI's coverage instrumentation.
describe(
  'judgeMove never accepts a move that leaves a check worse (property)',
  { timeout: 120_000 },
  () => {
    // Fast terms only: the property is about the constraints, not the goldfish.
    const ctx = merenCtx({ allowPartial: true, weights: { mana: 0, winline: 0 } });
    const pool = FIX.cards
      .filter(
        (c) => !BASELINE.cards.some((b) => b.name === c.name) && c.name !== 'Meren of Clan Nel Toth'
      )
      .slice(0, 40);
    const sizes = [99, 98, 70];
    const loose = [{ trust: false as const, minGain: -100 }, { minGain: -100 }, {}];

    it('holds over adds, cuts and swaps, in full and partial decks, with and without the trust region', () => {
      let accepted = 0;
      let judged = 0;
      for (const n of sizes) {
        const deck = withCards(BASELINE, n);
        const names = deck.cards.map((c) => c.name);
        const moves: Array<{ out: string[]; in: typeof pool }> = [];
        for (let i = 0; i < pool.length; i++) {
          const out = names[(i * 7) % names.length];
          moves.push({ out: [out], in: [pool[i]] }); // swap
          moves.push({ out: [], in: [pool[i]] }); // add
          if (i % 4 === 0) moves.push({ out: [out], in: [] }); // cut
          if (i % 5 === 0)
            moves.push({
              out: [out, names[(i * 11 + 3) % names.length]].filter(
                (x, k, a) => a.indexOf(x) === k
              ),
              in: [pool[i], pool[(i + 1) % pool.length]],
            }); // wider swap
        }
        for (const move of moves) {
          for (const options of loose) {
            for (const partial of [true, false]) {
              const j = judgeMove(deck, move, ctx, { ...options, partial });
              judged++;
              if (!j.accepted) continue;
              accepted++;
              const c = partial ? ctx : { ...ctx, allowPartial: false };
              const idx = move.out.map((o) => deck.cards.findIndex((d) => d.name === o));
              const after = {
                commanders: deck.commanders,
                cards: [...deck.cards.filter((_, i) => !idx.includes(i)), ...move.in],
              };
              const was = magnitudes(deck, c);
              const now = magnitudes(after, c);
              for (const [check, mag] of now) {
                expect(
                  mag,
                  `${check} after ${move.out.join('+')} -> ${move.in.map((x) => x.name).join('+')}`
                ).toBeLessThanOrEqual(was.get(check) ?? 0);
              }
              expect(j.worsened).toEqual([]);
            }
          }
        }
      }
      // The property is not vacuous: plenty of moves were judged and many accepted.
      expect(judged).toBeGreaterThan(500);
      expect(accepted).toBeGreaterThan(20);
    });
  }
);

describe('judgeMove on Yuriko, a second real deck and page', () => {
  it('holds the invariant for adds to a deck under its size', () => {
    const yuriko = card("Yuriko, the Tiger's Shadow");
    const deck: ObjectiveDeck = { commanders: [yuriko], cards: YURIKO.cards.slice(0, 7) };
    const ctx = createObjectiveContext({
      colorIdentity: ['U', 'B'],
      customization: { deckFormat: 99, currency: 'USD' },
      edhrec: new Map(Object.entries(YURIKO.page)),
      roleTargets: { ramp: 10, cardDraw: 10, removal: 8, boardwipe: 3 },
      combos: YURIKO.combos,
      manaSim: { games: 500 },
      allowPartial: true,
    });
    const adds = [...YURIKO.cards.slice(7), card('Cultivate'), card('Path to Exile')];
    let accepted = 0;
    for (const c of adds) {
      const j = judgeMove(deck, { out: [], in: [c] }, ctx, {
        partial: true,
        trust: false,
        minGain: -100,
      });
      const was = new Set(checkConstraints(deck, ctx).map((v) => v.check));
      const now = checkConstraints({ commanders: deck.commanders, cards: [...deck.cards, c] }, ctx);
      if (j.accepted) {
        accepted++;
        for (const v of now) expect(was.has(v.check), `${c.name}: ${v.check}`).toBe(true);
      } else {
        // The off-colour card is the refusal this deck should produce.
        expect(now.length).toBeGreaterThan(0);
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
