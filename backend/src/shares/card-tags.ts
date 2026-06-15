/**
 * Server-side Scryfall oracle-tag lookup for shared-binder projections.
 *
 * A binder rule can match on a Scryfall otag (e.g. "mana-rock"); the routing
 * engine reads `EnrichedCard.tags`. The frontend decorates cards from the
 * bundled `tagger-tags.json` snapshot — this is the server's mirror so a
 * shared-link projection routes identically to the owner's own app (no drift).
 *
 * The snapshot is already in the runtime image: `backend/Dockerfile` copies
 * `frontend/dist` → `backend/public`, and Vite copies `public/tagger-tags.json`
 * into `dist`. So we just read it off disk (same dir server.ts serves the SPA
 * from). In local dev / tests that dir doesn't exist (the SPA isn't built) —
 * the loader degrades to "no tags", so tag rules simply match nothing rather
 * than erroring. ponytail: piggyback on the existing copy, no second 889 KB
 * asset committed; the upgrade path if that COPY ever changes is to commit a
 * backend copy + refresh it like the frontend's refresh-tagger.mjs does.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

const SNAPSHOT_PATH =
  process.env.TAGGER_SNAPSHOT_PATH ??
  path.join(__dirname, '..', '..', 'public', 'tagger-tags.json');

let tagsByName: Map<string, string[]> | null = null;
let loaded = false;

/** Load + index the snapshot once. Missing file → empty index (graceful). */
function ensureLoaded(): Map<string, string[]> {
  if (loaded) return tagsByName ?? new Map();
  loaded = true;
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw) as { tags?: Record<string, string[]> };
    const byName = new Map<string, string[]>();
    for (const [tag, names] of Object.entries(data.tags ?? {})) {
      for (const name of names) {
        const list = byName.get(name);
        if (list) list.push(tag);
        else byName.set(name, [tag]);
      }
    }
    tagsByName = byName;
  } catch {
    // No snapshot on disk (dev/test) — tag rules match nothing. Not an error.
    tagsByName = new Map();
  }
  return tagsByName;
}

/** Cheap walk of raw binder JSONB: does any rule read oracle tags? */
export function anyBinderUsesTagRules(bindersRaw: unknown): boolean {
  if (!Array.isArray(bindersRaw)) return false;
  return bindersRaw.some((b) => {
    const groups = (b as { filterGroups?: unknown })?.filterGroups;
    if (!Array.isArray(groups)) return false;
    return groups.some((g) => {
      const chips = (g as { filter?: { oracleTagChips?: { chips?: unknown } } })?.filter
        ?.oracleTagChips?.chips;
      return Array.isArray(chips) && chips.length > 0;
    });
  });
}

/** Decorate cards with `.tags` from the snapshot (only copies cards that have tags). */
export function decorateCardsWithTags(cards: EnrichedCard[]): EnrichedCard[] {
  const byName = ensureLoaded();
  if (byName.size === 0) return cards;
  return cards.map((c) => {
    const tags = byName.get(c.name);
    return tags ? { ...c, tags } : c;
  });
}
