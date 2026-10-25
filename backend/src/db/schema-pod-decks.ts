/**
 * Decks a pod member chose to put in the pod's Rule 0 notes (pods/rule0.ts).
 * A choice only: every read gates again on the deck's own visibility, so a row
 * here never widens who can see a deck. `deck_id` is a soft reference to
 * `user_decks` (the app cascades). Raw SQL, no Drizzle table: db/schema.ts is
 * at its size ceiling. Rows go with the pod and the account (FK cascade), and
 * with the member when they leave or are removed (routes/pods.ts).
 *
 * The DDL for ensureSchema() (db/index.ts) and the test schema (test-helpers.ts),
 * through FEATURE_TABLES_DDL.
 */
export const POD_DECKS_DDL = `
    CREATE TABLE IF NOT EXISTS pod_decks (
      pod_id TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL,
      added_at BIGINT NOT NULL,
      PRIMARY KEY (pod_id, user_id, deck_id)
    );
`;
