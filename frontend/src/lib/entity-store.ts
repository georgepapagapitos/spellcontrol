/**
 * Per-entity IndexedDB shape. One object store per kind (imports / cards /
 * binders / decks / games / lists), each keyed by the entity's id. Replaces
 * the legacy single-blob `spellcontrol` DB whose whole-snapshot reads/writes
 * forced the sync layer into all-or-nothing semantics.
 *
 * Every row also carries the canonical server `rev` and a `deletedAt`
 * tombstone marker so:
 *   - the sync driver can rehydrate the in-memory stores from local state
 *     after a cold start (live rows only),
 *   - the cursor it advances corresponds to "the rev I have locally," and
 *   - a tombstone pulled from the server can be applied as a no-content
 *     row that filters out of any "live rows" read.
 *
 * The `rev` index speeds up the (rare) "recompute the latest rev I have"
 * boot path; the primary key is `id` so per-row reads remain O(1).
 */

import { openDB, type IDBPDatabase } from 'idb';
import { logger } from '@/lib/logger';

export const DB_NAME = 'spellcontrol-sync';
const DB_VERSION = 1;

export type EntityKind = 'import' | 'card' | 'binder' | 'deck' | 'game' | 'list';

const STORE_NAMES: Record<EntityKind, string> = {
  import: 'imports',
  card: 'cards',
  binder: 'binders',
  deck: 'decks',
  game: 'games',
  list: 'lists',
};

export const ALL_KINDS: EntityKind[] = ['import', 'card', 'binder', 'deck', 'game', 'list'];

export interface StoredRow {
  id: string;
  /** Entity payload — null when the row is a tombstone. */
  data: unknown;
  rev: number;
  /**
   * Last server rev this row was based on before a local edit dirtied it.
   * `rev` is reset to 0 for pending writes, so reject-stale deck pushes need a
   * separate base rev that survives the local edit.
   */
  syncedRev?: number;
  /** ms epoch; null on live rows. */
  deletedAt: number | null;
  /** Only set on card rows. */
  importId?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of Object.values(STORE_NAMES)) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            store.createIndex('rev', 'rev');
            store.createIndex('deletedAt', 'deletedAt');
            if (name === STORE_NAMES.card) {
              store.createIndex('importId', 'importId');
            }
          }
        }
      },
    });
  }
  return dbPromise;
}

/** Test-only — drop the cached promise so the next call reopens. */
export function _resetDbPromiseForTests(): void {
  dbPromise = null;
}

function storeName(kind: EntityKind): string {
  return STORE_NAMES[kind];
}

/** Read every live (non-tombstoned) row for a kind. */
export async function getAllLive(kind: EntityKind): Promise<StoredRow[]> {
  const db = await getDB();
  const rows = (await db.getAll(storeName(kind))) as StoredRow[];
  return rows.filter((r) => r.deletedAt == null);
}

/** Read a single row by id, including tombstones (rare; mostly for tests). */
export async function getById(kind: EntityKind, id: string): Promise<StoredRow | undefined> {
  const db = await getDB();
  return (await db.get(storeName(kind), id)) as StoredRow | undefined;
}

/** Bulk upsert. Each row replaces any prior row with the same id. */
export async function putMany(kind: EntityKind, rows: StoredRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(storeName(kind), 'readwrite');
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
}

/**
 * Apply a tombstone (no payload kept on the client — once we know a row was
 * deleted the local data is dead weight). Uses the server's `rev`/`deletedAt`
 * so the cursor advances past this tombstone on its next pull.
 */
export async function putTombstone(
  kind: EntityKind,
  id: string,
  rev: number,
  deletedAt: number
): Promise<void> {
  const db = await getDB();
  await db.put(storeName(kind), { id, data: null, rev, deletedAt });
}

/**
 * Apply many tombstones in ONE transaction per kind — the batched form of
 * putTombstone. Applying server deletions one-at-a-time opened a fresh IDB
 * transaction per row, which crawled when a delta carried thousands of
 * tombstones (large/heavily-edited accounts catching up).
 */
export async function putTombstones(
  kind: EntityKind,
  rows: Array<{ id: string; rev: number; deletedAt: number }>
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(storeName(kind), 'readwrite');
  await Promise.all(
    rows.map((r) => tx.store.put({ id: r.id, data: null, rev: r.rev, deletedAt: r.deletedAt }))
  );
  await tx.done;
}

/** Hard-delete a row by id. Used on logout / boot wipe, not on tombstone apply. */
export async function deleteMany(kind: EntityKind, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(storeName(kind), 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

/** Drop every row in every store. Used by logout / boot wipe. */
export async function wipeAll(): Promise<void> {
  const db = await getDB();
  const names = Object.values(STORE_NAMES);
  const tx = db.transaction(names as unknown as string[], 'readwrite');
  await Promise.all(names.map((n) => tx.objectStore(n).clear()));
  await tx.done;
}

/**
 * One-time legacy IDB cleanup. Pre-rewrite, synced data lived in two places:
 *   - `spellcontrol` DB / `collection` store: the cards blob (one record at
 *     key `current`, written by the old `local-cards.ts`).
 *   - `spellcontrol-decks` DB: zustand-persist's IDB storage for the decks
 *     store (`createIndexedDbStorage('spellcontrol-decks')`).
 *
 * After the per-row sync rewrite, both are dead weight — entity-store
 * (`spellcontrol-sync`) is the canonical local cache. Leaving them around
 * means zustand-persist would still hydrate stale decks on every boot,
 * racing sync.ts's rehydrate. Delete both on first boot of the new client.
 * No-op if they're already gone. Safe to remove in a follow-up PR once we
 * can confirm everyone has upgraded.
 */
export async function deleteLegacyDatabasesOnce(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !('deleteDatabase' in indexedDB)) return;
  for (const name of ['spellcontrol', 'spellcontrol-decks']) {
    try {
      indexedDB.deleteDatabase(name);
    } catch (err) {
      logger.warn(`[entity-store] legacy IDB cleanup (${name}) failed (non-fatal):`, err);
    }
  }
}
