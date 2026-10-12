import { useEffect, useMemo } from 'react';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useDeckCombos } from '@/lib/deck-analysis/use-deck-combos';
import { type ArrivalsByType } from '@/lib/coach/new-arrivals';
import {
  coachWantedNames,
  narrowArrivals,
  rememberArrivalWatchlist,
} from '@/lib/coach/arrival-watchlist';
import type { ComboMatchResponse } from '@/types/combos';

export function useCoachArrivals({
  deck,
  mainboardComboData,
  arrivalsByType,
  comboData,
}: {
  deck: Deck;
  mainboardComboData: ComboMatchResponse | null;
  arrivalsByType: ArrivalsByType;
  comboData: ReturnType<typeof useDeckCombos>;
}) {
  const collectionHydrating = useCollectionStore((s) => s.hydrating);
  // New arrivals, tailored to THIS deck: only cards the coach recommends for
  // it or that finish a one-away combo (lib/coach/arrival-watchlist.ts says which
  // lanes, and why not the owned-only ones). The raw arrivals are "in color
  // identity, acquired since the deck last changed", which on any real import
  // reads as random: every red card you bought lit up a Krenko deck.
  const coachWanted = useMemo(
    () =>
      coachWantedNames(
        {
          gaps: deck?.gapAnalysis,
          synergy: deck?.synergyAnalysis?.suggestions,
          hiddenGems: deck?.hiddenGems,
        },
        mainboardComboData?.oneAway
      ),
    [deck?.gapAnalysis, deck?.synergyAnalysis, deck?.hiddenGems, mainboardComboData]
  );
  const coachArrivals = useMemo(
    () => narrowArrivals(arrivalsByType, coachWanted),
    [arrivalsByType, coachWanted]
  );
  // The wanted list is what Home's "+N new cards" narrows by, so Home and this
  // page count the same cards (lib/coach/arrival-watchlist.ts). Recorded only once
  // every input has landed: a list taken mid-load (collection still
  // hydrating, combos still fetching) is short, and Home would under-count.
  const arrivalsSettled = !collectionHydrating && !comboData.loading;
  const deckIdForWatch = deck?.id;
  // Joined so the selector returns a primitive: other decks' edits don't
  // re-render this page, only a deck being added or deleted.
  const liveDeckIds = useDecksStore((s) => s.decks.map((d) => d.id).join(','));
  useEffect(() => {
    if (!deckIdForWatch || !arrivalsSettled) return;
    rememberArrivalWatchlist(deckIdForWatch, coachWanted, liveDeckIds.split(','));
  }, [deckIdForWatch, arrivalsSettled, coachWanted, liveDeckIds]);

  return { coachArrivals, arrivalsSettled };
}
