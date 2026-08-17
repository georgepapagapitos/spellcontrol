import fs from 'node:fs';
import path from 'node:path';
import { createTagLookup, type TagLookup } from '@spellcontrol/deck-metrics';
import { logger } from '../logger';

/**
 * Server-side tag data for the bracket estimator.
 *
 * ⚠️ **The failure mode here is a WRONG ANSWER, not a crash.** Every predicate a
 * `TagLookup` exposes returns `false`/`null` on a miss, so a lookup built over
 * missing data reports that no card in any deck is mass land denial, takes an
 * extra turn, or has a role — and `estimateBracket` then hands back a confident,
 * too-low bracket. That is exactly what forced tag membership to become an
 * injected parameter when the estimator moved into `@spellcontrol/deck-metrics`.
 *
 * So this module never degrades to an empty lookup. It returns `null` when the
 * data is absent, and the caller must treat `null` as "this tool is
 * unavailable" rather than as "nothing matched".
 */

/**
 * Where `tagger-tags.json` actually is, in the two places this runs.
 *
 * In the image, `backend/Dockerfile` copies `frontend/dist` (which Vite fills
 * from `frontend/public`) into `backend/public`, so the file ships as a static
 * asset alongside the SPA. In a dev checkout there is no `backend/public`, so
 * fall back to the frontend's source copy.
 */
function candidatePaths(): string[] {
  // Resolved per call, not at import: a module-level constant would freeze the
  // paths against whatever `cwd` happened to be when the module first loaded,
  // which is both fragile and untestable.
  return [
    path.join(process.cwd(), 'public', 'tagger-tags.json'),
    path.join(process.cwd(), '..', 'frontend', 'public', 'tagger-tags.json'),
  ];
}

interface TaggerFile {
  generatedAt?: string;
  tags?: Record<string, string[]>;
}

let cached: TagLookup | null = null;
let attempted = false;

/**
 * The tag lookup, or `null` when the data could not be read.
 *
 * Loaded once and memoised — the file is ~1MB of JSON and the parse is far too
 * expensive to repeat per request. A failure is logged once, loudly, and never
 * retried: if the asset is missing from the image it will still be missing on
 * the next request, and a per-request warning would just flood the log.
 */
export function getTagLookup(): TagLookup | null {
  if (attempted) return cached;
  attempted = true;

  const paths = candidatePaths();
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TaggerFile;
      const tags = parsed.tags;
      if (!tags || Object.keys(tags).length === 0) {
        logger.error(`[ai] tagger data at ${file} has no tags; bracket checks disabled`);
        continue;
      }
      cached = createTagLookup(tags);
      logger.info(
        `[ai] tagger data loaded from ${file} (${Object.keys(tags).length} tags, generated ${parsed.generatedAt ?? 'unknown'})`
      );
      return cached;
    } catch (err) {
      logger.error(`[ai] failed to read tagger data at ${file}`, err);
    }
  }

  logger.error(
    `[ai] no tagger data found (looked in: ${paths.join(', ')}) — ` +
      'bracket checks are DISABLED rather than silently scoring every deck as untagged'
  );
  return null;
}

/** Test seam — the memo would otherwise leak a null result between cases. */
export function __resetTagLookup(): void {
  cached = null;
  attempted = false;
}
