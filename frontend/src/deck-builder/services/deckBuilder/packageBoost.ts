/**
 * Generation-time package assembly: a bounded boost for candidates that
 * complete the deck's LIVE engines — the positive counterpart to
 * synergyDependency's negative gate.
 *
 * The dependency gate only prevents dead payoffs ("no Blood Artist without sac
 * fodder"); nothing pushed the generator to ASSEMBLE an engine once one side
 * existed. This module tallies per-axis producer/payoff investment over the
 * commander(s) + cards picked so far (the 23-axis oracle classifier), and
 * boosts candidates that sit on the SCARCER side of a live axis — a payoff for
 * a deck full of producers, fuel for a deck full of payoffs.
 *
 * Guardrails, in the E71 bounded-re-rank tradition:
 *  - Only the scarcer side ever gets a boost (strictly fewer than the other
 *    side). Deepening the majority side gets nothing, so one axis can't
 *    snowball the whole deck.
 *  - Capped at PACKAGE_BOOST_MAX per card — below the theme-synergy bonus
 *    (+100) and typical combo boosts, so EDHREC priority stays primary.
 *  - An axis only counts once it's live (LIVE_MIN classified cards across both
 *    sides), so a stray token maker doesn't summon Cathars' Crusade.
 *  - A re-rank, never an eligibility path: every hard gate (color, price,
 *    salt, bracket, curve, dependency) still applies at the pick site.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyCard, type CardSynergy } from '@/deck-builder/services/synergy/classify';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

/** Ceiling for the per-card package boost. */
export const PACKAGE_BOOST_MAX = 30;
/** Classified cards (both sides) before an axis counts as a live engine. */
const LIVE_MIN = 3;
/** The commander is always castable/present — its axes weigh double. */
const COMMANDER_WEIGHT = 2;

// Name-keyed classify cache: candidates recur across the six type passes and
// picked cards are re-tallied each pass; classifyCard is pure per printing.
const classifyCache = new Map<string, CardSynergy>();

function classified(card: ScryfallCard): CardSynergy {
  const hit = classifyCache.get(card.name);
  if (hit) return hit;
  const result = classifyCard(card);
  classifyCache.set(card.name, result);
  return result;
}

/** Test hook — the cache is module-level and card names can collide across tests. */
export function clearPackageBoostCache(): void {
  classifyCache.clear();
}

export interface AxisInvestment {
  producers: number;
  payoffs: number;
}

/**
 * Per-axis producer/payoff investment of the deck so far. Commanders weigh
 * double (always available); everything else counts once.
 */
export function tallyAxisInvestment(
  picked: readonly ScryfallCard[],
  commanders: readonly ScryfallCard[]
): Map<AxisKey, AxisInvestment> {
  const tally = new Map<AxisKey, AxisInvestment>();
  const bump = (axis: AxisKey, side: 'producers' | 'payoffs', weight: number) => {
    const entry = tally.get(axis) ?? { producers: 0, payoffs: 0 };
    entry[side] += weight;
    tally.set(axis, entry);
  };
  const add = (card: ScryfallCard, weight: number) => {
    const c = classified(card);
    for (const p of c.producers) bump(p.axis, 'producers', weight);
    for (const p of c.payoffs) bump(p.axis, 'payoffs', weight);
  };
  for (const c of commanders) add(c, COMMANDER_WEIGHT);
  for (const c of picked) add(c, 1);
  return tally;
}

/** Imbalance → boost: 10 × (gap / (scarcerSide + 1)), capped at 20 per axis. */
function axisBoost(scarce: number, abundant: number): number {
  return Math.min(20, 10 * ((abundant - scarce) / (scarce + 1)));
}

/**
 * Boosts for candidates that complete a live engine's scarcer side. Returns
 * only positive entries; callers merge into the pick-phase boost map.
 */
export function computePackageBoosts(
  candidateNames: readonly string[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  investment: ReadonlyMap<AxisKey, AxisInvestment>
): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const name of candidateNames) {
    const card = cardMap.get(name);
    if (!card) continue;
    const c = classified(card);
    let boost = 0;
    for (const p of c.payoffs) {
      const inv = investment.get(p.axis);
      if (!inv || inv.producers + inv.payoffs < LIVE_MIN) continue;
      if (inv.payoffs < inv.producers) boost += axisBoost(inv.payoffs, inv.producers);
    }
    for (const p of c.producers) {
      const inv = investment.get(p.axis);
      if (!inv || inv.producers + inv.payoffs < LIVE_MIN) continue;
      if (inv.producers < inv.payoffs) boost += axisBoost(inv.producers, inv.payoffs);
    }
    if (boost > 0) boosts.set(name, Math.min(PACKAGE_BOOST_MAX, Math.round(boost)));
  }
  return boosts;
}

/**
 * Lift pick boost (E71 follow-up): the EDHREC lift clusterScore is validated
 * (nDCG 0.825/0.841 — see project_edhrec_lift_signal memory) but was only
 * ever wired as an EXACT-tie tie-break (cardPicking.ts's liftTie), which a
 * continuous float priority score never hits — so it never actually moved a
 * pick. Folded into the same bounded re-rank as package completion: a small,
 * capped, additive boost so a role-null payoff with real lift connectivity
 * (no ramp/removal/boardwipe/cardDraw tag, so it gets zero role boost) can
 * still win a marginal slot race against role-boosted filler.
 *
 * Ceiling matches PACKAGE_BOOST_MAX for the same reason: comfortably below
 * theme-synergy (+100) and role-deficit boosts, so EDHREC priority stays
 * primary — this only breaks close races, never overrides them.
 */
export const LIFT_PICK_BOOST_MAX = 30;
/**
 * Scales a candidate's clusterScore (liftSynergy.ts) into boost points.
 * Derived from the committed 24-commander lift eval fixture
 * (__fixtures__/edhrec-lift.fixture.json): reconstructing each commander's
 * candidate pool from its lift-pool "context" seeds and scoring with
 * aggregateLiftCandidates/edgeScore, the per-commander TOP candidate's
 * clusterScore has median ~2150 (p25 ~934, p75 ~8350) across all 24
 * commanders, while the full candidate pool (9.5k candidates total) sits far
 * lower (median ~106, p90 ~693, p99 ~5631). At 0.0075, a median "best
 * candidate for this commander" lands ~16 boost (mid of the 10-25 target
 * band); weak/incidental candidates (most of the pool) stay near 0; only the
 * strongest ~35-40% of per-commander top picks (clusterScore > 4000, e.g.
 * Krenko's Sling-Gang Lieutenant at ~20242) saturate the 30 cap.
 */
export const LIFT_PICK_BOOST_SCALE = 0.0075;

/**
 * Pure, testable re-rank step: caller supplies the candidate pool and a
 * `liftScoreOf` lookup (deckGenerator.ts's `liftIndex`-backed closure).
 * Returns only positive entries — callers merge into the shared boost map,
 * same as computePackageBoosts.
 */
export function computeLiftPickBoosts(
  candidateNames: readonly string[],
  liftScoreOf: (name: string) => number,
  /** Staples <-> Brew dial scale (deckGenerator.ts: `2 * brewLevel`) — 1 at the
   *  Balanced default (today's exact boost, unchanged), 0 at full Staples
   *  (hidden-synergy lift stops influencing a pure-staples build), 2 at full
   *  Brew (doubles the lift-pick boost/cap, per the E89 Staples<->Brew spec's
   *  "scale the lift multiplier/cap up"). A pure scalar on the already-capped
   *  boost, so it stays monotonic and never changes which candidates have a
   *  lift connection — only how much it weighs. */
  scaleMul: number = 1
): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const name of candidateNames) {
    const l = liftScoreOf(name);
    if (l > 0)
      boosts.set(name, Math.min(LIFT_PICK_BOOST_MAX, l * LIFT_PICK_BOOST_SCALE) * scaleMul);
  }
  return boosts;
}

/**
 * Untap-theme visibility boost (E89, iter-7 Slice E): a flat, capped boost
 * for untap-producer candidates (isUntapProducer, tagger/client.ts),
 * gated entirely on whether the deck's commander (or partner) wants untap
 * support — near-inert (empty map) for every other deck. `isProducer` is
 * injected, mirroring computeLiftPickBoosts's `liftScoreOf` param, so this
 * module doesn't import tagger/client.ts directly.
 *
 * Ceiling is half of PACKAGE_BOOST_MAX / LIFT_PICK_BOOST_MAX (30) — same
 * "narrower/single-signal boost gets half the two-signal cap" precedent as
 * phaseRoleSurplusRebalance.ts's MIN_IMPROVEMENT_MARGIN. This is a boolean
 * signal (no continuous score to scale, unlike lift's clusterScore), so a
 * flat award at half-cap, not a scaled one.
 */
export const UNTAP_VISIBILITY_BOOST_MAX = 15;

export function computeUntapVisibilityBoosts(
  candidateNames: readonly string[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  commanderWantsUntap: boolean,
  isProducer: (card: ScryfallCard) => boolean
): Map<string, number> {
  const boosts = new Map<string, number>();
  if (!commanderWantsUntap) return boosts;
  for (const name of candidateNames) {
    const card = cardMap.get(name);
    if (card && isProducer(card)) boosts.set(name, UNTAP_VISIBILITY_BOOST_MAX);
  }
  return boosts;
}

/**
 * Blink/flicker theme visibility boost (iter-8 Slice B) — same shape as
 * computeUntapVisibilityBoosts: a flat, capped boost for blink-producer
 * candidates (isBlinkProducer, tagger/client.ts), gated entirely on whether
 * the deck's commander (or partner) is itself a blink producer. `isProducer`
 * is injected for the same reason as untap's — this module doesn't import
 * tagger/client.ts directly.
 */
export const BLINK_VISIBILITY_BOOST_MAX = 15;

export function computeBlinkVisibilityBoosts(
  candidateNames: readonly string[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  commanderWantsBlink: boolean,
  isProducer: (card: ScryfallCard) => boolean
): Map<string, number> {
  const boosts = new Map<string, number>();
  if (!commanderWantsBlink) return boosts;
  for (const name of candidateNames) {
    const card = cardMap.get(name);
    if (card && isProducer(card)) boosts.set(name, BLINK_VISIBILITY_BOOST_MAX);
  }
  return boosts;
}

/**
 * Exile-matters (impulse draw) theme visibility boost (iter-8 Slice B) — same
 * shape as computeUntapVisibilityBoosts. Gated on commanderWantsExile, which
 * (unlike blink) is true for either an exile-producer commander OR a
 * cast-from-exile payoff-identity commander (see hasExilePayoffIdentity in
 * deckGenerator.ts) — this is what catches Urianger Augurelt, whose own text
 * never matches isExileProducer.
 */
export const EXILE_VISIBILITY_BOOST_MAX = 15;

export function computeExileVisibilityBoosts(
  candidateNames: readonly string[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  commanderWantsExile: boolean,
  isProducer: (card: ScryfallCard) => boolean
): Map<string, number> {
  const boosts = new Map<string, number>();
  if (!commanderWantsExile) return boosts;
  for (const name of candidateNames) {
    const card = cardMap.get(name);
    if (card && isProducer(card)) boosts.set(name, EXILE_VISIBILITY_BOOST_MAX);
  }
  return boosts;
}
