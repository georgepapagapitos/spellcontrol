import { useSyncExternalStore } from 'react';

/**
 * The id of the deck the editor has open, for surfaces deep in the tree that act
 * on it (hiding a suggestion for this deck) without the page threading the id
 * through every prop. The editor sets it through `setSuggestionContext`.
 */
let activeDeckId: string | null = null;
const listeners = new Set<() => void>();

export function setActiveDeckId(id: string | null): void {
  if (id === activeDeckId) return;
  activeDeckId = id;
  listeners.forEach((l) => l());
}

export const getActiveDeckId = (): string | null => activeDeckId;

export function useActiveDeckId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getActiveDeckId,
    () => null
  );
}
