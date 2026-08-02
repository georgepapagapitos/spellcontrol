/**
 * Disk-backed mirror of the Scryfall client's in-memory card cache.
 *
 * The in-memory `Map` in `client.ts` dies with the tab, so every reload, every
 * new tab and every cold deck generation re-fetched cards we already had —
 * which is the single biggest source of the 429s we keep eating. The cheapest
 * request is the one that never happens.
 *
 * Deliberately its OWN database, not `spellcontrol-sync`: this is public
 * reference data, identical for every user, so it must survive logout and must
 * never be pushed anywhere. Same reasoning as the offline oracle snapshot,
 * which is likewise a standalone DB.
 *
 * Keys are exactly the client's cache keys (a card name, `name|set`, a Scryfall
 * id, or an `upgrade|filters|name` printing-upgrade entry) — this store makes no
 * assumptions about their shape.
 *
 * Every function here is best-effort and never throws: IndexedDB can be absent
 * (node tests), blocked (private browsing, some WebViews), or full. A dead cache
 * must only cost us the network request we would have made anyway.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { logger } from '@/lib/logger';
import type { ScryfallCard } from '@/deck-builder/types';

const DB_NAME = 'spellcontrol-scryfall-cache';
const DB_VERSION = 1;
const STORE = 'cards';

/** Matches the backend's SQLite Scryfall cache TTL, so both layers age alike. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard ceiling so the DB can't grow without bound. TTL keeps normal use far
 *  below this; the cap only bites for a heavy long-term user. */
const MAX_ENTRIES = 8000;
/** Writes are batched — a deck generation resolves hundreds of cards, and one
 *  IDB transaction per card would be slower than the fetch it saves. */
const FLUSH_DELAY_MS = 1000;
/** Keys per read transaction — see `readCachedCards`. */
const READ_CHUNK = 500;

interface CachedCard {
  key: string;
  card: ScryfallCard;
  cachedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
let unavailable = false;
let pruned = false;

function getDB(): Promise<IDBPDatabase> | null {
  if (unavailable) return null;
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    unavailable = true;
    return null;
  }
  try {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('cachedAt', 'cachedAt');
        }
      },
    });
  } catch (err) {
    unavailable = true;
    logger.warn('[scryfall-cache] IndexedDB unavailable; using in-memory only', err);
    return null;
  }
  // Reclaim space once per session. Fire-and-forget: nothing waits on it.
  if (!pruned) {
    pruned = true;
    void prune();
  }
  return dbPromise;
}

/**
 * Drop expired rows (reads already ignore them, so this only frees disk), then
 * hard-cap the store to its newest N. Cheap — `cachedAt` is indexed.
 */
async function prune(): Promise<void> {
  try {
    const db = await dbPromise;
    if (!db) return;
    const cutoff = Date.now() - TTL_MS;
    {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.store.index('cachedAt');
      let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    }

    const count = await db.count(STORE);
    if (count > MAX_ENTRIES) {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.store.index('cachedAt');
      let remaining = count - MAX_ENTRIES;
      let cursor = await index.openCursor();
      while (cursor && remaining > 0) {
        await cursor.delete();
        remaining -= 1;
        cursor = await cursor.continue();
      }
      await tx.done;
    }
  } catch (err) {
    // Prune is housekeeping — a failure here must never affect reads or writes.
    logger.debug('[scryfall-cache] prune skipped', err);
  }
}

/**
 * Bulk-read the given keys, returning only entries that are present AND fresh.
 * Absent keys are simply missing from the map — callers fetch those.
 */
export async function readCachedCards(keys: string[]): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const db = await getDB();
  if (!db || keys.length === 0) return result;
  const cutoff = Date.now() - TTL_MS;
  // Chunked: a cube resolve asks about every unique name a player owns (10k+),
  // and that's exactly the path that got us throttled. One transaction per
  // chunk keeps each one short and makes a mid-read failure partial, not total.
  for (let i = 0; i < keys.length; i += READ_CHUNK) {
    const chunk = keys.slice(i, i + READ_CHUNK);
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rows = await Promise.all(chunk.map((key) => tx.store.get(key) as Promise<CachedCard>));
      await tx.done;
      for (const row of rows) {
        if (row && row.cachedAt > cutoff) result.set(row.key, row.card);
      }
    } catch (err) {
      logger.debug('[scryfall-cache] read failed', err);
    }
  }
  return result;
}

const pendingWrites = new Map<string, ScryfallCard>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue a card for persistence. Returns immediately — callers never await disk. */
export function persistCard(key: string, card: ScryfallCard): void {
  if (unavailable) return;
  pendingWrites.set(key, card);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPersistedCards();
  }, FLUSH_DELAY_MS);
}

let quotaWarned = false;

/** Write everything queued so far. Safe to call at any time; no-ops when empty. */
export async function flushPersistedCards(): Promise<void> {
  if (pendingWrites.size === 0) return;
  const batch = [...pendingWrites];
  pendingWrites.clear();
  const db = await getDB();
  if (!db) return;
  try {
    const cachedAt = Date.now();
    const tx = db.transaction(STORE, 'readwrite');
    await Promise.all(batch.map(([key, card]) => tx.store.put({ key, card, cachedAt })));
    await tx.done;
  } catch (err) {
    // Quota exhaustion is the expected failure. Don't re-queue — the next
    // resolve will re-offer these cards anyway, and a retry loop against a full
    // disk just burns time.
    if (!quotaWarned) {
      quotaWarned = true;
      logger.warn('[scryfall-cache] write failed (quota or DB error)', err);
    }
  }
}

/** Test-only — drop connection + queue state so each test starts clean. */
export function _resetCacheForTests(): void {
  // Close first: an open connection blocks `indexedDB.deleteDatabase` forever,
  // so a test that reset without closing hung the whole file.
  void dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  unavailable = false;
  pruned = false;
  quotaWarned = false;
  pendingWrites.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
