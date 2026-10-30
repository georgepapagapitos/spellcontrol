import { useCallback } from 'react';
import { useDecksStore, newDeckCard, type DeckSource, type DeckCard } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useCubeStore } from '@/store/cube';
import { defaultNewDeckVisibility, type NewDeckVisibility } from '@/lib/deck/new-deck-visibility';
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  allocateCardsForImport,
  type AllocationInfo,
} from '@/lib/collection/allocations';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import type { DeckImportResponse, EnrichedCard } from '@/types/index';
import type { Finish } from '@spellcontrol/binder-routing';
import type { Deck } from '@/store/decks';
import type { SavedCube } from '@/store/cube';

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
  /**
   * The box's physical extras (a display commander, the box's sideboard),
   * kept "In the box". Each claims an owned copy of its printing and finish,
   * after the deck itself, so a single owned copy goes to the command zone.
   */
  extras?: Array<{ card: ScryfallCard; finish?: Finish }>;
  /** The finish each command-zone copy ships in, so it claims that copy and a
   *  same-printing display commander in another finish claims the other. */
  commanderFinish?: Finish;
  partnerFinish?: Finish;
  /** Deck source; defaults to 'manual'. */
  source?: DeckSource;
  /** The dialog's Public/Friends/Private choice; otherwise the signed-in
   *  default (public). */
  initialVisibility?: NewDeckVisibility;
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
  considering: DeckCard[];
  extras: DeckCard[];
  sourceProduct?: SourceProduct;
}

const pendingClaim = (cardName: string): AllocationInfo =>
  makeDeckAllocationInfo('__pending__', '__pending__', '', cardName);

/**
 * In the box slots for a product's physical extras, each claiming a free owned
 * copy of its own printing and finish and recording the claim in `claim`, so
 * two extras (or an extra and a deck slot) never take the same copy.
 */
export function allocateBoxExtras(
  extras: ReadonlyArray<{ card: ScryfallCard; finish?: Finish }>,
  collectionCards: EnrichedCard[],
  claim: Map<string, AllocationInfo>
): DeckCard[] {
  return extras.map(({ card, finish }) => {
    const pick = pickCollectionCopy(card.name, collectionCards, claim, card.id, finish);
    if (pick) claim.set(pick.copyId, pendingClaim(card.name));
    return newDeckCard(card, pick?.copyId ?? null);
  });
}

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
  ctx: { decks: Deck[]; cubes: readonly SavedCube[]; collectionCards: EnrichedCard[] },
  opts: BuildDeckOptions = {}
): BuiltDeckInput {
  const { partner = null, sourceProduct, source = 'manual', commanderFinish, partnerFinish } = opts;
  const claim =
    opts.claimed ?? new Map<string, AllocationInfo>(buildAllocationMap(ctx.decks, ctx.cubes));

  const allocate = (cardList: ScryfallCard[]): DeckCard[] =>
    allocateCardsForImport(cardList, ctx.collectionCards, claim);

  const base = {
    name: name.trim() || undefined,
    format,
    source,
    sourceProduct,
  };

  // E122: sideboard/maybeboard rows resolve into their own DeckImportResponse
  // arrays now (previously excluded from `cards` upstream and silently
  // dropped — never reached this function at all). Every real DECK_FORMAT_CONFIGS
  // entry has a sideboard, so "extras beyond a real sideboard" only ever means
  // maybeboard rows in practice — sideboard rows always route to `sideboard`.
  const sideboard = allocate(result.sideboard ?? []);
  const considering = allocate(result.considering ?? []);
  // Called last, so the deck's own slots claim first: a box extra only takes
  // a copy the deck itself doesn't need.
  const allocateExtras = (): DeckCard[] =>
    allocateBoxExtras(opts.extras ?? [], ctx.collectionCards, claim);

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
      commander.id,
      commanderFinish
    );
    if (commanderPick) claim.set(commanderPick.copyId, pendingClaim(commander.name));
    const partnerPick = partner
      ? pickCollectionCopy(partner.name, ctx.collectionCards, claim, partner.id, partnerFinish)
      : null;
    if (partner && partnerPick) claim.set(partnerPick.copyId, pendingClaim(partner.name));

    return {
      ...base,
      commander,
      partnerCommander: partner,
      commanderAllocatedCopyId: commanderPick?.copyId ?? null,
      partnerCommanderAllocatedCopyId: partnerPick?.copyId ?? null,
      cards,
      sideboard,
      considering,
      extras: allocateExtras(),
    };
  }

  return {
    ...base,
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: allocate(result.cards),
    sideboard,
    considering,
    extras: allocateExtras(),
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
      const cubes = useCubeStore.getState().saved;
      const collectionCards = useCollectionStore.getState().cards;
      return createDeck({
        ...buildDeckInputFromImport(
          result,
          commander,
          name,
          format,
          { decks, cubes, collectionCards },
          opts
        ),
        initialVisibility: opts.initialVisibility ?? defaultNewDeckVisibility(),
      });
    },
    [createDeck]
  );
}
