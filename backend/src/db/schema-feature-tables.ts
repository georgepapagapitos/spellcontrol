import { BRACKET_VOTES_DDL } from './schema-bracket-votes';
import { POD_DECKS_DDL } from './schema-pod-decks';
import { RESOURCE_PUBLICATIONS_DDL } from './schema-resource-publications';

/**
 * The raw-SQL tables that have no Drizzle table (db/schema.ts and db/index.ts
 * are at their size ceilings), joined so ensureSchema() (db/index.ts) and the
 * test schema (test-helpers.ts) each take one import and one interpolation.
 * A new table of this kind goes here, not into those two files.
 */
export const FEATURE_TABLES_DDL = `${RESOURCE_PUBLICATIONS_DDL}\n${BRACKET_VOTES_DDL}\n${POD_DECKS_DDL}`;
