import { logger } from './logger';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ScryfallCard } from './types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * SQLite-backed cache for Scryfall card data, keyed by Scryfall ID.
 * Uses synchronous better-sqlite3 — fine at our request volumes and avoids callback noise.
 *
 * A second table, `card_lookups`, maps the stable identifier key used during import
 * (e.g. `n:sol ring`, `ns:sol ring|cmr`, `nsc:sol ring|cmr|472`) to a resolved
 * scryfall_id. Without it, name/set/collector lookups — the shape produced by
 * Moxfield / Archidekt / Deckbox / generic CSV / text lists — could never hit the
 * cache (the `cards` table is keyed by ID), so re-importing the identical file
 * re-fetched every card from Scryfall. The lookup layer makes those re-imports
 * resolve locally.
 */
export class ScryfallCache {
  private db: Database.Database;
  private setStmt: Database.Statement;
  private setLookupStmt: Database.Statement;

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
      CREATE TABLE IF NOT EXISTS card_lookups (
        lookup_key TEXT PRIMARY KEY,
        scryfall_id TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lookups_cached_at ON card_lookups(cached_at);
    `);

    this.setStmt = this.db.prepare(
      'INSERT OR REPLACE INTO cards (scryfall_id, data, cached_at) VALUES (?, ?, ?)'
    );
    this.setLookupStmt = this.db.prepare(
      'INSERT OR REPLACE INTO card_lookups (lookup_key, scryfall_id, cached_at) VALUES (?, ?, ?)'
    );
  }

  /**
   * Returns map of scryfallId -> card for all fresh hits. Misses are simply omitted.
   */
  getMany(scryfallIds: string[]): Map<string, ScryfallCard> {
    if (scryfallIds.length === 0) return new Map();

    try {
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
    } catch (err) {
      logger.error('[cache] getMany failed, treating as cache miss:', err);
      return new Map();
    }
  }

  /**
   * Resolves identifier keys (name/set/collector lookups) to cards via the
   * `card_lookups` alias table joined to `cards`. Returns a map of lookup_key ->
   * card for every fresh hit; misses (unknown key, stale alias, or stale/missing
   * underlying card) are omitted. Both the alias row and the card row must be
   * within the TTL for a hit.
   */
  getManyByKeys(keys: string[]): Map<string, ScryfallCard> {
    if (keys.length === 0) return new Map();

    try {
      const placeholders = keys.map(() => '?').join(',');
      const stmt = this.db.prepare(
        `SELECT l.lookup_key AS lookup_key, c.data AS data, l.cached_at AS lookup_cached_at,
                c.cached_at AS card_cached_at
           FROM card_lookups l
           JOIN cards c ON c.scryfall_id = l.scryfall_id
          WHERE l.lookup_key IN (${placeholders})`
      );
      const rows = stmt.all(...keys) as Array<{
        lookup_key: string;
        data: string;
        lookup_cached_at: number;
        card_cached_at: number;
      }>;

      const result = new Map<string, ScryfallCard>();
      const now = Date.now();
      for (const row of rows) {
        if (now - row.lookup_cached_at > TTL_MS) continue;
        if (now - row.card_cached_at > TTL_MS) continue;
        try {
          result.set(row.lookup_key, JSON.parse(row.data));
        } catch {
          /* skip malformed */
        }
      }
      return result;
    } catch (err) {
      logger.error('[cache] getManyByKeys failed, treating as cache miss:', err);
      return new Map();
    }
  }

  /**
   * Records identifier-key -> scryfall_id aliases so a future name/set/collector
   * lookup can resolve from cache. Call after the corresponding cards have been
   * persisted via {@link setMany}.
   */
  setLookups(entries: Array<{ key: string; scryfallId: string }>): void {
    if (entries.length === 0) return;
    try {
      const insert = this.db.transaction((items: Array<{ key: string; scryfallId: string }>) => {
        const now = Date.now();
        for (const { key, scryfallId } of items) {
          this.setLookupStmt.run(key, scryfallId, now);
        }
      });
      insert(entries);
    } catch (err) {
      logger.error('[cache] setLookups failed, aliases will not be cached:', err);
    }
  }

  /** Bulk insert/update — wrapped in a transaction for performance. */
  setMany(cards: ScryfallCard[]): void {
    try {
      const insert = this.db.transaction((items: ScryfallCard[]) => {
        const now = Date.now();
        for (const card of items) {
          this.setStmt.run(card.id, JSON.stringify(card), now);
        }
      });
      insert(cards);
    } catch (err) {
      logger.error('[cache] setMany failed, cards will not be cached:', err);
    }
  }

  stats(): { total: number; fresh: number } {
    try {
      const total = (this.db.prepare('SELECT COUNT(*) as n FROM cards').get() as { n: number }).n;
      const fresh = (
        this.db
          .prepare('SELECT COUNT(*) as n FROM cards WHERE cached_at > ?')
          .get(Date.now() - TTL_MS) as { n: number }
      ).n;
      return { total, fresh };
    } catch (err) {
      logger.error('[cache] stats query failed:', err);
      return { total: -1, fresh: -1 };
    }
  }

  close(): void {
    this.db.close();
  }
}
