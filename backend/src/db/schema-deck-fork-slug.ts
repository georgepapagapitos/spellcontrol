/**
 * A copy of a public deck carries `forkedFrom.slug` in its data blob. Those
 * live copies are the deck's copy count (publications/copies.ts) and a
 * trending signal (aggregates/trending-decks.ts), so both scan for them.
 *
 * The slug is a STORED generated column, not an expression read at query
 * time. A deck's blob lives in TOAST and the planner doesn't cost
 * decompressing it: with the expression it chose a seq scan that detoasted
 * every deck on every /api/aggregates/trending (150 ms over 50 MB locally),
 * while an index on the same expression sat unused even with expression
 * statistics. The column sits in the heap, so a scan of it never detoasts.
 *
 * Raw SQL with no Drizzle column, since db/schema.ts is at its size ceiling.
 * The ALTER runs after `user_decks` exists in both ensureSchema() and the
 * test schema, through FEATURE_TABLES_DDL.
 */
export const DECK_FORK_SLUG_DDL = `
    ALTER TABLE user_decks ADD COLUMN IF NOT EXISTS forked_from_slug TEXT
      GENERATED ALWAYS AS (data->'forkedFrom'->>'slug') STORED;
    DROP INDEX IF EXISTS user_decks_forked_from_idx;
    CREATE INDEX IF NOT EXISTS user_decks_forked_from_slug_idx
      ON user_decks (forked_from_slug)
      WHERE deleted_at IS NULL AND forked_from_slug IS NOT NULL;
`;
