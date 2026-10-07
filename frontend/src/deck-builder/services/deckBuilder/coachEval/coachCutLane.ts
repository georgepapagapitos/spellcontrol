/**
 * The Cuts lane as the app shows it (E540 S6), for the Coach eval: each legacy
 * cut paired with its best replacement by the same `pairCuts` the deck page
 * runs, over the harness's saved deck. Records what the lane would show, how
 * long the pairing took, and the moves a user who follows the lane would make
 * (a paired row is a swap; a repair is a bare cut), so the advised deck can be
 * built and gated like the feed's.
 */
import { cutLane, pairCuts, type CutLane, type CutOutcome } from '@/lib/coach/coach-cut-swaps';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Change } from '@/lib/coach/deck-change';
import { ownershipByName } from './coachView';
import {
  applyCoachMoves,
  type AppliedMove,
  type ApplyEnv,
  type ApplyResult,
  type CoachMove,
  type DeckSettings,
  type EvalDeckState,
  type SkippedMove,
} from './applyCoachMoves';
import { shadowCandidates, shadowObjective, type ShadowInput } from './coachShadow';

export interface CutLaneRow {
  /** swap: cut `out`, add `in`. repair: a bare cut. legacy: today's row, unpaired. */
  kind: 'swap' | 'repair' | 'legacy';
  out: string;
  in: string | null;
  reason: string | null;
  /** The swap's gain by the whole-deck objective, and whether the commander's page has the card. */
  delta?: number;
  onPage?: boolean;
  terms?: [string, number][];
}

export interface CutLaneRecord {
  deck: string;
  /** 'ok', or why the deck can't be scored (the lane then shows today's rows). */
  objective: string;
  legacyCuts: number;
  rows: CutLaneRow[];
  withheld: number;
  /** Each cut the lane left out: why, and the best replacement the judge saw. */
  refused: { out: string; reason: string; best: string | null; delta: number | null }[];
  /** Milliseconds the pairing took (budget off). */
  pairMs: number;
  candidates: number;
  spellCandidates?: number;
  landCandidates?: number;
}

export async function cutLaneRecord(
  input: ShadowInput & { fit?: (change: Change) => boolean | undefined },
  deckNames: ReadonlySet<string>
): Promise<{ record: CutLaneRecord; lane: CutLane }> {
  const cuts = input.pass.view.cuts;
  const objective = shadowObjective(input);
  const base = { deck: input.deck, legacyCuts: cuts.length };
  if (!objective.ok) {
    const lane = cutLane(cuts, { status: 'fallback', reason: objective.reason }, deckNames);
    return {
      lane,
      record: {
        ...base,
        objective: objective.reason,
        rows: legacyRows(lane),
        withheld: 0,
        refused: [],
        pairMs: 0,
        candidates: 0,
      },
    };
  }
  const candidates = shadowCandidates(input, objective);
  const t0 = Date.now();
  const outcomes = await pairCuts(
    cuts.map((r) => r.change),
    {
      objective,
      resolve: input.resolve,
      candidates,
      ownership: ownershipByName(input.ownedNames),
      settingsBreak: input.fit ? (c) => (input.fit!(c) === false ? 'unowned' : null) : undefined,
      budgetMs: Number.MAX_SAFE_INTEGER,
    }
  );
  const pairMs = Date.now() - t0;
  const lane = cutLane(cuts, { status: 'ready', outcomes }, deckNames);
  return {
    lane,
    record: {
      ...base,
      objective: 'ok',
      rows: legacyRows(lane, outcomes),
      withheld: lane.withheld,
      refused: cuts.flatMap((r) => {
        const o = outcomes.get(r.change.id);
        return o?.status === 'none'
          ? [
              {
                out: r.change.name,
                reason: o.reason,
                best: o.best?.in ?? null,
                delta: o.best ? Math.round(o.best.delta * 1000) / 1000 : null,
              },
            ]
          : [];
      }),
      pairMs,
      candidates: candidates.length,
      spellCandidates: candidates.filter((c) => !/land/i.test(c.type_line ?? '')).length,
      landCandidates: candidates.filter((c) => /land/i.test(c.type_line ?? '')).length,
    },
  };
}

function legacyRows(lane: CutLane, outcomes?: ReadonlyMap<string, CutOutcome>): CutLaneRow[] {
  return lane.rows.map(({ change: c }) => {
    if (c.type === 'swap') {
      const o = outcomes?.get(c.id);
      return {
        kind: 'swap',
        out: c.inName!,
        in: c.name,
        reason: c.reason ?? null,
        ...(o?.status === 'swap'
          ? { delta: Math.round(o.delta * 1000) / 1000, onPage: o.onPage, terms: o.terms }
          : {}),
      };
    }
    // A repair carries the rule it fixes; a legacy row carries the engine's label.
    const repair = /^(The deck|This card)/.test(c.reason ?? '');
    return { kind: repair ? 'repair' : 'legacy', out: c.name, in: null, reason: c.reason ?? null };
  });
}

/** The lane's rows as the moves a user following it would make, in order. */
export function cutLaneMoves(lane: CutLane): CoachMove[] {
  return lane.rows
    .filter(
      ({ change }) => change.type === 'swap' || /^(The deck|This card)/.test(change.reason ?? '')
    )
    .map(({ change: c, tier }, i) => ({
      rank: i + 1,
      source: 'feed' as const,
      surface: 'cuts-lane',
      type: c.type,
      name: c.name,
      outName: c.type === 'swap' ? c.inName : undefined,
      tier,
      reason: c.reason,
      whyFactors: c.whyFactors,
      inclusion: c.inclusion,
      ownership: c.ownership,
    }));
}

/**
 * The lane's move judged again against the deck as it now stands (a user applies the
 * rows one after another): same card, words recomputed ("ramp 15 to 14" once the
 * first swap took it to 15), or null when the pair is no longer accepted.
 */
async function currentMove(
  input: ShadowInput & { fit?: (change: Change) => boolean | undefined },
  cards: ScryfallCard[],
  move: CoachMove,
  cut: Change
): Promise<CoachMove | null> {
  const now = { ...input, state: { ...input.state, cards } };
  const objective = shadowObjective(now);
  if (!objective.ok) return null;
  const outcomes = await pairCuts([cut], {
    objective,
    resolve: input.resolve,
    candidates: shadowCandidates(now, objective),
    ownership: ownershipByName(input.ownedNames),
    settingsBreak: input.fit ? (c) => (input.fit!(c) === false ? 'unowned' : null) : undefined,
    budgetMs: Number.MAX_SAFE_INTEGER,
    pins: new Map([[cut.id, move.name]]),
  });
  const o = outcomes.get(cut.id);
  return o?.status === 'swap' && o.change.name === move.name
    ? { ...move, reason: o.change.reason, whyFactors: o.change.whyFactors }
    : null;
}

/**
 * Follow the lane the way a user does: row by row, each judged against the deck the
 * rows before it left, up to `n` applied.
 */
export async function applyCutLane(
  input: ShadowInput & { fit?: (change: Change) => boolean | undefined },
  lane: CutLane,
  settings: DeckSettings,
  env: ApplyEnv,
  n: number
): Promise<ApplyResult> {
  const cutById = new Map(input.pass.view.cuts.map((r) => [r.change.id, r.change]));
  const laneIds = lane.rows
    .filter(
      ({ change }) => change.type === 'swap' || /^(The deck|This card)/.test(change.reason ?? '')
    )
    .map(({ change }) => change.id);
  let deck: EvalDeckState = input.state;
  const applied: AppliedMove[] = [];
  const skipped: SkippedMove[] = [];
  for (const [i, move] of cutLaneMoves(lane).entries()) {
    if (applied.length >= n) break;
    let m = move;
    const cut = cutById.get(laneIds[i]);
    if (move.type === 'swap' && applied.length > 0 && cut) {
      const again = await currentMove(input, deck.cards, move, cut);
      if (!again) continue;
      m = again;
    }
    const r = applyCoachMoves(deck, [m], settings, env, 1, 1);
    skipped.push(...r.skipped);
    if (r.applied.length === 0) continue;
    deck = r.deck;
    applied.push({ ...r.applied[0], order: applied.length + 1 });
  }
  return { deck, applied, skipped };
}
