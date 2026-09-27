/**
 * Upgrade plan (E458): spend a budget on the best swaps for a Commander deck.
 *
 * Pure and synchronous over the Coach feed's own `Change` list
 * (`buildCoachChanges` → `rankCoachMoves`), so a plan is "the Coach's top
 * moves that fit your money" and never disagrees with the feed. Re-planning on
 * every tap is free: no AI, no network.
 *
 * Walk the ranked moves in order. Each one needs a slot (an empty one first,
 * then a paired cut) and must fit what's left of the budget; a move that
 * doesn't fit is skipped and the next is tried. Pairing keeps the deck's
 * shape: land for land, nonland for nonland, same role first, and a role is
 * never cut below its target unless the add replaces it in kind.
 *
 * Price, the bracket predicates and the re-estimate are injected, so this file
 * carries no card data and no I/O (the deck-metrics `TagLookup` pattern).
 */
import type { Change } from './deck-change';

/** 'hold' keeps the bracket, 'up' moves it up to `ceiling`, 'any' ignores it. */
export type UpgradeGoal = 'hold' | 'up' | 'any';

export interface UpgradePlanOptions {
  budget: number;
  goal: UpgradeGoal;
  /** Owned copies with a free copy cost nothing. Copies committed to another
   *  deck or a cube are always priced: counting them free would quietly strip
   *  the deck they're in. */
  ownedFree: boolean;
  /** Incoming card names the player unticked. */
  excluded?: ReadonlySet<string>;
}

export interface UpgradePlanContext {
  /** Add and swap candidates in Coach rank order. Other types are ignored. */
  moves: readonly Change[];
  /** Cut candidates, weakest first (the optimizer's own order). */
  cuts: readonly Change[];
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  /** Empty mainboard slots, filled before anything is cut. */
  openSlots: number;
  /** One copy's price in the display currency, or null when unknown. */
  priceOf: (name: string) => number | null;
  /** Adding this card can raise the bracket (Game Changer, tutor, fast mana,
   *  mass land denial, extra turns, stax, a combo completion…). */
  raisesBracket: (c: Change) => boolean;
  isGameChanger: (c: Change) => boolean;
  /** 'up' only: Game Changers the target bracket still allows. */
  gameChangerRoom: number;
  /** Highest bracket the plan may leave the deck at ('hold'/'up'). */
  ceiling: number;
  /** Re-estimate the bracket with the plan applied. Absent → no verify. */
  estimate?: (addNames: string[], cutNames: string[]) => number;
}

export interface PlannedMove {
  /** The add or swap; `change.name` is the card coming in. */
  change: Change;
  /** The card going out, or null when the move fills an empty slot. */
  cutName: string | null;
  /** The cut's own Change when it came from the cut pool (role, inclusion, why). */
  cut?: Change;
  cost: number;
}

export interface UpgradePlan {
  picks: PlannedMove[];
  spent: number;
  /** Picks that cost nothing because a free copy is owned. */
  fromCollection: number;
  /** Would have fit the budget but would raise the bracket past the goal. */
  leftOutForBracket: Change[];
  /** No price today. Never counted as free. */
  unpriced: Change[];
  /** The best move the budget couldn't reach, with its cost. */
  nextOverBudget: { change: Change; cost: number } | null;
  /** Role counts with the plan applied. */
  rolesAfter: Record<string, number>;
  /** The re-estimate with the plan applied, when a verify ran. */
  estimateAfter: number | null;
}

/** Lanes that don't spend money on the deck: cheaper copies of what's there,
 *  and the carousel's audition rows. */
const IGNORED_LANES = new Set<Change['lane']>(['budget', 'similar']);

const isLand = (c: Change) => c.role === 'land' || /\bLand\b/.test(c.typeLine ?? '');
const key = (name: string) => name.toLowerCase();

export function planUpgrades(ctx: UpgradePlanContext, opts: UpgradePlanOptions): UpgradePlan {
  const excluded = new Set([...(opts.excluded ?? [])].map(key));
  const counts = { ...ctx.roleCounts };
  // A role with no target (lands, roleless filler) is never protected.
  const short = (role: string) => (counts[role] ?? 0) < (ctx.roleTargets[role] ?? -Infinity);
  const cuttable = (role: string) => (counts[role] ?? 0) > (ctx.roleTargets[role] ?? -Infinity);

  // Candidates: one row per incoming card, highest rank wins. A Your-decks move
  // brings a copy committed elsewhere, so it is priced like one.
  const seen = new Set<string>();
  let candidates = ctx.moves
    .filter((c) => (c.type === 'add' || c.type === 'swap') && !IGNORED_LANES.has(c.lane))
    .map((c): Change => (c.lane === 'decks' ? { ...c, ownership: 'in-other-deck' } : c))
    .filter((c) => {
      const k = key(c.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // Moving up: Game Changers are the point of the goal, so they go first,
  // then the other bracket raisers, then everything else in rank order.
  if (opts.goal === 'up') {
    const rank = (c: Change) => (ctx.isGameChanger(c) ? 0 : ctx.raisesBracket(c) ? 1 : 2);
    candidates = candidates
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .map((x) => x.c);
  }

  const cutPool = ctx.cuts.filter((c) => c.type === 'cut' && c.lane !== 'bracket-fit');
  const usedCuts = new Set<string>();
  const freeCut = (c: Change) => !usedCuts.has(key(c.name)) && !excluded.has(key(c.name));

  // A cut that keeps the deck's shape: same kind (land/nonland), and a role
  // never falls below its target unless the add is that role too.
  function pickCut(add: Change): Change | undefined {
    const land = isLand(add);
    const role = add.role;
    const eligible = cutPool.filter((c) => freeCut(c) && isLand(c) === land);
    const safe = (c: Change) => !c.role || c.role === role || cuttable(c.role);
    // Filling a short role only helps when the cut comes from outside it.
    if (role && short(role)) {
      const outside = eligible.find((c) => c.role !== role && safe(c));
      if (outside) return outside;
    }
    return (role ? eligible.find((c) => c.role === role) : undefined) ?? eligible.find(safe);
  }

  const costOf = (c: Change): number | null => {
    if (opts.ownedFree && c.ownership === 'owned') return 0;
    const price = ctx.priceOf(c.name);
    if (price != null) return price;
    return c.type === 'add' && c.deltaPrice != null && c.deltaPrice > 0 ? c.deltaPrice : null;
  };

  const picks: PlannedMove[] = [];
  const leftOutForBracket: Change[] = [];
  const unpriced: Change[] = [];
  let nextOverBudget: UpgradePlan['nextOverBudget'] = null;
  let spent = 0;
  let slots = Math.max(0, ctx.openSlots);
  let gcRoom = opts.goal === 'up' ? ctx.gameChangerRoom : Infinity;

  for (const c of candidates) {
    if (excluded.has(key(c.name))) continue;
    const cost = costOf(c);
    if (cost == null) {
      unpriced.push(c);
      continue;
    }
    const remaining = opts.budget - spent;
    const raises = ctx.raisesBracket(c);
    if (opts.goal === 'hold' && raises) {
      if (cost <= remaining) leftOutForBracket.push(c);
      continue;
    }
    if (ctx.isGameChanger(c) && gcRoom <= 0) {
      if (cost <= remaining) leftOutForBracket.push(c);
      continue;
    }
    if (cost > remaining) {
      nextOverBudget ??= { change: c, cost };
      continue;
    }

    let cutName: string | null = null;
    let cut: Change | undefined;
    if (c.type === 'swap' && c.inName) {
      // A pre-paired swap brings its own cut; it can't be cut twice.
      if (usedCuts.has(key(c.inName)) || excluded.has(key(c.inName))) continue;
      cutName = c.inName;
      cut = cutPool.find((p) => key(p.name) === key(c.inName!));
    } else if (slots > 0) {
      slots--;
    } else {
      cut = pickCut(c);
      if (!cut) continue;
      cutName = cut.name;
    }

    if (cutName) usedCuts.add(key(cutName));
    if (c.role) counts[c.role] = (counts[c.role] ?? 0) + 1;
    if (cut?.role) counts[cut.role] = (counts[cut.role] ?? 0) - 1;
    if (ctx.isGameChanger(c)) gcRoom--;
    spent += cost;
    picks.push({ change: c, cutName, cut, cost });
  }

  // Verify with the real estimator: drop the latest bracket raiser (else the
  // latest pick) until the deck is back under the ceiling.
  // ponytail: dropped moves free budget that isn't re-spent; re-run the walk
  // with the drops excluded if a plan ever leaves visible money on the table.
  let estimateAfter: number | null = null;
  if (ctx.estimate && opts.goal !== 'any') {
    const run = () =>
      ctx.estimate!(
        picks.map((p) => p.change.name),
        picks.flatMap((p) => (p.cutName ? [p.cutName] : []))
      );
    estimateAfter = run();
    while (estimateAfter > ctx.ceiling && picks.length > 0) {
      let i = picks.map((p) => ctx.raisesBracket(p.change)).lastIndexOf(true);
      if (i < 0) i = picks.length - 1;
      const [dropped] = picks.splice(i, 1);
      spent -= dropped.cost;
      if (dropped.change.role) counts[dropped.change.role]--;
      if (dropped.cut?.role) counts[dropped.cut.role]++;
      leftOutForBracket.push(dropped.change);
      estimateAfter = run();
    }
  }

  return {
    picks,
    spent: Math.round(spent * 100) / 100,
    fromCollection: picks.filter((p) => p.cost === 0 && p.change.ownership === 'owned').length,
    leftOutForBracket,
    unpriced,
    nextOverBudget,
    rolesAfter: counts,
    estimateAfter,
  };
}
