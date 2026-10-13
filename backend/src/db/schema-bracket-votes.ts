/**
 * Bracket feedback labels (E418): a signed-in owner's answer to "does this
 * estimate look right?", one row per user, deck and deck content. Personal and
 * never public; the only reader is the admin export, which a human reviews
 * before any calibration batch. Labels never tune the estimator on their own.
 *
 * `deck_hash` fingerprints the card list the estimate was made from, so
 * re-voting on the same list updates the row and an edited list starts a new
 * one. Queried with raw SQL (routes/bracket-votes.ts), so there is no Drizzle
 * table: db/schema.ts is at its size ceiling.
 *
 * The DDL for ensureSchema() (db/index.ts) and the test schema (test-helpers.ts).
 * Rows go with the account (FK cascade) and with the deck (the sync hook).
 */
export const BRACKET_VOTES_DDL = `
    CREATE TABLE IF NOT EXISTS bracket_votes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL,
      deck_hash TEXT NOT NULL,
      estimator_version INTEGER NOT NULL,
      estimated_bracket SMALLINT NOT NULL,
      signals JSONB NOT NULL,
      stated_bracket SMALLINT NOT NULL,
      vote TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, deck_id, deck_hash)
    );
    CREATE INDEX IF NOT EXISTS bracket_votes_deck_idx ON bracket_votes(user_id, deck_id);
`;
