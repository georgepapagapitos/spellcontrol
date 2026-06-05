import { useCallback } from 'react';
import { useDecksStore, newDeckCard, type DeckSource, type DeckCard } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import { buildAllocationMap, pickCollectionCopy, type AllocationInfo } from './allocations';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import type { DeckImportResponse, EnrichedCard } from '../types';
import type { Deck } from '../store/decks';

export interface SourceProduct {
  code: string;
  fileName: string;
  name: string;
}

export interface BuildDeckOptions {
  /**
   * Shared allocation map when creating several decks at once (multi-file
   * import) so two decks can't claim the same physical copy. Omit for one-offs.
   */
  claimed?: Map<string, AllocationInfo>;
  /** Second commander (partner / background) to move into the command zone. */
  partner?: ScryfallCard | null;
  /** Provenance tag when the deck came from a known product (T17). */
  sourceProduct?: SourceProduct;
  /** Deck source; defaults to 'manual'. */
  source?: DeckSource;
}

/** The fully-allocated deck shape handed to `createDeck`. */
export interface BuiltDeckInput {
  name?: string;
  format: DeckFormat;
  source: DeckSource;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: string | null;
  cards: DeckCard[];
  sideboard: DeckCard[];
  sourceProduct?: SourceProduct;
}

const pendingClaim = (cardName: string): AllocationInfo => ({
  deckId: '__pending__',
  deckName: '__pending__',
  deckColor: '',
  cardName,
});

/**
 * Pure core: builds the fully-allocated `createDeck` input from a resolved
 * {@link DeckImportResponse}, claiming an owned physical copy for each card.
 * Kept pure (no stores) so the subtle commander-out-of-the-99 + copy-allocation
 * logic is unit-testable; the hook below just supplies live store data.
 */
export function buildDeckInputFromImport(
  result: DeckImportResponse,
  commander: ScryfallCard | null,
  name: string,
  format: DeckFormat,
  ctx: { decks: Deck[]; collectionCards: EnrichedCard[] },
  opts: BuildDeckOptions = {}
): BuiltDeckInput {
  const { partner = null, sourceProduct, source = 'manual' } = opts;
  const claim = opts.claimed ?? new Map<string, AllocationInfo>(buildAllocationMap(ctx.decks));

  const allocate = (cardList: ScryfallCard[]): DeckCard[] =>
    cardList.map((card) => {
      const pick = pickCollectionCopy(card.name, ctx.collectionCards, claim, card.id);
      if (pick) claim.set(pick.copyId, pendingClaim(card.name));
      return newDeckCard(card, pick?.copyId ?? null);
    });

  const base = {
    name: name.trim() || undefined,
    format,
    source,
    sourceProduct,
  };

  if (commander) {
    // Both commanders are kept out of the 99; a paired partner that was sitting
    // in the imported list moves into the command zone.
    const mainCards = result.cards.filter(
      (c) => c.name !== commander.name && (!partner || c.name !== partner.name)
    );
    const cards = allocate(mainCards);
    const commanderPick = pickCollectionCopy(
      commander.name,
      ctx.collectionCards,
      claim,
      commander.id
    );
    if (commanderPick) claim.set(commanderPick.copyId, pendingClaim(commander.name));
    const partnerPick = partner
      ? pickCollectionCopy(partner.name, ctx.collectionCards, claim, partner.id)
      : null;
    if (partner && partnerPick) claim.set(partnerPick.copyId, pendingClaim(partner.name));

    return {
      ...base,
      commander,
      partnerCommander: partner,
      commanderAllocatedCopyId: commanderPick?.copyId ?? null,
      partnerCommanderAllocatedCopyId: partnerPick?.copyId ?? null,
      cards,
      sideboard: [],
    };
  }

  return {
    ...base,
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: allocate(result.cards),
    sideboard: [],
  };
}

/**
 * Builds a saved deck from a resolved {@link DeckImportResponse}, allocating
 * each card to an owned physical copy. Shared by the deck-import dialog (paste /
 * file / multi-file) and the product-import "Add as deck" path so the logic
 * lives in exactly one place. Returns the new deck id.
 */
export function useBuildDeckFromImport() {
  const createDeck = useDecksStore((s) => s.createDeck);

  return useCallback(
    (
      result: DeckImportResponse,
      commander: ScryfallCard | null,
      name: string,
      format: DeckFormat,
      opts: BuildDeckOptions = {}
    ): string => {
      // Read collection + decks FRESH at call time, not a render-captured
      // snapshot. The "add to collection AND as a deck" flow imports the cards
      // into the collection first; a stale snapshot would allocate against the
      // pre-add collection and mark every card unowned (T17 bug).
      const decks = useDecksStore.getState().decks;
      const collectionCards = useCollectionStore.getState().cards;
      return createDeck(
        buildDeckInputFromImport(result, commander, name, format, { decks, collectionCards }, opts)
      );
    },
    [createDeck]
  );
}
