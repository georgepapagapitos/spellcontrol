import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { HASH_BYTES, hammingDistance } from './phash';

/**
 * SQLite-backed store for the perceptual-hash database the card scanner uses.
 *
 * The full table is loaded into memory at startup — at ~90k entries × ~80
 * bytes/row that's roughly 7 MB of RAM, which is cheaper than paying the
 * SQLite round-trip cost on every scan. Hamming-distance match is a linear
 * scan; at 90k entries it runs in ~5 ms on a modest CPU, well below the
 * latency a user would notice on a scanner UI.
 *
 * The DB lives next to the existing scryfall cache (same directory) so the
 * Docker volume that already persists scryfall-cache.db automatically
 * persists this too.
 */

export interface HashEntry {
  scryfallId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  hash: Uint8Array;
}

export interface MatchResult {
  entry: HashEntry;
  /** Hamming distance in bits (0–64 for our 64-bit hashes). */
  distance: number;
}

export class PhashStore {
  private db: Database.Database;
  private entries: HashEntry[] = [];
  private upsertStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS card_phash (
        scryfall_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        set_code TEXT NOT NULL,
        collector_number TEXT NOT NULL,
        hash BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_phash_updated ON card_phash(updated_at);
    `);

    this.upsertStmt = this.db.prepare(
      `INSERT INTO card_phash
         (scryfall_id, name, set_code, collector_number, hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scryfall_id) DO UPDATE SET
         name = excluded.name,
         set_code = excluded.set_code,
         collector_number = excluded.collector_number,
         hash = excluded.hash,
         updated_at = excluded.updated_at`
    );

    this.reloadIntoMemory();
  }

  /**
   * Rebuilds the in-memory snapshot from disk. Called automatically by the
   * constructor and after large mutations; cheap enough at 90k rows that we
   * don't bother with finer-grained invalidation.
   */
  reloadIntoMemory(): void {
    try {
      const rows = this.db
        .prepare('SELECT scryfall_id, name, set_code, collector_number, hash FROM card_phash')
        .all() as Array<{
        scryfall_id: string;
        name: string;
        set_code: string;
        collector_number: string;
        hash: Buffer;
      }>;
      this.entries = rows.map((r) => ({
        scryfallId: r.scryfall_id,
        name: r.name,
        setCode: r.set_code,
        collectorNumber: r.collector_number,
        // Buffer extends Uint8Array — assignment is zero-copy.
        hash: r.hash as unknown as Uint8Array,
      }));
    } catch (err) {
      console.error('[phash-store] reload failed, in-memory snapshot empty:', err);
      this.entries = [];
    }
  }

  /**
   * Bulk upsert, wrapped in a transaction for ingest throughput. Keeps the
   * in-memory snapshot in sync incrementally so `search()` reflects writes
   * without an explicit reload — avoids re-scanning all 90k rows after every
   * ingest batch.
   */
  upsertMany(items: HashEntry[]): void {
    if (!Array.isArray(items) || items.length === 0) return;
    const now = Date.now();
    const accepted: HashEntry[] = [];
    const insert = this.db.transaction((rows: HashEntry[]) => {
      for (const r of rows) {
        if (r.hash.length !== HASH_BYTES) continue;
        this.upsertStmt.run(
          r.scryfallId,
          r.name,
          r.setCode,
          r.collectorNumber,
          Buffer.from(r.hash),
          now
        );
        accepted.push(r);
      }
    });
    insert(items);

    if (accepted.length === 0) return;
    const byId = new Map(this.entries.map((e, i) => [e.scryfallId, i] as const));
    for (const r of accepted) {
      const existing = byId.get(r.scryfallId);
      if (existing !== undefined) {
        this.entries[existing] = r;
      } else {
        byId.set(r.scryfallId, this.entries.length);
        this.entries.push(r);
      }
    }
  }

  /** Number of hashes currently loaded. */
  size(): number {
    return this.entries.length;
  }

  /**
   * Returns the top-K nearest matches to `query` (ascending distance). Linear
   * scan — fast enough at 90k entries that an index would be premature.
   */
  search(query: Uint8Array, k = 3): MatchResult[] {
    if (query.length !== HASH_BYTES || this.entries.length === 0) return [];
    // Maintain a running top-K instead of sorting the full list — at K=3 the
    // overhead vs an unsorted scan is negligible while avoiding a 90k sort.
    const top: MatchResult[] = [];
    let worstInTop = 65;
    for (const entry of this.entries) {
      const d = hammingDistance(query, entry.hash);
      if (top.length < k) {
        top.push({ entry, distance: d });
        if (top.length === k) {
          top.sort((a, b) => a.distance - b.distance);
          worstInTop = top[top.length - 1].distance;
        }
        continue;
      }
      if (d >= worstInTop) continue;
      top[top.length - 1] = { entry, distance: d };
      top.sort((a, b) => a.distance - b.distance);
      worstInTop = top[top.length - 1].distance;
    }
    if (top.length < k) top.sort((a, b) => a.distance - b.distance);
    return top;
  }

  close(): void {
    this.db.close();
  }
}
