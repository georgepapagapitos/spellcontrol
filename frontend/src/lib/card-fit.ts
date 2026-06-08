/**
 * Audition / what-if fit report (E20 Slice C core).
 *
 * Given a card the user is *considering* adding and the current deck, produce an
 * explainable "what would this card cost / contribute?" report — BEFORE they
 * commit it. It answers the questions a knowledgeable playtest partner would:
 *   - **Engine fit** — which of the deck's invested synergy axes does it
 *     reinforce, and which does it ignore? Does it nudge a brand-new direction?
 *   - **Curve / role** — how crowded is its mana slot and its functional role?
 *   - **Color** — is it inside the commander's identity (colorless flagged)?
 *   - **What to cut** — the ranked replacement cuts (the Slice-A engine).
 *
 * Pure + isomorphic: reuses the synergy classifier, the cut ranker, and the
 * tagger roles. No React/store/network. Lives in `src/lib/**` (coverage-gated).
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { axisLabel } from './axis-overlap';
import { roleOf, primaryTypeOf, withinColorIdentity } from './card-matching';
import { rankReplacementCuts, type CutCandidate, type RankedCut } from './intelligent-cuts';

export interface AxisHit {
  axis: string;
  label: string;
  /** Which side the add fills — `producer` feeds the engine, `payoff` rewards it. */
  side: 'producer' | 'payoff';
}

export interface AddFitReport {
  /** Invested deck axes the add reinforces — the "this fits your X engine" line. */
  axesHit: AxisHit[];
  /** Invested deck axes the add does NOT touch (what the deck does that it ignores). */
  axesMissed: { axis: string; label: string }[];
  /** The add's own axes the deck isn't invested in — a new direction it nudges. */
  axesNew: AxisHit[];
  /** Curve: how many NONLAND cards already sit at the add's mana value. */
  curve: { cmc: number; nonlandAtCmc: number };
  /** Role: the add's functional role and how many deck cards already fill it. */
  role: { role: string | null; label: string | null; countInDeck: number };
  /** Color: identity fit (colorless cards are flagged — they slot anywhere). */
  color: { withinIdentity: boolean; colorless: boolean };
  /** Ranked replacement cuts to make room (Slice-A engine). */
  rankedCuts: RankedCut[];
}

export interface ComputeAddFitParams {
  /** The card being auditioned. */
  addCard: ScryfallCard;
  /** In-deck cards eligible to cut (caller excludes the commander/partner). */
  deckCards: CutCandidate[];
  /** Optimizer removal suggestions (`deck.optimizeSwaps?.removals`) for the cut ranker. */
  removals?: OptimizeCard[];
  /** Commander color identity — to flag an off-identity / colorless add. */
  commanderColorIdentity?: string[];
  /** Max ranked cuts to return (default 8). */
  cutLimit?: number;
}

const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

/**
 * Compute the audition fit report for `addCard` against the deck. The synergy
 * engine is re-derived from `deckCards` (the persisted `synergyAnalysis` keeps
 * only axis counts, not the named card lists this needs), which is cheap & pure.
 */
export function computeAddFit({
  addCard,
  deckCards,
  removals = [],
  commanderColorIdentity,
  cutLimit = 8,
}: ComputeAddFitParams): AddFitReport {
  const deckSyn = analyzeDeckSynergy(deckCards.map((d) => d.card));
  const investedSet = new Set<string>(deckSyn.invested);

  const addSyn = classifyCard(addCard);
  const addProd = new Set(addSyn.producers.map((p) => p.axis));
  const addPay = new Set(addSyn.payoffs.map((p) => p.axis));

  const axesHit: AxisHit[] = [];
  const axesMissed: { axis: string; label: string }[] = [];
  for (const axis of deckSyn.invested) {
    if (addProd.has(axis) || addPay.has(axis)) {
      axesHit.push({
        axis,
        label: axisLabel(axis),
        side: addProd.has(axis) ? 'producer' : 'payoff',
      });
    } else {
      axesMissed.push({ axis, label: axisLabel(axis) });
    }
  }

  // The add's axes the deck isn't (yet) built around — deduped, producer-preferred.
  const axesNew: AxisHit[] = [];
  const seenNew = new Set<string>();
  for (const r of [...addSyn.producers, ...addSyn.payoffs]) {
    if (investedSet.has(r.axis) || seenNew.has(r.axis)) continue;
    seenNew.add(r.axis);
    axesNew.push({
      axis: r.axis,
      label: axisLabel(r.axis),
      side: addProd.has(r.axis) ? 'producer' : 'payoff',
    });
  }

  const addCmc = addCard.cmc ?? 0;
  let nonlandAtCmc = 0;
  for (const { card } of deckCards) {
    if (primaryTypeOf(card) === 'Land') continue;
    if ((card.cmc ?? 0) === addCmc) nonlandAtCmc += 1;
  }

  const role = roleOf(addCard);
  let countInDeck = 0;
  if (role) {
    for (const { card } of deckCards) {
      if (roleOf(card) === role) countInDeck += 1;
    }
  }

  const ci = addCard.color_identity ?? [];
  const colorless = ci.length === 0;
  const withinIdentity =
    !commanderColorIdentity || withinColorIdentity(addCard, commanderColorIdentity);

  const rankedCuts = rankReplacementCuts({
    addCard,
    deckCards,
    removals,
    deckSynergy: deckSyn,
    limit: cutLimit,
  });

  return {
    axesHit,
    axesMissed,
    axesNew,
    curve: { cmc: addCmc, nonlandAtCmc },
    role: { role, label: role ? (ROLE_LABELS[role] ?? role) : null, countInDeck },
    color: { withinIdentity, colorless },
    rankedCuts,
  };
}
