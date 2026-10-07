/**
 * Shadow scoring for the Coach eval (E540 S4): the live harness's Coach feed
 * for one deck, with the whole-deck objective's verdict beside every row the
 * user would meet. Nothing a user sees changes; this only records.
 *
 * `shadowRecord` builds the objective from the SAVED deck the harness holds
 * (the same `buildCoachObjective` the app will call), scores the shown rows
 * (the feed and the cuts lane, in the order the user meets them) with
 * `scoreCoachMoves`, and keeps a compact row per change. coachShadowReport.ts
 * turns the records into the numbers that decide S5.
 */
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';
import {
  buildCoachObjective,
  coachCombos,
  protectionSourcesFrom,
  type CoachObjective,
  type CoachObjectiveResult,
} from '@/lib/coach/coach-objective';
import { scoreCoachMoves, type RowScore } from '@/lib/coach/coach-move-score';
import { replacementCandidateNames } from '@/lib/coach/coach-cut-swaps';
import type { Change } from '@/lib/coach/deck-change';
import type { CommanderDeckAnalysisResult } from '../commanderDeckAnalysis';
import { edhrecRowsFrom } from '../deckObjective/panelDump';
import type { CoachView } from './coachView';
import type { EvalDeckState } from './applyCoachMoves';

/** A scored row without the full per-term table: the three terms that moved most. */
export type CompactScore =
  | {
      status: 'scored';
      kind: string;
      tier: 'fast' | 'full';
      accepted: boolean;
      delta: number;
      required: number;
      refusal: string | null;
      move: { out: string[]; in: string[] };
      topTerms: [string, number][];
    }
  | { status: 'unscored'; reason: string };

export interface ShadowRow {
  /** Position in the surface the user meets it on (0-based). */
  position: number;
  surface: 'feed' | 'cuts';
  lane: string;
  type: 'add' | 'cut' | 'swap';
  /** The card the row is about (incoming for an add or swap, outgoing for a cut). */
  name: string;
  /** A swap's outgoing card. */
  inName: string | null;
  tier: 1 | 2 | 3;
  inclusion: number | null;
  score: CompactScore;
}

export interface ShadowLabels {
  weak: string[];
  missing: string[];
  lostPremium: string[];
}

export interface ShadowRecord {
  corpus: 'advise' | 'bench';
  group: string;
  deck: string;
  /** 'ok', or why the objective could not be built (no-page, thin-page, ...). */
  objective: string;
  pageRows: number;
  scoreMs: number;
  deckSize: number;
  rows: ShadowRow[];
  labels?: ShadowLabels;
  error?: string;
}

export interface ShadowInput {
  corpus: ShadowRecord['corpus'];
  group: string;
  deck: string;
  state: EvalDeckState;
  customization: Record<string, unknown>;
  ownedNames: ReadonlySet<string>;
  gameChangers: ReadonlySet<string>;
  pass: {
    analysis: CommanderDeckAnalysisResult;
    view: CoachView;
    page: EDHRECCommanderData | null;
    combos: { inDeck: ComboMatchResponse['inDeck']; oneAway: ComboMatchResponse['oneAway'] };
  };
  resolve: (name: string) => ScryfallCard | undefined;
  /** Goldfish games per full read. */
  games?: number;
  fullTop?: number;
  labels?: ShadowLabels;
}

const compact = (s: RowScore): CompactScore => {
  if (s.status === 'unscored') return { status: 'unscored', reason: s.reason };
  const topTerms = Object.entries(s.terms)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([k, v]): [string, number] => [k, Math.round(v * 1000) / 1000]);
  return {
    status: 'scored',
    kind: s.kind,
    tier: s.tier,
    accepted: s.accepted,
    delta: Math.round(s.delta * 1000) / 1000,
    required: Math.round(s.required * 1000) / 1000,
    refusal: s.refusal,
    move: s.move,
    topTerms,
  };
};

/** The whole-deck objective for the harness's saved deck (the app's `buildCoachObjective`). */
export function shadowObjective(input: ShadowInput): CoachObjectiveResult {
  const { state, pass, customization } = input;
  const { analysis } = pass;
  const response: ComboMatchResponse = {
    ...pass.combos,
    almostInCollection: [],
    source: 'local',
    almostInCollectionTotal: 0,
  };
  const cz = customization;
  return buildCoachObjective({
    deck: {
      format: 'commander',
      commander: state.commander,
      partnerCommander: state.partner,
      cards: state.cards.map((card, i) => ({ slotId: String(i), card, allocatedCopyId: null })),
      generationContext: {
        selectedThemes: [],
        targetBracket: (cz.targetBracket as number | 'all' | undefined) ?? 'all',
        landCount: 0,
        collectionMode: cz.collectionMode === true,
        customization: cz as never,
      },
      bracketOverride: null,
    },
    rows: pass.page ? edhrecRowsFrom(pass.page) : new Map(),
    roleTargets: analysis.roleTargets,
    combos: coachCombos(response, [
      state.commander,
      ...(state.partner ? [state.partner] : []),
      ...state.cards,
    ]),
    ownedNames: input.ownedNames,
    availableNames: input.ownedNames,
    gameChangerNames: input.gameChangers,
    protections: protectionSourcesFrom(analysis),
    knownCards: state.cards,
    manaSim: { games: input.games ?? 1000 },
  });
}

/** The cards a cut's replacement is chosen from: what Coach itself offers (the app's own list). */
export function shadowCandidates(input: ShadowInput, objective: CoachObjective): ScryfallCard[] {
  const { analysis, view } = input.pass;
  return replacementCandidateNames({
    gaps: [...(analysis.gapAnalysis ?? []), ...view.suggestions.staples],
    hiddenGems: view.hiddenGems,
    additions: analysis.optimizeSwaps?.additions,
    synergy: analysis.synergyAnalysis?.suggestions,
    ownedNames: input.ownedNames,
    inclusionOf: (n) => objective.ctx.edhrec.get(n)?.inclusion ?? 0,
  })
    .map((n) => input.resolve(n))
    .filter((c): c is ScryfallCard => !!c);
}

export async function shadowRecord(input: ShadowInput): Promise<ShadowRecord> {
  const { state, pass } = input;
  const { view } = pass;
  const base = {
    corpus: input.corpus,
    group: input.group,
    deck: input.deck,
    deckSize: state.cards.length,
    labels: input.labels,
  };
  const shown: { row: Omit<ShadowRow, 'score'>; change: Change }[] = [
    ...view.feed.map((r, position) => ({ surface: 'feed' as const, r, position })),
    ...view.cuts.map((r, position) => ({ surface: 'cuts' as const, r, position })),
  ].map(({ surface, r, position }) => ({
    change: r.change,
    row: {
      position,
      surface,
      lane: r.change.lane,
      type: r.change.type,
      name: r.change.name,
      inName: r.change.inName ?? null,
      tier: r.tier,
      inclusion: r.change.inclusion ?? null,
    },
  }));

  const objective = shadowObjective(input);
  if (!objective.ok) {
    const rows = shown.map((s) => ({
      ...s.row,
      score: { status: 'unscored', reason: `no-objective:${objective.reason}` } as CompactScore,
    }));
    return { ...base, objective: objective.reason, pageRows: 0, scoreMs: 0, rows };
  }

  const candidates = shadowCandidates(input, objective);

  const t0 = Date.now();
  const scores = scoreCoachMoves(
    shown.map((s) => s.change),
    objective,
    { resolve: input.resolve, candidates, fullTop: input.fullTop ?? 20 }
  );
  const scoreMs = Date.now() - t0;
  return {
    ...base,
    objective: 'ok',
    pageRows: objective.pageRows,
    scoreMs,
    rows: shown.map((s, i) => ({ ...s.row, score: compact(scores[i]) })),
  };
}
