import { logger } from '@/lib/logger';
import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import { buildInclusionIndex, lookupInclusion } from '../commanderDeckAnalysis';
import { BASIC_LAND_NAMES } from '../landGenerator';
import type { GenerationState } from './state';

// Build deck score from EDHREC inclusion percentages.
// Verbatim extraction from generateDeck: `categories` is rewritten to
// `state.categories`; `swapCandidates`/`gapAnalysis` are passed in (they are
// generateDeck locals, not on state). No behavior change.
export function deckScorePhase(
  state: GenerationState,
  swapCandidates: Record<string, ScryfallCard[]> | undefined,
  gapAnalysis: GapAnalysisCard[] | undefined
): { deckScore: number | undefined; cardInclusionMap: Record<string, number> | undefined } {
  let deckScore: number | undefined;
  let cardInclusionMap: Record<string, number> | undefined;
  if (state.edhrecData) {
    const inclusionIndex = buildInclusionIndex(state.edhrecData);

    const inclMap: Record<string, number> = {};
    let score = 0;
    for (const cards of Object.values(state.categories)) {
      for (const card of cards) {
        if (BASIC_LAND_NAMES.has(card.name)) continue;
        const val = lookupInclusion(inclusionIndex, card.name) ?? 0;
        inclMap[card.name] = val;
        score += val;
      }
    }
    // Also index swap candidates so the UI can show their inclusion %
    if (swapCandidates) {
      for (const cards of Object.values(swapCandidates)) {
        for (const card of cards) {
          if (inclMap[card.name] !== undefined) continue;
          const incl = lookupInclusion(inclusionIndex, card.name);
          if (incl !== undefined) inclMap[card.name] = incl;
        }
      }
    }
    // Also index gap analysis cards
    if (gapAnalysis) {
      for (const g of gapAnalysis) {
        if (inclMap[g.name] === undefined) inclMap[g.name] = g.inclusion;
      }
    }
    deckScore = Math.round(score);
    cardInclusionMap = inclMap;
    const nonBasicCount =
      Object.keys(inclMap).length -
      (swapCandidates ? Object.values(swapCandidates).flat().length : 0) -
      (gapAnalysis?.length ?? 0);
    const avg = nonBasicCount > 0 ? score / nonBasicCount : 0;
    logger.debug(
      `[DeckGen] Deck score: ${deckScore} (avg ${avg.toFixed(1)}% across ${nonBasicCount} deck cards)`
    );
  }

  return { deckScore, cardInclusionMap };
}
