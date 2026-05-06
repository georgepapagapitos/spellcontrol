import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ScryfallCard } from './types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * SQLite-backed cache for Scryfall card data, keyed by Scryfall ID.
 * Uses synchronous better-sqlite3 — fine at our request volumes and avoids callback noise.
 */
export class ScryfallCache {
  private db: Database.Database;
  private setStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        scryfall_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_at ON cards(cached_at);
    `);

    this.setStmt = this.db.prepare(
      'INSERT OR REPLACE INTO cards (scryfall_id, data, cached_at) VALUES (?, ?, ?)'
    );
  }

  /**
   * Returns map of scryfallId -> card for all fresh hits. Misses are simply omitted.
   */
  getMany(scryfallIds: string[]): Map<string, ScryfallCard> {
    if (scryfallIds.length === 0) return new Map();

    const placeholders = scryfallIds.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT scryfall_id, data, cached_at FROM cards WHERE scryfall_id IN (${placeholders})`
    );
    const rows = stmt.all(...scryfallIds) as Array<{
      scryfall_id: string;
      data: string;
      cached_at: number;
    }>;

    const result = new Map<string, ScryfallCard>();
    const now = Date.now();
    for (const row of rows) {
      if (now - row.cached_at > TTL_MS) continue;
      try {
        result.set(row.scryfall_id, JSON.parse(row.data));
      } catch {
        /* skip malformed */
      }
    }
    return result;
  }

  /** Bulk insert/update — wrapped in a transaction for performance. */
  setMany(cards: ScryfallCard[]): void {
    const insert = this.db.transaction((items: ScryfallCard[]) => {
      const now = Date.now();
      for (const card of items) {
        this.setStmt.run(card.id, JSON.stringify(card), now);
      }
    });
    insert(cards);
  }

  stats(): { total: number; fresh: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as n FROM cards').get() as { n: number }).n;
    const fresh = (
      this.db
        .prepare('SELECT COUNT(*) as n FROM cards WHERE cached_at > ?')
        .get(Date.now() - TTL_MS) as { n: number }
    ).n;
    return { total, fresh };
  }

  close(): void {
    this.db.close();
  }
}
