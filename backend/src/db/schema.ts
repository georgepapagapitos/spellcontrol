import { pgTable, text, integer, jsonb, bigint } from 'drizzle-orm/pg-core';

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

export type UserRow = typeof users.$inferSelect;
export type UserDataRow = typeof userData.$inferSelect;
export type GameSessionRow = typeof gameSessions.$inferSelect;
