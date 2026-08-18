import { logger } from './logger';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ScryfallCard, Ruling } from './types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Colour-identity bits, so "fits inside this commander's identity" is one AND. */
const COLOR_BITS: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };

/** `['B','G'] -> 20`. Colourless is 0, which is a subset of every identity. */
export function colorIdentityMask(identity: readonly string[] | undefined): number {
  let mask = 0;
  for (const c of identity ?? []) mask |= COLOR_BITS[c.toUpperCase()] ?? 0;
  return mask;
}

/**
 * Turn free text into a safe FTS5 MATCH expression.
 *
 * Callers pass an EFFECT in plain words ("destroy target artifact"), never FTS5
 * syntax — the eventual caller is a language model, and letting it hand-write
 * match expressions means a stray `"` or `*` throws `fts5: syntax error` instead
 * of returning cards. Every token is quoted (so operator words like AND/OR/NOT
 * and punctuation are literal) and joined with AND, which is the right default
 * for effect search: "destroy artifact" should match "destroy target artifact",
 * so this is deliberately an all-terms-present match rather than a phrase.
 *
 * Returns null when nothing searchable survives, so the caller can return no
 * results rather than issue a query that matches everything.
 */
export function toMatchExpression(query: string, join: 'AND' | 'OR' = 'AND'): string | null {
  const tokens = String(query ?? '')
    // FTS5 treats these as syntax; strip rather than escape so a model's stray
    // punctuation degrades into a plain word search instead of an error.
    .replace(/["*():^-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(` ${join} `);
}

/** One card as the oracle-text search returns it. Printing-agnostic. */
export interface CardSearchResult {
  oracleId: string;
  name: string;
  typeLine: string;
  oracleText: string;
  cmc: number | null;
  colorIdentity: string;
}

export interface CardSearchOptions {
  /** Plain-language effect text. Not FTS5 syntax — see {@link toMatchExpression}. */
  query: string;
  /** Only cards whose colour identity fits INSIDE this one (e.g. ['B','G']). */
  colorIdentity?: readonly string[];
  /** Restrict to cards legal in Commander. */
  commanderLegalOnly?: boolean;
  /** Substring match on the type line, e.g. 'Instant', 'Land'. */
  typeLine?: string;
  /** Names to exclude — the deck's own cards, so results are things it lacks. */
  exclude?: readonly string[];
  /**
   * Names to restrict TO — the player's own collection, when a caller may only
   * suggest cards they physically have. Unlike {@link exclude} this cannot be
   * applied after the query: the owned cards for a niche effect routinely rank
   * below the LIMIT, so post-filtering would answer "you own nothing that does
   * this" when the collection plainly holds something.
   */
  ownedNames?: readonly string[];
  limit?: number;
}

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 100;
/** Rows per backfill page — bounds both heap and WAL growth. ~22MB of JSON. */
const BACKFILL_PAGE_SIZE = 5000;

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
  private setRulingsStmt: Database.Statement;
  /** Null when the FTS5 index could not be created — search then returns []. */
  private searchInsertStmt: Database.Statement | null = null;
  private searchDeleteStmt: Database.Statement | null = null;
  private searchRowidStmt: Database.Statement | null = null;
  private searchMapSetStmt: Database.Statement | null = null;

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
      CREATE TABLE IF NOT EXISTS card_rulings (
        scryfall_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `);

    this.setStmt = this.db.prepare(
      'INSERT OR REPLACE INTO cards (scryfall_id, data, cached_at) VALUES (?, ?, ?)'
    );
    this.setLookupStmt = this.db.prepare(
      'INSERT OR REPLACE INTO card_lookups (lookup_key, scryfall_id, cached_at) VALUES (?, ?, ?)'
    );
    this.setRulingsStmt = this.db.prepare(
      'INSERT OR REPLACE INTO card_rulings (scryfall_id, data, cached_at) VALUES (?, ?, ?)'
    );

    this.ensureSearchIndex();
  }

  /**
   * Full-text index over the oracle text already sitting in this cache.
   *
   * Until now the cache could only answer EXACT name lookups, so the only way to
   * ask "what cards do this?" was to call Scryfall — which we can't do at any
   * volume from a shared Fly IP. ~100k cards' rules text is already here; this
   * makes it searchable locally, which is what lets the AI features propose
   * cards they actually retrieved rather than ones they remember.
   *
   * One row per PRINTING (1:1 with `cards`, so the incremental path in
   * `setMany` stays a plain insert) and deduped to one row per `oracle_id` at
   * QUERY time — otherwise a search returns the same card twenty times.
   *
   * The filterable columns are UNINDEXED: they're returned and compared, never
   * tokenized, so they don't bloat the term index.
   */
  private ensureSearchIndex(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS card_search USING fts5(
          name, type_line, oracle_text,
          scryfall_id UNINDEXED,
          oracle_id UNINDEXED,
          ci_mask UNINDEXED,
          commander_legal UNINDEXED,
          cmc UNINDEXED,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);

      this.searchInsertStmt = this.db.prepare(
        `INSERT INTO card_search
           (name, type_line, oracle_text, scryfall_id, oracle_id, ci_mask, commander_legal, cmc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // ⛔ Do NOT go back to `DELETE FROM card_search WHERE scryfall_id = ?`.
      //
      // `scryfall_id` is an UNINDEXED fts5 column, so that delete cannot seek —
      // it FULL SCANS the index. Per-card cost therefore grows with the index,
      // making a full re-ingest O(n^2). Measured on this exact schema:
      //
      //   index size    cost per card       (500 reindexes)
      //   5,000         0.73 ms
      //   20,000        2.83 ms
      //   50,000        7.77 ms
      //   107,383      22.94 ms   <- production
      //
      // At 22.94 ms x 107k cards that is ~40 minutes of pure FTS work on a
      // local SSD, and on the Fly volume it was ~12 HOURS: the nightly ingest
      // ran all night, degraded latency the whole time, and had never once
      // completed (board E259 / the 2026-08-17 outage post-mortem).
      //
      // Deleting by `rowid` seeks instead, and is flat in the index size —
      // 129 ms for the same 500 reindexes at n=107,383, a ~90x improvement.
      // `card_search_map` is what makes the rowid reachable, since fts5 has no
      // upsert and `cards` uses INSERT OR REPLACE (which churns its own rowid,
      // so it cannot be borrowed).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS card_search_map (
          scryfall_id TEXT PRIMARY KEY,
          rid INTEGER NOT NULL
        );
      `);
      this.searchRowidStmt = this.db.prepare(
        'SELECT rid FROM card_search_map WHERE scryfall_id = ?'
      );
      this.searchMapSetStmt = this.db.prepare(
        'INSERT OR REPLACE INTO card_search_map (scryfall_id, rid) VALUES (?, ?)'
      );
      this.searchDeleteStmt = this.db.prepare('DELETE FROM card_search WHERE rowid = ?');

      // An index that predates the map has no rowids recorded. Without this the
      // first reindex of every card would find no rid, skip the delete, and
      // silently accumulate DUPLICATE index rows — the exact bug the delete
      // exists to prevent. One scan of the index, and only when it is missing.
      const mapped = (
        this.db.prepare('SELECT COUNT(*) AS n FROM card_search_map').get() as { n: number }
      ).n;
      if (mapped === 0) {
        const t0 = Date.now();
        this.db.exec(
          'INSERT OR REPLACE INTO card_search_map (scryfall_id, rid) ' +
            'SELECT scryfall_id, rowid FROM card_search'
        );
        const n = (
          this.db.prepare('SELECT COUNT(*) AS n FROM card_search_map').get() as { n: number }
        ).n;
        if (n > 0)
          logger.info(`[cache] built card_search rowid map (${n} rows) in ${Date.now() - t0}ms`);
      }

      // Backfill only when the index is empty but cards exist — i.e. the first
      // boot after this shipped, or after someone dropped the table. Measured
      // ~1.3s for 107k rows, so it is a one-time cost, not a per-boot one.
      const indexed = (
        this.db.prepare('SELECT COUNT(*) AS n FROM card_search').get() as { n: number }
      ).n;
      if (indexed > 0) return;
      const cards = (this.db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
      if (cards === 0) return;

      const started = Date.now();
      // Read in PAGES, never `.all()` and never `.iterate()`.
      //
      // `.all()` materialises every blob at once — the rows are full Scryfall
      // JSON, ~470MB across 107k cards, which is a heap spike that matters on
      // the 2GB production VM (we have OOM'd on bulk card data before).
      //
      // `.iterate()` looks like the fix and is a trap: better-sqlite3
      // invalidates an open iterator as soon as another statement runs on the
      // same connection, and we insert into `card_search` inside the loop. It
      // does not throw — the loop just stops early. Measured against the real
      // cache it indexed 16 of 107,369 cards and reported success.
      //
      // Keyset pagination over the primary key keeps memory bounded (one page
      // of blobs) without an open cursor, and costs nothing extra since
      // `scryfall_id` is the PK. One transaction per page also bounds WAL
      // growth, which matters on a 1GB volume.
      const page = this.db.prepare(
        'SELECT scryfall_id, data FROM cards WHERE scryfall_id > ? ORDER BY scryfall_id LIMIT ?'
      );
      const indexPage = this.db.transaction((items: Array<{ data: string }>) => {
        for (const row of items) {
          try {
            this.indexCard(JSON.parse(row.data) as ScryfallCard);
          } catch {
            // A single unparseable blob shouldn't abort the whole backfill.
          }
        }
      });

      let after = '';
      let count = 0;
      for (;;) {
        const rows = page.all(after, BACKFILL_PAGE_SIZE) as Array<{
          scryfall_id: string;
          data: string;
        }>;
        if (rows.length === 0) break;
        indexPage(rows);
        count += rows.length;
        after = rows[rows.length - 1].scryfall_id;
        if (rows.length < BACKFILL_PAGE_SIZE) break;
      }
      logger.info(
        `[cache] built oracle-text search index over ${count} cards in ${Date.now() - started}ms`
      );
    } catch (err) {
      // A missing index degrades card search to "no results"; it must never
      // stop the cache — and therefore the server — from starting.
      logger.error('[cache] could not build card_search index, oracle search unavailable:', err);
    }
  }

  /**
   * Index one printing. Shared by the backfill and `setMany` so the flattening
   * rules live in exactly one place — the reason this is TypeScript rather than
   * a SQLite trigger over `json_extract`, which would have been a second
   * implementation of the same transform, free to drift.
   */
  private indexCard(card: ScryfallCard): void {
    if (!this.searchInsertStmt) return;
    // Multi-face layouts carry their rules text per face, so a search for a back
    // face's ability would miss the card entirely if we only read the top level.
    const faces = card.card_faces ?? [];
    const oracleText =
      card.oracle_text ||
      faces
        .map((f) => f.oracle_text ?? '')
        .filter(Boolean)
        .join('\n//\n');
    const typeLine =
      card.type_line ||
      faces
        .map((f) => f.type_line ?? '')
        .filter(Boolean)
        .join(' // ');
    if (!oracleText && !typeLine) return;

    const info = this.searchInsertStmt.run(
      card.name ?? '',
      typeLine,
      oracleText,
      card.id,
      card.oracle_id ?? '',
      colorIdentityMask(card.color_identity),
      card.legalities?.commander === 'legal' ? 1 : 0,
      typeof card.cmc === 'number' ? card.cmc : null
    );
    // Remember where it landed so the next reindex can seek straight to it.
    this.searchMapSetStmt?.run(card.id, info.lastInsertRowid as number);
  }

  /**
   * Returns map of scryfallId -> card for all fresh hits. Misses are simply omitted.
   *
   * `allowStale` serves the readers that only want ORACLE facts (name, type
   * line, oracle text, cmc) rather than prices. The TTL exists because prices
   * move; a card's rules text does not, so expiring an oracle-only read just
   * forces a pointless Scryfall round-trip. Never pass it on a price path.
   *
   * `maxAgeMs` tightens the bar below the default TTL. The price refresh passes
   * a day-and-a-half window: the nightly bulk ingest restamps every printing,
   * so a row older than that means the ingest has been missing runs, and those
   * prices shouldn't be trusted for money.
   */
  getMany(
    scryfallIds: string[],
    allowStale = false,
    maxAgeMs: number = TTL_MS
  ): Map<string, ScryfallCard> {
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
        if (!allowStale && now - row.cached_at > maxAgeMs) continue;
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
   * within the TTL for a hit — unless `allowStale`, which oracle-only readers
   * pass for the reason documented on {@link getMany}.
   */
  getManyByKeys(keys: string[], allowStale = false): Map<string, ScryfallCard> {
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
        if (!allowStale && now - row.lookup_cached_at > TTL_MS) continue;
        if (!allowStale && now - row.card_cached_at > TTL_MS) continue;
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
   * Cheapest cached paper printing of a card by exact name — the bulk dump's
   * answer to `/cards/named`, with no network involved.
   *
   * `cardAliasKeys` deliberately skips the bare `n:<name>` alias because a name
   * maps to many printings and we don't replicate Scryfall's "best printing"
   * heuristic. We don't have to: the `card_lookups` primary key already indexes
   * every printing under `ns:<name>|<set>`, so a bounded range scan over that
   * prefix enumerates a card's printings and we pick from them ourselves. No new
   * index, and no `json_extract` scan of the 100k-row `cards` table.
   *
   * The upper bound stays inside the `ns:` namespace, which also excludes the
   * `nsc:` (name+set+collector) keys — they sort after every `ns:` key, since
   * `'c' > ':'`.
   *
   * Selection mirrors the frontend's price-ordered `/cards/search` fallback:
   * cheapest nonfoil USD, else cheapest foil USD, else whatever printing came
   * back. Returns null when nothing is cached inside `maxAgeMs`, which the
   * caller reads as "go ask Scryfall".
   */
  getCheapestByName(name: string, maxAgeMs: number = TTL_MS): ScryfallCard | null {
    // Multi-face names are stored under the front face (see cardAliasKeys).
    const front = name.split(' // ')[0].trim().toLowerCase();
    if (!front) return null;

    try {
      const stmt = this.db.prepare(
        `SELECT c.data AS data, l.cached_at AS lookup_cached_at, c.cached_at AS card_cached_at
           FROM card_lookups l
           JOIN cards c ON c.scryfall_id = l.scryfall_id
          WHERE l.lookup_key >= ? AND l.lookup_key < ?`
      );
      const rows = stmt.all(`ns:${front}|`, `ns:${front}|￿`) as Array<{
        data: string;
        lookup_cached_at: number;
        card_cached_at: number;
      }>;

      const now = Date.now();
      const cards: ScryfallCard[] = [];
      for (const row of rows) {
        if (now - row.lookup_cached_at > maxAgeMs) continue;
        if (now - row.card_cached_at > maxAgeMs) continue;
        try {
          cards.push(JSON.parse(row.data));
        } catch {
          /* skip malformed */
        }
      }
      if (cards.length === 0) return null;

      // Infinity == "no price in this currency", so it always loses the min.
      // Not `Number(raw)` alone: the dump writes an absent price as null, and
      // `Number(null)` is 0 — which read as free and beat every real price.
      const priceOf = (card: ScryfallCard, key: 'usd' | 'usd_foil'): number => {
        const raw = card.prices?.[key];
        if (raw == null || raw === '') return Infinity;
        const n = Number(raw);
        return Number.isFinite(n) ? n : Infinity;
      };
      const cheapestBy = (key: 'usd' | 'usd_foil'): ScryfallCard | null =>
        cards.reduce<ScryfallCard | null>(
          (best, card) =>
            priceOf(card, key) < (best ? priceOf(best, key) : Infinity) ? card : best,
          null
        );

      return cheapestBy('usd') ?? cheapestBy('usd_foil') ?? cards[0];
    } catch (err) {
      logger.error('[cache] getCheapestByName failed, treating as cache miss:', err);
      return null;
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
          // Keep the oracle-text index in step with the rows it indexes. Cheap
          // (~80k rows/sec measured), and without it a newly-cached set stays
          // invisible to card search until someone rebuilds the index.
          this.reindexCard(card);
        }
      });
      insert(cards);
    } catch (err) {
      logger.error('[cache] setMany failed, cards will not be cached:', err);
    }
  }

  /**
   * Re-index one printing. `cards` uses INSERT OR REPLACE, but FTS5 has no
   * upsert, so the old row is deleted first — otherwise re-caching a card (which
   * the price refresh does routinely) would accumulate duplicate index rows.
   */
  private reindexCard(card: ScryfallCard): void {
    if (!this.searchDeleteStmt || !this.searchRowidStmt) return;
    const existing = this.searchRowidStmt.get(card.id) as { rid: number } | undefined;
    if (existing) this.searchDeleteStmt.run(existing.rid);
    this.indexCard(card);
  }

  /**
   * Search the cached oracle text. Returns one row per ORACLE card (not per
   * printing), best match first.
   *
   * ⚠️ Deliberately ignores the 7-day TTL. That TTL exists because PRICES move;
   * a card's rules text does not — the same reasoning `getMany`'s `allowStale`
   * already documents. Honouring it here would make search results vanish as
   * rows aged out and force exactly the Scryfall round-trips this index exists
   * to avoid. Never read a price off these results.
   */
  searchCards(options: CardSearchOptions): CardSearchResult[] {
    if (!this.searchInsertStmt) return [];
    // Require every term first — that is the precise answer when it exists.
    // Fall back to ANY term (bm25 still ranks best-overlap first) when it finds
    // nothing, because an all-terms match is unforgiving of conceptual phrasing:
    // "graveyard cards cannot be exiled" returned 0 against the real 107k-card
    // cache even though the effect plainly exists. An empty result is the worst
    // possible answer here — it sends the caller back to reciting cards from
    // memory, which is the whole failure this index exists to remove.
    const strict = this.runSearch(options, 'AND');
    if (strict.length > 0) return strict;
    return this.runSearch(options, 'OR');
  }

  private runSearch(options: CardSearchOptions, join: 'AND' | 'OR'): CardSearchResult[] {
    const match = toMatchExpression(options.query, join);
    if (!match) return [];

    const limit = Math.min(Math.max(1, options.limit ?? SEARCH_LIMIT_DEFAULT), SEARCH_LIMIT_MAX);
    const where: string[] = ['card_search MATCH ?'];
    const params: Array<string | number> = [match];

    if (options.commanderLegalOnly) where.push('commander_legal = 1');
    if (options.colorIdentity) {
      // Subset test: every colour bit the card needs must be present in the
      // deck's identity. Colourless (0) passes against every identity.
      where.push('(ci_mask & ~?) = 0');
      params.push(colorIdentityMask(options.colorIdentity));
    }
    if (options.typeLine) {
      where.push('type_line LIKE ?');
      params.push(`%${options.typeLine}%`);
    }
    if (options.ownedNames) {
      // ONE bound parameter whatever the collection's size. A literal IN list
      // would need a placeholder per owned name — tens of thousands of them for
      // a real collection, past SQLite's variable limit — so the names ride in
      // as a single JSON array and json_each unpacks them. Compared
      // case-insensitively because collection rows and cache rows are entered
      // by different paths.
      where.push('lower(name) IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(options.ownedNames.map((n) => n.toLowerCase())));
    }

    try {
      const rows = this.db
        .prepare(
          `SELECT oracle_id, name, type_line, oracle_text, ci_mask, MIN(cmc) AS cmc
             FROM card_search
            WHERE ${where.join(' AND ')}
            GROUP BY oracle_id
            ORDER BY rank
            LIMIT ?`
        )
        // Over-fetch by the exclusion count: excluded cards are dropped below,
        // and a deck that already runs the top matches would otherwise get an
        // empty answer to a perfectly good question.
        .all(...params, limit + (options.exclude?.length ?? 0)) as Array<{
        oracle_id: string;
        name: string;
        type_line: string;
        oracle_text: string;
        ci_mask: number;
        cmc: number | null;
      }>;

      // Excluding by NAME in SQL would need a variable-length IN clause for what
      // is usually a 100-card decklist; filtering here keeps the query fixed.
      const excluded = new Set((options.exclude ?? []).map((n) => n.toLowerCase()));
      return rows
        .filter((r) => !excluded.has(r.name.toLowerCase()))
        .slice(0, limit)
        .map((r) => ({
          oracleId: r.oracle_id,
          name: r.name,
          typeLine: r.type_line,
          oracleText: r.oracle_text,
          cmc: r.cmc,
          colorIdentity: Object.entries(COLOR_BITS)
            .filter(([, bit]) => (r.ci_mask & bit) !== 0)
            .map(([c]) => c)
            .join(''),
        }));
    } catch (err) {
      logger.error('[cache] searchCards failed, returning no results:', err);
      return [];
    }
  }

  /** Returns cached rulings for a card id, or null on miss/stale. */
  getRulings(scryfallId: string): Ruling[] | null {
    try {
      const row = this.db
        .prepare('SELECT data, cached_at FROM card_rulings WHERE scryfall_id = ?')
        .get(scryfallId) as { data: string; cached_at: number } | undefined;
      if (!row || Date.now() - row.cached_at > TTL_MS) return null;
      return JSON.parse(row.data) as Ruling[];
    } catch (err) {
      logger.error('[cache] getRulings failed, treating as cache miss:', err);
      return null;
    }
  }

  /** Persists rulings for a card id. An empty array is a valid cache entry. */
  setRulings(scryfallId: string, rulings: Ruling[]): void {
    try {
      this.setRulingsStmt.run(scryfallId, JSON.stringify(rulings), Date.now());
    } catch (err) {
      logger.error('[cache] setRulings failed, rulings will not be cached:', err);
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
