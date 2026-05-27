/**
 * Compatibility shim over the per-entity sync layer.
 *
 * Pre-rewrite this module owned its own IndexedDB database (`spellcontrol`,
 * one object store `collection` keyed by a single record) and the sync layer
 * round-tripped the whole blob. After the per-row sync rewrite, those calls
 * are delegated to `entity-store` (one IDB store per kind, keyed by id) and
 * actual sync push/pull lives in `lib/sync.ts`. The types stay here so
 * existing consumers (UploadPanel, backup builder, reimport helper, store
 * subscribers, etc.) keep compiling unchanged.
 *
 * These wrappers do NOT enqueue mutations — that's the responsibility of the
 * Zustand store subscribers (registered at the end of each store file) which
 * watch in-memory state changes and call the appropriate persistXxxState
 * helper from `lib/sync.ts`. saveCollection/clearCollection here only touch
 * local IDB; they're now equivalent to "update the local cache."
 */

import * as estore from './entity-store';
import type { EnrichedCard, ListDef } from '../types';

export interface ImportHistoryEntry {
  /**
   * Stable identifier for this import. Cards added by the import are stamped
   * with the same id so a user can delete just this batch later.
   */
  id: string;
  /** Source file name or "pasted-list". */
  name: string;
  /** Number of cards added by this individual import. */
  count: number;
  /** Detected parser format (manabox / archidekt / mtga / plain / etc). */
  format: string;
  /** Wall-clock time of the import (ms). */
  addedAt: number;
  /** Marks imports added via the "try a sample set" buttons. */
  isSample?: boolean;
}

export interface StoredCollection {
  fileName: string;
  cards: EnrichedCard[];
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number;
  importHistory: ImportHistoryEntry[];
  /** User-defined lists of unowned cards. */
  lists: ListDef[];
}

/**
 * Local cache write. Updates the per-entity IDB rows so a subsequent reload
 * sees the same state without waiting on a server pull. Does NOT enqueue
 * sync mutations — the store's subscriber does that when in-memory state
 * actually changes.
 */
export async function saveCollection(data: StoredCollection): Promise<void> {
  await Promise.all([
    estore.putMany(
      'card',
      data.cards.map((c) => ({
        id: c.copyId,
        data: c,
        rev: 0,
        deletedAt: null,
        importId: c.importId ?? '',
      }))
    ),
    estore.putMany(
      'import',
      data.importHistory.map((i) => ({ id: i.id, data: i, rev: 0, deletedAt: null }))
    ),
    estore.putMany(
      'list',
      data.lists.map((l) => ({ id: l.id, data: l, rev: 0, deletedAt: null }))
    ),
  ]);
}

/**
 * Read the local cache. Returns null when there's nothing stored — e.g.
 * a fresh install, or a logged-out / wiped device. Synthesizes the legacy
 * blob shape from the per-entity rows so consumers that destructured
 * `{ cards, importHistory, lists }` keep working unchanged.
 */
export async function loadCollection(): Promise<StoredCollection | null> {
  const [cards, imports, lists] = await Promise.all([
    estore.getAllLive('card'),
    estore.getAllLive('import'),
    estore.getAllLive('list'),
  ]);
  if (cards.length === 0 && imports.length === 0 && lists.length === 0) return null;
  return {
    fileName: '',
    cards: cards.map((r) => r.data) as EnrichedCard[],
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: Date.now(),
    importHistory: imports.map((r) => r.data) as ImportHistoryEntry[],
    lists: lists.map((r) => r.data) as ListDef[],
  };
}

/**
 * Drop the local cache. Used during destructive flows (logout, "clear
 * collection" without an account). After clearing, the store subscriber's
 * next persistXxxState call will enqueue any subsequent in-memory state as
 * fresh upserts — so this is safe to call on a still-authed user; their
 * data won't be lost from the server.
 */
export async function clearCollection(): Promise<void> {
  const [cards, imports, lists] = await Promise.all([
    estore.getAllLive('card'),
    estore.getAllLive('import'),
    estore.getAllLive('list'),
  ]);
  await Promise.all([
    estore.deleteMany(
      'card',
      cards.map((r) => r.id)
    ),
    estore.deleteMany(
      'import',
      imports.map((r) => r.id)
    ),
    estore.deleteMany(
      'list',
      lists.map((r) => r.id)
    ),
  ]);
}
