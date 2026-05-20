import { openDB, type IDBPDatabase } from 'idb';
import type { OfflineCombo, OfflineManifest, SlimCard } from './types';

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
        const front = card.name.split(' // ')[0]?.toLowerCase();
        if (front && front !== primary) nameStore.put(card.oracleId, front);
      }
    }
    await tx.done;
    onProgress?.(Math.min(i + INSERT_BATCH, cards.length), cards.length);
  }
}

export async function replaceCombos(combos: OfflineCombo[]): Promise<void> {
  const db = await getDB();
  {
    const tx = db.transaction(STORE_COMBOS, 'readwrite');
    await tx.objectStore(STORE_COMBOS).clear();
    await tx.done;
  }
  for (let i = 0; i < combos.length; i += INSERT_BATCH) {
    const slice = combos.slice(i, i + INSERT_BATCH);
    const tx = db.transaction(STORE_COMBOS, 'readwrite');
    const store = tx.objectStore(STORE_COMBOS);
    for (const c of slice) store.put(c);
    await tx.done;
  }
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

export async function getAllCombos(): Promise<OfflineCombo[]> {
  const db = await getDB();
  return (await db.getAll(STORE_COMBOS)) as OfflineCombo[];
}

export async function readManifest(): Promise<OfflineManifest | null> {
  const db = await getDB();
  return ((await db.get(STORE_META, META_MANIFEST_KEY)) as OfflineManifest | undefined) ?? null;
}

export async function writeManifest(manifest: OfflineManifest): Promise<void> {
  const db = await getDB();
  await db.put(STORE_META, manifest, META_MANIFEST_KEY);
}

export async function clearOfflineData(): Promise<void> {
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
