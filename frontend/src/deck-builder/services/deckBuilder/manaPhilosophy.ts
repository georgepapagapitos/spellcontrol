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
 * Ships behind `customization.manaPhilosophy`, default OFF (`undefined`) with
 * no UI in v1 — same posture as E221's archetype blend and E230's Hyper Focus.
 * Unset means the whole pass is skipped and generation is byte-identical. This
 * is a composition change to shipped generation, so the default must not flip
 * until a 0-regressed `deckgen-eval-gate` panel clears. The wheel control
 * itself is its own design pass (board row), not a tail-of-session widget.
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
