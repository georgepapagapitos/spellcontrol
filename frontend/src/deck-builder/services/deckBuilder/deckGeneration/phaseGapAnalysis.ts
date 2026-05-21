import { logger } from '@/lib/logger';
import type { GapAnalysisCard } from '@/deck-builder/types';
import { getCardsByNames, getCardPrice } from '@/deck-builder/services/scryfall/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { calculateCardPriority } from '../cardPicking';
import type { GenerationState } from './state';

// Gap analysis: find top unowned cards that would improve the deck.
// Verbatim extraction from generateDeck: closed-over free vars are rewritten
// to `state.X` (context -> state.context, categories/bannedCards ->
// state.X, preferredSet/currency -> state.cfg.X). No behavior change.
export async function gapAnalysisPhase(
  state: GenerationState
): Promise<GapAnalysisCard[] | undefined> {
  let gapAnalysis: GapAnalysisCard[] | undefined;
  if (state.context.collectionNames && state.edhrecData) {
    const allDeckCardNames = new Set<string>();
    for (const c of Object.values(state.categories).flat()) {
      allDeckCardNames.add(c.name);
      // DFCs: also add front-face name so EDHREC's front-face-only names match
      if (c.name.includes(' // ')) allDeckCardNames.add(c.name.split(' // ')[0]);
    }

    const gapCandidates = state.edhrecData.cardlists.allNonLand
      .filter((c) => !allDeckCardNames.has(c.name) && !state.bannedCards.has(c.name))
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a))
      .slice(0, 40);

    if (gapCandidates.length > 0) {
      const gapCardMap = await getCardsByNames(
        gapCandidates.map((c) => c.name),
        undefined,
        state.cfg.preferredSet
      );

      const ROLE_LABELS: Record<string, string> = {
        ramp: 'Ramp',
        removal: 'Removal',
        boardwipe: 'Board Wipes',
        cardDraw: 'Card Advantage',
      };
      gapAnalysis = gapCandidates
        .map((c) => {
          const scryfall = gapCardMap.get(c.name);
          const role = getCardRole(c.name) || undefined;
          return {
            name: c.name,
            price: scryfall ? getCardPrice(scryfall, state.cfg.currency) : null,
            inclusion: c.inclusion,
            synergy: c.synergy ?? 0,
            typeLine: scryfall?.type_line ?? '',
            cmc: scryfall?.cmc,
            imageUrl: scryfall?.image_uris?.small,
            isOwned: state.context.collectionNames!.has(c.name),
            role,
            roleLabel: role ? ROLE_LABELS[role] : undefined,
          };
        })
        .filter((c) => c.price !== null);

      logger.debug(
        `[DeckGen] Gap analysis: ${gapAnalysis.length} cards suggested (${gapAnalysis.filter((c) => c.isOwned).length} owned)`
      );
    }
  }

  return gapAnalysis;
}
