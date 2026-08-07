import type { Customization, ManaPhilosophy, ScryfallCard } from '@/deck-builder/types';
import { getCardPrice, isMdfcLand } from '@/deck-builder/services/scryfall/client';
import { hasLandUpside, landColorCoverage } from './landPower';

/**
 * Mana-philosophy wheel (Manafoundry ranked item 22) — a blendable preference
 * over WHAT KIND of manabase to build, expressed as four weights that are
 * normalized to sum to 1 and applied as one additive re-rank on the nonbasic
 * land candidates (`landGenerator.ts`'s `landPenalties`).
 *
 * The four axes are the ones the existing land boosts already imply, made
 * user-steerable instead of fixed:
 *   reliable   — colored sources first (the COLOR_DEMAND_BOOST_MAX instinct)
 *   greedy     — utility lands with real abilities over plain fixing
 *   spelllands — MDFC spell/lands, i.e. land slots that aren't dead draws
 *   budget     — cheaper lands, penalized by price
 *
 * Ships behind `customization.manaPhilosophy`, default OFF (`undefined`). Unset
 * means the whole pass is skipped and generation is byte-identical. The wheel
 * control itself shipped separately as E234 (#1518, DeckCustomizer).
 *
 * ── E231 DEFAULT-ON: ASKED AND ANSWERED 2026-08-07 — OFF STAYS THE DEFAULT. ──
 *
 * Two independent reasons, one product and one measured.
 *
 * PRODUCT: E234 shipped this as an opt-in preference, and its on-screen copy
 * says so — "Off by default — every deck keeps today's land priority until you
 * turn this on." There is also no default vector to default TO: these four axes
 * are user preferences, not correctness, and landGenerator already encodes the
 * house philosophy (COLOR_DEMAND_BOOST_MAX 25 / LAND_POWER_BOOST_MAX 40 / MDFC
 * 50 / channel 80 / tapland pacing). Turning the wheel on adds no judgement, it
 * re-weights those same terms arbitrarily.
 *
 * MEASURED: A/B on the standard 15-deck panel with the wheel forced to exactly
 * what DeckCustomizer's checkbox writes when ticked without moving a slider (all
 * four raw weights 0 → WEIGHT_FLOOR normalizes to an equal 25% blend). Result:
 * **31 cards changed across 15 of 15 decks**, 25 of them land swaps and 6
 * non-land knock-on. The `budget` axis is the damage: at a 25% share it prices
 * lands in decks that set NO budget, shedding $1,084 of manabase across the
 * panel (12/15 decks got cheaper unasked) — Yuriko bracket-4 lost Underground
 * Sea for Temple of Deceit, Kozilek lost Urza's Saga, Meren lost Phyrexian
 * Tower, Krenko lost Command Tower. Note Phyrexian Tower is doubly exposed:
 * `hasLandUpside` rejects its mana-only activation, so `greedy` never credits it
 * while `budget` still penalizes its price.
 *
 * The wheel remains correct as a USER choice — this rejects default-on only.
 */

/** Per identity color a land supplies, at full `reliable` weight. */
export const RELIABLE_PER_COLOR = 18;
/** A land with a real non-mana ability, at full `greedy` weight. */
export const GREEDY_UTILITY_BOOST = 55;
/** An MDFC spell/land, at full `spelllands` weight. */
export const SPELLLAND_MDFC_BOOST = 60;
/** Price penalty per dollar, at full `budget` weight. */
export const BUDGET_PENALTY_PER_DOLLAR = 3;
/** Ceiling on the price penalty — past this, pricier is just pricier. */
export const BUDGET_PENALTY_CAP = 30;

/**
 * Share every axis keeps no matter how the user sets the wheel. A term that
 * normalizes to exactly 0 has no gradient — the cube objective refiner shipped
 * that bug for six weeks and it took #1408 to find it (a zeroed interaction
 * term meant cutting the cube's removal cost nothing). Here it would mean a
 * wheel turned all the way to `greedy` stops seeing price entirely and can seat
 * a $200 utility land in a budget deck. With the floor, all-greedy still reads
 * ~4% of each other axis.
 */
export const WEIGHT_FLOOR = 0.05;

export type { ManaPhilosophy };

const AXES = ['reliable', 'greedy', 'spelllands', 'budget'] as const;

/** `undefined` = OFF. No smart default — this is a composition change (same
 *  rule as `resolveArchetypeBlend`, unlike `resolvePriceSanity`). */
export function resolveManaPhilosophy(
  customization: Pick<Customization, 'manaPhilosophy'>
): ManaPhilosophy | null {
  return customization.manaPhilosophy ?? null;
}

/** Weights as shares summing to 1, with `WEIGHT_FLOOR` reserved per axis so no
 *  axis can reach 0. Negative/NaN inputs clamp to 0 before flooring. */
export function normalizeManaPhilosophy(weights: ManaPhilosophy): ManaPhilosophy {
  const floored = AXES.map((a) => Math.max(0, Number(weights[a]) || 0) + WEIGHT_FLOOR);
  const total = floored.reduce((s, v) => s + v, 0);
  const out = {} as ManaPhilosophy;
  AXES.forEach((a, i) => {
    out[a] = floored[i] / total;
  });
  return out;
}

/**
 * Additive pick-score deltas keyed by card name, for the nonbasic land
 * candidate pool. Pure — the caller merges into the existing land boost map, so
 * a land can carry a channel/MDFC/merit boost and a philosophy delta at once.
 *
 * Basics are not in this pool (they're allocated separately by pip demand), so
 * the wheel only ever re-ranks nonbasics.
 */
export function computeManaPhilosophyBoosts(
  lands: ReadonlyMap<string, ScryfallCard>,
  identity: ReadonlySet<string>,
  weights: ManaPhilosophy,
  currency: 'USD' | 'EUR' = 'USD'
): Map<string, number> {
  const w = normalizeManaPhilosophy(weights);
  const boosts = new Map<string, number>();
  for (const [name, card] of lands) {
    const price = Number(getCardPrice(card, currency) ?? 0);
    const delta =
      w.reliable * RELIABLE_PER_COLOR * landColorCoverage(card, identity) +
      w.greedy * (hasLandUpside(card) ? GREEDY_UTILITY_BOOST : 0) +
      w.spelllands * (isMdfcLand(card) ? SPELLLAND_MDFC_BOOST : 0) -
      w.budget * Math.min(price * BUDGET_PENALTY_PER_DOLLAR, BUDGET_PENALTY_CAP);
    boosts.set(name, Math.round(delta));
  }
  return boosts;
}
