import { pgTable, text, integer, jsonb, bigint, primaryKey, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const userData = pgTable('user_data', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  collection: jsonb('collection'),
  binders: jsonb('binders').notNull().default([]),
  decks: jsonb('decks').notNull().default([]),
  games: jsonb('games').notNull().default([]),
  version: integer('version').notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/**
 * Live multi-device game sessions. The full game state (players, life totals,
 * commander damage, event log) lives in `state` JSONB; clients poll GET and
 * mutate via PATCH with optimistic concurrency on `version`. Finished sessions
 * are kept briefly so each participant's client can pull the final snapshot
 * into its own history, then expired by a periodic sweep.
 */
export const gameSessions = pgTable('game_sessions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  hostUserId: text('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  state: jsonb('state').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/**
 * Global Commander Spellbook combo dataset. One row per combo variant; the
 * full card set lives in `comboCards`. Refreshed nightly from the Spellbook
 * bulk export — see `combos/ingest.ts`. Reference data, not user data.
 */
export const combos = pgTable('combos', {
  id: text('id').primaryKey(),
  identity: text('identity').notNull(),
  produces: jsonb('produces').notNull().$type<string[]>(),
  /**
   * Structured prerequisites mirroring Spellbook's split:
   *   { easy?: string, notable?: string }
   * Stored as JSONB so we can render distinct sections in the UI without a
   * second lookup. Both fields are optional — most combos have one or the
   * other, some have both, some have neither.
   */
  prerequisites: jsonb('prerequisites').$type<{ easy?: string; notable?: string }>(),
  description: text('description'),
  manaNeeded: text('mana_needed'),
  popularity: integer('popularity').notNull().default(0),
  legalities: jsonb('legalities').notNull().$type<Record<string, string>>(),
  cardCount: integer('card_count').notNull(),
  bracket: integer('bracket'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const comboCards = pgTable(
  'combo_cards',
  {
    comboId: text('combo_id')
      .notNull()
      .references(() => combos.id, { onDelete: 'cascade' }),
    oracleId: text('oracle_id').notNull(),
    cardName: text('card_name').notNull(),
    /** Number of copies of this card the combo needs (Spellbook `uses[].quantity`). */
    quantity: integer('quantity').notNull().default(1),
    position: integer('position').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.comboId, t.oracleId] }),
    oracleIdx: index('combo_cards_oracle_idx').on(t.oracleId),
  })
);

export const comboIngestRuns = pgTable('combo_ingest_runs', {
  id: text('id').primaryKey(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  finishedAt: bigint('finished_at', { mode: 'number' }),
  combosWritten: integer('combos_written'),
  source: text('source').notNull(),
  error: text('error'),
});

export type UserRow = typeof users.$inferSelect;
export type UserDataRow = typeof userData.$inferSelect;
export type GameSessionRow = typeof gameSessions.$inferSelect;
export type ComboRow = typeof combos.$inferSelect;
export type ComboCardRow = typeof comboCards.$inferSelect;
export type ComboIngestRunRow = typeof comboIngestRuns.$inferSelect;
