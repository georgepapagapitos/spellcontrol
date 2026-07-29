import { create } from 'zustand';
import type { Deck } from './decks';

/**
 * One deck whose push was rejected as stale (E170). `applyPushResult`
 * (lib/sync.ts) captures the local edit's Deck snapshot BEFORE it overwrites
 * the IDB row with the server's version — that's the only chance to grab the
 * data the user is about to lose — and pushes it here so a real diff panel
 * can offer a recovery choice instead of a bare "kept the server version"
 * toast. Mirrors `store/toasts.ts`'s shape/imperative-helper convention.
 */
export interface DeckConflict {
  id: string;
  localDeck: Deck;
  serverDeck: Deck;
  detectedAt: number;
}

interface ConflictsState {
  queue: DeckConflict[];
  push(conflicts: DeckConflict[]): void;
  dismiss(id: string): void;
  clear(): void;
}

export const useConflictsStore = create<ConflictsState>((set) => ({
  queue: [],
  push: (conflicts) =>
    set((s) => ({
      // A retried push for the same deck can re-detect the same conflict —
      // replace rather than stack a duplicate entry for it.
      queue: [...s.queue.filter((q) => !conflicts.some((c) => c.id === q.id)), ...conflicts],
    })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((c) => c.id !== id) })),
  clear: () => set({ queue: [] }),
}));

/** Imperative helper for non-component callers (mirrors `store/toasts.ts`'s `toast`). */
export const conflictQueue = {
  push: (conflicts: DeckConflict[]) => useConflictsStore.getState().push(conflicts),
};
