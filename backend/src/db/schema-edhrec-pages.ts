import { bigint, customType, integer, pgTable, text } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * EDHREC's per-page JSON (commander, tag, card, combo pages), one row per
 * EDHREC path, served by GET /api/edhrec/page/*. `body` is the page exactly as
 * EDHREC sent it, gzipped; `bytes` is its length, summed to bound the table
 * (edhrec/page-store.ts); `servedAt` orders eviction. A cache, not user data.
 *
 * Its own file because db/schema.ts and db/index.ts are at their size
 * ceilings; the DDL is shared by ensureSchema() and the test schema through
 * schema-feature-tables.ts.
 */
export const edhrecPages = pgTable('edhrec_pages', {
  path: text('path').primaryKey(),
  body: bytea('body').notNull(),
  bytes: integer('bytes').notNull(),
  fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull(),
  checkedAt: bigint('checked_at', { mode: 'number' }).notNull(),
  servedAt: bigint('served_at', { mode: 'number' }).notNull(),
});

export const EDHREC_PAGES_DDL = `
    CREATE TABLE IF NOT EXISTS edhrec_pages (
      path TEXT PRIMARY KEY,
      body BYTEA NOT NULL,
      bytes INTEGER NOT NULL,
      fetched_at BIGINT NOT NULL,
      checked_at BIGINT NOT NULL,
      served_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS edhrec_pages_served_idx ON edhrec_pages(served_at);
`;
