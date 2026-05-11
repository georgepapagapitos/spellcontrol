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
  version: integer('version').notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type UserDataRow = typeof userData.$inferSelect;
