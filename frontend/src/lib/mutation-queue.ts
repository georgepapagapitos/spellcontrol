/**
 * Durable FIFO queue of pending sync mutations. The store mutators enqueue
 * `{ op, kind, id, data?, importId? }` records right after they update
 * in-memory state; the sync driver drains the queue with `peekBatch` and
 * `ack` after a successful POST. Survives a reload so a mutation issued
 * offline is still pushed on the next online window.
 *
 * One IndexedDB object store, keyed by an auto-incrementing integer (`seq`)
 * so ordering is preserved. Operations sit in the queue regardless of which
 * user is authed — the driver guarantees it only fires push() while a
 * session is active.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'spellcontrol-sync-queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

export type EntityKind = 'import' | 'card' | 'binder' | 'deck' | 'game' | 'list';

export type Mutation =
  | {
      op: 'upsert';
      kind: EntityKind;
      id: string;
      data: unknown;
      importId?: string;
      clientRev?: number;
    }
  | { op: 'delete'; kind: EntityKind; id: string };

export interface QueuedMutation {
  /** Auto-assigned by IDB. Strictly increasing. */
  seq: number;
  m: Mutation;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'seq', autoIncrement: true });
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

/**
 * Coalesce: if the latest queued entry targets the same (kind, id) as `m`,
 * replace it instead of appending. Cheap to do, dramatically shrinks the
 * queue when a user is rapidly editing the same row (e.g. adjusting a
 * deck slot's quantity). The semantics still hold — a later op replaces an
 * earlier one at the same target — and we'd send only the latest anyway.
 *
 * NOT applied across a delete: an `upsert → delete` pair on the same target
 * stays as two entries because the server-side cascade behavior for `delete`
 * (cards under an import etc.) shouldn't be smuggled into an "upsert".
 */
export async function enqueue(m: Mutation): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  // Peek the last entry by walking the cursor in reverse.
  const cursor = await tx.store.openCursor(null, 'prev');
  if (cursor && cursor.value) {
    const last = cursor.value as QueuedMutation;
    if (
      last.m.op === 'upsert' &&
      m.op === 'upsert' &&
      last.m.kind === m.kind &&
      last.m.id === m.id
    ) {
      const next =
        last.m.kind === 'deck' && last.m.clientRev !== undefined
          ? { ...m, clientRev: last.m.clientRev }
          : m;
      await cursor.update({ seq: last.seq, m: next });
      await tx.done;
      return;
    }
  }
  await tx.store.add({ m });
  await tx.done;
}

/** Enqueue many ops atomically. Used for bulk mutations (clear / import). */
export async function enqueueBatch(ms: Mutation[]): Promise<void> {
  if (ms.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const m of ms) await tx.store.add({ m });
  await tx.done;
}

/** Read up to `limit` queued mutations in FIFO order without removing them. */
export async function peekBatch(limit: number): Promise<QueuedMutation[]> {
  if (limit <= 0) return [];
  const db = await getDB();
  const out: QueuedMutation[] = [];
  let cursor = await db.transaction(STORE_NAME, 'readonly').store.openCursor();
  while (cursor && out.length < limit) {
    out.push(cursor.value as QueuedMutation);
    cursor = await cursor.continue();
  }
  return out;
}

/** Remove the named seq entries (drained on a successful push). */
export async function ack(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all(seqs.map((s) => tx.store.delete(s)));
  await tx.done;
}

/** Number of queued ops. Cheap, used as an "anything to push?" signal. */
export async function size(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

/** Drop the entire queue. Logout, account switch, boot wipe. */
export async function clear(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE_NAME);
}
