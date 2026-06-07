/**
 * Intelligent contextual cuts (E20).
 *
 * When a Commander deck is full (99/99) and the user adds a card, we have to cut
 * something to keep it legal. The old prompt offered a flat "weak slot" list —
 * the globally-weakest cards, unrelated to what you're adding (adding Young
 * Pyromancer offered Roaming Throne). This ranks cuts by how *related/replaceable*
 * they are to the card being added, across four signals:
 *
 *   - **Synergy-axis overlap** (the dominant signal) — the 23-axis oracle-text
 *     classifier. A token-maker relates to other token-makers even when the
 *     coarse 4-role tagger gives them no role. This is what makes the cut feel
 *     "related" rather than "globally weakest".
 *   - **Shared tagger role** (ramp / removal / boardwipe / cardDraw).
 *   - **Same primary card type** (creature ↔ creature).
 *   - **Similar mana cost / color overlap** — weak tiebreaks.
 *
 * It reuses the optimizer's real per-card cut reason (`optimizeSwaps.removals`)
 * instead of "weak slot", and **never suggests cutting a card that's load-bearing
 * for an engine the deck is invested in** unless the card being added reinforces
 * that same engine (a true like-for-like swap).
 *
 * Pure & isomorphic-ish: only depends on the tagger/scryfall/synergy helpers.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { analyzeDeckSynergy, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { axisKeys, axisJaccard, sharedAxisNames, axisLabel } from './axis-overlap';

export interface CutCandidate {
  slotId: string;
  card: ScryfallCard;
}

export interface RankedCut {
  slotId: string;
  card: ScryfallCard;
  /** Plain-language "why this cut" for the row hint (the optimizer's real reason,
   *  or a relation-derived one when the card isn't flagged). */
  reason: string;
  /** True when this cut shares a role/type with the card being added — i.e. the
   *  swap reads as a genuine replacement, not just "cut your weakest card". */
  related: boolean;
}

export interface RankReplacementCutsParams {
  /** The card the user is adding (we cut to make room for it). */
  addCard: ScryfallCard;
  /** In-deck cards eligible to cut (caller excludes the commander/partner). */
  deckCards: CutCandidate[];
  /** Optimizer removal suggestions for this deck (`deck.optimizeSwaps?.removals`). */
  removals?: OptimizeCard[];
  /**
   * The deck's synergy engine analysis, for the load-bearing cut guard. Optional:
   * when omitted it's derived from `deckCards` (cheap, pure). Pass a precomputed
   * one to avoid re-classifying every card on a hot path.
   */
  deckSynergy?: DeckSynergy;
  /** Max suggestions to return (default 8). */
  limit?: number;
}

/** Do two cards share at least one color identity? (Colorless shares with no one.) */
function colorsOverlap(a: ScryfallCard, b: ScryfallCard): boolean {
  const bColors = new Set(b.color_identity ?? []);
  return (a.color_identity ?? []).some((c) => bColors.has(c));
}

/** Leading card type ("Creature", "Instant", …), stripped of "Legendary" and
 *  any subtype after the em-dash. Mirrors deckAnalyzer's primaryType derivation. */
export function primaryTypeOf(card: ScryfallCard): string {
  const words = getFrontFaceTypeLine(card)
    .split('—')[0]
    .replace(/Legendary\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w && w !== 'Basic' && w !== 'Snow');
  // Last word of the supertype run is the core type ("Artifact Creature" → "Creature").
  return words[words.length - 1] ?? '';
}

const roleOf = (card: ScryfallCard): string | null => card.deckRole ?? getCardRole(card.name);

/** EDHREC-style inclusion proxy (0–100, higher = more played) for sort tiebreaks.
 *  Prefers the optimizer's inclusion, falls back to the analyzer's rank formula. */
function inclusionOf(card: ScryfallCard, removal: OptimizeCard | undefined): number {
  if (removal?.inclusion != null) return removal.inclusion;
  if (card.edhrec_rank != null) return Math.max(1, 100 - Math.floor(card.edhrec_rank / 100));
  return 50;
}

/**
 * Rank in-deck cards as replacement cuts for `addCard`, best-first.
 *
 * Tiers (best → worst):
 *  1. Optimizer-flagged AND related to the add  — a real, on-theme swap.
 *  2. Optimizer-flagged, not related            — a genuine weak slot (real reason).
 *  3. Related but not flagged                   — relevant, though a fine card.
 * Unflagged + unrelated cards are dropped here; the caller's "pick another card"
 * list still exposes every card. A card that's load-bearing for an engine the
 * deck is invested in is never suggested unless the add reinforces that engine.
 */
export function rankReplacementCuts({
  addCard,
  deckCards,
  removals = [],
  deckSynergy,
  limit = 8,
}: RankReplacementCutsParams): RankedCut[] {
  const removalByName = new Map<string, OptimizeCard>();
  for (const r of removals) removalByName.set(r.name.toLowerCase(), r);

  const addRole = roleOf(addCard);
  const addType = primaryTypeOf(addCard);
  const addCmc = addCard.cmc ?? 0;
  const addAxes = axisKeys(addCard);
  // Derive the engine analysis once if the caller didn't supply it.
  const deckSyn = deckSynergy ?? analyzeDeckSynergy(deckCards.map((d) => d.card));
  const investedAxes = new Set<string>(deckSyn.invested);
  const hasEngine = investedAxes.size > 0;

  type Scored = RankedCut & { tier: number; relScore: number; inclusion: number };
  const scored: Scored[] = [];

  for (const { slotId, card } of deckCards) {
    if (card.name === addCard.name) continue; // never offer to cut the card you're adding

    const removal = removalByName.get(card.name.toLowerCase());
    const cuttable = !!removal;

    const cardAxes = axisKeys(card);
    const shared = sharedAxisNames(addAxes, cardAxes);
    const sameAxis = shared.length > 0;
    const axisOverlap = axisJaccard(addAxes, cardAxes); // 0–1

    const sameRole = !!addRole && roleOf(card) === addRole;
    const sameType = !!addType && primaryTypeOf(card) === addType;
    const cmcClose = Math.abs((card.cmc ?? 0) - addCmc) <= 1;
    const colorClose = colorsOverlap(addCard, card);
    const related = sameAxis || sameRole || sameType;

    // Cut guard: don't propose trimming a card holding up one of the deck's
    // invested engines — unless the card being added plays that same engine, in
    // which case it's a legitimate like-for-like swap. (Reuses cardAxes rather
    // than re-classifying via isLoadBearing.)
    const loadBearing =
      hasEngine && [...cardAxes].some((k) => investedAxes.has(k.slice(0, k.indexOf(':'))));
    if (loadBearing && !sameAxis) continue;

    // Axis overlap is the dominant relatedness signal (up to 6), then role, type,
    // color, cost. Mirrors the synergy-first weighting of the similar-cards scorer.
    const relScore =
      axisOverlap * 6 +
      (sameRole ? 4 : 0) +
      (sameType ? 2 : 0) +
      (colorClose ? 0.5 : 0) +
      (cmcClose ? 1 : 0);

    let tier: number;
    if (cuttable && related) tier = 1;
    else if (cuttable) tier = 2;
    else if (related) tier = 3;
    else continue; // unflagged + unrelated → not a suggestion

    const reason =
      removal?.reason ??
      (sameAxis
        ? `Overlapping ${axisLabel(shared[0])}`
        : sameRole
          ? 'Overlapping role'
          : sameType
            ? 'Overlapping type'
            : 'Similar cost');

    scored.push({
      slotId,
      card,
      reason,
      related,
      tier,
      relScore,
      inclusion: inclusionOf(card, removal),
    });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Tiers 1 & 3 favor stronger relation first; tier 2 is a flat weakest-first list.
    if (a.tier !== 2 && a.relScore !== b.relScore) return b.relScore - a.relScore;
    return a.inclusion - b.inclusion; // weaker (less-played) cut wins ties
  });

  return scored
    .slice(0, limit)
    .map(({ slotId, card, reason, related }) => ({ slotId, card, reason, related }));
}
