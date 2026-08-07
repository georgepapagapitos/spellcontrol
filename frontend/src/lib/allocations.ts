import { useMemo } from 'react';
import { useDecksStore, newDeckCard, type Deck, type DeckCard } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import { useCubeStore, type SavedCube } from '../store/cube';
import type { EnrichedCard, Finish } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ChangeOwnership } from './deck-change';
import {
  makeDeckAllocationInfo,
  buildAllocationMap,
  pickCollectionCopy,
  compareCopyPreference,
  isBasicLandName,
  type AllocationInfo,
} from './allocations-core';

// The pure claim model + the functions the stores need at module scope live in
// ./allocations-core, so the stores can import them without cycling back
// through this module's hooks. Re-exported so every existing
// `from '@/lib/allocations'` import site keeps working unchanged.
export * from './allocations-core';

/**
 * Map<copyId → AllocationInfo>. Read by `CardSlot` and the binder UI
 * to grey out copies that are "checked out" to a saved deck. The map only
 * contains entries with a non-null `allocatedCopyId`; cards in decks
 * the user does not own (or that have been orphaned by a collection
 * delete) do not appear here.
 */
export function useAllocations(): Map<string, AllocationInfo> {
  const decks = useDecksStore((s) => s.decks);
  const cubes = useCubeStore((s) => s.saved);
  return useMemo(() => buildAllocationMap(decks, cubes), [decks, cubes]);
}

/**
 * Copies kept aside before the rest of a card's unallocated stock counts as
 * tradeable surplus. 1 is the simplest defensible default: decks here are
 * predominantly Commander (singleton), so a card only ever needs one
 * "working" copy — anything past that, once nothing has claimed it, is free
 * to trade. Constructed playsets (up to 4) would need per-format awareness
 * this collection doesn't track, so the floor stays flat and card-agnostic.
 */
export const SURPLUS_KEEP_COPIES = 1;

/**
 * Map<cardName, surplus count> for the "tradeable surplus" collection
 * filter — physical copies bound to no deck or cube, beyond the first kept
 * copy, excluding basic lands (fungible, never worth flagging as spare).
 * Names with zero surplus are omitted, so `.has(name)` doubles as the
 * per-row predicate.
 *
 * Computed over the FULL collection, not a scoped subset (e.g. a
 * single-binder view's `cards` prop) — a surplus copy sitting in a
 * different binder than the one currently displayed still counts, since
 * allocation is a collection-wide fact.
 */
export function computeSurplusByName(
  cards: EnrichedCard[],
  allocations: Map<string, AllocationInfo>
): Map<string, number> {
  const unallocated = new Map<string, number>();
  for (const c of cards) {
    if (isBasicLandName(c.name)) continue;
    if (allocations.has(c.copyId)) continue;
    unallocated.set(c.name, (unallocated.get(c.name) ?? 0) + 1);
  }
  const surplus = new Map<string, number>();
  for (const [name, count] of unallocated) {
    const over = count - SURPLUS_KEEP_COPIES;
    if (over > 0) surplus.set(name, over);
  }
  return surplus;
}

/**
 * Picks which `count` of a stacked row's slots to release for a quantity
 * decrement (qty stepper "−", bulk click-to-type shrink). Prefers releasing
 * UNALLOCATED slots first — dropping an allocated slot while an unallocated
 * duplicate of the same card remains would silently make an owned card read
 * as unowned in the deck, even though the physical copy is still there and
 * merely needs re-binding (which `buildAllocationMap` does automatically on
 * the next render, since allocation is derived from what's left in `cards`).
 * Falls back to allocated slots only once there's no unallocated stock left
 * to shed. Order within each group is preserved (oldest-added first).
 */
export function pickSlotsToRelease<T extends { allocatedCopyId: string | null }>(
  current: T[],
  count: number
): T[] {
  if (count <= 0) return [];
  const unallocated = current.filter((c) => !c.allocatedCopyId);
  const allocated = current.filter((c) => c.allocatedCopyId);
  if (unallocated.length >= count) return unallocated.slice(-count);
  return [...allocated.slice(-(count - unallocated.length)), ...unallocated];
}

/**
 * Turn a flat list of resolved import cards into DeckCards, claiming a free
 * owned collection copy for each as it goes. `claimed` is mutated in place
 * (marked with a `'__pending__'` deck so a later card in the SAME list can't
 * double-claim the copy this one just took) — callers share one `claimed` map
 * across every zone (cards/sideboard/considering, plus the commander slots)
 * of a single import so nothing in that batch collides.
 *
 * Shared by whole-deck import (`build-deck-from-import.ts`'s
 * `buildDeckInputFromImport`) and single-deck append (`append-deck-import.ts`)
 * — the claim-as-you-go allocation behavior lives in exactly one place.
 */
export function allocateCardsForImport(
  cardList: ScryfallCard[],
  collection: EnrichedCard[],
  claimed: Map<string, AllocationInfo>
): DeckCard[] {
  return cardList.map((card) => {
    const pick = pickCollectionCopy(card.name, collection, claimed, card.id);
    if (pick)
      claimed.set(pick.copyId, makeDeckAllocationInfo('__pending__', '__pending__', '', card.name));
    return newDeckCard(card, pick?.copyId ?? null);
  });
}

/** Stable display order for finish lists — matches the dialog's button order. */
const FINISH_ORDER: readonly Finish[] = ['nonfoil', 'foil', 'etched'];

/**
 * Per-printing (scryfallId) finishes the user owns AND can bind to a slot in
 * `currentDeckId` (free, or already claimed by this deck — same "in THIS deck
 * = free" rule as {@link classifyPrintingAvailability}). One pass over the
 * collection so the edit-printing dialog can resolve every listed printing by
 * lookup. Printings with no bindable copy have no entry.
 */
export function bindableFinishesByPrinting(
  collection: EnrichedCard[],
  allocations: Map<string, AllocationInfo>,
  currentDeckId?: string
): Map<string, Finish[]> {
  const sets = new Map<string, Set<Finish>>();
  for (const c of collection) {
    const claim = allocations.get(c.copyId);
    if (claim && claim.deckId !== currentDeckId) continue;
    let s = sets.get(c.scryfallId);
    if (!s) {
      s = new Set<Finish>();
      sets.set(c.scryfallId, s);
    }
    s.add(c.finish);
  }
  const out = new Map<string, Finish[]>();
  for (const [id, s] of sets)
    out.set(
      id,
      FINISH_ORDER.filter((f) => s.has(f))
    );
  return out;
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
 * Availability of a specific printing (by `scryfallId`) for binding to a slot in
 * `currentDeckId`, at printing granularity — `classifyAllocation`/`ownershipFor`
 * answer by card *name*, but the edit-printing picker needs it per printing.
 * Speaks the same `ChangeOwnership` vocabulary the Suggestions tab already uses:
 *
 *  - 'owned'         → you own ≥1 copy of THIS printing that's free (or already
 *                       in this deck) — pick it and it binds from your collection.
 *  - 'in-other-deck' → owned, but every copy of this printing is in another deck.
 *  - 'in-cube'       → owned, but every copy is committed to a physical cube.
 *  - 'unowned'       → you don't own this printing.
 *
 * A copy already allocated to `currentDeckId` counts as free (it's re-bindable
 * here), matching `ownershipByName`'s "in THIS deck = free" rule.
 */
export function classifyPrintingAvailability(
  scryfallId: string,
  collection: EnrichedCard[],
  allocations: Map<string, AllocationInfo>,
  currentDeckId?: string
): Exclude<ChangeOwnership, undefined> {
  const copies = collection.filter((c) => c.scryfallId === scryfallId);
  if (copies.length === 0) return 'unowned';
  let hasDeck = false;
  for (const c of copies) {
    const claim = allocations.get(c.copyId);
    if (!claim || claim.deckId === currentDeckId) return 'owned';
    if (claim.ownerKind === 'deck') hasDeck = true;
  }
  // Every remaining copy is claimed; prefer the deck label when copies are split
  // across a deck and a cube — a deck is the more actionable place to pull from
  // (mirrors ownershipFor). No deck claim ⇒ all copies are cube-committed.
  return hasDeck ? 'in-other-deck' : 'in-cube';
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
    for (const c of deck.considering ?? []) {
      consider(deck, c.card.name, c.card.id, c.allocatedCopyId);
    }
  }
  return out;
}

/**
 * What to do with the donor deck's slot when a physical copy is pulled out of
 * it into another deck. The user always picks this explicitly — nothing moves
 * silently (see the "physical copy reallocation" feature).
 *
 * - `leave-gap`: the slot stays in the donor deck but becomes unowned/proxy —
 *    the truthful physical state (that deck is now short a card). DEFAULT.
 * - `replace`: swap the donor slot for an owned alternative (picked via the
 *    similar-cards suggestion engine).
 * - `remove`: drop the slot from the donor deck entirely.
 */
export type DonorOutcome = 'leave-gap' | 'replace' | 'remove';

/**
 * Where a physical copy currently lives in its donor. Deck zones are a slot in
 * the donor deck; `cube` means a physical-cube pick (released by copyId, not a
 * slot — a cube's only donor outcome is leave-gap).
 */
export type DonorZone = 'main' | 'sideboard' | 'commander' | 'partner' | 'cube';

/**
 * A physical copy that can be pulled out of another deck OR a physical cube to
 * satisfy an add in the current deck. Carries enough context to (a) confirm the
 * move with the user and (b) apply the donor outcome to the right place.
 *
 * The `donor*` fields mirror {@link AllocationInfo}'s alias shape: `donorId` is
 * the canonical owner id (Deck.id or SavedCube.id), and the legacy `donorDeck*`
 * names stay populated (`donorDeckId` is `''` for a cube, so any
 * `=== thisDeck.id` check treats it as elsewhere) so the existing deck-steal
 * call sites don't churn. Branch on `donorKind` to route the apply.
 */
export interface StealableCopy {
  copyId: string;
  /** Whether the copy is currently held by a deck or a physical cube. */
  donorKind: 'deck' | 'cube';
  /** Canonical owner id: Deck.id for a deck donor, SavedCube.id for a cube. */
  donorId: string;
  /** Legacy alias = donorId for a deck donor, `''` for a cube donor. */
  donorDeckId: string;
  /** Display name of the donor (the cube name for a cube donor). */
  donorDeckName: string;
  /** Donor accent color (the shared cube color for a cube donor). */
  donorDeckColor: string;
  donorZone: DonorZone;
  /** Slot id for `main`/`sideboard`; `null` for commander/partner and cube. */
  donorSlotId: string | null;
  /**
   * The donor deck slot's card payload — for the replace-suggestion target and
   * display. Absent for a cube donor: its only outcome is leave-gap (released by
   * copyId), so no card payload is needed.
   */
  donorCard?: ScryfallCard;
}

/** Find which slot in `deck` holds `copyId`, if any. */
function locateCopyInDeck(
  deck: Deck,
  copyId: string
): { zone: DonorZone; slotId: string | null; card: ScryfallCard } | null {
  if (deck.commanderAllocatedCopyId === copyId && deck.commander) {
    return { zone: 'commander', slotId: null, card: deck.commander };
  }
  if (deck.partnerCommanderAllocatedCopyId === copyId && deck.partnerCommander) {
    return { zone: 'partner', slotId: null, card: deck.partnerCommander };
  }
  const main = deck.cards.find((c) => c.allocatedCopyId === copyId);
  if (main) return { zone: 'main', slotId: main.slotId, card: main.card };
  const side = (deck.sideboard ?? []).find((c) => c.allocatedCopyId === copyId);
  if (side) return { zone: 'sideboard', slotId: side.slotId, card: side.card };
  return null;
}

/**
 * Decide whether adding `cardName` to `excludeDeckId` requires stealing a
 * physical copy from another deck. This is the pure gate that decides whether
 * to surface the steal-confirm UI at all — it never mutates.
 *
 * Returns `null` (no steal — caller should bind a free copy or add as proxy)
 * when:
 *  - the user owns no copies of the card,
 *  - at least one owned copy matching the preferences is free (unallocated),
 *  - every such copy is already allocated to `excludeDeckId` itself.
 *
 * Otherwise returns the best copy to pull — held by another deck OR a physical
 * cube — ranked with the same non-foil → cheapest preference as
 * {@link pickCollectionCopy} — plus where it currently lives so the donor
 * outcome can be applied. A cube donor is always a leave-gap release (a
 * 540-card cube just loses one slot); a deck donor lets the caller pick
 * leave-gap / replace / remove. Either way the pull is a conscious per-card
 * choice — this function only surfaces it.
 *
 * `preferredScryfallId` / `preferredFinish` cascade as hard filters (mirroring
 * pickCollectionCopy, basics included — special-art basics are a real choice)
 * BEFORE the free-copy bail-out, so the bail-out is preference-scoped: a free
 * copy of some other printing/finish doesn't hide that the copy the user
 * actually asked for is committed elsewhere. Each falls back a level when the
 * preference isn't owned at all.
 */
export function findStealableCopy(
  cardName: string,
  collection: EnrichedCard[],
  decks: Deck[],
  excludeDeckId: string,
  preferredScryfallId?: string,
  physicalCubes?: SavedCube[],
  preferredFinish?: Finish
): StealableCopy | null {
  let owned = collection.filter((c) => c.name === cardName);
  if (owned.length === 0) return null;

  if (preferredScryfallId) {
    const printingMatches = owned.filter((c) => c.scryfallId === preferredScryfallId);
    if (printingMatches.length > 0) owned = printingMatches;
  }
  if (preferredFinish) {
    const finishMatches = owned.filter((c) => c.finish === preferredFinish);
    if (finishMatches.length > 0) owned = finishMatches;
  }

  const allocations = buildAllocationMap(decks, physicalCubes);
  // A free copy (of the preferred kind) exists → no steal needed; the normal
  // allocator binds it.
  if (owned.some((c) => !allocations.has(c.copyId))) return null;

  // Stealable = held by a DECK other than the one we're adding to, OR by a
  // physical cube (cube copies are now consciously pullable as a leave-gap —
  // the move still requires the explicit per-card choice in the UI).
  const stealable = owned.filter((c) => {
    const info = allocations.get(c.copyId);
    if (!info) return false;
    if (info.ownerKind === 'cube') return true;
    return info.deckId !== excludeDeckId;
  });
  if (stealable.length === 0) return null;

  const best = [...stealable].sort(compareCopyPreference)[0];
  const info = allocations.get(best.copyId)!;

  // Cube donor: release by copyId (no slot), leave-gap only.
  if (info.ownerKind === 'cube') {
    return {
      copyId: best.copyId,
      donorKind: 'cube',
      donorId: info.ownerId,
      donorDeckId: '',
      donorDeckName: info.ownerName,
      donorDeckColor: info.ownerColor,
      donorZone: 'cube',
      donorSlotId: null,
    };
  }

  const donorDeck = decks.find((d) => d.id === info.deckId);
  const located = donorDeck ? locateCopyInDeck(donorDeck, best.copyId) : null;
  // Defensive: the allocation map said a deck claims this copy, so the slot
  // should always be locatable. If the deck vanished mid-flight, bail.
  if (!donorDeck || !located) return null;

  return {
    copyId: best.copyId,
    donorKind: 'deck',
    donorId: donorDeck.id,
    donorDeckId: donorDeck.id,
    donorDeckName: donorDeck.name,
    donorDeckColor: donorDeck.color,
    donorZone: located.zone,
    donorSlotId: located.slotId,
    donorCard: located.card,
  };
}

/**
 * What adding a card to a deck should do, given the live collection + decks.
 * The single source of truth shared by every add path (collection search panel,
 * Coach/Engine lanes, quantity stepper) so they behave identically.
 *
 * An add NEVER moves a physical copy out of another deck — decks list what they
 * want freely. Pulling a copy in is always a separate, conscious choice (the
 * per-row "Use my copy" / the Shared-copies review's "Move here…"). So:
 *
 *  - `bind`: a free owned copy exists → claim it.
 *  - `list`: no free copy → add the slot unbound. classifyAllocation then renders
 *    it "In [deck]" (owned but every copy is elsewhere) or "unowned" (not owned) —
 *    exactly the slot import/generate already produce.
 */
export type AddPlan = { kind: 'bind'; copyId: string } | { kind: 'list' };

export function planCardAdd(
  cardName: string,
  preferredScryfallId: string | undefined,
  collection: EnrichedCard[],
  decks: Deck[],
  physicalCubes?: SavedCube[]
): AddPlan {
  // Including physicalCubes here is what stops an add from binding a copy that
  // already lives in a physical cube — a card can't be in two places at once.
  const allocations = buildAllocationMap(decks, physicalCubes);
  const claim = pickCollectionCopy(cardName, collection, allocations, preferredScryfallId);
  return claim ? { kind: 'bind', copyId: claim.copyId } : { kind: 'list' };
}

/** A mainboard slot whose card you own but every copy is currently committed elsewhere. */
export interface ContestedCard {
  slotId: string;
  cardName: string;
  /** Whether the best donor is another deck or a physical cube (drives the icon/wording). */
  donorKind: 'deck' | 'cube';
  /** The deck/cube a copy currently lives in (best donor) — for the "also in […]" line. */
  donorDeckName: string;
  donorDeckColor: string;
  /** How many copies you own (honest shortage line: "you own N, also wanted by …"). */
  owned: number;
}

/**
 * List this deck's mainboard cards that are owned-but-claimed-elsewhere — feeds the
 * Shared-copies review sheet. Pure; never mutates and never plans a move (unlike a
 * bulk resolver — the user decides each one consciously). Each entry names the best
 * donor (via {@link findStealableCopy}) so the row can show where the copy is and
 * trigger a per-card move.
 */
export function listContestedCards(
  deck: Deck,
  collection: EnrichedCard[],
  decks: Deck[],
  physicalCubes?: SavedCube[]
): ContestedCard[] {
  const out: ContestedCard[] = [];
  for (const slot of deck.cards) {
    if (slot.allocatedCopyId) continue;
    const owned = collection.filter((c) => c.name === slot.card.name).length;
    if (owned === 0) continue;
    const donor = findStealableCopy(
      slot.card.name,
      collection,
      decks,
      deck.id,
      slot.card.id,
      physicalCubes
    );
    if (!donor) continue; // a free copy exists, or not actually elsewhere — not contested
    out.push({
      slotId: slot.slotId,
      cardName: slot.card.name,
      donorKind: donor.donorKind,
      donorDeckName: donor.donorDeckName,
      donorDeckColor: donor.donorDeckColor,
      owned,
    });
  }
  return out;
}
