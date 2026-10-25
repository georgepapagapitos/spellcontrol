import type { AllocationInfo } from '@/lib/collection/allocations-core';
import type { EnrichedCard } from '@/types/index';

/**
 * Owned cards whose every copy is already bound to a deck, keyed by lowercased
 * name, with the decks holding them. Owning a staple only helps a new deck if a
 * copy is free: a card you own once and play in your Atraxa deck is "owned" and
 * also "taking it from Atraxa". Cube claims are left out: a cube is not a deck the player would think of
 * raiding for this.
 */
export function heldByDecks(
  cards: readonly EnrichedCard[],
  allocations: ReadonlyMap<string, AllocationInfo>
): Map<string, string[]> {
  const copies = new Map<string, { total: number; held: number; decks: Set<string> }>();
  for (const card of cards) {
    const key = card.name.toLowerCase();
    const entry = copies.get(key) ?? { total: 0, held: 0, decks: new Set<string>() };
    entry.total += 1;
    const claim = card.copyId ? allocations.get(card.copyId) : undefined;
    if (claim && claim.ownerKind === 'deck') {
      entry.held += 1;
      entry.decks.add(claim.deckName);
    }
    copies.set(key, entry);
  }
  const out = new Map<string, string[]>();
  for (const [key, entry] of copies) {
    if (entry.held > 0 && entry.held >= entry.total) out.set(key, [...entry.decks]);
  }
  return out;
}

/** A deck holding a card's copies: its id for lookups, its name for the player. */
export interface Holder {
  deckId: string;
  deckName: string;
}

/**
 * Like {@link heldByDecks}, for one deck's own page: cards with no free copy,
 * with the OTHER decks holding them (the viewing deck's own claim counts as
 * free, since the card is already usable there). Keyed by lowercased name.
 * "Free" is any copy with no deck or cube claim, so a cube-held copy keeps a
 * card out of this map only when no deck holds it either; a card held only by
 * cubes is not committed to a deck and has nothing to name.
 */
export function committedElsewhere(
  cards: readonly EnrichedCard[],
  allocations: ReadonlyMap<string, AllocationInfo>,
  thisDeckId: string
): Map<string, Holder[]> {
  const tally = new Map<string, { free: number; holders: Map<string, Holder> }>();
  for (const card of cards) {
    const key = card.name.toLowerCase();
    const entry = tally.get(key) ?? { free: 0, holders: new Map<string, Holder>() };
    const claim = card.copyId ? allocations.get(card.copyId) : undefined;
    if (!claim || claim.deckId === thisDeckId) entry.free += 1;
    else if (claim.ownerKind === 'deck')
      entry.holders.set(claim.deckId, { deckId: claim.deckId, deckName: claim.deckName });
    tally.set(key, entry);
  }
  const out = new Map<string, Holder[]>();
  for (const [key, entry] of tally) {
    if (entry.free === 0 && entry.holders.size > 0) out.set(key, [...entry.holders.values()]);
  }
  return out;
}
