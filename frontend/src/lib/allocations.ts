import { useMemo } from 'react';
import { useDecksStore, type Deck, type DeckCard } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';

/**
 * Basic-land names — fungible across printings. A deck slot for a Swamp
 * doesn't "want" a specific printing; binding the slot to whatever copy
 * the user owns is always correct. Used to short-circuit preferred-printing
 * logic in the allocator, remap pass, and suboptimal-printing audit so a
 * mixed-printing collection stops generating spurious "wrong printing" rows.
 */
export const BASIC_LAND_NAMES: ReadonlySet<string> = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
  'Snow-Covered Wastes',
]);

export function isBasicLandName(name: string): boolean {
  return BASIC_LAND_NAMES.has(name);
}

/**
 * Per-allocation info: which deck claims this physical card copy,
 * and which logical card slot in that deck.
 */
export interface AllocationInfo {
  deckId: string;
  deckName: string;
  /** Deck's swatch color, mirrored from the Deck record so badges/links can tint without re-fetching. */
  deckColor: string;
  cardName: string;
}

/**
 * Map<copyId → AllocationInfo>. Read by `CardSlot` and the binder UI
 * to grey out copies that are "checked out" to a saved deck. The map only
 * contains entries with a non-null `allocatedCopyId`; cards in decks
 * the user does not own (or that have been orphaned by a collection
 * delete) do not appear here.
 */
export function useAllocations(): Map<string, AllocationInfo> {
  const decks = useDecksStore((s) => s.decks);
  return useMemo(() => buildAllocationMap(decks), [decks]);
}

export function buildAllocationMap(decks: Deck[]): Map<string, AllocationInfo> {
  const m = new Map<string, AllocationInfo>();
  const isDev =
    typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  const claim = (copyId: string, info: AllocationInfo) => {
    if (isDev && m.has(copyId)) {
      const prior = m.get(copyId)!;
      console.warn(
        `[allocations] copyId ${copyId} double-claimed: "${prior.cardName}" in "${prior.deckName}" (${prior.deckId}) and "${info.cardName}" in "${info.deckName}" (${info.deckId})`
      );
    }
    m.set(copyId, info);
  };
  for (const deck of decks) {
    if (deck.commander && deck.commanderAllocatedCopyId) {
      claim(deck.commanderAllocatedCopyId, {
        deckId: deck.id,
        deckName: deck.name,
        deckColor: deck.color,
        cardName: deck.commander.name,
      });
    }
    if (deck.partnerCommander && deck.partnerCommanderAllocatedCopyId) {
      claim(deck.partnerCommanderAllocatedCopyId, {
        deckId: deck.id,
        deckName: deck.name,
        deckColor: deck.color,
        cardName: deck.partnerCommander.name,
      });
    }
    for (const c of deck.cards) {
      if (c.allocatedCopyId) {
        claim(c.allocatedCopyId, {
          deckId: deck.id,
          deckName: deck.name,
          deckColor: deck.color,
          cardName: c.card.name,
        });
      }
    }
    for (const c of deck.sideboard ?? []) {
      if (c.allocatedCopyId) {
        claim(c.allocatedCopyId, {
          deckId: deck.id,
          deckName: deck.name,
          deckColor: deck.color,
          cardName: c.card.name,
        });
      }
    }
  }
  return m;
}

/**
 * Strip cross-slot double-claims so one physical copy (`copyId`) is allocated
 * to at most one deck slot. First-claim-wins in a deterministic order: deck
 * array order, then within a deck commander → partnerCommander → cards →
 * sideboard. Any later slot holding an already-claimed `copyId` is reset to
 * `null` (the deck still lists the card — only the impossible physical claim is
 * dropped; the next `remapAllocations` re-picks a free copy if one is owned).
 *
 * Pure and reference-stable: returns the original `decks` array (and the
 * original `Deck`/`DeckCard` objects) when nothing was contested, so selector
 * identity, React memoization, and the sync subscriber don't see a spurious
 * change. Mirrors `reconcileBinderRefs`'s contract for the deck side. Does not
 * bump `updatedAt`: clearing a slot that never had a valid claim restores the
 * truthful state rather than recording a user edit.
 *
 * Collection-independent by design — it never inspects the collection, so it is
 * safe to run at deck-store hydration (decks hydrate independently of, and
 * usually before, the collection).
 *
 * This is the steady-state safety net. `remapAllocations` already enforces
 * first-claim-wins, but it only runs on collection replace; mutations like
 * `setCardAllocation` / `setCommander` / `addCard(…, copyId)` and
 * generated-deck saves can introduce a double-claim that otherwise persists —
 * and, in prod, is invisible (`buildAllocationMap`'s warn is dev-only) — until
 * the next import. Running this on every hydrate makes a persisted double-claim
 * self-heal, and folding it into `remapAllocations`'s output makes the
 * no-double-claim invariant hold by construction.
 */
export function dedupeDeckAllocations(decks: Deck[]): { decks: Deck[]; changed: boolean } {
  const claimed = new Set<string>();
  let anyChanged = false;

  const claimOne = (copyId: string | null): { copyId: string | null; changed: boolean } => {
    if (!copyId) return { copyId, changed: false };
    if (claimed.has(copyId)) return { copyId: null, changed: true };
    claimed.add(copyId);
    return { copyId, changed: false };
  };

  const claimSlots = (slots: DeckCard[]): { slots: DeckCard[]; changed: boolean } => {
    let listChanged = false;
    const next = slots.map((c) => {
      if (!c.allocatedCopyId) return c;
      if (claimed.has(c.allocatedCopyId)) {
        listChanged = true;
        return { ...c, allocatedCopyId: null };
      }
      claimed.add(c.allocatedCopyId);
      return c;
    });
    return listChanged ? { slots: next, changed: true } : { slots, changed: false };
  };

  const out = decks.map((deck) => {
    const cmd = claimOne(deck.commanderAllocatedCopyId);
    const partner = claimOne(deck.partnerCommanderAllocatedCopyId);
    const cards = claimSlots(deck.cards);
    const sideboard = claimSlots(deck.sideboard ?? []);
    const deckChanged = cmd.changed || partner.changed || cards.changed || sideboard.changed;
    if (!deckChanged) return deck;
    anyChanged = true;
    return {
      ...deck,
      commanderAllocatedCopyId: cmd.copyId,
      partnerCommanderAllocatedCopyId: partner.copyId,
      cards: cards.slots,
      sideboard: sideboard.slots,
    };
  });

  return { decks: anyChanged ? out : decks, changed: anyChanged };
}

/**
 * Pick the best collection copy of a named card to allocate to a deck.
 *
 * Preference order:
 *   1. Not already allocated to any deck (so we never double-claim).
 *   2. If `preferredScryfallId` is given and at least one free copy of that
 *      exact printing exists, restrict candidates to that printing. This is a
 *      hard filter, not a tiebreaker — a deck slot's printing is treated as
 *      meaningful intent rather than a hint.
 *   3. Non-foil over foil (foils are usually display copies).
 *   4. Cheapest purchasePrice (so the deck claims the budget copy first;
 *      premium copies stay free for the user).
 */
export function pickCollectionCopy(
  cardName: string,
  collection: EnrichedCard[],
  allocated: Map<string, AllocationInfo>,
  preferredScryfallId?: string
): EnrichedCard | null {
  const free = collection.filter((c) => c.name === cardName && !allocated.has(c.copyId));
  if (free.length === 0) return null;
  let candidates = free;
  // Basic lands are fungible — a slot for "Swamp" never has a real
  // preference for printing, so ignore preferredScryfallId for them and
  // let the finish/price tiebreakers spread across whatever the user owns.
  if (preferredScryfallId && !isBasicLandName(cardName)) {
    const printingMatches = free.filter((c) => c.scryfallId === preferredScryfallId);
    if (printingMatches.length > 0) candidates = printingMatches;
  }
  const finishRank = { nonfoil: 0, foil: 1, etched: 2 } as const;
  candidates.sort((a, b) => {
    const aRank = finishRank[a.finish] ?? (a.foil ? 1 : 0);
    const bRank = finishRank[b.finish] ?? (b.foil ? 1 : 0);
    if (aRank !== bRank) return aRank - bRank;
    return (a.purchasePrice ?? 0) - (b.purchasePrice ?? 0);
  });
  return candidates[0];
}

/**
 * Lookup of `EnrichedCard` by `copyId` for the current collection.
 * Used by the editor to render allocation badges with set/finish info.
 *
 * Returns `undefined` while the collection store is still rehydrating
 * from localStorage so callers can avoid mis-classifying allocated slots
 * as orphans (which paints them red) on first render.
 */
export function useCollectionByCopyId(): Map<string, EnrichedCard> | undefined {
  const cards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  return useMemo(() => {
    if (hydrating) return undefined;
    const m = new Map<string, EnrichedCard>();
    for (const c of cards) m.set(c.copyId, c);
    return m;
  }, [cards, hydrating]);
}

/**
 * Status of a deck slot, computed against the live collection. We do not
 * persist this — it is always derivable.
 *
 * - `allocated`: slot has a copyId that resolves to a real owned copy
 * - `orphan`: slot has a copyId but the collection no longer contains it
 * - `claimed-elsewhere`: slot has no copyId, but the user owns ≥1 copy of
 *    the card by name — every copy is currently allocated to another deck
 * - `unowned`: slot has no copyId and the user owns no copies of the card
 */
export type AllocationStatus = 'allocated' | 'unowned' | 'orphan' | 'claimed-elsewhere';

export function classifyAllocation(
  allocatedCopyId: string | null,
  collectionById: Map<string, EnrichedCard> | undefined,
  ctx?: {
    cardName?: string;
    /** All collection copies keyed by name (lower-cased) for the cross-deck lookup. */
    copiesByName?: Map<string, EnrichedCard[]>;
    /** Cross-deck allocation map — used to tell "owned but in another deck" from "not owned at all". */
    allocations?: Map<string, AllocationInfo>;
  }
): AllocationStatus {
  if (allocatedCopyId) {
    // Collection store hasn't rehydrated yet — defer the orphan check so we
    // don't paint every allocated row red for one frame on load.
    if (!collectionById) return 'allocated';
    return collectionById.has(allocatedCopyId) ? 'allocated' : 'orphan';
  }
  // No copy bound to this slot. Distinguish "I don't own it" from
  // "I own it but another deck has the copy".
  if (ctx?.cardName && ctx.copiesByName && ctx.allocations) {
    const copies = ctx.copiesByName.get(ctx.cardName.toLowerCase()) ?? [];
    if (copies.length > 0 && copies.every((c) => ctx.allocations!.has(c.copyId))) {
      return 'claimed-elsewhere';
    }
  }
  return 'unowned';
}

/**
 * One slot whose allocated copy is a different printing than the slot's
 * preferred scryfallId, where the preferred printing is owned. This is the
 * single highest-signal allocation bug class: every other audit (orphan,
 * double-claim, name mismatch) is caught by the existing invariants, but
 * "wrong printing despite better available" only shows up here.
 */
export interface SuboptimalPrinting {
  deckId: string;
  deckName: string;
  cardName: string;
  /** scryfallId the deck slot prefers. */
  preferredScryfallId: string;
  /** copyId currently allocated. */
  allocatedCopyId: string;
  /** Where the allocated copy comes from — for the admin table. */
  allocatedSet: string;
  allocatedScryfallId: string;
  /**
   * True when at least one copy of the preferred printing is unallocated, so
   * a remap can actually rebind this slot. False means the preferred copy is
   * owned but already claimed by another deck/slot — remap can't help, the
   * row is "stuck" and the user must free the copy first.
   */
  preferredFree: boolean;
}

/**
 * Find every deck slot where the allocated copy is a different printing than
 * the slot's preferred scryfallId AND the user owns at least one copy of the
 * preferred printing. Slots whose preferred printing isn't owned at all are
 * not reported — there's nothing better to bind them to.
 *
 * Reports slot-level rows, not collapsed by name/deck, so the admin table can
 * surface counts and per-deck details. The caller groups for display.
 */
export function findSuboptimalPrintings(
  decks: Deck[],
  collection: EnrichedCard[]
): SuboptimalPrinting[] {
  const byCopyId = new Map<string, EnrichedCard>();
  for (const c of collection) byCopyId.set(c.copyId, c);

  // Pre-index "does the user own (name, scryfallId)?" so the check stays O(slots).
  const ownedPrintings = new Set<string>();
  for (const c of collection) ownedPrintings.add(`${c.name} ${c.scryfallId}`);

  // Which copies are currently claimed by some deck slot — used to tell
  // "fixable by remap" (a free preferred copy exists) from "stuck" (the
  // preferred printing is owned but every copy of it is allocated already).
  const claimed = buildAllocationMap(decks);
  const freePreferred = new Set<string>();
  for (const c of collection) {
    if (!claimed.has(c.copyId)) freePreferred.add(`${c.name} ${c.scryfallId}`);
  }

  const out: SuboptimalPrinting[] = [];
  const consider = (
    deck: Deck,
    cardName: string,
    preferredScryfallId: string | undefined,
    allocatedCopyId: string | null
  ): void => {
    if (!allocatedCopyId || !preferredScryfallId) return;
    // Basic lands are fungible — never flag them as "wrong printing".
    if (isBasicLandName(cardName)) return;
    const copy = byCopyId.get(allocatedCopyId);
    if (!copy || copy.scryfallId === preferredScryfallId) return;
    if (!ownedPrintings.has(`${cardName} ${preferredScryfallId}`)) return;
    out.push({
      deckId: deck.id,
      deckName: deck.name,
      cardName,
      preferredScryfallId,
      allocatedCopyId,
      allocatedSet: copy.setCode,
      allocatedScryfallId: copy.scryfallId,
      preferredFree: freePreferred.has(`${cardName} ${preferredScryfallId}`),
    });
  };

  for (const deck of decks) {
    if (deck.commander) {
      consider(deck, deck.commander.name, deck.commander.id, deck.commanderAllocatedCopyId);
    }
    if (deck.partnerCommander) {
      consider(
        deck,
        deck.partnerCommander.name,
        deck.partnerCommander.id,
        deck.partnerCommanderAllocatedCopyId
      );
    }
    for (const c of deck.cards) {
      consider(deck, c.card.name, c.card.id, c.allocatedCopyId);
    }
    for (const c of deck.sideboard ?? []) {
      consider(deck, c.card.name, c.card.id, c.allocatedCopyId);
    }
  }
  return out;
}
