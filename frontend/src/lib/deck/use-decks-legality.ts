import { useMemo } from 'react';
import type { Deck } from '@/store/decks';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { validateDeckZones, type LegalityIssue } from './deck-validation';
import { legalNow, storedNotLegalNames, useCurrentLegalities } from './use-currently-legal-names';

const NONE: LegalityIssue[] = [];

/**
 * Each deck's legality issues, judged the way the deck page judges them: on
 * the deck's own zones (a Commander sideboard is a holding pile, not the
 * deck), with a card stored while it was a preview checked against its
 * current data (see use-currently-legal-names). One lookup covers every deck.
 */
export function useDecksLegalityIssues(
  decks: readonly Deck[]
): ReadonlyMap<string, LegalityIssue[]> {
  const storedNotLegal = useMemo(
    () =>
      new Map(
        decks.map((d) => {
          const key = DECK_FORMAT_CONFIGS[d.format]?.legalityKey;
          return [d.id, key ? storedNotLegalNames([...d.cards, ...d.sideboard], key) : []];
        })
      ),
    [decks]
  );
  const allNames = useMemo(() => [...storedNotLegal.values()].flat(), [storedNotLegal]);
  const current = useCurrentLegalities(allNames);
  return useMemo(
    () =>
      new Map(
        decks.map((deck) => {
          const config = DECK_FORMAT_CONFIGS[deck.format];
          if (!config) return [deck.id, NONE];
          const issues = validateDeckZones(deck.cards, deck.sideboard, config, {
            commander: deck.commander,
            partnerCommander: deck.partnerCommander,
            currentlyLegalNames: current
              ? legalNow(current, storedNotLegal.get(deck.id) ?? [], config.legalityKey)
              : undefined,
          }).deck;
          return [deck.id, issues];
        })
      ),
    [decks, storedNotLegal, current]
  );
}
