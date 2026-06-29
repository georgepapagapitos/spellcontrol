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
import type { ComboMatch } from '@/types/combos';
import { analyzeDeckSynergy, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { axisKeys, axisJaccard, sharedAxisNames, axisLabel } from './axis-overlap';
import { roleOf, primaryTypeOf, colorsOverlap } from './card-matching';
import type { EdhrecComboOverlay } from './edhrec-combo-overlay';

// Re-exported so existing import sites (`card-fit`, tests) stay stable now that the
// canonical definition lives in `card-matching`.
export { primaryTypeOf };

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
  /** Fully assembled combos already present in the deck, for combo-piece cut protection. */
  inDeckCombos?: ComboMatch[];
  /** E63 per-commander EDHREC combo stats, used to protect signature combos harder. */
  comboOverlay?: EdhrecComboOverlay;
  /** Max suggestions to return (default 8). */
  limit?: number;
}

/** EDHREC-style inclusion proxy (0–100, higher = more played) for sort tiebreaks.
 *  Prefers the optimizer's inclusion, falls back to the analyzer's rank formula. */
function inclusionOf(card: ScryfallCard, removal: OptimizeCard | undefined): number {
  if (removal?.inclusion != null) return removal.inclusion;
  if (card.edhrec_rank != null) return Math.max(1, 100 - Math.floor(card.edhrec_rank / 100));
  return 50;
}

interface ComboCutProtection {
  reason: string;
  strength: number;
}

function comboCutReason(match: ComboMatch): string {
  const names = match.combo.cards
    .map((c) => c.cardName)
    .filter(Boolean)
    .join(' + ');
  const result = match.combo.produces[0];
  return `Breaks combo: ${names}${result ? ` (${result})` : ''}`;
}

function comboProtectionStrength(match: ComboMatch, comboOverlay?: EdhrecComboOverlay): number {
  const stat = comboOverlay?.get(
    match.combo.cards
      .map((c) => c.cardName.trim().toLowerCase())
      .sort()
      .join('|')
  );
  if (!stat) return 1 + Math.min(1.5, match.combo.popularity / 5000);
  const prevalence = stat.percent == null ? 0 : Math.min(3, stat.percent / 2);
  const rankBoost = Math.max(0, (25 - stat.rank) / 25);
  return 2 + prevalence + rankBoost;
}

function buildComboCutProtection(
  inDeckCombos: ComboMatch[],
  comboOverlay?: EdhrecComboOverlay
): Map<string, ComboCutProtection> {
  const byName = new Map<string, ComboCutProtection>();
  for (const match of inDeckCombos) {
    const protection = {
      reason: comboCutReason(match),
      strength: comboProtectionStrength(match, comboOverlay),
    };
    for (const card of match.combo.cards) {
      const key = card.cardName.toLowerCase();
      const prev = byName.get(key);
      if (!prev || protection.strength > prev.strength) byName.set(key, protection);
    }
  }
  return byName;
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
  inDeckCombos = [],
  comboOverlay,
  limit = 8,
}: RankReplacementCutsParams): RankedCut[] {
  const removalByName = new Map<string, OptimizeCard>();
  for (const r of removals) removalByName.set(r.name.toLowerCase(), r);
  const comboProtectionByName = buildComboCutProtection(inDeckCombos, comboOverlay);

  const addRole = roleOf(addCard);
  const addType = primaryTypeOf(addCard);
  const addCmc = addCard.cmc ?? 0;
  const addAxes = axisKeys(addCard);
  // Derive the engine analysis once if the caller didn't supply it.
  const deckSyn = deckSynergy ?? analyzeDeckSynergy(deckCards.map((d) => d.card));
  const investedAxes = new Set<string>(deckSyn.invested);
  const hasEngine = investedAxes.size > 0;

  type Scored = RankedCut & {
    tier: number;
    relScore: number;
    inclusion: number;
    comboProtection: number;
  };
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

    const comboProtection = comboProtectionByName.get(card.name.toLowerCase());
    const baseReason =
      removal?.reason ??
      (sameAxis
        ? `Overlapping ${axisLabel(shared[0])}`
        : sameRole
          ? 'Overlapping role'
          : sameType
            ? 'Overlapping type'
            : 'Similar cost');
    const reason = comboProtection ? `${comboProtection.reason} - ${baseReason}` : baseReason;

    scored.push({
      slotId,
      card,
      reason,
      related,
      tier,
      relScore,
      inclusion: inclusionOf(card, removal),
      comboProtection: comboProtection?.strength ?? 0,
    });
  }

  scored.sort((a, b) => {
    const aTier = a.tier + a.comboProtection;
    const bTier = b.tier + b.comboProtection;
    if (aTier !== bTier) return aTier - bTier;
    // Tiers 1 & 3 favor stronger relation first; tier 2 is a flat weakest-first list.
    if (a.tier !== 2 && a.relScore !== b.relScore) return b.relScore - a.relScore;
    return a.inclusion - b.inclusion; // weaker (less-played) cut wins ties
  });

  return scored
    .slice(0, limit)
    .map(({ slotId, card, reason, related }) => ({ slotId, card, reason, related }));
}
