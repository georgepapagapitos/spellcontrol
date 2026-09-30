import { useEffect, useRef } from 'react';
import type { ScryfallCard, DeckFormatConfig } from '@/deck-builder/types';
import { effectiveDeckColors } from '@/lib/deck/deck-validation';
import { haptics } from '@/lib/util/haptics';
import { toast } from '../../store/toasts';
import { useSealMoment } from '../shared/SealMoment';
import { toDeckCards } from './deck-display-derive';
import type { DeckDisplayCard } from './deck-display-types';

/** Deck ids whose completion moment already played this app-open — an edit
 *  that re-crosses the complete boundary doesn't re-celebrate (mirrors the
 *  consumedRevealKeys registry's once-per-session semantics). */
const celebratedDeckComplete = new Set<string>();

/**
 * Deck-complete moment: the edit that takes the deck from incomplete to
 * exactly full-size with zero legality flags earns the seal + a toast —
 * today that boundary is a silent badge repaint. Fires only on a transition
 * observed while mounted (never on opening an already-complete deck), and
 * once per deck per app-open (the module-level set), so re-cross edits
 * don't re-celebrate. Returns the seal element to render at the root.
 */
export function useDeckCompleteMoment(args: {
  cards: DeckDisplayCard[];
  flaggedCardCount: number;
  sideboardSizeWarning: string | null;
  formatConfig: DeckFormatConfig;
  deckId: string | undefined;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
}) {
  const {
    cards,
    flaggedCardCount,
    sideboardSizeWarning,
    formatConfig,
    deckId,
    commander,
    partnerCommander,
  } = args;
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  const prevDeckComplete = useRef<boolean | null>(null);
  useEffect(() => {
    const complete =
      cards.length > 0 &&
      cards.length === formatConfig.mainboardSize &&
      flaggedCardCount === 0 &&
      !sideboardSizeWarning;
    if (
      prevDeckComplete.current === false &&
      complete &&
      deckId &&
      !celebratedDeckComplete.has(deckId)
    ) {
      celebratedDeckComplete.add(deckId);
      const colors = [
        ...effectiveDeckColors({
          commander: commander ?? null,
          partnerCommander: partnerCommander ?? null,
          cards: toDeckCards(cards),
        }),
      ];
      fireSealMoment(colors);
      haptics.success();
      toast.show({
        message: `Deck complete, legal for ${formatConfig.label}`,
        tone: 'success',
      });
    }
    prevDeckComplete.current = complete;
  }, [
    cards,
    flaggedCardCount,
    sideboardSizeWarning,
    formatConfig,
    deckId,
    commander,
    partnerCommander,
    fireSealMoment,
  ]);
  return sealMoment;
}
