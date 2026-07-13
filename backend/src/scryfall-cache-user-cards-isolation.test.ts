import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard (E131 audit): the Scryfall SQLite cache layer (`cache.ts` /
 * `scryfall-cache.ts` / `scryfall.ts` / `scryfall-bulk.ts`) must have NO write
 * — or even read — path into `user_cards`, the per-user Postgres inventory
 * table. The cache holds reference data shared across every user with a
 * 7-day TTL; it has nothing to do with what any particular user owns. This
 * pins that separation so a future "backfill/repair the collection from the
 * cache" convenience can't quietly wire the two together and fabricate
 * ownership data. Static, code-level check — no DB needed: none of these
 * files may reference the Postgres user_cards table or the drizzle db handle
 * at all.
 */
const CACHE_LAYER_FILES = ['cache.ts', 'scryfall-cache.ts', 'scryfall.ts', 'scryfall-bulk.ts'];
const FORBIDDEN = /user_cards|userCards|from ['"]\.{1,2}\/db|drizzle/;

describe('scryfall cache layer has no write path into user_cards', () => {
  for (const file of CACHE_LAYER_FILES) {
    it(`${file} never references user_cards or the Postgres db handle`, () => {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(
        src,
        `${file} must not import or reference the Postgres layer — the Scryfall cache and user inventory are separate stores by construction`
      ).not.toMatch(FORBIDDEN);
    });
  }
});
