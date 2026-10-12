/**
 * Public binder / list pages (E401): the publish state behind /b/:slug and
 * /l/:slug. A sibling of `deck_publications` with only what a page and a
 * profile row need; `slug` is frozen once minted so republishing keeps the URL.
 * Queried with raw SQL (publications/resource-pages.ts, routes/publications.ts),
 * so there is no Drizzle table: db/schema.ts is at its size ceiling and nothing
 * here needs the typed builder.
 *
 * The DDL for ensureSchema() (db/index.ts) and the test schema (test-helpers.ts).
 */
export const RESOURCE_PUBLICATIONS_DDL = `
    CREATE TABLE IF NOT EXISTS resource_publications (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      published_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      unpublished_at BIGINT,
      PRIMARY KEY (user_id, kind, resource_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS resource_publications_slug_idx ON resource_publications(slug);
`;
