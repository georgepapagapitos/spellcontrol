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
 * Pre-overwrite safety net for the collection-wipe path. A PUT /api/sync that
 * replaces a non-empty stored collection with null/empty is the documented
 * destructive-wipe hazard; before applying it the route stashes the prior
 * full snapshot here so the user can restore it. Bounded to the 3 most recent
 * per user (ring) by the route — old rows are pruned on insert.
 */
export const userDataBackups = pgTable(
  'user_data_backups',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Full prior SyncSnapshot (collection/binders/decks/games/version/updatedAt). */
    snapshot: jsonb('snapshot').notNull(),
    /** Why the backup was taken — currently always 'collection-wipe'. */
    reason: text('reason').notNull(),
    priorVersion: integer('prior_version').notNull(),
    priorCardCount: integer('prior_card_count').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    userIdx: index('user_data_backups_user_idx').on(t.userId, t.createdAt),
  })
);

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

/**
 * Public share links. Each row maps an unguessable token to a slice of a user's
 * data: the whole collection, a single binder, a single deck, or a single list.
 * The public read route looks up the row, loads that user's user_data, projects
 * the requested slice through the public-projection layer, and returns it.
 * Revoking sets revokedAt; revoked tokens 404.
 *
 * `resourceId` is the in-blob id of the binder/deck/list. For kind='collection'
 * it is unused (stored as empty string) — there's only one collection per user.
 */
export const shares = pgTable(
  'shares',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<'collection' | 'binder' | 'deck' | 'list'>(),
    resourceId: text('resource_id').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
  },
  (t) => ({
    userIdx: index('shares_user_idx').on(t.userId),
    resourceIdx: index('shares_resource_idx').on(t.userId, t.kind, t.resourceId),
  })
);

export type UserRow = typeof users.$inferSelect;
export type UserDataRow = typeof userData.$inferSelect;
export type UserDataBackupRow = typeof userDataBackups.$inferSelect;
export type GameSessionRow = typeof gameSessions.$inferSelect;
export type ComboRow = typeof combos.$inferSelect;
export type ComboCardRow = typeof comboCards.$inferSelect;
export type ComboIngestRunRow = typeof comboIngestRuns.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
