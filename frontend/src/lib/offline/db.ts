import { openDB, type IDBPDatabase } from 'idb';
import type { OfflineCombo, OfflineManifest, SlimCard } from './types';
import { frontFaceName } from '@/lib/cards/card-text';

/**
 * Dedicated IndexedDB database for the offline oracle/combo snapshot.
 *
 * Kept separate from `spellcontrol` (the user's collection database) so the
 * offline-mode toggle can fully wipe its data — including the schema upgrade
 * history — without touching the user's owned cards. The dataset is large
 * (oracle ~30MB raw across ~30k rows) so we use a real object-store + indexes,
 * not a single-blob put.
 */
const DB_NAME = 'spellcontrol-offline';
const DB_VERSION = 1;

const STORE_CARDS = 'cards';
const STORE_NAMES = 'cards_by_name'; // lowercase-name -> oracleId secondary index store
const STORE_COMBOS = 'combos';
const STORE_META = 'meta';

const META_MANIFEST_KEY = 'manifest';
// Version of the combos-only cache (see ensure-combos.ts). Tracked separately
// from META_MANIFEST_KEY so the lightweight combos-only path never corrupts the
// full offline-mode manifest (which also gates the oracle-card cache).
const META_COMBOS_VERSION_KEY = 'combos-standalone-version';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_CARDS)) {
          // Key path is `oracleId` — every SlimCard has one.
          db.createObjectStore(STORE_CARDS, { keyPath: 'oracleId' });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES)) {
          // Standalone store mapping lowercase canonical name -> oracleId.
          // Built post-insert during downloadAndStore so we can resolve
          // by-name searches without an inline index (inline indexes on
          // SlimCard would bloat IDB and we want to support multi-face
          // alias names cheaply).
          db.createObjectStore(STORE_NAMES);
        }
        if (!db.objectStoreNames.contains(STORE_COMBOS)) {
          db.createObjectStore(STORE_COMBOS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

const INSERT_BATCH = 1000;

/** Replace the entire oracle dataset. Wipes the existing cards/name stores first. */
export async function replaceOracleCards(
  cards: SlimCard[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const db = await getDB();

  // Clear in a single tx so a failed clear doesn't leave a stale shard behind.
  {
    const tx = db.transaction([STORE_CARDS, STORE_NAMES], 'readwrite');
    await Promise.all([tx.objectStore(STORE_CARDS).clear(), tx.objectStore(STORE_NAMES).clear()]);
    await tx.done;
  }

  // Insert in batches to keep individual transactions small and let the event
  // loop breathe between chunks.
  for (let i = 0; i < cards.length; i += INSERT_BATCH) {
    const slice = cards.slice(i, i + INSERT_BATCH);
    const tx = db.transaction([STORE_CARDS, STORE_NAMES], 'readwrite');
    const cardStore = tx.objectStore(STORE_CARDS);
    const nameStore = tx.objectStore(STORE_NAMES);
    for (const card of slice) {
      cardStore.put(card);
      const primary = card.name.toLowerCase();
      nameStore.put(card.oracleId, primary);
      // For DFCs, also index by the front face so EDHREC-style lookups match.
      if (card.faces && card.faces.length >= 1) {
        const front = card.faces[0]?.name?.toLowerCase();
        if (front && front !== primary) nameStore.put(card.oracleId, front);
      }
      // Split-card front halves (e.g. "Fire" from "Fire // Ice")
      if (card.name.includes(' // ')) {
        const front = frontFaceName(card.name).toLowerCase();
        if (front && front !== primary) nameStore.put(card.oracleId, front);
      }
    }
    await tx.done;
    onProgress?.(Math.min(i + INSERT_BATCH, cards.length), cards.length);
  }
}

/**
 * Bumped by every combo-store write in this process. `combo-index.ts` keeps a
 * per-session copy of its index in memory and uses this (plus the dataset
 * version and row count) to know when that copy is stale — a test that
 * rewrites the store between cases, or an in-tab import, invalidates it
 * without a hook. Writes from another context (the import worker) change the
 * version stamp instead, which the same check also sees.
 */
let comboWriteGeneration = 0;
export function getComboWriteGeneration(): number {
  return comboWriteGeneration;
}

export async function replaceCombos(combos: OfflineCombo[]): Promise<void> {
  comboWriteGeneration++;
  const db = await getDB();
  {
    const tx = db.transaction(STORE_COMBOS, 'readwrite');
    await tx.objectStore(STORE_COMBOS).clear();
    await tx.done;
  }
  for (let i = 0; i < combos.length; i += INSERT_BATCH) {
    await appendCombos(combos.slice(i, i + INSERT_BATCH));
  }
}

/** Upsert a batch of combos by id (one transaction). Streaming import's write step. */
export async function appendCombos(combos: OfflineCombo[]): Promise<void> {
  if (combos.length === 0) return;
  comboWriteGeneration++;
  const db = await getDB();
  const tx = db.transaction(STORE_COMBOS, 'readwrite');
  const store = tx.objectStore(STORE_COMBOS);
  for (const c of combos) store.put(c);
  await tx.done;
}

/**
 * Delete every combo whose id is not in `keep` — the streaming import's final
 * step, so rows the dataset dropped upstream don't linger. Keys only; never
 * reads the values.
 */
export async function pruneCombosNotIn(keep: ReadonlySet<string>): Promise<number> {
  comboWriteGeneration++;
  const db = await getDB();
  const keys = (await db.getAllKeys(STORE_COMBOS)) as string[];
  const stale = keys.filter((k) => !keep.has(k));
  for (let i = 0; i < stale.length; i += INSERT_BATCH) {
    const tx = db.transaction(STORE_COMBOS, 'readwrite');
    const store = tx.objectStore(STORE_COMBOS);
    for (const k of stale.slice(i, i + INSERT_BATCH)) store.delete(k);
    await tx.done;
  }
  return stale.length;
}

export async function getCardByOracleId(oracleId: string): Promise<SlimCard | null> {
  const db = await getDB();
  const row = (await db.get(STORE_CARDS, oracleId)) as SlimCard | undefined;
  return row ?? null;
}

export async function getCardsByOracleIds(oracleIds: string[]): Promise<Map<string, SlimCard>> {
  const out = new Map<string, SlimCard>();
  if (oracleIds.length === 0) return out;
  const db = await getDB();
  const tx = db.transaction(STORE_CARDS, 'readonly');
  const store = tx.objectStore(STORE_CARDS);
  await Promise.all(
    oracleIds.map(async (id) => {
      const row = (await store.get(id)) as SlimCard | undefined;
      if (row) out.set(id, row);
    })
  );
  await tx.done;
  return out;
}

/** Resolve a card by exact (case-insensitive) name. Returns null if not found. */
export async function getCardByName(name: string): Promise<SlimCard | null> {
  const db = await getDB();
  const oracleId = (await db.get(STORE_NAMES, name.toLowerCase())) as string | undefined;
  if (!oracleId) return null;
  return ((await db.get(STORE_CARDS, oracleId)) as SlimCard | undefined) ?? null;
}

/**
 * Iterate every card in the offline dataset, yielding in batches so a heavy
 * search can stay incremental. Caller is expected to filter aggressively.
 */
export async function* iterateAllCards(): AsyncGenerator<SlimCard, void, unknown> {
  const db = await getDB();
  const tx = db.transaction(STORE_CARDS, 'readonly');
  let cursor = await tx.objectStore(STORE_CARDS).openCursor();
  while (cursor) {
    yield cursor.value as SlimCard;
    cursor = await cursor.continue();
  }
}

/**
 * Page size for reading the combo store back. Firefox rejects any single
 * `getAll` whose response serializes past its IPC cap (256 MiB − 10 MiB
 * overhead ≈ 246 MiB) with "The serialized value is too large" — and the
 * whole dataset (107k rows, 163 MB raw JSON) now serializes past it, so one
 * `getAll()` fails outright and every combo surface errored. 10 000 rows is
 * roughly 15 MB a page (~30 MB of heap while a matcher scans it): 11 round
 * trips for the whole store, nowhere near the cap. Measured 2026-09-09: 5000
 * cost Firefox +1.1 s per warm match over the single read; this halves that.
 */
const READ_BATCH = 10_000;

/**
 * Yield the combo store in key-ordered pages. Consumers that scan the whole
 * dataset (the matchers) hold one page at a time, so a match costs one page of
 * heap rather than the whole dataset (measured 2026-09-09: 391 MB peak with
 * everything materialized).
 */
export async function* iterateComboPages(): AsyncGenerator<OfflineCombo[], void, unknown> {
  const db = await getDB();
  const read = (after?: IDBKeyRange) =>
    db.getAll(STORE_COMBOS, after, READ_BATCH) as Promise<OfflineCombo[]>;
  let next = read();
  for (;;) {
    const page = await next;
    if (page.length < READ_BATCH) {
      if (page.length > 0) yield page;
      return;
    }
    // Kick off the next read before handing this page to the consumer, so the
    // IDB round trip overlaps the consumer's scan instead of serializing with it.
    next = read(IDBKeyRange.lowerBound(page[page.length - 1].id, true));
    yield page;
  }
}

export async function getAllCombos(): Promise<OfflineCombo[]> {
  const out: OfflineCombo[] = [];
  for await (const page of iterateComboPages()) for (const c of page) out.push(c);
  return out;
}

/**
 * Full rows for a handful of ids — how the matcher hydrates its results now
 * that the scan itself runs over the compact index (combo-index.ts). One
 * readonly transaction; ids the store does not have are skipped.
 */
export async function getCombosByIds(ids: readonly string[]): Promise<Map<string, OfflineCombo>> {
  const out = new Map<string, OfflineCombo>();
  if (ids.length === 0) return out;
  const db = await getDB();
  const tx = db.transaction(STORE_COMBOS, 'readonly');
  const rows = await Promise.all(
    ids.map((id) => tx.store.get(id) as Promise<OfflineCombo | undefined>)
  );
  await tx.done;
  for (const row of rows) if (row) out.set(row.id, row);
  return out;
}

const META_COMBO_INDEX_KEY = 'combo-index';

/** The persisted match index (combo-index.ts), or null if never built. */
export async function readComboIndexRow<T>(): Promise<T | null> {
  const db = await getDB();
  return ((await db.get(STORE_META, META_COMBO_INDEX_KEY)) as T | undefined) ?? null;
}

export async function writeComboIndexRow(index: unknown): Promise<void> {
  const db = await getDB();
  await db.put(STORE_META, index, META_COMBO_INDEX_KEY);
}

export async function readManifest(): Promise<OfflineManifest | null> {
  const db = await getDB();
  return ((await db.get(STORE_META, META_MANIFEST_KEY)) as OfflineManifest | undefined) ?? null;
}

export async function writeManifest(manifest: OfflineManifest): Promise<void> {
  const db = await getDB();
  await db.put(STORE_META, manifest, META_MANIFEST_KEY);
}

/** Version of the combos-only cache, or null if it was never populated. */
export async function readStandaloneCombosVersion(): Promise<string | null> {
  const db = await getDB();
  return ((await db.get(STORE_META, META_COMBOS_VERSION_KEY)) as string | undefined) ?? null;
}

export async function writeStandaloneCombosVersion(version: string): Promise<void> {
  const db = await getDB();
  await db.put(STORE_META, version, META_COMBOS_VERSION_KEY);
}

export async function clearOfflineData(): Promise<void> {
  comboWriteGeneration++;
  const db = await getDB();
  const tx = db.transaction([STORE_CARDS, STORE_NAMES, STORE_COMBOS, STORE_META], 'readwrite');
  await Promise.all([
    tx.objectStore(STORE_CARDS).clear(),
    tx.objectStore(STORE_NAMES).clear(),
    tx.objectStore(STORE_COMBOS).clear(),
    tx.objectStore(STORE_META).clear(),
  ]);
  await tx.done;
}

/** Counts for the settings UI — cheap; runs against the keys index. */
export async function getOfflineDataStats(): Promise<{ cardCount: number; comboCount: number }> {
  const db = await getDB();
  const [cardCount, comboCount] = await Promise.all([
    db.count(STORE_CARDS),
    db.count(STORE_COMBOS),
  ]);
  return { cardCount, comboCount };
}
