/**
 * Two deck-level printing actions from the deck editor's ⋮ menu. Both swap a
 * slot's frozen `card` (the printing) and leave `allocatedCopyId` alone, so
 * no physical copy is ever claimed or released here.
 *
 * - Cheapest printings for missing: every slot with no owned copy bound (the
 *   deck's missing cards, the same `classifyAllocation` test DeckDisplay's
 *   missing tally uses) moves to the card's cheapest paper printing, when that
 *   is actually cheaper in the display currency.
 * - Match my copies: every owned slot whose printing differs from the copy it
 *   is bound to takes that copy's exact printing, so price, export fallbacks
 *   and anything else reading the slot's card agree with the card in the box.
 *
 * The planners are pure; the two `apply*` runners resolve printings in one
 * batch, re-read the deck after the await, and commit ONE store write and ONE
 * undo entry, the same shape as `apply-upgrade-plan.ts`.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import {
  getCardsByIds,
  getCardsByNames,
  setForceLiveSearch,
} from '@/deck-builder/services/scryfall/client';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck, type DeckCard, type DeckZone } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useDeckHistoryStore } from '@/store/deck-history';
import { classifyAllocation } from '@/lib/collection/allocations';
import { priceOf } from './deck-value';
import type { Currency } from '@/lib/collection/currency';

/** Where a slot lives: a zone row by slot id, or one of the commander seats. */
export type SlotRef =
  { zone: DeckZone; slotId: string } | { zone: 'commander' | 'partnerCommander' };

export interface DeckSlot {
  ref: SlotRef;
  card: ScryfallCard;
  allocatedCopyId: string | null;
}

export interface PrintingSwap {
  ref: SlotRef;
  /** The printing the slot takes. */
  card: ScryfallCard;
}

const ZONES: DeckZone[] = ['cards', 'sideboard', 'considering'];

/** Every slot in the deck: the commander seats first, then each zone. */
export function deckSlots(deck: Deck): DeckSlot[] {
  const slots: DeckSlot[] = [];
  if (deck.commander) {
    slots.push({
      ref: { zone: 'commander' },
      card: deck.commander,
      allocatedCopyId: deck.commanderAllocatedCopyId ?? null,
    });
  }
  if (deck.partnerCommander) {
    slots.push({
      ref: { zone: 'partnerCommander' },
      card: deck.partnerCommander,
      allocatedCopyId: deck.partnerCommanderAllocatedCopyId ?? null,
    });
  }
  for (const zone of ZONES) {
    for (const dc of (deck[zone] as DeckCard[] | undefined) ?? []) {
      slots.push({
        ref: { zone, slotId: dc.slotId },
        card: dc.card,
        allocatedCopyId: dc.allocatedCopyId ?? null,
      });
    }
  }
  return slots;
}

/** Slots with no owned copy bound: DeckDisplay's missing test, every zone. */
export function missingSlots(
  deck: Deck,
  collectionById: Map<string, EnrichedCard> | undefined
): DeckSlot[] {
  if (!collectionById) return [];
  return deckSlots(deck).filter(
    (s) => classifyAllocation(s.allocatedCopyId, collectionById) !== 'allocated'
  );
}

export interface CheapestPlan {
  swaps: PrintingSwap[];
  /** How much less the swapped slots cost now, in the plan's currency. */
  saved: number;
}

/**
 * Pick the swaps for the missing slots, given each name's cheapest printing.
 * A slot changes only when the candidate is a different printing of the same
 * card, both have a price, and the candidate's is strictly lower.
 */
export function planCheapestPrintings(
  deck: Deck,
  collectionById: Map<string, EnrichedCard> | undefined,
  cheapestByName: Map<string, ScryfallCard>,
  currency: Currency
): CheapestPlan {
  const swaps: PrintingSwap[] = [];
  let saved = 0;
  for (const slot of missingSlots(deck, collectionById)) {
    const next = cheapestByName.get(slot.card.name);
    if (!next || next.id === slot.card.id || !sameCard(slot.card, next)) continue;
    const was = priceOf(slot.card, currency);
    const now = priceOf(next, currency);
    if (was <= 0 || now <= 0 || now >= was) continue;
    swaps.push({ ref: slot.ref, card: next });
    saved += was - now;
  }
  return { swaps, saved };
}

export interface CopyMismatch extends DeckSlot {
  copy: EnrichedCard;
}

/** Owned slots whose printing isn't the printing of the copy they're bound to. */
export function copyMismatches(
  deck: Deck,
  collectionById: Map<string, EnrichedCard> | undefined
): CopyMismatch[] {
  if (!collectionById) return [];
  const out: CopyMismatch[] = [];
  for (const slot of deckSlots(deck)) {
    const copy = slot.allocatedCopyId ? collectionById.get(slot.allocatedCopyId) : undefined;
    if (copy?.scryfallId && copy.scryfallId !== slot.card.id) out.push({ ...slot, copy });
  }
  return out;
}

/** Swaps for the mismatched slots whose copy's printing resolved. */
export function planMatchCopies(
  deck: Deck,
  collectionById: Map<string, EnrichedCard> | undefined,
  printingsById: Map<string, ScryfallCard>
): PrintingSwap[] {
  const swaps: PrintingSwap[] = [];
  for (const m of copyMismatches(deck, collectionById)) {
    const printing = printingsById.get(m.copy.scryfallId);
    if (printing && sameCard(m.card, printing)) swaps.push({ ref: m.ref, card: printing });
  }
  return swaps;
}

/** The deck with each swap's printing in place; bindings are untouched. */
export function applyPrintingSwaps(deck: Deck, swaps: PrintingSwap[]): Deck {
  const bySlot = new Map<string, ScryfallCard>();
  let commander = deck.commander;
  let partnerCommander = deck.partnerCommander;
  for (const { ref, card } of swaps) {
    if ('slotId' in ref) bySlot.set(ref.slotId, card);
    else if (ref.zone === 'commander') commander = card;
    else partnerCommander = card;
  }
  const swapZone = (rows: DeckCard[] | undefined) =>
    (rows ?? []).map((dc) => {
      const card = bySlot.get(dc.slotId);
      return card ? { ...dc, card } : dc;
    });
  return {
    ...deck,
    commander,
    partnerCommander,
    cards: swapZone(deck.cards),
    sideboard: swapZone(deck.sideboard),
    considering: swapZone(deck.considering),
  };
}

/** Same oracle card: a different printing, never a different card. */
function sameCard(a: ScryfallCard, b: ScryfallCard): boolean {
  if (a.oracle_id && b.oracle_id) return a.oracle_id === b.oracle_id;
  return a.name.toLowerCase() === b.name.toLowerCase();
}

/** Thrown when the device is offline; the caller's toast names the reason. */
export class PrintingLookupOfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'PrintingLookupOfflineError';
  }
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new PrintingLookupOfflineError();
  }
}

/** Run a lookup on the live path: the slim offline payload keeps one printing
 *  per card, so neither a cheapest nor an exact printing can come from it. */
async function live<T>(fn: () => Promise<T>): Promise<T> {
  assertOnline();
  setForceLiveSearch(true);
  try {
    return await fn();
  } finally {
    setForceLiveSearch(false);
  }
}

function collectionMap(): Map<string, EnrichedCard> | undefined {
  const { cards, hydrating } = useCollectionStore.getState();
  if (hydrating) return undefined;
  return new Map(cards.map((c) => [c.copyId, c]));
}

function commit(deck: Deck, swaps: PrintingSwap[], label: string): void {
  const history = useDeckHistoryStore.getState();
  const before = history.begin(deck.id);
  useDecksStore.getState().replaceDeck(deck.id, applyPrintingSwaps(deck, swaps));
  if (before) history.commit(deck.id, label, before);
}

const cardsLabel = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

export interface CheapestResult {
  changed: number;
  saved: number;
  /** Missing names the lookup didn't answer. */
  unresolved: number;
}

/**
 * Move the deck's missing cards to their cheapest printings. The batch name
 * lookup answers each name's cheapest nonfoil USD printing from the bulk dump
 * (Scryfall's own batch for anything it lacks); an EUR viewer takes it only
 * when it is also cheaper in EUR, since there is no batched cheapest-by-EUR.
 * Throws `PrintingLookupOfflineError` offline; the deck is untouched on throw.
 */
export async function applyCheapestPrintings(
  deckId: string,
  currency: Currency
): Promise<CheapestResult> {
  const start = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!start) return { changed: 0, saved: 0, unresolved: 0 };
  const names = [...new Set(missingSlots(start, collectionMap()).map((s) => s.card.name))];
  if (names.length === 0) return { changed: 0, saved: 0, unresolved: 0 };

  const cheapest = await live(() => getCardsByNames(names));
  const unresolved = names.filter((n) => !cheapest.has(n)).length;

  // Planned against the deck as it is now, not as it was before the await.
  const deck = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!deck) return { changed: 0, saved: 0, unresolved };
  const { swaps, saved } = planCheapestPrintings(deck, collectionMap(), cheapest, currency);
  if (swaps.length > 0) commit(deck, swaps, `cheapest printings (${cardsLabel(swaps.length)})`);
  return { changed: swaps.length, saved, unresolved };
}

export interface MatchResult {
  changed: number;
  /** Mismatched slots whose copy's printing didn't resolve. */
  unresolved: number;
}

/**
 * Give every owned slot the exact printing of the copy it's bound to, in one
 * batched id lookup. Throws `PrintingLookupOfflineError` offline.
 */
export async function applyMatchMyCopies(deckId: string): Promise<MatchResult> {
  const start = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!start) return { changed: 0, unresolved: 0 };
  const ids = [...new Set(copyMismatches(start, collectionMap()).map((m) => m.copy.scryfallId))];
  if (ids.length === 0) return { changed: 0, unresolved: 0 };

  const printings = await live(() => getCardsByIds(ids));

  const deck = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!deck) return { changed: 0, unresolved: 0 };
  const collection = collectionMap();
  const swaps = planMatchCopies(deck, collection, printings);
  const unresolved = copyMismatches(deck, collection).length - swaps.length;
  if (swaps.length > 0) commit(deck, swaps, `match my copies (${cardsLabel(swaps.length)})`);
  return { changed: swaps.length, unresolved };
}
