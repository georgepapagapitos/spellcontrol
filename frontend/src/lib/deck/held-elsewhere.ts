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
