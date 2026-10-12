import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnrichedCard } from '../../types';
import { summarizeMissing, buildMissingTally } from './deck-display-derive';
import { useCardCarousel, tallyToEntries } from './useCardCarousel';
import type { CurrencyCode } from './deck-display-rows';
import type { DeckDisplayCard, DeckDisplayProps } from './deck-display-types';

interface Args {
  title: string;
  cards: DeckDisplayCard[];
  collectionByCopyId: Map<string, EnrichedCard> | undefined;
  currency: CurrencyCode;
  /** Ticks when prices land, so the missing total re-prices (E422). */
  pricesVersion: number;
  arrivalsByType: DeckDisplayProps['arrivalsByType'];
  autoOpenArrivals: boolean | undefined;
}

/**
 * The headline stats' drill-downs: the missing-cards total and its buy-list
 * dialog (a row hands off to the card carousel and back), and the new-arrivals
 * review sheet (E140).
 */
export function useDeckMissing({
  title,
  cards,
  collectionByCopyId,
  currency,
  pricesVersion,
  arrivalsByType,
  autoOpenArrivals,
}: Args) {
  // "Missing" is a claim about the VIEWER's collection, so it is only
  // answerable when a collection was supplied. Without one, every slot reads
  // as unallocated and the deck reports its own full card count as missing.
  // An owner whose collection is genuinely empty still passes a (empty) map
  // and still correctly sees everything as missing.
  const missing = useMemo(
    () => (void pricesVersion, summarizeMissing(cards, collectionByCopyId, currency)),
    [cards, collectionByCopyId, currency, pricesVersion]
  );
  // Tally of the unallocated (missing) cards — the tappable "missing" stat opens
  // a carousel of these so the count doubles as a shopping list.
  const missingTally = useMemo(
    () => buildMissingTally(cards, collectionByCopyId),
    [cards, collectionByCopyId]
  );

  // Every new-arrival row across categories, best fit first — feeds the
  // "N new arrivals" stat and the sheet it opens.
  const [arrivalsOpen, setArrivalsOpen] = useState(false);
  const arrivalRows = useMemo(
    () =>
      Object.values(arrivalsByType ?? {})
        .flat()
        .sort((a, b) => b.score - a.score),
    [arrivalsByType]
  );
  const autoOpenedArrivals = useRef(false);
  useEffect(() => {
    if (!autoOpenArrivals || autoOpenedArrivals.current || arrivalRows.length === 0) return;
    autoOpenedArrivals.current = true;
    setArrivalsOpen(true);
  }, [autoOpenArrivals, arrivalRows.length]);

  // Buy-list dialog for the missing cards. Tapping a row swaps the dialog for
  // the card carousel at that card; `buyListReturn` re-opens the dialog when
  // that carousel closes, so the carousel reads as a preview layer over the
  // list rather than a dead end.
  const [buyListOpen, setBuyListOpen] = useState(false);
  const buyListReturn = useRef(false);
  // Tap a headline stat (cards / value) to drill into the cards behind it —
  // the same carousel pattern as the analysis-tab drill-downs.
  const statCarousel = useCardCarousel(title);
  // Reopen the buy list when a carousel it spawned closes (the dialog and the
  // carousel never stack — Modal and CardPreview both grab Escape globally, so
  // layering them would close both on one keypress).
  const statCarouselOpen = statCarousel.preview !== null;
  useEffect(() => {
    if (!statCarouselOpen && buyListReturn.current) {
      buyListReturn.current = false;
      setBuyListOpen(true);
    }
  }, [statCarouselOpen]);
  const pickBuyListCard = (name: string) => {
    setBuyListOpen(false);
    buyListReturn.current = true;
    void statCarousel.open(tallyToEntries(missingTally), name);
  };

  return {
    missing,
    missingTally,
    arrivalRows,
    arrivalsOpen,
    setArrivalsOpen,
    buyListOpen,
    setBuyListOpen,
    pickBuyListCard,
    statCarouselPreview: statCarousel.preview,
  };
}
