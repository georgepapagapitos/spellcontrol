/**
 * Single-move judgement: one move judged on its own against a whole deck, by
 * the rule the search applies (split from optimizer.ts, which holds the search
 * and re-exports `judgeSwap`). Two entry points over one core:
 *
 *  - `judgeSwap`: a 1:1 or 2:2 swap. The first gate's rule and the swap-label
 *    validation (scripts/deck-objective-swaps.mjs) replay through it, so its
 *    behavior is fixed: a move is accepted when it breaks no MORE hard
 *    constraint (by total magnitude), stays inside the trust region and gains
 *    its margin.
 *  - `judgeMove`: any `{ out, in }` (an add into an open slot, a cut, a swap
 *    of any width), for callers that show the move to a person (Coach). The
 *    same trust region, margin and reason re-verification, plus the invariant
 *    those callers need: an ACCEPTED move leaves no hard-constraint check worse
 *    than it was. A move that fixes one check by breaking another is refused.
 *
 * `partial: true` scores a deck that is not at its size yet (a deck being
 * built): the size check then only objects to a deck that is too LARGE.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { classCounts } from './classFloors';
import { reasonProblem } from './reasonCheck';
import { infeasibility, scoreDeck } from './index';
import { reasonsFor, type SwapReason } from './swapReasons';
import {
  countRoles,
  factsRoleOf,
  gameChangerCount,
  protectedCards,
  trustVerdict,
  type TrustOptions,
} from './trustRegion';
import type {
  ConstraintViolation,
  ObjectiveContext,
  ObjectiveDeck,
  ObjectiveScore,
  TermKey,
} from './types';

/** Swaps a deck is changed by: out are indices into the deck, in the cards that take their place. */
export function applyMove(
  deck: ObjectiveDeck,
  move: { out: readonly number[]; in: readonly ScryfallCard[] }
): ObjectiveDeck {
  const cards = [...deck.cards];
  const paired = Math.min(move.out.length, move.in.length);
  // The first cards swap in place (a 1:1 swap keeps the library's slots, so
  // the goldfish plays the same shuffled positions); any extra out is removed
  // and any extra in is appended.
  for (let j = 0; j < paired; j++) cards[move.out[j]] = move.in[j];
  const gone = new Set(move.out.slice(paired));
  const kept = gone.size ? cards.filter((_, i) => !gone.has(i)) : cards;
  return { commanders: deck.commanders, cards: [...kept, ...move.in.slice(paired)] };
}

/** The report's role counter, memoized by name (it is asked about the same cards every step). */
export function memoRoleOf(
  roleOf: (card: ScryfallCard) => string | null
): (card: ScryfallCard) => string | null {
  const memo = new Map<string, string | null>();
  return (card) => {
    let r = memo.get(card.name);
    if (r === undefined) {
      r = roleOf(card);
      memo.set(card.name, r);
    }
    return r;
  };
}

/**
 * The margin a swap must clear, in card-equivalents: about twice the mana
 * term's standard deviation on a one-card swap with common random numbers
 * (0.155, context.ts), so a swap is never taken on goldfish noise.
 */
export const MIN_GAIN = 0.3;

export interface SwapJudgement {
  /** Full score change, the library in `deck`'s slots. */
  delta: number;
  /** The gain the move had to reach (its margin). */
  required: number;
  accepted: boolean;
  /** Why it was refused, when it was. */
  refusal: string | null;
  reasons: SwapReason[];
}

export interface MoveJudgement extends SwapJudgement {
  /** Each term's contribution change (after − before). */
  terms: Record<TermKey, number>;
  /** The deck breaks no hard constraint after the move. */
  feasibleAfter: boolean;
  /** Hard-constraint checks the move made worse, or newly broke. Empty when accepted. */
  worsened: ConstraintViolation[];
}

export interface MoveOptions {
  minGain?: number;
  trust?: TrustOptions | false;
  /** The deck is not at its size yet: only a deck that is too large breaks the size check. */
  partial?: boolean;
}

/** Per check, the magnitude of a score's violations. */
function byCheck(score: ObjectiveScore): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of score.violations) m.set(v.check, (m.get(v.check) ?? 0) + v.magnitude);
  return m;
}

function judgeCore(
  deck: ObjectiveDeck,
  outNames: readonly string[],
  ins: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: MoveOptions,
  strict: boolean
): MoveJudgement {
  const minGain = options.minGain ?? MIN_GAIN;
  const trust = options.trust === false ? null : (options.trust ?? {});
  const ctx: ObjectiveContext = {
    ...baseCtx,
    ...(options.partial === undefined ? {} : { allowPartial: options.partial }),
    slotOrder: deck.cards.map((c) => c.name),
  };
  const idx: number[] = [];
  for (const n of outNames) {
    const i = deck.cards.findIndex((c, j) => c.name === n && !idx.includes(j));
    if (i < 0) throw new Error(`judge: ${n} is not in the deck`);
    idx.push(i);
  }
  const next = applyMove(deck, { out: idx, in: ins });
  const before = scoreDeck(deck, ctx);
  const after = scoreDeck(next, ctx);
  const delta = after.total - before.total;
  const reasons = reasonsFor(
    before,
    after,
    [...outNames],
    ins.map((c) => c.name)
  );
  const terms = {} as Record<TermKey, number>;
  for (const k of Object.keys(after.terms) as TermKey[])
    terms[k] = after.terms[k].contribution - before.terms[k].contribution;
  const was = byCheck(before);
  const now = byCheck(after);
  const worsened = after.violations.filter(
    (v) => (now.get(v.check) ?? 0) > (was.get(v.check) ?? 0)
  );
  const done = (j: Omit<MoveJudgement, 'terms' | 'feasibleAfter' | 'worsened'>): MoveJudgement => ({
    ...j,
    terms,
    feasibleAfter: after.feasible,
    worsened: j.accepted ? [] : worsened,
  });
  const worse = infeasibility(after) > infeasibility(before) || (strict && worsened.length > 0);
  if (worse) {
    const named = worsened.length ? worsened : after.violations;
    const refusal = `breaks ${[...new Set(named.map((v) => v.check))].join(', ')}`;
    return done({ delta, required: minGain, accepted: false, refusal, reasons });
  }
  let required = minGain;
  if (trust) {
    const roleOf = memoRoleOf(trust.roleOf ?? ctx.roleOf ?? factsRoleOf(ctx));
    const verdict = trustVerdict(
      countRoles(deck, roleOf),
      idx.map((i) => deck.cards[i]),
      ins,
      ctx,
      protectedCards(deck, ctx, trust.stapleBar),
      minGain,
      {
        ...trust,
        roleOf,
        classesNow: classCounts(deck, ctx),
        gameChangersNow: gameChangerCount(deck, ctx),
        repair: infeasibility(after) < infeasibility(before),
      }
    );
    if (verdict.blocked) {
      return done({
        delta,
        required: verdict.required,
        accepted: false,
        refusal: verdict.blocked,
        reasons,
      });
    }
    required = verdict.required;
    // As the search's final read: a claim the cards don't bear out doesn't count.
    const bad = reasons.filter(
      (r) => reasonProblem(r, ins.some((c) => c.name === r.name) ? next : deck, ctx) !== null
    );
    const claimed = bad.reduce((s, r) => s + r.value, 0);
    if (bad.length && delta - claimed < required) {
      const refusal = `rests on ${bad.map((r) => `${r.name} (${r.term})`).join(', ')}`;
      return done({ delta, required, accepted: false, refusal, reasons });
    }
  }
  const refusal = delta < required ? `gains ${delta.toFixed(2)} < ${required.toFixed(2)}` : null;
  return done({ delta, required, accepted: refusal === null, refusal, reasons });
}

/**
 * One swap judged on its own against `deck`, by the rule the search applies:
 * a move is taken when it breaks no more hard constraints, stays inside the
 * trust region, and gains its margin. `trust: false` with `minGain: 0.1` is
 * the first gate's rule. The swap-label validation
 * (scripts/deck-objective-swaps.mjs) replays a gate's swaps through this.
 */
export function judgeSwap(
  deck: ObjectiveDeck,
  outNames: readonly string[],
  ins: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: Pick<MoveOptions, 'minGain' | 'trust'> = {}
): SwapJudgement {
  const { delta, required, accepted, refusal, reasons } = judgeCore(
    deck,
    outNames,
    ins,
    baseCtx,
    options,
    false
  );
  return { delta, required, accepted, refusal, reasons };
}

/**
 * Any move judged against `deck`: `out` are card names in the deck (one entry
 * per copy), `in` the cards that come in. See the header for what accepted
 * means. A move with no `out` is an add, with no `in` a cut.
 */
export function judgeMove(
  deck: ObjectiveDeck,
  move: { out: readonly string[]; in: readonly ScryfallCard[] },
  baseCtx: ObjectiveContext,
  options: MoveOptions = {}
): MoveJudgement {
  return judgeCore(deck, move.out, move.in, baseCtx, options, true);
}
