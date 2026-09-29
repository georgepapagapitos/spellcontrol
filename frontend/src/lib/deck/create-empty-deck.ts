import { useDecksStore } from '@/store/decks';
import type { DeckFormat } from '@/deck-builder/types';

type CreateDeck = ReturnType<typeof useDecksStore.getState>['createDeck'];

/**
 * The one-tap "Empty deck" start (E465): no commander, no cards, the store's
 * default name ("Untitled deck"). Returns the new deck's id.
 *
 * Always created Private, for guests and signed-in accounts alike. A
 * signed-in deck otherwise defaults to Public (new-deck-visibility.ts), and
 * an empty "Untitled deck" must never publish itself; the owner makes it
 * public later from the editor's Sharing chip. The server reads 'private'
 * once on first sight and books an unpublished row
 * (backend publications/sync-hook.ts), so a guest's deck promoted on sign-in
 * stays private too.
 *
 * `create` is injectable so a page can pass the `createDeck` it already
 * selected from the store.
 */
export function createEmptyDeck(
  format: DeckFormat = 'commander',
  create: CreateDeck = useDecksStore.getState().createDeck
): string {
  return create({
    source: 'manual',
    format,
    commander: null,
    commanderAllocatedCopyId: null,
    partnerCommander: null,
    partnerCommanderAllocatedCopyId: null,
    initialVisibility: 'private',
  });
}
