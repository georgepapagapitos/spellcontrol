/**
 * The upgrade plan as the app runs it, for the Coach eval (E540 S9). It
 * chooses its own moves, outside the feed the default advise run applies, so
 * the harness runs it too:
 *
 *  - COACH_EVAL_PLAN="hold:50,any:200": for each `goal:budget`, run
 *    `planUpgrades` over the deck's own Coach changes (the sheet's inputs:
 *    ranked adds and swaps, the feed's cuts then the weakest cards by
 *    play-rate), apply its picks the way a user does, run a second Coach pass
 *    and count cut-then-re-add reversals. Also replays every pick through the
 *    whole-deck objective's judge, so a baseline run reports how many of its
 *    own picks the objective would have refused.
 *  - COACH_EVAL_FILL=1: take the deck, hold back every eighth non-basic card,
 *    and let `planFill` complete it from the deck itself as the generator's
 *    answer. Both sides of the gate are whole decks (the original, and the
 *    held-back deck plus the plan's adds); the sim throws if the sizes differ.
 *
 * The same file runs on a detached-main baseline: main's planners ignore the
 * `judge` argument, so the two sides differ only in the planners.
 */
import type { CommanderDeckAnalysisResult } from '../commanderDeckAnalysis';
import { buildInclusionIndex, computeRoleCounts, lookupInclusion } from '../commanderDeckAnalysis';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { planFill } from '@/lib/coach/fill-deck-plan';
import { createPlanJudge, type PlanPick } from '@/lib/coach/plan-move-judge';
import { planUpgrades, type UpgradeGoal, type UpgradePlan } from '@/lib/coach/upgrade-plan';
import { buildUpgradePlanTools } from '@/lib/coach/upgrade-plan-tools';
import type { Change } from '@/lib/coach/deck-change';
import {
  applyCoachMoves,
  auditMoves,
  type ApplyEnv,
  type ApplyResult,
  type CoachMove,
  type DeckSettings,
  type EvalDeckState,
  type MoveAudit,
} from './applyCoachMoves';
import type { CoachDump, RoleStamp } from './coachDump';
import { restampRoles } from './coachDump';
import { shadowObjective, type ShadowInput } from './coachShadow';

/** What a Coach pass hands the lanes (the live test's `CoachPass`). */
export type PassLike = ShadowInput['pass'] & {
  moves: CoachMove[];
  env: ApplyEnv;
};

export interface PlanLaneDeps {
  out: string;
  coachPass: (dump: CoachDump, deck: EvalDeckState) => Promise<PassLike>;
  advisedFrom: (
    dump: CoachDump,
    result: ApplyResult,
    index: ReturnType<typeof buildInclusionIndex>,
    pass2: PassLike
  ) => CoachDump;
  stamp: (cards: ScryfallCard[], analysis: CommanderDeckAnalysisResult) => RoleStamp;
  writeJson: (path: string, value: unknown) => void;
  join: (...parts: string[]) => string;
  auditK: number;
  implicitReversal: string;
}

export interface PlanLaneInput extends ShadowInput {
  dump: CoachDump;
  panel: string;
  file: string;
  settings: DeckSettings;
  env: ApplyEnv;
}

export interface Reversal {
  move: string;
  how: string;
}

/** Ping-pong: the second pass wants an added card out, or a cut card back. */
export function pingPong(
  applied: readonly { added?: string; cut?: string }[],
  pass2: { moves: readonly CoachMove[]; view: { cuts: readonly { change: { name: string } }[] } },
  audit2: readonly MoveAudit[],
  k: number,
  implicit: string
): Reversal[] {
  const top2 = pass2.moves.slice(0, k);
  const addsBack = new Set(top2.filter((m) => m.type !== 'cut').map((m) => m.name));
  const outs2 = new Set([
    ...pass2.view.cuts.slice(0, k).map((r) => r.change.name),
    ...top2.filter((m) => m.type === 'swap' && m.outName).map((m) => m.outName!),
  ]);
  const promptCuts2 = new Set(audit2.map((a) => a.cut).filter((c): c is string => !!c));
  const out: Reversal[] = [];
  for (const a of applied) {
    if (a.added && outs2.has(a.added))
      out.push({ move: `+${a.added}`, how: 'second pass lists it as a cut' });
    else if (a.added && promptCuts2.has(a.added)) out.push({ move: `+${a.added}`, how: implicit });
    if (a.cut && addsBack.has(a.cut))
      out.push({ move: `-${a.cut}`, how: 'second pass suggests adding it back' });
  }
  return out;
}

export interface PlanRecord {
  kind: 'plan' | 'fill';
  config: string;
  panel: string;
  deck: string;
  /** 'ok', or why the deck cannot be judged. */
  objective: string;
  picks: { in: string; cut: string | null; cost?: number }[];
  applied: number;
  /** Picks the objective's judge refuses when replayed in order (a baseline's own losses). */
  refusedByObjective: { in: string; cut: string | null; reason: string }[];
  notUpgrades: number;
  declined: { card: string; reason: string }[];
  stillOpen?: number;
  reversed: Reversal[];
  ms: number;
  error?: string;
}

const records: PlanRecord[] = [];

const configsOf = (): { goal: UpgradeGoal; budget: number; name: string }[] =>
  (process.env.COACH_EVAL_PLAN ?? '')
    .split(',')
    .filter(Boolean)
    .map((c) => {
      const [goal, budget] = c.split(':');
      return { goal: goal as UpgradeGoal, budget: Number(budget), name: `${goal}-${budget}` };
    });
export const PLAN_CONFIGS = configsOf();
export const FILL = process.env.COACH_EVAL_FILL === '1';

async function advise(
  input: PlanLaneInput,
  deps: PlanLaneDeps,
  base: ApplyResult,
  dir: string,
  rec: PlanRecord,
  pass1: PassLike
): Promise<void> {
  const { dump, panel, file } = input;
  const pass2 = await deps.coachPass(dump, base.deck);
  const audit2 = auditMoves(base.deck, pass2.moves, input.settings, pass2.env, deps.auditK);
  rec.reversed = pingPong(base.applied, pass2, audit2, deps.auditK, deps.implicitReversal);
  const index = pass1.page ? buildInclusionIndex(pass1.page) : new Map<string, number>();
  deps.writeJson(deps.join(deps.out, dir, panel, 'original', file), dump);
  deps.writeJson(
    deps.join(deps.out, dir, panel, 'advised', file),
    restampRoles(
      deps.advisedFrom(dump, base, index, pass2),
      deps.stamp(base.deck.cards, pass2.analysis),
      pass2.analysis.deckGrade
    )
  );
}

/** The upgrade plan for one deck, one config: plan, replay through the judge, apply, second pass. */
export async function planLaneAdvise(
  input: PlanLaneInput,
  deps: PlanLaneDeps,
  pass1: PassLike
): Promise<void> {
  const objective = shadowObjective(input);
  const judge = createPlanJudge(objective, (n) => input.resolve(n));
  const { state, settings } = input;
  const index = pass1.page ? buildInclusionIndex(pass1.page) : new Map<string, number>();
  const a = pass1.analysis;
  const inclusion = Object.fromEntries(
    state.cards.flatMap((c) => {
      const i = lookupInclusion(index, c.name);
      return i == null ? [] : [[c.name, i]];
    })
  );
  const tools = buildUpgradePlanTools({
    deckCards: state.cards,
    commanderNames: [state.commander.name, state.partner?.name].filter((n): n is string => !!n),
    combos: pass1.combos,
    roleCounts: computeRoleCounts(state.cards).roleCounts,
    estimate: a.bracketEstimation.bracket,
    stated: settings.targetBracket,
    cardInclusionMap: inclusion,
  });
  const tierById = new Map(pass1.view.feed.map((r) => [r.change.id, r.tier]));
  const moves = pass1.view.feed.map((r) => r.change).filter((c) => c.type !== 'cut');
  const cuts = [...pass1.view.cuts.map((r) => r.change)];
  const seen = new Set(cuts.map((c) => c.name));
  const allCuts: Change[] = [...cuts, ...tools.weakestCuts.filter((c) => !seen.has(c.name))];
  const mainboard = 99 - (state.partner ? 1 : 0);
  const priceOf = (name: string): number | null => {
    const card = input.resolve(name);
    if (!card) return null;
    const p = getCardPrice(card, 'USD');
    return p ? Number(p) || 0 : 0;
  };

  for (const cfg of PLAN_CONFIGS) {
    const rec: PlanRecord = {
      kind: 'plan',
      config: cfg.name,
      panel: input.panel,
      deck: input.deck,
      objective: objective.ok ? 'ok' : objective.reason,
      picks: [],
      applied: 0,
      refusedByObjective: [],
      notUpgrades: 0,
      declined: [],
      reversed: [],
      ms: 0,
    };
    records.push(rec);
    try {
      const upTarget = tools.current + 1;
      const ceiling = cfg.goal === 'up' ? upTarget : tools.current;
      const t0 = Date.now();
      const plan: UpgradePlan = planUpgrades(
        {
          moves,
          cuts: allCuts,
          roleCounts: computeRoleCounts(state.cards).roleCounts,
          roleTargets: (a.roleTargets ?? {}) as Record<string, number>,
          openSlots: Math.max(0, mainboard - state.cards.length),
          priceOf,
          raisesBracket:
            cfg.goal === 'hold' && tools.current >= 4 ? () => false : tools.raisesBracket,
          isGameChanger: (c) => c.isGameChanger === true || tools.isGameChanger(c.name),
          gameChangerRoom: upTarget >= 4 ? Infinity : Math.max(0, 3 - tools.gameChangersInDeck),
          ceiling,
          estimate: tools.estimateAfter,
          tierOf: (c) => tierById.get(c.id) ?? 3,
          basics: tools.basics,
          fetchers: tools.fetchers,
          judge: judge ?? undefined,
        },
        { budget: cfg.budget, goal: cfg.goal, ownedFree: true }
      );
      rec.ms = Date.now() - t0;
      rec.notUpgrades = (plan as { notUpgrades?: number }).notUpgrades ?? 0;
      rec.picks = plan.picks.map((p) => ({ in: p.change.name, cut: p.cutName, cost: p.cost }));
      // Replay in order through the judge: how many picks the objective would have refused.
      if (judge) {
        const prior: PlanPick[] = [];
        for (const p of plan.picks) {
          const v = judge.verdict(p.change, p.cutName, prior);
          if (v.status === 'refused')
            rec.refusedByObjective.push({ in: p.change.name, cut: p.cutName, reason: v.reason });
          prior.push({ add: p.change.name, cut: p.cutName });
        }
      }
      const asMoves: CoachMove[] = plan.picks.map((p, i) => ({
        rank: i + 1,
        source: 'feed',
        surface: 'upgrade-plan',
        type: p.cutName ? 'swap' : 'add',
        name: p.change.name,
        outName: p.cutName ?? undefined,
        tier: tierById.get(p.change.id),
        reason: p.change.reason,
        inclusion: p.change.inclusion,
        ownership: p.change.ownership,
      }));
      const result = applyCoachMoves(state, asMoves, settings, input.env, asMoves.length, 1000);
      rec.applied = result.applied.length;
      if (result.applied.length > 0)
        await advise(input, deps, result, `plan/${cfg.name}`, rec, pass1);
    } catch (err) {
      rec.error = err instanceof Error ? err.message : String(err);
    }
  }
}

/** "Fill the rest" for one deck: hold back every eighth non-basic card, complete from the deck itself. */
export async function fillLaneAdvise(
  input: PlanLaneInput,
  deps: PlanLaneDeps,
  pass1: PassLike
): Promise<void> {
  const rec: PlanRecord = {
    kind: 'fill',
    config: 'fill',
    panel: input.panel,
    deck: input.deck,
    objective: 'ok',
    picks: [],
    applied: 0,
    refusedByObjective: [],
    notUpgrades: 0,
    declined: [],
    reversed: [],
    ms: 0,
  };
  records.push(rec);
  try {
    const { state } = input;
    const isBasic = (c: ScryfallCard) => /\bBasic\b/.test((c.type_line ?? '').split('//')[0]);
    let n = 0;
    const heldBack = new Set<ScryfallCard>();
    for (const c of state.cards) if (!isBasic(c) && n++ % 8 === 3) heldBack.add(c);
    const partBuilt = { ...state, cards: state.cards.filter((c) => !heldBack.has(c)) };
    const objective = shadowObjective({ ...input, state: partBuilt });
    rec.objective = objective.ok ? 'ok' : objective.reason;
    const judge = createPlanJudge(objective, (name) => input.resolve(name));
    const index = pass1.page ? buildInclusionIndex(pass1.page) : new Map<string, number>();
    const relevancy = Object.fromEntries(
      state.cards.map((c) => [c.name, lookupInclusion(index, c.name) ?? 0])
    );
    const t0 = Date.now();
    const plan = planFill(
      partBuilt.cards,
      state.cards,
      state.cards.length,
      relevancy,
      judge ?? undefined
    );
    rec.ms = Date.now() - t0;
    rec.picks = plan.additions.map((c) => ({ in: c.name, cut: null }));
    rec.declined = (
      (plan as { declined?: { card: ScryfallCard; reason: string }[] }).declined ?? []
    ).map((d) => ({ card: d.card.name, reason: d.reason }));
    rec.stillOpen = plan.stillOpen;
    rec.applied = plan.additions.length;
    // The advised dump is built from the original dump: cut what was held back, add what the plan seats.
    const cutOps = [...heldBack].map((c, i) => ({
      order: i + 1,
      move: {
        rank: i + 1,
        source: 'feed' as const,
        surface: 'fill',
        type: 'cut' as const,
        name: c.name,
      },
      cut: c.name,
    }));
    const addOps = plan.additions.map((c, i) => ({
      order: cutOps.length + i + 1,
      move: {
        rank: i + 1,
        source: 'feed' as const,
        surface: 'fill',
        type: 'add' as const,
        name: c.name,
      },
      added: c.name,
    }));
    const result: ApplyResult = {
      deck: { ...state, cards: [...partBuilt.cards, ...plan.additions] },
      applied: [...cutOps, ...addOps],
      skipped: [],
    };
    // Both sides of the gate are whole decks: the held-back deck plus the plan's adds is the original's size.
    if (result.deck.cards.length + plan.stillOpen !== state.cards.length)
      throw new Error(
        `fill sim: ${result.deck.cards.length} cards + ${plan.stillOpen} open, not ${state.cards.length}`
      );
    await advise(input, deps, result, 'fill', rec, pass1);
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
  }
}

/** The numbers per kind and config: applied picks, objective refusals, reversals, errors. */
export function planReport(): string {
  const groups = new Map<string, PlanRecord[]>();
  for (const r of records) groups.set(r.config, [...(groups.get(r.config) ?? []), r]);
  const lines: string[] = [];
  for (const [config, rs] of groups) {
    const sum = (f: (r: PlanRecord) => number) => rs.reduce((s, r) => s + f(r), 0);
    lines.push(
      `## ${config}`,
      `- decks ${rs.length} (errors ${rs.filter((r) => r.error).length}, objective unavailable ${rs.filter((r) => r.objective !== 'ok').length})`,
      `- picks offered ${sum((r) => r.picks.length)}, applied ${sum((r) => r.applied)}`,
      `- picks the objective refuses (replayed in order) ${sum((r) => r.refusedByObjective.length)} across ${rs.filter((r) => r.refusedByObjective.length > 0).length} decks`,
      `- moves the plan withheld as not an upgrade ${sum((r) => r.notUpgrades)}`,
      `- fill cards declined ${sum((r) => r.declined.length)}, slots left open ${sum((r) => r.stillOpen ?? 0)}`,
      `- Ping-pong (cut-then-re-add reversals): ${sum((r) => r.reversed.length)} across ${rs.filter((r) => r.reversed.length > 0).length} decks`,
      `- plan time ms (sum ${sum((r) => r.ms)}, max ${Math.max(0, ...rs.map((r) => r.ms))})`,
      ''
    );
  }
  return lines.join('\n');
}

export const planRecords = (): readonly PlanRecord[] => records;
