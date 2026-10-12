import { useMemo } from 'react';
import type { DeckFormatConfig, ScryfallCard } from '@/deck-builder/types';
import {
  validateDeckSize,
  validateSideboardSize,
  countFlaggedCards,
  type LegalityIssue,
} from '@/lib/deck/deck-validation';
import { useBanList } from '@/lib/deck/use-ban-list';
import { validateDisplayedZones } from './deck-display-derive';
import type { DeckDisplayCard } from './deck-display-types';

interface Args {
  cards: DeckDisplayCard[];
  sideboard: DeckDisplayCard[];
  formatConfig: DeckFormatConfig;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
}

/**
 * Legality for the current format. The live ban list catches a card banned
 * after it was added, which its own stored legalities still call legal.
 * `legalityIssues` is what the deck is judged on: in Commander that is the
 * commander and the mainboard, never the sideboard, so an illegal card or a
 * second copy parked there can't fail the checks, set the Power tab's "can't
 * be played" note, inflate the flagged count or badge a mainboard row.
 * Sideboard rows still get their own badge (`sideboardIssues`).
 */
export function useDeckLegality({
  cards,
  sideboard,
  formatConfig,
  commander,
  partnerCommander,
}: Args) {
  const bannedNames = useBanList(formatConfig.legalityKey);
  const { deck: legalityIssues, sideboardOnly: sideboardIssues } = useMemo(
    () =>
      validateDisplayedZones({
        cards,
        sideboard,
        formatConfig,
        commander,
        partnerCommander,
        bannedNames,
      }),
    [cards, sideboard, formatConfig, commander, partnerCommander, bannedNames]
  );
  const illegalCardNames = useMemo(
    () => [
      ...new Set(legalityIssues.filter((i) => i.issue === 'not-legal').map((i) => i.cardName)),
    ],
    [legalityIssues]
  );
  const legalityBySlot = useMemo(() => {
    const map = new Map<string, LegalityIssue>();
    for (const issue of [...legalityIssues, ...sideboardIssues]) {
      // Keep whichever issue we saw first: the tooltip only has room for one
      // detail line anyway.
      if (!map.has(issue.slotId)) map.set(issue.slotId, issue);
    }
    return map;
  }, [legalityIssues, sideboardIssues]);
  const flaggedCardCount = useMemo(() => countFlaggedCards(legalityIssues), [legalityIssues]);
  const deckSizeWarning = useMemo(
    () => validateDeckSize(cards.length, formatConfig),
    [cards.length, formatConfig]
  );
  // A 60-card format registers 15 sideboard cards (E468). Commander's
  // sideboard is uncapped and Considering is never counted.
  const sideboardSizeWarning = useMemo(
    () => validateSideboardSize(sideboard.length, formatConfig),
    [sideboard.length, formatConfig]
  );
  // The legality banner's facts, in reading order: the two size overruns, then
  // the flagged cards.
  const legalityBannerParts = [
    deckSizeWarning,
    sideboardSizeWarning,
    flaggedCardCount > 0
      ? `${flaggedCardCount} ${flaggedCardCount === 1 ? 'card' : 'cards'} flagged in ${formatConfig.label}`
      : null,
  ].filter((part): part is string => !!part);
  return {
    illegalCardNames,
    legalityBySlot,
    flaggedCardCount,
    sideboardSizeWarning,
    legalityBannerParts,
  };
}
