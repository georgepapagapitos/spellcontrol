/**
 * Compatibility shim over the per-entity sync layer.
 *
 * Pre-rewrite this module owned its own IndexedDB database (`spellcontrol`,
 * one object store `collection` keyed by a single record) and the sync layer
 * round-tripped the whole blob. After the per-row sync rewrite, the storage
 * and the wire-sync both live in `lib/sync.ts` (and its `entity-store` +
 * `mutation-queue` helpers). The types stay here so existing consumers
 * (UploadPanel, backup builder, reimport helper, store mutators, etc.) keep
 * compiling unchanged.
 *
 * `saveCollection` delegates to the `persistXxxState` helpers — those diff
 * the new in-memory shape against the local IDB, write the delta back, AND
 * enqueue per-row sync mutations. That last step is the critical one: it's
 * how a local change (add card, clear collection, etc.) reaches the server
 * and propagates to the user's other devices.
 */

import * as estore from './entity-store';
import * as sync from './sync';
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
 * Persist a collection snapshot. Writes the delta to the local entity-store
 * (so a refresh sees the same state immediately) AND enqueues per-row
 * upserts + tombstones to the sync queue — the diff against IDB is what
 * computes the deletions when a row disappears from the snapshot. Once
 * online, the sync driver drains the queue to the server, which is how a
 * change made on this device propagates to every other device.
 *
 * Each persistXxxState helper handles one entity kind end-to-end (IDB write
 * + queue enqueue + debounced push). The legacy callers pass the whole
 * StoredCollection blob; we decompose it into the per-kind helpers here.
 */
export async function saveCollection(data: StoredCollection): Promise<void> {
  await Promise.all([
    sync.persistCardsState(data.cards),
    sync.persistImportsState(data.importHistory),
    sync.persistListsState(data.lists),
  ]);
}

/**
 * Persist a set of cards whose price fields just changed, in bounded chunks.
 * Used by the price refresh, which can touch the whole collection (~12k copies)
 * at once — routing that through saveCollection→persistKind spiked memory enough
 * to OOM the native WebView. Only cards are written (a price refresh never
 * changes imports/lists), and there are no deletions to diff.
 */
export async function saveCardPrices(cards: EnrichedCard[]): Promise<void> {
  await sync.persistCardsChunked(cards);
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
 * Empty the collection (cards, imports, lists). For an authed user this
 * enqueues a tombstone for every removed row, so the deletion propagates
 * to every other device on its next pull. For a guest, the tombstones sit
 * in the local queue until they sign in and the queue drains.
 *
 * Implemented by handing empty arrays to the per-kind helpers — they diff
 * vs IDB and tombstone the difference, exactly matching the contract of
 * `saveCollection` with empty `cards`/`importHistory`/`lists`.
 */
export async function clearCollection(): Promise<void> {
  await Promise.all([
    sync.persistCardsState([]),
    sync.persistImportsState([]),
    sync.persistListsState([]),
  ]);
}
