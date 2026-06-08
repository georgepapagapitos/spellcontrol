/**
 * Snapshot helpers for undoing destructive collection operations.
 *
 * The collection-page "danger" actions — clearing the collection, deleting an
 * import batch, replacing the collection on import — are one-shot, hard-to-undo
 * moments. Before each, the store captures a {@link CollectionSnapshot} and
 * surfaces an "Undo" toast that restores it.
 *
 * Crucially the snapshot holds only the collection-owned slice. Deck card→copy
 * allocations and binder pins/exclusions are NOT snapshotted: they re-derive
 * deterministically from the restored `cards` (decks via
 * `useDecksStore.remapAllocations`, binders via `reconcileBinderRefs` against
 * their retained durable key shadow). This is the same self-healing path
 * `importCards` and `restoreFromBackup` already rely on, so restoring just the
 * collection slice reproduces the prior deck/binder state without threading
 * those entities through every undo.
 */
import type { EnrichedCard, ListDef } from '../types';
import type { ImportHistoryEntry } from './local-cards';

/** The restorable slice of collection state captured before a destructive op. */
export interface CollectionSnapshot {
  cards: EnrichedCard[];
  fileName: string;
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number | null;
  unresolvedNames: string[];
  detectedFormat: string;
  importHistory: ImportHistoryEntry[];
  lists: ListDef[];
}

/**
 * Capture the restorable collection slice from current state. Holds the array
 * references as-is — the store mutates immutably (every action replaces the
 * arrays rather than editing in place), so the captured references stay a valid
 * point-in-time view. Accepts any superset of {@link CollectionSnapshot} (e.g.
 * the full store state) and narrows it to the persisted fields.
 */
export function captureCollectionSnapshot(state: CollectionSnapshot): CollectionSnapshot {
  return {
    cards: state.cards,
    fileName: state.fileName,
    scryfallHits: state.scryfallHits,
    scryfallMisses: state.scryfallMisses,
    uploadedAt: state.uploadedAt,
    unresolvedNames: state.unresolvedNames,
    detectedFormat: state.detectedFormat,
    importHistory: state.importHistory,
    lists: state.lists,
  };
}

/**
 * Whether a snapshot holds anything worth restoring. Callers use this to skip
 * the "Undo" affordance when the op was effectively a no-op (e.g. clearing an
 * already-empty collection), so an empty toast never appears.
 */
export function snapshotHasContent(snap: CollectionSnapshot): boolean {
  return snap.cards.length > 0 || snap.importHistory.length > 0 || snap.lists.length > 0;
}
