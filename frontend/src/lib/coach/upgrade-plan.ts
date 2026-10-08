/**
 * Upgrade plan (E458, v2 E467): spend a budget on the best swaps for a
 * Commander deck.
 *
 * Pure and synchronous over the Coach feed's own `Change` list
 * (`buildCoachChanges` → `rankCoachMoves`), so the plan and the feed never
 * disagree about what a deck could use. Re-planning on every tap is free: no
 * AI, no network.
 *
 * Moves are taken by VALUE FOR MONEY. Value is the Coach tier, plus how much
 * better the new card is than the one it replaces (play-rate over the cut, a
 * land's fixing score, a completed combo), plus a short role filled; a price
 * divides it (`PRICE_SCALE`), so a $27 fetch land has to be far better than
 * a $0.30 staple to go first. A move that doesn't fit what's left is skipped
 * and the next is tried. An owned card costs nothing but still has to earn
 * its slot: a swap that isn't a clear gain over its cut is a sidegrade and
 * isn't proposed, owned or not.
 *
 * Pairing keeps the deck's shape: an empty slot first, then land for land and
 * nonland for nonland, same role first, a role never cut below its target
 * unless the add fills it, basics never below what the fetch lands need, and a
 * fetch land never replaces a basic.
 *
 * Price, the bracket predicates and the re-estimate are injected, so this file
 * carries no card data and no I/O (the deck-metrics `TagLookup` pattern).
 */
import type { Change } from './deck-change';
import type { PlanJudge, PlanPick } from './plan-move-judge';

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
  /** Deck cards the player chose to keep: never cut. */
  kept?: ReadonlySet<string>;
}

export interface UpgradePlanContext {
  /** Add and swap candidates in Coach rank order. Other types are ignored. */
  moves: readonly Change[];
  /** Cut candidates, weakest first. */
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
  /** The Coach tier of a move (1 structural … 3 polish). Default 3. */
  tierOf?: (c: Change) => 1 | 2 | 3;
  /** Basic lands in the list, and lands in it that fetch a basic. */
  basics?: number;
  fetchers?: number;
  /**
   * The whole-deck objective's judge (E540 S9), absent when the deck cannot be
   * scored (no EDHREC page, a thin one): the plan then runs on its own rules.
   * A swap or add it refuses is never offered, and a cut it refuses (a card the
   * protection set holds) is passed over for the next weakest card.
   */
  judge?: PlanJudge;
}

export type LeftOutReason =
  /** Raises the bracket past the goal. */
  | 'bracket'
  /** A Game Changer past the goal bracket's allowance. */
  | 'game-changer-limit'
  /** The re-estimate read the deck's power past the goal with it in. */
  | 'power'
  /** No price today. Never counted as free. */
  | 'no-price';

export interface LeftOut {
  change: Change;
  reason: LeftOutReason;
  /** Its cost, when known. */
  cost: number | null;
}

export interface PlannedMove {
  /** The add or swap; `change.name` is the card coming in. */
  change: Change;
  /** The card going out, or null when the move fills an empty slot. */
  cutName: string | null;
  /** The cut's own Change when it came from the cut pool (role, inclusion, why). */
  cut?: Change;
  cost: number;
  /** Upgrade value the plan ranked it by. */
  value: number;
}

export interface UpgradePlan {
  picks: PlannedMove[];
  spent: number;
  /** Picks that cost nothing because a free copy is owned. */
  fromCollection: number;
  /** Cards the plan would have taken, and why it didn't. */
  leftOut: LeftOut[];
  /** The most valuable move the budget couldn't reach, with its cost. */
  nextOverBudget: { change: Change; cost: number } | null;
  /**
   * Moves the objective judged a loss or refused (a protected cut) and the plan
   * therefore did not offer. Lets an empty plan say why it is empty.
   */
  notUpgrades: number;
  /** Role counts with the plan applied. */
  rolesAfter: Record<string, number>;
  /** The re-estimate with the plan applied, when a verify ran. */
  estimateAfter: number | null;
}

/** Lanes that don't spend money on the deck: cheaper copies of what's there,
 *  and the carousel's audition rows. */
const IGNORED_LANES = new Set<Change['lane']>(['budget', 'similar']);

/** Value a Coach tier adds on its own: a structural gap outranks polish. */
const TIER_VALUE = { 1: 40, 2: 20, 3: 0 } as const;
/** A gain below this over the cut is a sidegrade, not an upgrade. */
export const MIN_GAIN = 10;
/** Filling a role that's short of its target. */
const SHORT_ROLE_GAIN = 15;
/** Completing a combo already half in the deck. */
const COMBO_GAIN = 50;
/** Dollars at which a card's priority halves: value ÷ (1 + price ÷ this).
 *  The live check on an imported precon put a $27 Prismatic Vista, a modest
 *  fixing gain, ahead of a dozen strong cards under a dollar; this is the knob. */
const PRICE_SCALE = 10;
/** Play-rate assumed for a card EDHREC has none for (an off-meta synergy pick,
 *  an owned stand-in): enough to beat a dead card, not a staple. */
const UNRATED_INCLUSION = 20;

const BASIC = /^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest)$|^Wastes$/;
/** Lands that fetch a basic, by name when the Change carries no card text.
 *  A fixed list; the oracle-text check below covers any card with text. */
const FETCH_NAMES = new Set([
  'Evolving Wilds',
  'Terramorphic Expanse',
  'Fabled Passage',
  'Prismatic Vista',
  'Escape Tunnel',
  'Ash Barrens',
  'Myriad Landscape',
  'Warped Landscape',
  'Shire Terrace',
  'Promising Vein',
  'Brokers Hideout',
  'Cabaretti Courtyard',
  'Maestros Theater',
  'Obscura Storefront',
  'Riveteers Overlook',
]);

const isLand = (c: Change) => c.role === 'land' || /\bLand\b/.test(c.typeLine ?? '');
const key = (name: string) => name.toLowerCase();
export const isBasicName = (name: string) => BASIC.test(name);
/** "a basic land card", or a land type a basic has ("a Forest or Island card",
 *  the sacrifice fetches). Either way it needs a basic to find. */
const FETCH_TEXT =
  /search your library for (?:a|an|up to \w+) (?:basic|(?:plains|island|swamp|mountain|forest)(?:,? (?:or )?(?:plains|island|swamp|mountain|forest))* card)/i;
export function isBasicFetcher(c: Change): boolean {
  if (FETCH_NAMES.has(c.name)) return true;
  return FETCH_TEXT.test(c.card?.oracle_text ?? '');
}

export function planUpgrades(ctx: UpgradePlanContext, opts: UpgradePlanOptions): UpgradePlan {
  const excluded = new Set([...(opts.excluded ?? [])].map(key));
  const kept = new Set([...(opts.kept ?? [])].map(key));
  const counts = { ...ctx.roleCounts };
  // A role with no target (lands, roleless filler) is never protected.
  const short = (role: string) => (counts[role] ?? 0) < (ctx.roleTargets[role] ?? -Infinity);
  const cuttable = (role: string) => (counts[role] ?? 0) > (ctx.roleTargets[role] ?? -Infinity);
  let basics = ctx.basics ?? Infinity;
  let fetchers = ctx.fetchers ?? 0;

  // Candidates: one row per incoming card, highest rank wins. A Your-decks move
  // brings a copy committed elsewhere, so it is priced like one.
  const seen = new Set<string>();
  const rankOf = new Map<Change, number>();
  const candidates = ctx.moves
    .filter((c) => (c.type === 'add' || c.type === 'swap') && !IGNORED_LANES.has(c.lane))
    .map((c): Change => (c.lane === 'decks' ? { ...c, ownership: 'in-other-deck' } : c))
    .filter((c) => {
      const k = key(c.name);
      if (seen.has(k)) return false;
      seen.add(k);
      rankOf.set(c, rankOf.size);
      return true;
    });

  /** What a move is worth against a given cut (or an empty slot). */
  function gainOver(c: Change, cut: Change | undefined): number {
    let gain: number;
    if (c.lane === 'combos') gain = COMBO_GAIN;
    else if (c.lane === 'lands' && c.deltaScore != null) gain = c.deltaScore;
    else gain = (c.inclusion ?? UNRATED_INCLUSION) - (cut?.inclusion ?? 0);
    if (c.role && short(c.role)) gain += SHORT_ROLE_GAIN;
    return gain;
  }
  const valueOf = (c: Change, cut: Change | undefined) =>
    TIER_VALUE[ctx.tierOf?.(c) ?? 3] + gainOver(c, cut);

  const costOf = (c: Change): number | null => {
    if (opts.ownedFree && c.ownership === 'owned') return 0;
    const price = ctx.priceOf(c.name);
    if (price != null) return price;
    return c.type === 'add' && c.deltaPrice != null && c.deltaPrice > 0 ? c.deltaPrice : null;
  };

  // Best value for money first (value scored against an empty slot, the best
  // case), owned only as a tie-break, then the Coach's own order. Moving up
  // puts Game Changers first: they are the point of that goal.
  const upRank = (c: Change) =>
    opts.goal !== 'up' ? 0 : ctx.isGameChanger(c) ? 0 : ctx.raisesBracket(c) ? 1 : 2;
  const priority = (c: Change) => valueOf(c, undefined) / (1 + (costOf(c) ?? 0) / PRICE_SCALE);
  const ordered = [...candidates].sort(
    (a, b) =>
      upRank(a) - upRank(b) ||
      priority(b) - priority(a) ||
      Number(b.ownership === 'owned') - Number(a.ownership === 'owned') ||
      rankOf.get(a)! - rankOf.get(b)!
  );

  const cutPool = ctx.cuts.filter((c) => c.type === 'cut' && c.lane !== 'bracket-fit');
  const usedCuts = new Set<string>();
  const freeCut = (name: string) => !usedCuts.has(key(name)) && !kept.has(key(name));

  // A cut that keeps the deck's shape. Basics stay at or above the fetch
  // lands that need them, and a fetch land never takes a basic's slot.
  function basicAllowed(add: Change, cutName: string): boolean {
    if (!isBasicName(cutName)) return true;
    if (isBasicFetcher(add)) return false;
    return basics - 1 >= fetchers;
  }
  /** Cuts that keep the deck's shape for this add, in the order they are preferred. */
  function cutOptions(add: Change): Change[] {
    const land = isLand(add);
    const role = add.role;
    const eligible = cutPool.filter(
      (c) => freeCut(c.name) && isLand(c) === land && basicAllowed(add, c.name)
    );
    const safe = (c: Change) => !c.role || c.role === role || cuttable(c.role);
    const ordered: Change[] = [];
    // Filling a short role only helps when the cut comes from outside it.
    if (role && short(role)) ordered.push(...eligible.filter((c) => c.role !== role && safe(c)));
    if (role) ordered.push(...eligible.filter((c) => c.role === role));
    ordered.push(...eligible.filter(safe));
    return [...new Set(ordered)];
  }
  /** Cuts the judge may refuse before a card is given up on. */
  const MAX_CUT_TRIES = 8;

  const picks: PlannedMove[] = [];
  const leftOut: LeftOut[] = [];
  let nextOverBudget: UpgradePlan['nextOverBudget'] = null;
  let spent = 0;
  let notUpgrades = 0;
  const priorPicks = (): PlanPick[] => picks.map((p) => ({ add: p.change.name, cut: p.cutName }));
  let slots = Math.max(0, ctx.openSlots);
  let gcRoom = opts.goal === 'up' ? ctx.gameChangerRoom : Infinity;

  for (const c of ordered) {
    if (excluded.has(key(c.name))) continue;
    const cost = costOf(c);
    if (cost == null) {
      leftOut.push({ change: c, reason: 'no-price', cost: null });
      continue;
    }
    const remaining = opts.budget - spent;
    if (opts.goal === 'hold' && ctx.raisesBracket(c)) {
      if (cost <= remaining) leftOut.push({ change: c, reason: 'bracket', cost });
      continue;
    }
    if (ctx.isGameChanger(c) && gcRoom <= 0) {
      if (cost <= remaining) leftOut.push({ change: c, reason: 'game-changer-limit', cost });
      continue;
    }

    // A card the budget can't reach and the next pick is already named: nothing
    // below changes the plan, so skip the slot search and the judge.
    if (cost > remaining && nextOverBudget) continue;

    // Find its slot: a pre-paired swap brings its own cut unless the player
    // kept that card, then an empty slot, then the pool. With a judge the
    // first slot it accepts wins; without one, the first slot is the only try.
    const options: { cutName: string | null; cut?: Change }[] = [];
    if (c.type === 'swap' && c.inName && freeCut(c.inName) && basicAllowed(c, c.inName)) {
      options.push({
        cutName: c.inName,
        cut: cutPool.find((p) => key(p.name) === key(c.inName!)),
      });
    }
    if (slots > 0) options.push({ cutName: null });
    else
      for (const cut of cutOptions(c).slice(0, ctx.judge ? MAX_CUT_TRIES : 1))
        options.push({ cutName: cut.name, cut });
    // Without a judge the pre-paired cut, or else the first slot, is the only try.
    const tries = ctx.judge ? options : options.slice(0, 1);

    let cutName: string | null = null;
    let cut: Change | undefined;
    let found = false;
    let refused = false;
    for (const o of tries) {
      // A pre-paired swap was already judged against its cut by its own engine.
      const prePaired = c.type === 'swap' && o.cutName === c.inName;
      if (!prePaired && o.cutName && gainOver(c, o.cut) < MIN_GAIN) continue;
      if (ctx.judge) {
        const v = ctx.judge.verdict(c, o.cutName, priorPicks());
        if (v.status === 'refused') {
          refused = true;
          continue;
        }
      }
      ({ cutName, cut } = { cutName: o.cutName, cut: o.cut });
      found = true;
      break;
    }
    if (!found) {
      if (refused) notUpgrades++;
      continue;
    }

    if (cost > remaining) {
      nextOverBudget ??= { change: c, cost };
      continue;
    }

    if (cutName === null) slots--;
    else usedCuts.add(key(cutName));
    if (cutName && isBasicName(cutName)) basics--;
    if (isBasicFetcher(c)) fetchers++;
    if (c.role) counts[c.role] = (counts[c.role] ?? 0) + 1;
    if (cut?.role) counts[cut.role] = (counts[cut.role] ?? 0) - 1;
    if (ctx.isGameChanger(c)) gcRoom--;
    spent += cost;
    picks.push({ change: c, cutName, cut, cost, value: valueOf(c, cut) });
  }

  // Verify with the real estimator. While the deck reads past the ceiling,
  // drop the pick whose removal lowers the Estimate most: the card actually
  // responsible, never a bystander that happened to be picked last.
  // One estimator call per pick per drop (≈ picks² worst case); fine
  // at plan sizes, memoize by pick set if plans grow past a few dozen swaps.
  let estimateAfter: number | null = null;
  if (ctx.estimate && opts.goal !== 'any') {
    const run = (list: PlannedMove[]) =>
      ctx.estimate!(
        list.map((p) => p.change.name),
        list.flatMap((p) => (p.cutName ? [p.cutName] : []))
      );
    estimateAfter = run(picks);
    while (estimateAfter > ctx.ceiling && picks.length > 0) {
      let best = -1;
      let bestEstimate = Infinity;
      for (let i = picks.length - 1; i >= 0; i--) {
        const without = run(picks.filter((_, j) => j !== i));
        const raiser = ctx.raisesBracket(picks[i].change);
        // Lower is better; on a tie prefer a known raiser, then the latest pick.
        if (
          without < bestEstimate ||
          (without === bestEstimate && raiser && !ctx.raisesBracket(picks[best].change))
        ) {
          best = i;
          bestEstimate = without;
        }
      }
      const [dropped] = picks.splice(best, 1);
      spent -= dropped.cost;
      if (dropped.change.role) counts[dropped.change.role]--;
      if (dropped.cut?.role) counts[dropped.cut.role]++;
      leftOut.push({
        change: dropped.change,
        reason: ctx.raisesBracket(dropped.change) ? 'bracket' : 'power',
        cost: dropped.cost,
      });
      estimateAfter = bestEstimate;
    }
  }

  return {
    picks,
    spent: Math.round(spent * 100) / 100,
    fromCollection: picks.filter((p) => p.cost === 0 && p.change.ownership === 'owned').length,
    leftOut,
    nextOverBudget,
    notUpgrades,
    rolesAfter: counts,
    estimateAfter,
  };
}
