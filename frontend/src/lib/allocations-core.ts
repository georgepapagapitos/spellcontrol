// Pure allocation core — the card-copy claim model plus the functions the
// Zustand stores need at write time.
//
// Split out of ./allocations to break a value-level import cycle: both
// `store/decks` and `store/collection` import these at module scope, while
// ./allocations imports `newDeckCard` and the store hooks back. Per the
// established rule (see the repo cleanup wave), the fix for a cycle is to push
// the shared leaf DOWN into its own module — never to import back up into the
// parent. Everything here is pure and store-free: this module may import store
// TYPES, but must never import a store value or a React hook.

import { logger } from '@/lib/logger';
import type { Deck, DeckCard } from '../store/decks';
import type { SavedCube } from '../store/cube';
import type { EnrichedCard, Finish } from '../types';

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
 * Cubes have no per-cube user color (unlike decks), so every cube badge/link
 * tints with one shared identity color — a CSS var distinct from any deck
 * swatch so a "in a cube" marker never reads as a deck. Defined in tokens.css.
 */
export const CUBE_BADGE_COLOR = 'var(--cube-color)';

/**
 * Per-allocation info: which container (a deck OR a physical cube) claims this
 * physical card copy, and which card it stands in for.
 *
 * The `owner*` fields are the allocator-agnostic shape. The `deck*` fields are
 * kept as aliases so the ~25 sites that read `deckId`/`deckName`/`deckColor`
 * don't all need touching — for a cube claim `deckId` is `''` (so existing
 * `claim.deckId === thisDeck.id` "is it in *this* deck" checks correctly treat
 * a cube copy as elsewhere), while `deckName`/`deckColor` mirror the cube's.
 * Anything that must route or label differently branches on `ownerKind`.
 */
export interface AllocationInfo {
  ownerKind: 'deck' | 'cube';
  /** Deck.id for a deck claim; SavedCube.id for a cube claim. */
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  /** Legacy alias = ownerId for decks, '' for cubes. */
  deckId: string;
  /** Legacy alias = ownerName. */
  deckName: string;
  /** Legacy alias = ownerColor. */
  deckColor: string;
  cardName: string;
}

/**
 * Build a deck AllocationInfo with the owner* fields and the legacy deck*
 * aliases both populated. Exported so the transient claimed-maps in
 * save-generated-deck / build-deck-from-import / the deck remap can construct
 * the full shape without repeating the alias boilerplate.
 */
export function makeDeckAllocationInfo(
  deckId: string,
  deckName: string,
  deckColor: string,
  cardName: string
): AllocationInfo {
  return {
    ownerKind: 'deck',
    ownerId: deckId,
    ownerName: deckName,
    ownerColor: deckColor,
    deckId,
    deckName,
    deckColor,
    cardName,
  };
}

/** Full AllocationInfo for a deck claim, with legacy aliases populated. */
function deckClaim(deck: Deck, cardName: string): AllocationInfo {
  return makeDeckAllocationInfo(deck.id, deck.name, deck.color, cardName);
}

/** Full AllocationInfo for a physical-cube claim. `deckId` is '' on purpose. */
function cubeClaim(cube: SavedCube, cardName: string): AllocationInfo {
  return {
    ownerKind: 'cube',
    ownerId: cube.id,
    ownerName: cube.name,
    ownerColor: CUBE_BADGE_COLOR,
    deckId: '',
    deckName: cube.name,
    deckColor: CUBE_BADGE_COLOR,
    cardName,
  };
}

/**
 * Map<copyId → AllocationInfo> of every physical copy "checked out" to a deck
 * or to a cube the user flagged as physical (`isPhysical`). Read by `CardSlot`,
 * the binder UI, and the deck editor to grey out / badge copies that aren't
 * free. Pass `physicalCubes` (the raw saved-cube list — non-physical cubes are
 * filtered out here) to fold cube claims in; omit it for deck-only behavior.
 *
 * `onCollision` is called synchronously for every double-claim found (the
 * later claimant losing to the earlier one in map iteration order — the map
 * itself just keeps the last write). This is prod-visible reporting, unlike
 * the dev-only `logger.warn` below: AdminPage uses it to surface a live
 * double-claim counter instead of the invariant only being checkable via a
 * dev console. In steady state this never fires — dedupeDeckAllocations
 * (below) is the chokepoint that prevents a double-claim from persisting.
 */
export function buildAllocationMap(
  decks: Deck[],
  physicalCubes?: SavedCube[],
  onCollision?: (collision: { copyId: string; prior: AllocationInfo; next: AllocationInfo }) => void
): Map<string, AllocationInfo> {
  const m = new Map<string, AllocationInfo>();
  const isDev =
    typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  const claim = (copyId: string, info: AllocationInfo) => {
    const prior = m.get(copyId);
    if (prior) {
      if (isDev) {
        logger.warn(
          `[allocations] copyId ${copyId} double-claimed: "${prior.cardName}" in "${prior.deckName}" and "${info.cardName}" in "${info.deckName}"`
        );
      }
      onCollision?.({ copyId, prior, next: info });
    }
    m.set(copyId, info);
  };
  for (const deck of decks) {
    if (deck.commander && deck.commanderAllocatedCopyId) {
      claim(deck.commanderAllocatedCopyId, deckClaim(deck, deck.commander.name));
    }
    if (deck.partnerCommander && deck.partnerCommanderAllocatedCopyId) {
      claim(deck.partnerCommanderAllocatedCopyId, deckClaim(deck, deck.partnerCommander.name));
    }
    for (const c of deck.cards) {
      if (c.allocatedCopyId) claim(c.allocatedCopyId, deckClaim(deck, c.card.name));
    }
    for (const c of deck.sideboard ?? []) {
      if (c.allocatedCopyId) claim(c.allocatedCopyId, deckClaim(deck, c.card.name));
    }
    // Considering (E122) claims too — passive bookkeeping only (no donor/steal
    // participation), but still must count as "checked out" so a card parked
    // here can't be double-bound to a slot in another deck.
    for (const c of deck.considering ?? []) {
      if (c.allocatedCopyId) claim(c.allocatedCopyId, deckClaim(deck, c.card.name));
    }
  }
  for (const cube of physicalCubes ?? []) {
    if (!cube.isPhysical) continue;
    for (const slot of cube.picks ?? []) {
      if (slot.allocatedCopyId) claim(slot.allocatedCopyId, cubeClaim(cube, slot.card.name));
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
    // `?? []` on both: this now runs on every decks-store write (E133's
    // centralized subscriber), including sync-rehydrated rows whose shape a
    // test fixture or a stale/partial persisted blob might not fully match —
    // must not crash the app over a missing array field.
    const cards = claimSlots(deck.cards ?? []);
    const sideboard = claimSlots(deck.sideboard ?? []);
    const considering = claimSlots(deck.considering ?? []);
    const deckChanged =
      cmd.changed || partner.changed || cards.changed || sideboard.changed || considering.changed;
    if (!deckChanged) return deck;
    anyChanged = true;
    return {
      ...deck,
      commanderAllocatedCopyId: cmd.copyId,
      partnerCommanderAllocatedCopyId: partner.copyId,
      cards: cards.slots,
      sideboard: sideboard.slots,
      considering: considering.slots,
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
 *   3. If `preferredFinish` is given and at least one candidate has that
 *      finish, restrict to it — same hard-filter semantics as the printing:
 *      an explicit foil pick in the edit-printing dialog is deliberate intent,
 *      not a hint the default ranking may overrule.
 *   4. Real printings over proxies (play the real card; the proxy is the spare).
 *   5. Non-foil over foil (foils are usually display copies).
 *   6. Cheapest purchasePrice (so the deck claims the budget copy first;
 *      premium copies stay free for the user).
 */
export function pickCollectionCopy(
  cardName: string,
  collection: EnrichedCard[],
  allocated: Map<string, AllocationInfo>,
  preferredScryfallId?: string,
  preferredFinish?: Finish
): EnrichedCard | null {
  const free = collection.filter((c) => c.name === cardName && !allocated.has(c.copyId));
  if (free.length === 0) return null;
  let candidates = free;
  // Honor an exact-printing preference as a hard filter when the user owns it
  // — applies to basics too: special-art / foil basics (e.g. a Secret Lair
  // Mountain) are a real, deliberate choice, not fungible. Falls back to the
  // finish/price tiebreakers when no copy of the preferred printing is free.
  if (preferredScryfallId) {
    const printingMatches = free.filter((c) => c.scryfallId === preferredScryfallId);
    if (printingMatches.length > 0) candidates = printingMatches;
  }
  if (preferredFinish) {
    const finishMatches = candidates.filter((c) => c.finish === preferredFinish);
    if (finishMatches.length > 0) candidates = finishMatches;
  }
  candidates.sort(compareCopyPreference);
  return candidates[0];
}

/** Same proxy-then-finish-then-price ranking pickCollectionCopy uses, as a comparator. */
export function compareCopyPreference(a: EnrichedCard, b: EnrichedCard): number {
  // Real printings before proxies. This MUST outrank the price tiebreak below:
  // a proxy is force-priced to 0 by applyPrices (lib/card-prices.ts), so without
  // it every proxy would win "cheapest first" and decks would claim the proxy
  // while the real copy sat unused in a binder. Play the real card; the proxy is
  // the spare.
  const aProxy = a.proxy ? 1 : 0;
  const bProxy = b.proxy ? 1 : 0;
  if (aProxy !== bProxy) return aProxy - bProxy;
  const finishRank = { nonfoil: 0, foil: 1, etched: 2 } as const;
  const aRank = finishRank[a.finish] ?? (a.foil ? 1 : 0);
  const bRank = finishRank[b.finish] ?? (b.foil ? 1 : 0);
  if (aRank !== bRank) return aRank - bRank;
  return (a.purchasePrice ?? 0) - (b.purchasePrice ?? 0);
}
