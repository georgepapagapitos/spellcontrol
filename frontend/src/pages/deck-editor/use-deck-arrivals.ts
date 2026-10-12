import { useMemo } from 'react';
import { type Deck } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { computeNewArrivals, type ArrivalsByType } from '@/lib/coach/new-arrivals';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckArrivals({
  deck,
  collectionById,
}: {
  deck: Deck;
  collectionById: Map<string, EnrichedCard> | undefined;
}) {
  const importHistory = useCollectionStore((s) => s.importHistory);

  // New arrivals (E140) — importId -> import batch's addedAt, for the
  // acquired-at resolution (see lib/coach/new-arrivals.ts). Mirrors CardListTable's
  // dateAdded sort context.
  const addedAtByImportId = useMemo(
    () => new Map(importHistory.map((e) => [e.id, e.addedAt])),
    [importHistory]
  );
  // Individually-named so the memo below depends on each field, not the whole
  // `deck` reference — a silent derived write (bracket/gap analysis, which
  // recomputes often) replaces `deck` wholesale without touching cards/
  // commander/updatedAt/lastArrivalReviewAt, and re-running the (pricier,
  // similarity-scoring) arrivals computation on every one of those would be
  // exactly the "re-runs per render" cost the memo below exists to avoid.
  const arrivalsCommander = deck?.commander ?? null;
  const arrivalsPartnerCommander = deck?.partnerCommander ?? null;
  const arrivalsMainCards = deck?.cards;
  const arrivalsSideCards = deck?.sideboard;
  const arrivalsDeckUpdatedAt = deck?.updatedAt;
  const arrivalsLastReviewAt = deck?.lastArrivalReviewAt;
  // Keyed on deck identity/updatedAt/lastArrivalReviewAt + the collection
  // reference, so this does NOT re-run per keystroke/render on a large
  // collection — only when the deck's cards/commander actually changed
  // (always bumps updatedAt), the review was dismissed, or the collection did.
  const arrivalsByType = useMemo<ArrivalsByType>(() => {
    if (arrivalsDeckUpdatedAt == null || !arrivalsMainCards || !collectionById) return {};
    return computeNewArrivals({
      commander: arrivalsCommander,
      partnerCommander: arrivalsPartnerCommander,
      cards: arrivalsMainCards,
      sideboard: arrivalsSideCards,
      deckUpdatedAt: arrivalsDeckUpdatedAt,
      lastArrivalReviewAt: arrivalsLastReviewAt,
      collectionCards: Array.from(collectionById.values()),
      addedAtByImportId,
    });
  }, [
    arrivalsCommander,
    arrivalsPartnerCommander,
    arrivalsMainCards,
    arrivalsSideCards,
    arrivalsDeckUpdatedAt,
    arrivalsLastReviewAt,
    collectionById,
    addedAtByImportId,
  ]);

  return { arrivalsByType };
}
