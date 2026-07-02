import { logger } from '@/lib/logger';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import {
  getCardsByNames,
  getCardPrice,
  upgradeCardPrintings,
} from '@/deck-builder/services/scryfall/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { calculateCardPriority } from '../cardPicking';
import { exceedsMaxRarity, isOwnedRarityExempt, notOnArena, exceedsCmcCap } from '../deckFilters';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import { getLiftIndex } from './liftPools';

export interface GapAnalysisOptions {
  /** The generation's EFFECTIVE Scryfall filter (user query + alt-mode
   *  constraint) — enforced strictly so suggestions match the pool's filter. */
  effectiveScryfallQuery?: string;
}

// Gap analysis: find top unowned cards that would improve the deck.
// Suggestions honor the same rarity/Arena/CMC caps and Scryfall filter as
// generation itself (E71 controls audit) — salt is already covered upstream
// because candidates come from the salt-trimmed cardlists.
export async function gapAnalysisPhase(
  state: GenerationState,
  opts: GapAnalysisOptions = {}
): Promise<GapAnalysisCard[] | undefined> {
  let gapAnalysis: GapAnalysisCard[] | undefined;
  if (state.context.collectionNames && state.edhrecData) {
    const allDeckCardNames = new Set<string>();
    for (const c of Object.values(state.categories).flat()) {
      allDeckCardNames.add(c.name);
      // DFCs: also add front-face name so EDHREC's front-face-only names match
      if (c.name.includes(' // ')) allDeckCardNames.add(frontFaceName(c.name));
    }

    // Pools are already fetched by the early generation-time seed pass (see
    // deckGenerator.ts) — this only reads the memoized index, never fetches.
    const liftIndex = getLiftIndex(state);
    const clusterScoreOf = (name: string) => liftIndex.get(name.toLowerCase())?.clusterScore ?? 0;

    const gapCandidates = state.edhrecData.cardlists.allNonLand
      .filter((c) => !allDeckCardNames.has(c.name) && !state.bannedCards.has(c.name))
      .sort(
        (a, b) =>
          calculateCardPriority(b) - calculateCardPriority(a) ||
          clusterScoreOf(b.name) - clusterScoreOf(a.name)
      )
      .slice(0, 40);

    if (gapCandidates.length > 0) {
      const gapCardMap = await getCardsByNames(
        gapCandidates.map((c) => c.name),
        undefined,
        state.cfg.preferredSet
      );

      // Enforce the user's Scryfall filter / alt-mode constraint on
      // suggestions (candidates come from the unfiltered EDHREC list, not the
      // query-scoped cardMap): the strict upgrade deletes non-matching cards,
      // which the price-null filter below then drops.
      const effectiveQuery = opts.effectiveScryfallQuery?.trim() ?? '';
      if (effectiveQuery && gapCardMap.size > 0) {
        await upgradeCardPrintings(gapCardMap, effectiveQuery, true);
      }

      // A suggestion the user can't actually run isn't a suggestion: apply
      // the same rarity (owned-exempt aware) / Arena / CMC gates as picking.
      const violatesConstraints = (scryfall: ScryfallCard | undefined): boolean => {
        if (!scryfall) return false; // unresolvable — price-null filter drops it below
        if (
          !isOwnedRarityExempt(
            scryfall.name,
            state.context.collectionNames,
            state.cfg.ignoreOwnedRarity
          ) &&
          exceedsMaxRarity(scryfall, state.cfg.maxRarity)
        )
          return true;
        if (notOnArena(scryfall, state.cfg.arenaOnly)) return true;
        if (exceedsCmcCap(scryfall, state.cfg.maxCmc)) return true;
        return false;
      };

      const ROLE_LABELS: Record<string, string> = {
        ramp: 'Ramp',
        removal: 'Removal',
        boardwipe: 'Board Wipes',
        cardDraw: 'Card Advantage',
      };
      gapAnalysis = gapCandidates
        .filter((c) => !violatesConstraints(gapCardMap.get(c.name)))
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
            liftedBy: liftIndex.get(c.name.toLowerCase())?.liftedBy,
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
