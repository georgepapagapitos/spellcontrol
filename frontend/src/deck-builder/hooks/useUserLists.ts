import type { UserCardList } from '@/deck-builder/types';

// Phase 1 stub. User lists (saved decks/lists used as exclude/include filters
// during generation) will be wired up in a later phase, sharing storage with
// the decks slice.
export function loadUserLists(): UserCardList[] {
  return [];
}
