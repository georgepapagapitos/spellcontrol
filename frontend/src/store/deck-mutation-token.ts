import { useSyncExternalStore } from 'react';

// Local-mutation token (E177) — a plain module-level counter per deck id,
// bumped synchronously by every entry into `touch()` (store/decks.ts).
const localMutationTokens = new Map<string, number>();
const mutationTokenListeners = new Set<() => void>();

export function bumpLocalMutationToken(deckId: string): void {
  localMutationTokens.set(deckId, (localMutationTokens.get(deckId) ?? 0) + 1);
  for (const listener of mutationTokenListeners) listener();
}

/** Non-reactive read — for tests and any non-component consumer. */
export function getLocalMutationToken(deckId: string): number {
  return localMutationTokens.get(deckId) ?? 0;
}

/**
 * Reactive read: re-renders the calling component whenever `deckId`'s local
 * mutation token bumps. A consumer snapshots a baseline (`getLocalMutationToken`
 * or this hook's value) and later asks "has the user mutated this deck since?"
 * by comparing tokens. See the comment on `touch()` in store/decks.ts for what this replaces.
 */
export function useLocalMutationToken(deckId: string): number {
  return useSyncExternalStore(
    (onChange) => {
      mutationTokenListeners.add(onChange);
      return () => mutationTokenListeners.delete(onChange);
    },
    () => getLocalMutationToken(deckId)
  );
}
