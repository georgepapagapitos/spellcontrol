import { openDB, type IDBPDatabase } from 'idb';
import type { EnrichedCard } from '../types';

/**
 * IndexedDB-backed persistence for the most recent CSV upload.
 *
 * We use IndexedDB rather than localStorage because enriched collections (8000+ cards
 * with Scryfall data) routinely exceed localStorage's ~5MB limit. IndexedDB has a
 * generous quota (typically ~50% of available disk space).
 *
 * Schema: a single object store ("collection") with one record at key "current".
 * Replacing on upload is just `put` — we don't keep history.
 */

const DB_NAME = 'mtg-binder-planner';
const DB_VERSION = 1;
const STORE_NAME = 'collection';
const CURRENT_KEY = 'current';

export interface ImportHistoryEntry {
  /**
   * Stable identifier for this import. Cards added by the import are stamped
   * with the same id so a user can delete just this batch later. Optional for
   * back-compat with histories saved before this field existed.
   */
  id?: string;
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
  /**
   * History of imports that contributed to the current collection. After a
   * `replace` import this contains a single entry; after merges, one entry per
   * import in chronological order.
   */
  importHistory?: ImportHistoryEntry[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

/** Save the current collection, replacing any previous upload. */
export async function saveCollection(data: StoredCollection): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, data, CURRENT_KEY);
}

/** Load the most recent collection, or null if none exists. */
export async function loadCollection(): Promise<StoredCollection | null> {
  try {
    const db = await getDB();
    const result = (await db.get(STORE_NAME, CURRENT_KEY)) as StoredCollection | undefined;
    if (!result) return null;

    // Migrate older records that used `binderName` instead of `sourceCategory`.
    // Cheap inline transform — no need for a separate DB version bump.
    const migratedCards = result.cards.map((c) => {
      const anyCard = c as unknown as Record<string, unknown>;
      if ('binderName' in anyCard && !('sourceCategory' in anyCard)) {
        anyCard.sourceCategory = anyCard.binderName;
        delete anyCard.binderName;
      }
      if (!('sourceFormat' in anyCard)) {
        anyCard.sourceFormat = 'manabox'; // older imports were always ManaBox
      }
      if (!c.copyId) {
        c.copyId = crypto.randomUUID();
      }
      if (!('finish' in anyCard)) {
        anyCard.finish = c.foil ? 'foil' : 'nonfoil';
      }
      return c;
    });

    return { ...result, cards: migratedCards };
  } catch (err) {
    console.warn('[local-cards] Failed to load collection from IndexedDB:', err);
    throw new Error(
      'Could not load your saved collection. This can happen in private browsing mode or if storage is full.'
    );
  }
}

/** Wipe the stored collection. */
export async function clearCollection(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, CURRENT_KEY);
}
