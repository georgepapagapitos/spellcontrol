import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { useDecksStore, newDeckCard } from '../store/decks';
import type { PublicDeck } from '../lib/shared-types';

/**
 * Pure mapper: converts a PublicDeck payload into the input shape expected by
 * `createDeck`. No store access — safe to call in tests without any Zustand
 * setup. Does NOT copy bracket/grade/synergy/salt fields — those recompute
 * in-app; copying the owner's stale analysis blobs would be wrong.
 */
export function sharedDeckToCreateInput(data: PublicDeck) {
  return {
    source: 'manual' as const,
    name: `${data.name} (copy)`,
    format: (data.format as DeckFormat) || 'commander',
    commander: (data.commander as unknown as ScryfallCard | null) ?? null,
    partnerCommander: (data.partnerCommander as unknown as ScryfallCard | null) ?? null,
    cards: data.cards.map((c) => newDeckCard(c.card as unknown as ScryfallCard, null)),
    sideboard: data.sideboard.map((c) => newDeckCard(c.card as unknown as ScryfallCard, null)),
    color: data.color,
  };
}

/**
 * Materializes a shared deck into the visitor's local decks store and returns
 * the new deck's id. Works for logged-out visitors — `createDeck` has no auth
 * check and the sync subscriber no-ops for guests. If they later sign in,
 * `startSync()` will drain the queued mutation and promote the deck into their
 * account automatically.
 */
export function copySharedDeck(data: PublicDeck): string {
  return useDecksStore.getState().createDeck(sharedDeckToCreateInput(data));
}
