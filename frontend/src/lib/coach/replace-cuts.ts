/**
 * The replace-when-full prompt's cuts, in one place for the prompt and for
 * the feed's ranking, so the two can't disagree (T171 round 3).
 *
 * The harness measured that 366 of the top-10 rows on a full deck were adds
 * whose prompt had no valid cut: every weaker card of the add's role was a
 * plan card, owned on a partial deck's floor, or at its role target. Such a
 * row is still shown (the prompt lets the user pick a card), but ranked below
 * every row that has a cut or needs none (coach-rank.ts).
 */
import { useMemo } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { getCachedCard } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import {
  rankReplacementCuts,
  type CutAnalysis,
  type CutCandidate,
  type RankedCut,
} from './intelligent-cuts';
import type { Change } from './deck-change';

export interface ReplaceCutInputs {
  /** The mainboard, commanders excluded. */
  deckCards: CutCandidate[];
  /** The persisted analysis, commander included (a Deck carries both). */
  analysis: CutAnalysis;
  inDeckCombos?: ComboMatch[];
  /** Combos one card short: an add that finishes one always gets a cut. */
  oneAwayCombos?: ComboMatch[];
  /** The deck settings' cut filter for an incoming card (`cutKeepsSettings`). */
  cutFits?: (add: ScryfallCard) => ((cut: ScryfallCard) => boolean) | undefined;
  /** The mainboard is at its size limit: an add needs a cut. */
  full: boolean;
  /** A row's card by name when the row carries none (default: the Scryfall cache). */
  resolve?: (name: string) => ScryfallCard | undefined;
}

export interface ReplaceCuts {
  /** The prompt's suggested cuts for `addCard`, best first. */
  cutsFor: (addCard: ScryfallCard, limit?: number) => RankedCut[];
  /** False for an add to a full deck the prompt has no suggested cut for. */
  hasCut: (change: Change) => boolean;
}

export function replaceCuts(input: ReplaceCutInputs): ReplaceCuts {
  const deckSynergy = analyzeDeckSynergy(input.deckCards.map((d) => d.card));
  const finishers = new Set(
    (input.oneAwayCombos ?? [])
      .filter((m) => m.missingOracleIds.length === 1)
      .flatMap((m) => m.combo.cards.filter((c) => m.missingOracleIds.includes(c.oracleId)))
      .map((c) => frontFaceName(c.cardName).toLowerCase())
  );
  const cutsFor = (addCard: ScryfallCard, limit?: number) =>
    rankReplacementCuts({
      addCard,
      deckCards: input.deckCards,
      analysis: input.analysis,
      inDeckCombos: input.inDeckCombos,
      deckSynergy,
      keepsSettings: input.cutFits?.(addCard),
      completesCombo: finishers.has(frontFaceName(addCard.name).toLowerCase()),
      limit,
    });
  const known = new Map<string, boolean>();
  const hasCut = (change: Change): boolean => {
    if (change.type !== 'add' || !input.full) return true;
    const key = change.name.toLowerCase();
    let has = known.get(key);
    if (has === undefined) {
      // The prompt resolves the card before it ranks; the feed reads the same
      // card from the cache the analysis filled when it stamped the row.
      const card =
        change.card ??
        (input.resolve ?? getCachedCard)(change.name) ??
        ({
          name: change.name,
          type_line: change.typeLine ?? '',
          cmc: change.cmc ?? 0,
        } as ScryfallCard);
      has = cutsFor(card, 1).length > 0;
      known.set(key, has);
    }
    return has;
  };
  return { cutsFor, hasCut };
}

/** The deck page's replace cuts, rebuilt when the deck, its combos or its settings change. */
export function useReplaceCuts(
  deck: (CutAnalysis & { cards: CutCandidate[] }) | null | undefined,
  combos: { inDeck?: ComboMatch[]; oneAway?: ComboMatch[] } | null | undefined,
  cutFits: ReplaceCutInputs['cutFits'],
  mainboardLimit: number
): ReplaceCuts {
  return useMemo(
    () =>
      replaceCuts({
        deckCards: deck?.cards ?? [],
        analysis: deck ?? {},
        inDeckCombos: combos?.inDeck,
        oneAwayCombos: combos?.oneAway,
        cutFits,
        full: (deck?.cards.length ?? 0) >= mainboardLimit,
      }),
    [deck, combos, cutFits, mainboardLimit]
  );
}
