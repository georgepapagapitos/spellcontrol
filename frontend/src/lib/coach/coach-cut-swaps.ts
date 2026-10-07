/**
 * The Cuts lane as swaps (E540 S6, the user ruling of 2026-10-06): "The Cuts
 * lane shows each cut with its best replacement, scored as one swap. A cut on
 * its own appears only to fix a broken rule: over the card count, over budget,
 * over a bracket or Game Changer limit, or a banned card."
 *
 * One source of truth for the pairing: `scoreCoachMoves` (coach-move-score.ts),
 * which judges a cut as the cut half of the best swap in its slot class with
 * `judgeMove`, the whole-deck search's own rule (trust region, protection set,
 * every hard constraint the deck's settings make). This module only reads its
 * verdicts and words them:
 *
 *  - accepted pairing  -> a `swap` row (`pairedCut`): the cut leads the row,
 *    the replacement is the card coming in, one apply does both;
 *  - bare cut accepted -> a repair, kept bare and saying which rule it fixes;
 *  - anything else     -> no row (the cut has no acceptable replacement and
 *    breaks no rule: today's bare cut is exactly what the ruling retires);
 *  - not scored (the time budget ran out, a card the cache cannot resolve)
 *    -> today's cut row, below the scored ones.
 *
 * It does NOT change which cut comes first: the shadow run measured the
 * objective's cut order as a wash against the legacy one (P@5 0.23 to 0.25),
 * so rows keep the legacy order (coach-rank.ts) and only the pairing is new.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import {
  countsClause,
  swapSentences,
} from '@/deck-builder/services/deckBuilder/deckGeneration/swapCopy';
import type { SwapReason } from '@/deck-builder/services/deckBuilder/deckObjective/swapReasons';
import { buildSwapAlternativeFactors } from './why-factors';
import { fromSwap, type Change, type ChangeOwnership } from './deck-change';
import {
  scoreCoachMovesAsync,
  type RowScore,
  type ScoredRow,
  type UnscoredReason,
} from './coach-move-score';
import type { CoachObjectiveResult } from './coach-objective';
import type { RankedMove } from './coach-rank';
import type { SettingsBreak } from './deck-settings-fit';

/** Time the app gives the pairing before the lane shows what it has (the user ruling: about 4 s). */
export const CUT_PAIRING_BUDGET_MS = 4000;

/** Marks a swap row that is a Cuts-lane row: the cut leads, the add is its best replacement. */
export function isPairedCut(change: Change): boolean {
  return change.type === 'swap' && change.pairedCut === true;
}

/** A row of the Cuts lane, paired or bare. */
export function isCutsLaneRow(change: Change): boolean {
  return change.type === 'cut' || isPairedCut(change);
}

export type CutOutcome =
  | { status: 'swap'; change: Change }
  | { status: 'repair'; change: Change }
  /** No acceptable replacement and no rule to repair: the row is not shown. */
  | { status: 'none'; reason: string; best?: { in: string; delta: number } }
  /** Not scored: the row stays as it is today, below the scored rows. */
  | { status: 'unscored'; reason: UnscoredReason };

/** The cards Coach itself offers to bring in, the pool a cut's replacement is chosen from. */
export function replacementCandidateNames(src: {
  gaps?: readonly { name: string }[];
  hiddenGems?: readonly { name: string }[];
  additions?: readonly { name: string }[];
  synergy?: readonly { cardName: string }[];
  /** A collection deck's best replacement is a card it owns. */
  ownedNames?: ReadonlySet<string>;
  /** Share of the commander's page decks that play a card (0-100). */
  inclusionOf?: (name: string) => number;
  /** Owned cards offered, the most played first. Default 60. */
  ownedLimit?: number;
}): string[] {
  const offered = [
    ...(src.gaps ?? []).map((g) => g.name),
    ...(src.hiddenGems ?? []).map((g) => g.name),
    ...(src.additions ?? []).map((o) => o.name),
    ...(src.synergy ?? []).map((s) => s.cardName),
  ];
  const owned =
    !src.ownedNames || src.ownedNames.size === 0 || !src.inclusionOf
      ? []
      : [...src.ownedNames]
          .map((n) => ({ n, inc: src.inclusionOf!(n) }))
          .filter((x) => x.inc > 0)
          .sort((a, b) => b.inc - a.inc || (a.n < b.n ? -1 : 1))
          .slice(0, src.ownedLimit ?? 60)
          .map((x) => x.n);
  return [...new Set([...offered, ...owned])];
}

/** What a repaired hard-constraint check says, in the words of the rule (objective's `check` names). */
const REPAIR_COPY: Record<string, string> = {
  size: 'The deck is over its card count, so a card has to go.',
  budget: 'The deck is over its budget.',
  'max-price': 'This card costs more than the deck allows per card.',
  'game-changers': 'The deck is over its Game Changer limit.',
  'bracket-ceiling': "The deck is over its bracket's limit.",
  'bracket-floor': "The deck is over its bracket's limit.",
  banned: "This card is banned in this deck's settings.",
  legality: 'This card is not legal in this format.',
  identity: "This card is outside the commander's colors.",
  'dead-in-identity': "This card needs a color the commander doesn't have.",
  rarity: "This card is above the deck's rarity limit.",
  collection: 'This card is not in the collection this deck is limited to.',
  'owned-share': 'The deck is under its share of owned cards.',
  singleton: 'The deck holds a second copy of a card it may have once.',
};

/** The rule a bare cut fixes, as one plain sentence. */
export function repairCopy(repairs: readonly string[]): string {
  for (const check of repairs) if (REPAIR_COPY[check]) return REPAIR_COPY[check];
  return 'The deck breaks a rule you set, and this cut fixes it.';
}

/** The swap record is written for a move already made; a proposal reads in the present. */
function present(s: string): string {
  return (
    s
      .replace(/was in only 0% of this commander's decks/, 'is not played with this commander')
      // The generation copy's article: "an static-speed answer".
      .replace(/\ban ([b-df-hj-np-tv-z]\w*-speed)/, 'a $1')
      // The feeders are a list of up to three names: the row has no room for it (a 3-line reason).
      .replace(/ \(fed by [^)]*\)/, '')
      .replace(/\bwas in only\b/, 'is in only')
      .replace(
        /\bsat in a part of the curve that was already crowded\b/,
        'sits in a part of the curve that is already crowded'
      )
      .replace(/\bwould have cost\b/, 'would cost')
  );
}

/** Why the card leaving is the weaker one, from the legacy cut's own label when the record has none. */
function weakerFromLegacy(cut: Change, outName: string): string {
  const reason = cut.reason ?? '';
  const excess = reason.match(/^Excess (.+)$/i);
  if (excess) return `${outName} is more ${excess[1].toLowerCase()} than the deck needs.`;
  if (/^tapland$/i.test(reason)) return `${outName} enters tapped.`;
  const basics = reason.match(/too many (\w+) basics/i);
  if (basics) return `The deck has more ${basics[1].toLowerCase()} basics than it needs.`;
  if (/^off-package/i.test(reason))
    return `${outName} has no co-play links with this deck's key cards.`;
  if (/low synergy/i.test(reason)) return `${outName} does little for this deck's plan.`;
  if (typeof cut.inclusion === 'number' && cut.inclusion < 1)
    return `${outName} is not played with this commander.`;
  if (typeof cut.inclusion === 'number' && cut.inclusion < 30)
    return `${outName} is in only ${Math.round(cut.inclusion)}% of this commander's decks.`;
  if (/low inclusion|not played/i.test(reason))
    return `${outName} is rarely played with this commander.`;
  return `${outName} is the weakest fit in this slot.`;
}

const PLAY_RATE = /^[\d.]+% of this page's decks/;

/** At most two plain sentences: why the card leaving is weaker, why the card coming in is better. */
export function cutSwapReason(
  cut: Change,
  outName: string,
  inName: string,
  reasons: SwapReason[]
): string {
  // The role counts a swap moves belong to the swap, not to the card coming in
  // (Animate Dead does not "move the deck's ramp"): they are said as the swap's.
  const roles = reasons.find((r) => r.term === 'roles');
  const counts = roles ? countsClause(roles.note) : null;
  const rest = reasons.filter((r) => r !== roles);
  const say = (rs: SwapReason[]) =>
    swapSentences({ in: [inName], out: [outName], kind: 'improve', reasons: rs, named: true });
  const fallback = `${inName} fits this deck better overall.`;
  // The row already shows how many decks play the card coming in, so its reason says
  // something else when it can; the play rate stays the answer when nothing else is.
  const quiet = say(rest.filter((r) => r.name !== inName || !PLAY_RATE.test(r.note)));
  const { why, weaker } =
    quiet.why === fallback ? say(rest) : { ...quiet, weaker: say(rest).weaker };
  const better =
    counts && why === fallback
      ? `The swap ${counts}.`
      : counts && !why.includes(' and ')
        ? `${why.slice(0, -1)} and the swap ${counts}.`
        : why;
  return [weaker ? present(weaker) : weakerFromLegacy(cut, outName), present(better)].join(' ');
}

interface PairEnv {
  objective: CoachObjectiveResult;
  resolve: (name: string) => ScryfallCard | undefined;
  candidates: readonly ScryfallCard[];
  ownership: (name: string) => ChangeOwnership;
  /** Coach's own settings check on the paired row (price, budget, rarity, ...). */
  settingsBreak?: (change: Change) => SettingsBreak | null;
}

/** The Cuts-lane swap row for an accepted pairing: the cut leads, one apply does both. */
function swapRow(cut: Change, s: ScoredRow, env: PairEnv): Change | null {
  const outName = s.move.out[0];
  const inName = s.move.in[0];
  const inCard = env.candidates.find((c) => c.name === inName) ?? env.resolve(inName) ?? null;
  if (!inCard) return null;
  const row =
    env.objective.ok && env.objective.ctx.edhrec
      ? (env.objective.ctx.edhrec.get(inName) ??
        env.objective.ctx.edhrec.get(frontFaceName(inName)))
      : undefined;
  const ownership = env.ownership(inName);
  const base = fromSwap({
    inCard,
    outName,
    reason: cutSwapReason(cut, outName, inName, s.reasons),
    ownership,
    lane: cut.lane,
    inclusion: row?.inclusion,
  });
  return {
    ...base,
    // The cut's id: the feed's leave/depart bookkeeping and its React key already follow it.
    id: cut.id,
    pairedCut: true,
    synergy: row?.synergy,
    rarity: inCard.rarity,
    // The cut's why (about the card leaving), then why the replacement is a fair one.
    whyFactors: [
      ...(cut.whyFactors ?? []),
      ...buildSwapAlternativeFactors({
        inclusion: row?.inclusion,
        synergy: row?.synergy,
        owned: ownership === 'owned',
      }).filter((f) => f.tone !== 'con'),
    ],
  };
}

/**
 * Pair every cut with its best replacement, in the order given, within
 * `budgetMs`. The rows past the budget come back `unscored`. Pure apart from
 * the clock and the yields to the page.
 */
export async function pairCuts(
  cuts: readonly Change[],
  env: PairEnv & { budgetMs?: number; now?: () => number; cancelled?: () => boolean }
): Promise<Map<string, CutOutcome>> {
  const out = new Map<string, CutOutcome>();
  const now = env.now ?? (() => Date.now());
  const t0 = now();
  const budget = env.budgetMs ?? CUT_PAIRING_BUDGET_MS;
  const scores: RowScore[] = await scoreCoachMovesAsync(cuts, env.objective, {
    resolve: env.resolve,
    candidates: env.candidates,
    // The fast read decides: the goldfish terms (mana, winline) are the slow ones.
    fullTop: 0,
    // The best pair by the estimate is nearly always the accepted one: judge two,
    // and give up on a cut after eight refusals. Each judged pair costs two deck
    // scores, and most cuts have no acceptable replacement (about 95% in the v4
    // corpus), so the search for one is the bulk of the time.
    pairsJudged: 2,
    maxPairs: 8,
    distinctReplacements: true,
    shouldStop: () => now() - t0 > budget || env.cancelled?.() === true,
  });
  cuts.forEach((cut, i) => {
    const s = scores[i];
    if (s.status === 'unscored') {
      out.set(
        cut.id,
        s.reason === 'bare-cut-not-a-repair' || s.reason === 'no-replacement'
          ? { status: 'none', reason: s.reason }
          : { status: 'unscored', reason: s.reason }
      );
      return;
    }
    if (s.kind === 'bare-cut') {
      out.set(cut.id, {
        status: 'repair',
        change: { ...cut, reason: repairCopy(s.repairs ?? []) },
      });
      return;
    }
    if (!s.accepted) {
      out.set(cut.id, {
        status: 'none',
        reason: s.refusal ?? 'refused',
        best: { in: s.move.in[0], delta: s.delta },
      });
      return;
    }
    const row = swapRow(cut, s, env);
    if (!row) {
      out.set(cut.id, { status: 'unscored', reason: 'card-unresolved' });
    } else if (env.settingsBreak?.(row)) {
      out.set(cut.id, { status: 'none', reason: `settings:${env.settingsBreak(row)}` });
    } else {
      out.set(cut.id, { status: 'swap', change: row });
    }
  });
  return out;
}

/**
 * A re-pairing after an apply changes the deck, and its verdicts can differ for rows
 * the user is reading: "Shriekmaw, add Scute Swarm" must not become another card
 * between the read and the click. So a row already shown keeps its verdict while it
 * stays valid: a replacement still out of the deck, or a row that was withheld. The
 * new run decides only what is new or no longer valid, and never hands a kept
 * replacement to a second row.
 */
export function keepShown(
  prev: ReadonlyMap<string, CutOutcome> | undefined,
  next: ReadonlyMap<string, CutOutcome>,
  inDeck: (name: string) => boolean
): Map<string, CutOutcome> {
  const out = new Map(next);
  if (!prev) return out;
  const taken = new Set<string>();
  for (const [id, was] of prev) {
    if (!out.has(id)) continue;
    const valid = was.status === 'none' || (was.status === 'swap' && !inDeck(was.change.name));
    if (!valid) continue;
    out.set(id, was);
    if (was.status === 'swap') taken.add(was.change.name);
  }
  for (const [id, o] of out) {
    if (o.status === 'swap' && taken.has(o.change.name) && prev.get(id) !== o) {
      out.set(id, { status: 'none', reason: 'replacement taken by a row already shown' });
    }
  }
  return out;
}

export type CutSwapState =
  /** Nothing to pair (no cuts yet, or the feed is not on a commander deck). */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; outcomes: ReadonlyMap<string, CutOutcome> }
  /** The deck cannot be scored (no page, a thin page, no commander): today's rows. */
  | { status: 'fallback'; reason: string }
  | { status: 'error' };

export interface CutLane {
  rows: RankedMove[];
  /** Why the rows are today's, unpaired: shown as a note above them. */
  note: 'fallback' | 'error' | null;
  /** Rows the pairing left out (a cut with no acceptable replacement and no rule to fix). */
  withheld: number;
}

/**
 * The lane's rows from the legacy ranked cuts and the pairing's verdicts. Order
 * is the legacy order with the scored rows first and any unscored below, so it
 * never changes once painted: the verdicts arrive in one batch (or at the
 * budget), and a row never moves for a later one.
 */
export function cutLane(
  cuts: readonly RankedMove[],
  state: CutSwapState,
  deckNames: ReadonlySet<string>
): CutLane {
  if (state.status === 'fallback') return { rows: [...cuts], note: 'fallback', withheld: 0 };
  if (state.status === 'error') return { rows: [...cuts], note: 'error', withheld: 0 };
  if (state.status !== 'ready') return { rows: [...cuts], note: null, withheld: 0 };
  const scored: RankedMove[] = [];
  const rest: RankedMove[] = [];
  let withheld = 0;
  for (const r of cuts) {
    const o = state.outcomes.get(r.change.id);
    if (!o || o.status === 'unscored') rest.push(r);
    else if (o.status === 'none') withheld++;
    // A replacement already in the deck (added by another route) is a stale pairing.
    else if (o.status === 'swap' && deckNames.has(o.change.name.toLowerCase())) withheld++;
    else scored.push({ ...r, change: o.change });
  }
  return { rows: [...scored, ...rest], note: null, withheld };
}
