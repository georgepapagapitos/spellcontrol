/**
 * Server-side mirror of the frontend's full Scryfall oracle-tag corpus
 * (`frontend/public/otag-index.json`, ~4.5k tags — built by
 * `scripts/refresh-otag-index.mjs`), for the `otag:` clause in Spellbook
 * combo-template queries (see `@spellcontrol/deck-metrics`'s
 * `evaluateTemplate`). NOT the same file as `shares/card-tags.ts`, which
 * reads the smaller 24-tag `tagger-tags.json` for the bracket estimator's own
 * signals (mass-land-denial, extra-turn, …) — different corpus, different job.
 *
 * The snapshot ships in the runtime image the same way: `backend/Dockerfile`
 * copies `frontend/dist` → `backend/public`, and Vite copies
 * `public/otag-index.json` straight through. In local dev/test that path
 * doesn't exist — the loader degrades to "no known tags", so every `otag:`
 * template clause reads null (unsupported) rather than a wrong "satisfied".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OracleTagLookup } from '@spellcontrol/deck-metrics';

const SNAPSHOT_PATH =
  process.env.OTAG_INDEX_PATH ?? path.join(__dirname, '..', '..', 'public', 'otag-index.json');

interface OtagIndexFile {
  tags?: Array<{ s?: unknown }>;
  cards?: Record<string, number[]>;
}

let tagIndexBySlug: Map<string, number> | null = null;
let idsByName: Map<string, Set<number>> | null = null;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw) as OtagIndexFile;
    const bySlug = new Map<string, number>();
    (data.tags ?? []).forEach((t, i) => {
      if (typeof t.s === 'string' && t.s.length > 0) bySlug.set(t.s, i);
    });
    tagIndexBySlug = bySlug;
    const byName = new Map<string, Set<number>>();
    for (const [name, ids] of Object.entries(data.cards ?? {})) {
      byName.set(name, new Set(ids));
    }
    idsByName = byName;
  } catch {
    // No snapshot on disk (dev/test) — every otag: clause is unsupported.
    tagIndexBySlug = new Map();
    idsByName = new Map();
  }
}

/** Build the {@link OracleTagLookup} the backend `check_bracket` tool feeds
 *  to `evaluateTemplate`/`resolveComboTemplates`. Loads (and caches) the
 *  snapshot on first use. */
export function backendOracleTagLookup(): OracleTagLookup {
  ensureLoaded();
  return {
    isKnownTag: (tag) => tagIndexBySlug?.has(tag) ?? false,
    hasTag: (name, tag) => {
      const idx = tagIndexBySlug?.get(tag);
      if (idx === undefined) return false;
      return idsByName?.get(name)?.has(idx) ?? false;
    },
  };
}

/** Test-only: drop the cached snapshot so the next call re-reads disk (a
 *  fresh `OTAG_INDEX_PATH`). */
export function __resetOracleTagLookupForTesting(): void {
  loaded = false;
  tagIndexBySlug = null;
  idsByName = null;
}
