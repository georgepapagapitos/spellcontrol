/**
 * Coach's moves scored by the whole-deck objective (E540 S4, SHADOW MODE).
 *
 * `scoreCoachMoves(changes, objective)` maps each Coach `Change` to a
 * `judgeMove` move and returns, per row, the verdict the whole-deck search's
 * rule would give it. Nothing here is imported by UI code yet: the eval harness
 * (coachEval/coachShadow.ts) runs it beside the legacy feed and measures what
 * ordering and filtering the objective would change before S5 lets it.
 *
 * Mapping, by what the row IS (the lane only labels it):
 *  - swap (`name` in, `inName` out): that swap, as shown.
 *  - add into a deck with room: an add into the open slot.
 *  - add into a FULL deck: the swap with the best cut in the incoming card's
 *    slot class (the user ruling is symmetric: Coach never shows a card in
 *    without a card out). "Best" is the lowest-loss cut the protection set lets
 *    go, judged exactly.
 *  - cut: the cut half of the BEST swap in its slot class, per the user ruling
 *    "every cut is shown with its best replacement, scored as one swap". The
 *    replacement pool is the candidates Coach itself offers.
 *  - a bare cut (no replacement in its slot class) is scored only as a repair
 *    of a broken rule (size over, banned card...): `judgeMove` accepts a bare
 *    cut only then. Otherwise it is unscored, never a guess.
 *
 * A row that cannot be scored honestly is `unscored` with a named reason: the
 * deck has no objective (no page, thin page), a card the cache cannot resolve,
 * an outgoing card that is not in the deck, no replacement to pair. The scorer
 * never throws on any of these.
 *
 * Tiering (the design's cost control): every row is judged with the FAST terms
 * (all but the two simulated ones, mana and winline); only the top `fullTop`
 * rows by that read are judged in full. A row's `tier` says which read it
 * carries. `scoreCoachMovesAsync` is the same work, waiting for the page every
 * SLICE_MS (optimizerAsync.ts's pattern) for the day it runs in the browser.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { normalizeCardName } from '@/deck-builder/services/deckBuilder/cardIdentity';
import { cardIneligibility, scoreDeck } from '@/deck-builder/services/deckBuilder/deckObjective';
import { isBasicLand, isLandCard } from '@/deck-builder/services/deckBuilder/deckObjective/context';
import {
  judgeMove,
  type MoveJudgement,
} from '@/deck-builder/services/deckBuilder/deckObjective/judge';
import { SLICE_MS } from '@/deck-builder/services/deckBuilder/deckObjective/optimizerAsync';
import { protectedCards } from '@/deck-builder/services/deckBuilder/deckObjective/protections';
import type {
  ObjectiveContext,
  ObjectiveDeck,
  TermKey,
} from '@/deck-builder/services/deckBuilder/deckObjective/types';
import type { Change } from './deck-change';
import type { CoachObjectiveResult } from './coach-objective';

export type MoveKind = 'swap' | 'add' | 'add-paired' | 'cut-paired' | 'bare-cut';

/** Which read a verdict carries: every row has the fast one, the top rows the full one. */
export type ScoreTier = 'fast' | 'full';

export interface ScoredRow {
  status: 'scored';
  id: string;
  kind: MoveKind;
  tier: ScoreTier;
  accepted: boolean;
  delta: number;
  required: number;
  refusal: string | null;
  terms: Record<TermKey, number>;
  /** The deck breaks no hard constraint after the move. */
  feasibleAfter: boolean;
  /** The move judged: names out of the deck, names in. For a paired row, the pairing chosen. */
  move: { out: string[]; in: string[] };
}

export type UnscoredReason =
  | `no-objective:${string}`
  | 'card-unresolved'
  | 'out-not-in-deck'
  /** A cut with no candidate in its slot class and no repair to make. */
  | 'no-replacement'
  /** An add to a full deck where every card of its slot class is held by the protection set. */
  | 'no-cut-offered'
  | 'bare-cut-not-a-repair'
  | 'error';

export interface UnscoredRow {
  status: 'unscored';
  id: string;
  reason: UnscoredReason;
}

export type RowScore = ScoredRow | UnscoredRow;

export interface CoachMoveScoreOptions {
  /** A card by name, for rows that carry none (the card cache). */
  resolve?: (name: string) => ScryfallCard | undefined;
  /**
   * Replacement candidates for a cut and the incoming cards for pairing,
   * beyond the rows' own incoming cards (the gaps, gems and staples Coach
   * offers). Rows' own incoming cards are always in the pool.
   */
  candidates?: readonly ScryfallCard[];
  /** Rows judged in full after the fast pass. Default 12. */
  fullTop?: number;
  /** Replaces the objective's margin. */
  minGain?: number;
  /** Pairs judged exactly per cut or add (the best by the fast estimate). Default 3. */
  pairsJudged?: number;
}

const DEFAULT_FULL_TOP = 12;
const DEFAULT_PAIRS = 6;
/** Pairs judged at most per row when none is accepted yet. */
const MAX_PAIRS = 30;

type SlotClass = 'spell' | 'land' | 'basic';
function slotClass(card: ScryfallCard): SlotClass {
  if (isBasicLand(card)) return 'basic';
  return isLandCard(card) ? 'land' : 'spell';
}

const keyOf = (name: string): string => normalizeCardName(frontFaceName(name));
const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Whether a record is a whole card: a name-only stub has none of these and cannot be scored. */
function isWholeCard(card: ScryfallCard | undefined): card is ScryfallCard {
  return !!card && typeof card.type_line === 'string' && card.type_line.length > 0;
}

/** Better verdict first: accepted, then the larger gain. */
const better = (a: MoveJudgement, b: MoveJudgement): boolean =>
  a.accepted !== b.accepted ? a.accepted : a.delta > b.delta;

function scored(
  id: string,
  kind: MoveKind,
  tier: ScoreTier,
  j: MoveJudgement,
  move: { out: string[]; in: string[] }
): ScoredRow {
  return {
    status: 'scored',
    id,
    kind,
    tier,
    accepted: j.accepted,
    delta: j.delta,
    required: j.required,
    refusal: j.refusal,
    terms: j.terms,
    feasibleAfter: j.feasibleAfter,
    move,
  };
}

/** The scorer as a coroutine: it yields between units of work, and returns the scores. */
function* scoreSteps(
  changes: readonly Change[],
  objective: CoachObjectiveResult,
  opts: CoachMoveScoreOptions
): Generator<void, RowScore[]> {
  if (!objective.ok) {
    return changes.map((c) => ({
      status: 'unscored',
      id: c.id,
      reason: `no-objective:${objective.reason}` as const,
    }));
  }
  const { deck, ctx } = objective;
  const resolve = opts.resolve ?? (() => undefined);
  const fullTop = opts.fullTop ?? DEFAULT_FULL_TOP;
  const pairsJudged = opts.pairsJudged ?? DEFAULT_PAIRS;
  const judgeOpts = opts.minGain === undefined ? {} : { minGain: opts.minGain };
  // The fast read: the same terms and constraints without the two goldfish terms.
  const fastCtx: ObjectiveContext = {
    ...ctx,
    weights: { ...ctx.weights, mana: 0, winline: 0 },
  };
  const fastTotal = (d: ObjectiveDeck): number =>
    scoreDeck(d, { ...fastCtx, allowPartial: true }).total;
  const fastNow = fastTotal(deck);

  const inDeck = new Map<string, ScryfallCard>();
  for (const c of deck.cards) if (!inDeck.has(keyOf(c.name))) inDeck.set(keyOf(c.name), c);
  const format = ctx.customization.deckFormat ?? 99;
  const expected = (format === 99 ? 100 : format) - deck.commanders.length;
  const full = deck.cards.length >= expected;

  const cardFor = (name: string, carried?: ScryfallCard): ScryfallCard | undefined => {
    if (isWholeCard(carried)) return carried;
    const r = resolve(name);
    return isWholeCard(r) ? r : undefined;
  };

  // The replacement pool: the rows' own incoming cards plus what the caller offers.
  const pool = new Map<string, ScryfallCard>();
  const addToPool = (c: ScryfallCard | undefined) => {
    if (
      isWholeCard(c) &&
      !inDeck.has(keyOf(c.name)) &&
      !pool.has(keyOf(c.name)) &&
      cardIneligibility(c, ctx) === null
    )
      pool.set(keyOf(c.name), c);
  };
  for (const c of opts.candidates ?? []) addToPool(c);
  for (const ch of changes) {
    if (ch.type !== 'cut') addToPool(cardFor(ch.name, ch.card));
  }
  const candidates = [...pool.values()].sort(byName);

  // Memoised fast reads of what each card is worth in this deck.
  const loss = new Map<string, number>();
  const gain = new Map<string, number>();
  function* lossOf(c: ScryfallCard): Generator<void, number> {
    let v = loss.get(c.name);
    if (v === undefined) {
      const i = deck.cards.indexOf(c);
      const without = deck.cards.filter((_, j) => j !== i);
      v = fastNow - fastTotal({ commanders: deck.commanders, cards: without });
      loss.set(c.name, v);
      yield;
    }
    return v;
  }
  function* gainOf(c: ScryfallCard): Generator<void, number> {
    let v = gain.get(c.name);
    if (v === undefined) {
      v = fastTotal({ commanders: deck.commanders, cards: [...deck.cards, c] }) - fastNow;
      gain.set(c.name, v);
      yield;
    }
    return v;
  }

  let protectedNow: ReturnType<typeof protectedCards> | null = null;
  const held = (): ReturnType<typeof protectedCards> =>
    (protectedNow ??= protectedCards(deck, ctx));

  /** The best swap among `outs` x `ins`: the fast estimate picks, the exact fast judge decides. */
  function* bestPair(
    outs: readonly ScryfallCard[],
    ins: readonly ScryfallCard[]
  ): Generator<void, { out: ScryfallCard; in: ScryfallCard; j: MoveJudgement } | null> {
    const pairs: { out: ScryfallCard; in: ScryfallCard; est: number }[] = [];
    for (const o of outs) {
      const l = yield* lossOf(o);
      for (const i of ins) {
        if (keyOf(i.name) === keyOf(o.name)) continue;
        pairs.push({ out: o, in: i, est: (yield* gainOf(i)) - l });
      }
    }
    pairs.sort((a, b) => b.est - a.est || byName(a.out, b.out) || byName(a.in, b.in));
    let best: { out: ScryfallCard; in: ScryfallCard; j: MoveJudgement } | null = null;
    let judged = 0;
    for (const p of pairs) {
      // Judge the best few by the estimate; keep going (to a cap) while none is
      // accepted, since a refusal on a hard rule (owned share, a role floor)
      // says nothing about the next pair.
      if (judged >= MAX_PAIRS || (judged >= pairsJudged && best?.j.accepted)) break;
      const j = judgeMove(deck, { out: [p.out.name], in: [p.in] }, fastCtx, judgeOpts);
      judged++;
      if (!best || better(j, best.j)) best = { ...p, j };
      yield;
    }
    return best;
  }

  const rows: (RowScore | null)[] = changes.map(() => null);
  for (let r = 0; r < changes.length; r++) {
    const ch = changes[r];
    const unscored = (reason: UnscoredReason): UnscoredRow => ({
      status: 'unscored',
      id: ch.id,
      reason,
    });
    try {
      if (ch.type === 'swap') {
        const incoming = cardFor(ch.name, ch.card);
        if (!incoming) {
          rows[r] = unscored('card-unresolved');
        } else {
          const out = ch.inName ? inDeck.get(keyOf(ch.inName)) : undefined;
          if (!out) {
            rows[r] = unscored('out-not-in-deck');
          } else {
            const move = { out: [out.name], in: [incoming.name] };
            rows[r] = scored(
              ch.id,
              'swap',
              'fast',
              judgeMove(deck, { out: move.out, in: [incoming] }, fastCtx, judgeOpts),
              move
            );
          }
        }
      } else if (ch.type === 'add') {
        const incoming = cardFor(ch.name, ch.card);
        if (!incoming) {
          rows[r] = unscored('card-unresolved');
        } else if (!full) {
          rows[r] = scored(
            ch.id,
            'add',
            'fast',
            judgeMove(deck, { out: [], in: [incoming] }, fastCtx, { ...judgeOpts, partial: true }),
            { out: [], in: [incoming.name] }
          );
        } else {
          const cls = slotClass(incoming);
          const outs = deck.cards
            .filter(
              (c, i, all) => slotClass(c) === cls && all.findIndex((d) => d.name === c.name) === i
            )
            .filter((c) => {
              const p = held().get(c.name);
              return !p || p.exempt?.(incoming) === true;
            });
          const best = yield* bestPair(outs, [incoming]);
          rows[r] = best
            ? scored(ch.id, 'add-paired', 'fast', best.j, {
                out: [best.out.name],
                in: [best.in.name],
              })
            : unscored('no-cut-offered');
        }
      } else {
        const out = inDeck.get(keyOf(ch.name));
        if (!out) {
          rows[r] = unscored('out-not-in-deck');
        } else {
          const cls = slotClass(out);
          // A basic comes out for a nonbasic land (the lands lane's own upgrade), or for another basic.
          const ins = candidates.filter(
            (c) => slotClass(c) === cls || (cls === 'basic' && slotClass(c) === 'land')
          );
          const best = ins.length > 0 ? yield* bestPair([out], ins) : null;
          if (best) {
            rows[r] = scored(ch.id, 'cut-paired', 'fast', best.j, {
              out: [best.out.name],
              in: [best.in.name],
            });
          } else {
            // No replacement in its slot class: a bare cut counts only as a repair.
            const j = judgeMove(deck, { out: [out.name], in: [] }, fastCtx, judgeOpts);
            rows[r] = j.accepted
              ? scored(ch.id, 'bare-cut', 'fast', j, { out: [out.name], in: [] })
              : unscored('bare-cut-not-a-repair');
          }
        }
      }
    } catch {
      rows[r] = unscored('error');
    }
    yield;
  }

  // Full read for the top rows by the fast one (accepted first, then the larger gain).
  const rank = (s: RowScore): number =>
    s.status === 'scored' ? s.delta + (s.accepted ? 1e6 : 0) : -Infinity;
  const top = rows
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: ScoredRow; i: number } => x.s?.status === 'scored')
    .sort((a, b) => rank(b.s) - rank(a.s) || a.i - b.i)
    .slice(0, fullTop);
  for (const { s, i } of top) {
    try {
      const outs = s.move.out.map((n) => inDeck.get(keyOf(n))!.name);
      const ins = s.move.in.map((n) => cardFor(n, pool.get(keyOf(n)) ?? inDeck.get(keyOf(n)))!);
      const j = judgeMove(deck, { out: outs, in: ins }, ctx, {
        ...judgeOpts,
        ...(s.kind === 'add' ? { partial: true } : {}),
      });
      rows[i] = scored(s.id, s.kind, 'full', j, s.move);
    } catch {
      // The fast read stands.
    }
    yield;
  }
  return rows as RowScore[];
}

/** Score every Coach row. Pure and synchronous: the harness runs this. Same length and order as `changes`. */
export function scoreCoachMoves(
  changes: readonly Change[],
  objective: CoachObjectiveResult,
  opts: CoachMoveScoreOptions = {}
): RowScore[] {
  const steps = scoreSteps(changes, objective, opts);
  for (let n = steps.next(); ; n = steps.next()) if (n.done) return n.value;
}

/** Lets the page paint and take input (optimizerAsync.ts's yield). */
function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** The same scores, waiting for the page every SLICE_MS of work. */
export async function scoreCoachMovesAsync(
  changes: readonly Change[],
  objective: CoachObjectiveResult,
  opts: CoachMoveScoreOptions = {}
): Promise<RowScore[]> {
  const steps = scoreSteps(changes, objective, opts);
  let sliceStart = Date.now();
  for (;;) {
    const n = steps.next();
    if (n.done) return n.value;
    if (Date.now() - sliceStart >= SLICE_MS) {
      await breathe();
      sliceStart = Date.now();
    }
  }
}

/** What the order reads of a score: the full row and the harness's compact one both fit. */
export type Orderable =
  { status: 'unscored' } | { status: 'scored'; accepted: boolean; delta: number };

/**
 * The feed order the objective would give: accepted rows by gain, then the
 * refused ones by gain, then the unscored in the order they came (the user
 * ruling: unscored rows keep today's order, below the scored ones). Returns
 * indices into `rows`.
 */
export function objectiveOrder(rows: readonly Orderable[]): number[] {
  const idx = rows.map((_, i) => i);
  const group = (s: Orderable) => (s.status === 'unscored' ? 2 : s.accepted ? 0 : 1);
  return idx.sort((a, b) => {
    const ra = rows[a];
    const rb = rows[b];
    const g = group(ra) - group(rb);
    if (g !== 0) return g;
    if (ra.status === 'scored' && rb.status === 'scored' && rb.delta !== ra.delta)
      return rb.delta - ra.delta;
    return a - b;
  });
}
