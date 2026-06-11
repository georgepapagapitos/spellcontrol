import { create } from 'zustand';
import {
  emptyHistory,
  pushCommand,
  undo as undoCore,
  redo as redoCore,
  invalidate as invalidateCore,
  canUndo as canUndoCore,
  canRedo as canRedoCore,
  undoLabel as undoLabelCore,
  redoLabel as redoLabelCore,
  type History,
} from '../lib/deck-history-core';
import { haptics } from '../lib/haptics';
import { useDecksStore, type Deck } from './decks';

/**
 * In-memory undo/redo history for deck editing.
 *
 * Each undoable user action is recorded as a before/after snapshot of the
 * affected deck (the pure stack logic lives in `lib/deck-history-core.ts`).
 * Undo/redo restore a snapshot via the decks store's `replaceDeck`, which
 * persists one upsert through the normal sync queue — under last-write-wins
 * that restored row is the compensating mutation, so no special sync plumbing
 * is needed (see `lib/sync.ts`).
 *
 * History is **ephemeral**: it lives only in memory, is never persisted or
 * synced, and is dropped for a deck when a server pull rewrites that deck's row
 * (`invalidate`, called from `lib/sync.ts`) — at which point the local
 * snapshots are stale and replaying them would clobber the remote edit.
 *
 * Recording is **explicit** (callers wrap user actions in `record` / `begin`+
 * `commit`); it is deliberately NOT driven off the decks-store subscriber,
 * because the analysis hook writes live fields via `updateDeck` and those must
 * not become undoable.
 */
interface DeckHistoryState {
  history: History<Deck>;

  /**
   * Snapshot the deck's current state to open a manual edit bracket. Pair with
   * {@link commit}. Use this for async actions that resolve data (e.g. a card
   * lookup) between the snapshot and the mutation. Returns null if the deck is
   * gone.
   */
  begin(deckId: string): Deck | null;
  /**
   * Close an edit bracket opened by {@link begin}: reads the deck's current
   * state and records a command if it actually changed.
   */
  commit(deckId: string, label: string, before: Deck): void;
  /**
   * Synchronous sugar: snapshot, run `fn` (which performs the mutation(s) via
   * the decks store), then record one command if the deck changed. Multiple
   * mutations inside one `fn` collapse to a single undo entry.
   */
  record(deckId: string, label: string, fn: () => void): void;

  /** Undo the most recent edit for this deck. Returns false if nothing to undo. */
  undo(deckId: string): boolean;
  /** Redo the most recently undone edit for this deck. Returns false if none. */
  redo(deckId: string): boolean;

  /** Drop the stacks for the given decks (stale after a server pull rewrote them). */
  invalidate(deckIds: Iterable<string>): void;
  /** Drop all history (e.g. on logout / account switch). */
  clear(): void;

  canUndo(deckId: string): boolean;
  canRedo(deckId: string): boolean;
  undoLabel(deckId: string): string | null;
  redoLabel(deckId: string): string | null;
}

function findDeck(deckId: string): Deck | null {
  return useDecksStore.getState().decks.find((d) => d.id === deckId) ?? null;
}

export const useDeckHistoryStore = create<DeckHistoryState>((set, get) => ({
  history: emptyHistory<Deck>(),

  begin: (deckId) => findDeck(deckId),

  commit: (deckId, label, before) => {
    const after = findDeck(deckId);
    // No after → the deck was deleted (out of scope for snapshot restore);
    // unchanged ref → the action was a no-op. Either way, record nothing.
    if (!after || after === before) return;
    set((s) => ({ history: pushCommand(s.history, { deckId, label, before, after }) }));
  },

  record: (deckId, label, fn) => {
    const before = get().begin(deckId);
    fn();
    if (before) get().commit(deckId, label, before);
  },

  undo: (deckId) => {
    const r = undoCore(get().history, deckId);
    if (!r) return false;
    useDecksStore.getState().replaceDeck(deckId, r.command.before);
    set({ history: r.history });
    // Light tick on the actual restore — this is the chokepoint for every
    // undo entry point (toolbar, Cmd/Ctrl+Z, toast actions), so wiring here
    // covers them all. No-op stacks return above without buzzing.
    haptics.tap();
    return true;
  },

  redo: (deckId) => {
    const r = redoCore(get().history, deckId);
    if (!r) return false;
    useDecksStore.getState().replaceDeck(deckId, r.command.after);
    set({ history: r.history });
    haptics.tap();
    return true;
  },

  invalidate: (deckIds) => {
    set((s) => {
      const next = invalidateCore(s.history, deckIds);
      return next === s.history ? s : { history: next };
    });
  },

  clear: () => set({ history: emptyHistory<Deck>() }),

  canUndo: (deckId) => canUndoCore(get().history, deckId),
  canRedo: (deckId) => canRedoCore(get().history, deckId),
  undoLabel: (deckId) => undoLabelCore(get().history, deckId),
  redoLabel: (deckId) => redoLabelCore(get().history, deckId),
}));

/** Imperative helpers for non-component callers (sync.ts invalidation, etc.). */
export const deckHistory = {
  invalidate: (deckIds: Iterable<string>) => useDeckHistoryStore.getState().invalidate(deckIds),
  clear: () => useDeckHistoryStore.getState().clear(),
};
