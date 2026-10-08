import { date, integer, pgTable, primaryKey, smallint, text } from 'drizzle-orm/pg-core';

/**
 * Suggestion labels (E518): a per-day aggregate of what players did with a
 * suggestion. Deliberately no user, deck or session column (routes/suggestion-labels.ts).
 */
export const suggestionCounts = pgTable(
  'suggestion_counts',
  {
    day: date('day', { mode: 'string' }).notNull(),
    surface: text('surface').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull().default(''),
    rank: smallint('rank').notNull().default(0),
    commander: text('commander').notNull(),
    partner: text('partner').notNull().default(''),
    cardIn: text('card_in').notNull().default(''),
    cardOut: text('card_out').notNull().default(''),
    commanderName: text('commander_name').notNull().default(''),
    count: integer('count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({
      columns: [
        t.day,
        t.surface,
        t.action,
        t.reason,
        t.rank,
        t.commander,
        t.partner,
        t.cardIn,
        t.cardOut,
      ],
    }),
  })
);
